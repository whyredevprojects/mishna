import { Context, Hono } from 'hono';
import { EmailKind, localParts, weekStartOnOrBefore } from '@mishna/domain';
import {
  OutgoingEmail,
  PreparedEmail,
  mergePrefs,
  planSends,
} from '@mishna/email-domain';
import { composeEmail } from '@mishna/email-templates';
import { AuthVariables } from '../auth-middleware';
import { emailContentEngine } from '../domain';
import { DEV_EMAIL_PAGE } from './dev-page';
import { loadRecipient } from './data';
import { prepareOne, processJobs } from './sender';
import { composeDeps, emailRepo, senderDeps } from './workflow';

// ---------------------------------------------------------------------------
// Local email workbench — `/__dev/email/*`.
//
// 🔴 DEV ONLY, AND STRUCTURALLY SO. Nothing in this file is reachable in
// production: it is mounted from `src/dev-entry.ts`, and `wrangler.toml` pins
// `main = "src/index.ts"`, which never imports it. `wrangler deploy` therefore
// cannot bundle it — there is no runtime flag to get wrong, no `requireAdmin` to
// forget, and `dev-routes.integration.test.ts` asserts the production entry answers
// `404` for `/__dev/*` (plus a `grep -c '__dev'` of the real deploy bundle in
// apps/server/CLAUDE.md). That matters because `POST /__dev/email/send` will mail
// **any address** as **any user**, with no auth at all.
//
// Why it lives inside the worker rather than in a CLI or a UI: only here do you get
// the real local D1 (`mishna-app` + `mishna-auth` in `.wrangler/state`), the real
// `D1EmailRepository` + `planSends`, the real `httpTextResolver`, the real signed
// unsubscribe token, the real templates and the real `processJobs`. Anything outside
// the worker has to re-derive blocks/completions — exactly the divergent-copy bug
// class that produced the `blocksForUser` regression.
//
// Every handler is thin by design: it parses query params and calls the production
// function. If a handler here starts growing logic, that logic belongs in
// `@mishna/email-domain` where it can be unit-tested.
// ---------------------------------------------------------------------------

type DevEnv = { Bindings: Env; Variables: AuthVariables };

/** A bad input, thrown from anywhere in a handler and answered as a `400`. */
class BadRequest extends Error {}

/**
 * Wrap one dev handler in its own error boundary.
 *
 * Per-handler rather than `app.onError`, because these routes are mounted on the
 * **production** Hono app (that's the point — same middleware, same bindings), and an
 * app-wide error handler installed by a dev tool would silently change how every
 * `/api/*` route reports failures. Hono routes a handler's exception to `onError`
 * before any middleware's `await next()` sees it, so a scoped `app.use('/__dev/*')`
 * boundary would not work here.
 *
 * The 500 branch deliberately includes the stack: this is a local workbench, and an
 * opaque "Internal Server Error" in `wrangler dev` is exactly the debugging experience
 * the tool exists to remove.
 */
function guard(
  handler: (c: Context<DevEnv>) => Promise<Response>,
): (c: Context<DevEnv>) => Promise<Response> {
  return async (c) => {
    try {
      return await handler(c);
    } catch (err) {
      if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
      const detail =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      return c.json({ error: 'the dev route threw', detail }, 500);
    }
  };
}

/** The instant to evaluate at: `?at=<ISO>`, defaulting to now. */
function parseAt(raw: string | undefined): Date {
  if (!raw) return new Date();
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new BadRequest(`bad ?at= (not an ISO date): ${raw}`);
  }
  return at;
}

function parseKind(raw: string | undefined): EmailKind {
  if (raw !== 'weekly' && raw !== 'reminder') {
    throw new BadRequest(
      `bad kind (want weekly|reminder): ${raw ?? '(missing)'}`,
    );
  }
  return raw;
}

/** What a resolve attempt produced: the job, or why there isn't one. */
interface Resolved {
  job: PreparedEmail;
  weekStart: string;
  timezone: string;
}

/**
 * The exact resolution `POST /api/admin/users/:id/send-weekly` does — the user's own
 * prefs anchor the week, then `prepareOne` (with `skipWhenEmpty: false`, so a finished
 * user still renders the deliberate empty state).
 *
 * `?weekStart=` overrides the anchor, which is the whole point of the tool: you can
 * look at any week without touching anyone's preferences.
 */
async function resolveJob(
  env: Env,
  userId: string,
  kind: EmailKind,
  weekStartParam: string | undefined,
  at: Date,
): Promise<Resolved> {
  const recipient = await loadRecipient(env, userId);
  if (!recipient) {
    // The one place the production path silently drops a user, so say it out loud.
    throw new BadRequest(
      `no sendable recipient for "${userId}": they have no row in AUTH_DB's "user" ` +
        `table, no email address, or an unverified one (the email path is ` +
        `verified-only). Try GET /__dev/email/users.`,
    );
  }
  const parts = localParts(at, recipient.timezone);
  const weekStart =
    weekStartParam || weekStartOnOrBefore(parts, recipient.weeklyEmailDow);
  const job = await prepareOne(
    env,
    userId,
    kind,
    weekStart,
    emailContentEngine,
  );
  if (!job) {
    throw new BadRequest(
      `prepareOne returned null for "${userId}" (${kind}, week ${weekStart})`,
    );
  }
  return { job, weekStart, timezone: recipient.timezone };
}

