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

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  // The real cron handler, unchanged — so `wrangler dev --test-scheduled` and
  // `/__dev/email/cron` exercise the production path.
  scheduled: worker.scheduled,
} satisfies ExportedHandler<Env>;

export { AllocatorDO, ReminderWorkflow };
