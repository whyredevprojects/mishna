// ---------------------------------------------------------------------------
// The **local development** entry point. Not deployed, ever.
//
//   npm run email:dev:server
//   # = npx wrangler dev apps/server/src/dev-entry.ts \
//   #       --config apps/server/wrangler.toml --persist-to .wrangler/state --port 8787
//
// It is the production worker (`./index`) plus the `/__dev/email/*` workbench. The
// positional script argument overrides `wrangler.toml`'s `main`, so this runs with
// the *same* config: same bindings, same D1 databases, same `[vars]`, same DO and
// Workflow classes — no second toml to drift.
//
// 🔴 Why a separate entry rather than a feature flag: `POST /__dev/email/send` mails
// **any address** as **any user**, with no auth. A flag is a thing you can get wrong
// (unset in one environment, typo'd in another, forgotten in a new handler). This is
// a thing you *cannot* get wrong: `wrangler.toml` pins `main = "src/index.ts"`, which
// never imports this file, so `wrangler deploy` has no path to the dev routes at all.
// The guard is mechanical, and checked:
//
//   cd apps/server && npx wrangler deploy --dry-run --outdir /tmp/wfb
//   grep -c '__dev' /tmp/wfb/index.js     # must print 0
//
// (plus `dev-routes.integration.test.ts`, which asserts the production entry 404s).
//
// The DO and Workflow classes must be re-exported here too: Cloudflare resolves
// `class_name` against the *entry point's* exports, and the entry point is this file
// while `wrangler dev` is running.
// ---------------------------------------------------------------------------

import worker, { AllocatorDO, ReminderWorkflow, app } from './index';
import { mountDevEmailRoutes } from './email/dev-routes';

mountDevEmailRoutes(app);

/**
 * 🔴 Shout if `APP_ORIGIN` still points at production.
 *
 * `wrangler.toml`'s `[vars]` pins the real apex, and `.dev.vars` is what overrides
 * it — so the *default* local state is the dangerous one. Left alone, every email
 * this workbench renders carries an unsubscribe link (footer **and** the RFC 8058
 * `List-Unsubscribe` header) pointing at production, signed with the local secret:
 * click it and you hit the live worker; mail it to a real inbox and the recipient
 * gets an unsubscribe link that cannot verify. The Hebrew text also comes from
 * production rather than the local dev server.
 *
 * Documented in `.dev.vars.example` and `apps/server/CLAUDE.md` — but documentation
 * is not a guard, and this one is invisible until it has already gone out.
 */
let originChecked = false;
function warnOnProductionOrigin(env: Env): void {
  if (originChecked) return;
  originChecked = true;
  const origin = env.APP_ORIGIN ?? '';
  let host = '';
  try {
    host = new URL(origin).hostname;
  } catch {
    host = '';
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return;
  console.warn(
    `\n🔴 email workbench: APP_ORIGIN is ${origin || '(unset)'}, not localhost.\n` +
      `   Unsubscribe links (footer + List-Unsubscribe header) will point at that\n` +
      `   origin while being signed with your LOCAL secret, and Hebrew text will be\n` +
      `   fetched from it. Set APP_ORIGIN=http://localhost:4200 in apps/server/.dev.vars.\n` +
      `   (To keep local links but borrow production's text, pass ?textOrigin=… instead.)\n`,
  );
}

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => {
    warnOnProductionOrigin(env);
    return app.fetch(req, env, ctx);
  },
  // The real cron handler, unchanged — so `wrangler dev --test-scheduled` and
  // `/__dev/email/cron` exercise the production path.
  scheduled: worker.scheduled,
} satisfies ExportedHandler<Env>;

export { AllocatorDO, ReminderWorkflow };
