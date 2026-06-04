# apps/email

Cloudflare Worker that sends the two scheduled Hebrew emails: the **weekly** email
(that week's mishnayot, with full Hebrew text) and the **reminder** email (a nudge,
sent only if the week isn't finished). Both go out at **08:00 in each user's own
timezone**. Two handlers in one worker:

- `scheduled()` — the **orchestrator**. Fires hourly; picks who is due an email right
  now and fans `EmailJob`s out to the `mishna-email` queue. Sends nothing itself.
- `queue()` — the **sender**. Builds each email and sends a Resend batch, then logs
  the successful sends. On failure the whole batch is retried (at-least-once;
  `email_log` dedups a redelivered batch).

The server worker is also a producer (admin "send now"); this worker is the only
consumer.

## Layout (`src/`)

| File | Role |
|------|------|
| `index.ts` | Handler wiring: `scheduled` → `planSends` → queue; `queue` → `processJobs`. Builds the real `SenderDeps` (Resend + HTTP text resolver). |
| `orchestrator.ts` | `planSends(env, now)` — pure w.r.t. the clock (`now` from `controller.scheduledTime`). Selects users at 08:00 local, applies enable flags + `email_log` dedup, and (for reminders) only when the week has unlearned mishnayot. |
| `sender.ts` | `processJobs(env, jobs, deps)` — builds emails, sends one Resend batch, writes `email_log`. Side effects injected via `SenderDeps` so it's testable offline. |
| `quota.ts` | `weekRefs(blocks, weekStart)` (wraps `AssignmentEngine.getWeekAssignment`); `httpTextResolver(base)` fetches each tractate's Hebrew text once from `mishna-text`. |
| `templates.ts` | `weeklyEmail` / `reminderEmail` — Hebrew-only, RTL, inline-styled HTML. |
| `data.ts` | All D1 access (see below). |
| `domain.ts` | Domain singletons (mirror of `apps/server/src/domain.ts`). |
| `env.d.ts` | Declares the `RESEND_API_KEY` secret (not visible to `wrangler types`). |

## Bindings (`wrangler.toml`)

- `DB` → **mishna-app** (the server owns the schema/migrations). Reads `participants`,
  `user_email_prefs`, `completions`, `groups`/`group_members`, and reads+writes `email_log`.
- `AUTH_DB` → **mishna-auth** (read-only): the better-auth `user` table for email + name.
  Separate DB, so identity is merged in memory (no cross-DB JOIN).
- `EMAIL_QUEUE` → the `mishna-email` queue (producer **and** consumer here).
- Vars: `APP_ORIGIN` (origin serving `mishna-text`'s `data/*.json` — the client's
  assets — and the app links), `RESEND_FROM_EMAIL`. Secret: `RESEND_API_KEY`.
- Cron: `0 * * * *` (hourly).

One-time: `wrangler queues create mishna-email`; `wrangler secret put RESEND_API_KEY`;
verify the Resend sender domain (DNS).

## The "week"

A week is the 7 days starting on the user's `weekly_email_dow`. `weekStartOnOrBefore`
(in `@mishna/domain`) anchors it; the reminder uses the **same** anchor so it refers to
the quota the weekly email covered. `EmailJob` carries that `weekStart` (a user-local
`YYYY-MM-DD`); the sender derives the refs from it via `weekRefs`.

## Hebrew text

`httpTextResolver` calls `mishna-text`'s `getTractate(APP_ORIGIN, ref.mesechta)` (the
English masechet name equals `mishna-text`'s key and `MishnaRef.mesechta`), caching each
tractate per run. The text JSON is **fetched, not bundled**, so the worker stays small.

## Testing

`nx test email` — `@cloudflare/vitest-pool-workers` with real D1 (both DBs). The test
recreates the subset of the mishna-app schema it reads (the server owns the real
migrations) and seeds a `Group` for block-dependent paths. `processJobs` is exercised
with injected `resolveText`/`send` so no network or Resend is hit. `planSends` is driven
with a fixed `now` to assert timezone/weekday/dedup selection.