/** Render one job into the wire-shaped email, with no Resend client involved. */
async function compose(
  env: Env,
  job: PreparedEmail,
  textOrigin: string | undefined,
): Promise<OutgoingEmail> {
  const deps = composeDeps(env, textOrigin || env.APP_ORIGIN);
  return composeEmail(job, await deps.resolveText(job.refs), {
    from: deps.from,
    replyTo: deps.replyTo,
    appOrigin: deps.appOrigin,
    unsubscribeUrl: await deps.unsubscribeUrlFor(job.userId),
  });
}

/**
 * Mount the workbench. Called **only** from `src/dev-entry.ts`.
 *
 * Takes the app rather than exporting one so the routes sit on the same Hono
 * instance as `/api/*`, sharing its bindings and middleware — a preview's unsubscribe
 * link therefore points at a `/api/unsubscribe` that is live on the same server.
 */
export function mountDevEmailRoutes(app: Hono<DevEnv>): void {
  // The workbench UI itself: one dependency-free HTML page (no build step, no
  // framework). Inlined rather than served as an asset because this worker has no
  // static-asset pipeline and adding one for a dev tool isn't worth it.
  app.get('/__dev/email', (c) => c.html(DEV_EMAIL_PAGE));

  /**
   * The user picker's options. Reads `AUTH_DB` (identity) and `DB` (who joined, and
   * their email prefs) directly rather than going through `GET /api/admin/users`:
   * that route needs a real admin session cookie from `apps/login`, which a plain
   * `file`-less HTML page opened straight against :8787 does not have.
   */
  app.get(
    '/__dev/email/users',
    guard(async (c) => {
      const [{ results: users }, { results: joined }, { results: prefs }] =
        await Promise.all([
          c.env.AUTH_DB.prepare(
            'SELECT id, email, name, "emailVerified" AS emailVerified FROM "user" ORDER BY email LIMIT 200',
          ).all<{
            id: string;
            email: string | null;
            name: string | null;
            emailVerified: number;
          }>(),
          c.env.DB.prepare('SELECT user_id, commitment FROM participants').all<{
            user_id: string;
            commitment: number;
          }>(),
          c.env.DB.prepare(
            `SELECT user_id, timezone, weekly_email_dow, reminder_email_dow,
                    weekly_enabled, reminder_enabled FROM user_email_prefs`,
          ).all<{
            user_id: string;
            timezone: string;
            weekly_email_dow: number;
            reminder_email_dow: number;
            weekly_enabled: number;
            reminder_enabled: number;
          }>(),
        ]);
      const commitments = new Map(joined.map((r) => [r.user_id, r.commitment]));
      const prefsById = new Map(prefs.map((r) => [r.user_id, r]));
      return c.json({
        users: users.map((u) => {
          // Via `mergePrefs`, not an inline `!== 0`: the whole point of that function
          // is that "what does this row mean" has exactly one answer everywhere (an
          // inline copy that drifted is what caused the `blocksForUser` bug). The two
          // also disagree — a NULL column reads as *off* through `mergePrefs` and as
          // *on* through `!== 0` — so a dropdown built the other way would tell you
          // this user gets mail when the cron thinks otherwise.
          const merged = mergePrefs(prefsById.get(u.id));
          return {
            id: u.id,
            email: u.email,
            name: u.name,
            emailVerified: u.emailVerified === 1,
            commitment: commitments.get(u.id) ?? null,
            timezone: merged.timezone,
            weeklyEnabled: merged.weeklyEnabled,
            reminderEnabled: merged.reminderEnabled,
          };
        }),
      });
    }),
  );

  /**
   * **Dry run — sends nothing.** The real `planSends` against the real local D1 at an
   * arbitrary instant: "who *would* get mail at 08:00 Sunday?"
   *
   * Nothing here is mocked, so an empty array is a real answer — usually "nobody is
   * at 08:00 local right now" (`?at=` is UTC; a `America/New_York` user is due at
   * `13:00Z` in winter) or "already in `email_log` for that week".
   */
  app.get(
    '/__dev/email/plan',
    guard(async (c) => {
      const at = parseAt(c.req.query('at'));
      const jobs = await planSends(emailRepo(c.env), emailContentEngine, at);
      return c.json({
        at: at.toISOString(),
        count: jobs.length,
        jobs,
      });
    }),
  );

  /**
   * The actual email, rendered. `?part=html` (default, served as `text/html` so the
   * browser paints it), `?raw=1` for the HTML source, `?part=text` for the plain-text
   * alternative, `?part=json` for the whole `OutgoingEmail` including the RFC 8058
   * headers. Real user, real mishnayot, real Hebrew, real signed unsubscribe token.
   */
  app.get(
    '/__dev/email/render',
    guard(async (c) => {
      const at = parseAt(c.req.query('at'));
      const userId = c.req.query('userId') ?? '';
      if (!userId) throw new BadRequest('missing ?userId=');
      const kind = parseKind(c.req.query('kind') ?? 'weekly');
      const { job } = await resolveJob(
        c.env,
        userId,
        kind,
        c.req.query('weekStart'),
        at,
      );
      const email = await compose(c.env, job, c.req.query('textOrigin'));

      const part = c.req.query('part') ?? 'html';
      if (part === 'json') return c.json({ job, email });
      if (part === 'text') return c.text(email.text);
      // `?raw=1`: the HTML source, as text, so the browser shows it instead of
      // rendering it.
      if (c.req.query('raw')) return c.text(email.html);
      return c.html(email.html);
    }),
  );

  /**
   * 🔴 Sends ONE **real** email through the production `processJobs` + `senderDeps`.
   * `{ userId, kind, to?, weekStart?, textOrigin? }`; `to` overrides the recipient's
   * real address, which is why this route must never be deployable.
   *
   * Prefer Resend's sandbox addresses — `delivered@resend.dev`, `bounced@resend.dev`,
   * `complained@resend.dev` — which exercise the API without touching a mailbox. The
   * HTML page defaults to the first.
   *
   * Like admin send-now, this writes the `email_log` row (`deps.record`), so the
   * scheduled send for that (user, kind, week) is now deduped away. That is the real
   * production behavior, deliberately not special-cased here.
   */
  app.post(
    '/__dev/email/send',
    guard(async (c) => {
      const body = await c.req.json<{
        userId?: string;
        kind?: string;
        to?: string;
        weekStart?: string;
        textOrigin?: string;
      }>();
      if (!body.userId) throw new BadRequest('missing userId');
      const kind = parseKind(body.kind ?? 'weekly');
      const { job, weekStart } = await resolveJob(
        c.env,
        body.userId,
        kind,
        body.weekStart,
        new Date(),
      );
      // The override is the point of the route: send a real user's real email to an
      // inbox you control (or to the sandbox).
      const sendJob: PreparedEmail = body.to ? { ...job, to: body.to } : job;

      // `EmailTransport` returns void (it throws on failure), so wrap it to report what
      // was actually handed to Resend — more useful for debugging than a message id.
      interface Handed {
        to: string;
        subject: string;
        idempotencyKey: string;
      }
      let handed: Handed | null = null;
      const base = senderDeps(c.env, body.textOrigin);
      try {
        await processJobs([sendJob], {
          ...base,
          send: async (emails, idempotencyKey) => {
            handed = {
              to: emails[0].to,
              subject: emails[0].subject,
              idempotencyKey,
            };
            await base.send(emails, idempotencyKey);
          },
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return c.json(
          { sent: false, to: sendJob.to, kind, weekStart, detail },
          502,
        );
      }
      return c.json({
        sent: true,
        to: sendJob.to,
        kind,
        weekStart,
        refs: sendJob.refs.length,
        handed,
        note: 'an email_log row was written, so the scheduled send for this (user, kind, week) is now deduped away',
      });
    }),
  );

  /**
   * End-to-end, locally: create a real `ReminderWorkflow` instance for `?at=<ISO>` —
   * the same thing the hourly cron's `scheduled` handler does, with the same
   * `reminder-<scheduledTime>` id (so a repeat call demonstrates the dedup rather
   * than starting a second campaign; `?fresh=1` forces a new one).
   *
   * Polls up to `?wait=` ms (default 20000) for a terminal status, because the
   * workflow's inter-batch `step.sleep` means a multi-batch run takes real seconds.
   */
  app.get(
    '/__dev/email/cron',
    guard(async (c) => {
      const at = parseAt(c.req.query('at'));
      const scheduledTime = at.getTime();
      const id = c.req.query('fresh')
        ? `dev-reminder-${scheduledTime}-${crypto.randomUUID().slice(0, 8)}`
        : `reminder-${scheduledTime}`;

      let created = true;
      let instance;
      try {
        instance = await c.env.REMINDER_WORKFLOW.create({
          id,
          params: { scheduledTime },
        });
      } catch {
        // Already exists — that *is* the cron dedup, so show the existing run.
        created = false;
        instance = await c.env.REMINDER_WORKFLOW.get(id);
      }

      const budget = Number(c.req.query('wait') ?? 20000);
      const deadline = Date.now() + (Number.isFinite(budget) ? budget : 20000);
      let status = await instance.status();
      while (
        Date.now() < deadline &&
        !['complete', 'errored', 'terminated'].includes(String(status.status))
      ) {
        await new Promise((r) => setTimeout(r, 250));
        status = await instance.status();
      }
      return c.json({ at: at.toISOString(), id, created, status });
    }),
  );
}
