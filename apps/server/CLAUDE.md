# apps/server

Main REST API for the Mishna app (Cloudflare Worker, Hono). It is the HTTP
surface the Angular client calls **and** the production data layer for
`@mishna/domain`: it supplies the D1-backed `GroupRepository` the domain library
declares but doesn't ship, authenticates against `apps/login`, and serializes
allocation writes so concurrent joins can't corrupt a group.

## Layout (`src/`)

| File | Role |
|------|------|
| `index.ts` | Hono app + routes + the **production** worker entry (`wrangler.toml`'s `main`). Default export is `{ fetch, scheduled }` (the cron handler kicks off the `ReminderWorkflow`); also exports `{ AllocatorDO, ReminderWorkflow }` and the Hono `app` itself (for `dev-entry.ts`). |
| `dev-entry.ts` | The **dev-only** entry: the same `app` plus the `/__dev/email/*` workbench, run by `npm run email:dev:server`. Never deployed — see "Testing email locally". |
| `domain.ts` | Module-scope domain singletons (`structure`, `calendar`, `assignmentEngine`, `idGen`), built once per isolate. |
| `repository.ts` | `D1GroupRepository implements GroupRepository` — the production persistence adapter. |
| `allocator.ts` | `AllocatorDO` Durable Object — the single, serialized write path for join/leave. |
| `auth-middleware.ts` | `requireAuth` — validates the session cookie via the `AUTH` service binding. |
| `email/` | The email module — the **side-effecting** half only. Everything pure has moved out to libs (see the table below this one): `workflow.ts` (`ReminderWorkflow` + `senderDeps` + `batchPlan` + run metrics; builds a `D1EmailRepository` and calls the lib's `planSends`), `sender.ts` (`processJobs` — resolve text → `composeEmail` → Resend batch w/ idempotency key → `deps.record`, plus `prepareOne` for admin), `data.ts` (the admin/send-now readers only — `loadGroupBlocksFor`/`loadIdentitiesFor`/`alreadySentSet`/`loadCompletedFor` + single-user `loadRecipient`/`loadBlocks`/`loadCompleted`; reuses `@mishna/email-data`'s `chunked`/`placeholders` and `@mishna/email-domain`'s `mergePrefs`), `quota.ts` (`httpTextResolver` — the HTTP `TextResolver` over `mishna-text`, with the tractate loader injected), `unsubscribe.ts` (a thin **re-export shim** over `@mishna/email-domain`, kept so existing import paths work), `dev-routes.ts` + `dev-page.ts` (the dev-only local workbench, mounted only by `dev-entry.ts`). |
| `apply-migrations.ts` | Test support: eager-loads `migrations/*.sql` and applies them to a D1 binding (used by the test `beforeAll`s). |
| `migrations/` | Numbered D1 migrations (`0001_initial.sql`, `0002_completions.sql`, …) — the source of truth for the `mishna-app` schema. |

### Where the email code lives

The rule is **pure logic in a lib, effects in the app** — so the rules can be tested in
plain node in under a second instead of inside a workerd integration run.

| Lives in | What |
|---|---|
| `@mishna/email-domain` | `planSends`/`selectDue`/`prepareSingle` (who + what), `mergePrefs`/`unsubscribeAudit`/`isHardUnsubscribe`/`flagsAfterUnsubscribe` (the prefs rules), the unsubscribe **token** and **landing page**, `OutgoingEmail`/`EmailTransport`/`batchIdempotencyKey`/`listId`/`unsubscribeHeaders`, and the `TextResolver`/`ResolvedMishna` port. |
| `@mishna/email-data` | `D1EmailRepository` — the bulk path's SQL. |
| `@mishna/email-templates` | The React Email components + `composeEmail` (job + text → `OutgoingEmail`). |
| `apps/server/src/email/` | The Workflow, the Resend wiring, `httpTextResolver`'s `fetch`, and the per-user D1 reads for admin/send-now. |
| `apps/server/src/index.ts` | The `/api/unsubscribe` + prefs + send-now **routes and their SQL** (including `applyUnsubscribe`'s upsert — the `DEFAULT 1` trap it guards is SQL behavior and needs a real D1 either way). |

Two seams worth knowing about: `httpTextResolver(base, loadTractate = getTractate)`
takes its loader as a parameter (so caching + the degrade-on-failure path are testable
offline), and `prepareOne(env, userId, kind, weekStart, engine)` takes the content
engine as a parameter rather than importing the `../domain` singleton — `src/email/`
depends on `domain.ts`'s narrow `emailContentEngine` (typed as the lib's
`AssignmentSource`), never on `AssignmentEngine` itself.

## Data model (D1 binding `DB`, database `mishna-app`)

Separate from the better-auth `mishna-auth` DB owned by `apps/login` — which this worker
also binds **read-only** as `AUTH_DB` (for recipient email/name on the email path; merged
in memory, no cross-DB JOIN).

- `groups(id, state, exhausted, capacity_left, updated_at)` — `state` is the JSON
  `GroupState` from `Group.toState()`; each block carries the user's **lot numbers**
  (1..120) plus their derived ranges. A group is one full covering of the corpus, so
  `exhausted` means all 120 lots are taken; `capacity_left` is the free lots' mishnayot.
  Both are denormalized from `state` on every save so queries don't parse JSON.
- `group_members(group_id, user_id)` — denormalized membership (index on `user_id`),
  rebuilt from `state.blocks[].userId` on each `save` so `loadGroupsForUser` is an
  indexed join.
- `participants(user_id, commitment, joined_at)` — who joined and their commitment (=
  their weekly pace in mishnayot; the lot count is derived at join from pace × weeks
  remaining); drives `/api/me` and rejects double-joins. `joined_at` (epoch ms) is also
  written into the user's `Block.startDate` (as a yyyy-mm-dd date) so assignment
  scheduling anchors on the join date.
- `completions(user_id, group_id, mesechta, perek, mishna, completed_at)` — one row per
  mishna a user has marked learned, within a specific group. `group_id` is resolved
  server-side from the user's block and handed down with the assignment, so per-group
  rollups are a plain `GROUP BY group_id` (no join, exact under overflow) and rows are
  cycle-scoped (groups are recreated each cycle). `completed_at` (epoch ms) seeds a future
  offline last-write-wins sync.
- `user_email_prefs(user_id, timezone, weekly_email_dow, reminder_email_dow,
  weekly_enabled, reminder_enabled, updated_at, unsubscribed_at, unsubscribed_via)` —
  per-user email settings (`0003`; the last two are `0006`'s one-click-unsubscribe audit
  trail — see Email below). A
  missing row means defaults (`America/New_York`, weekly=Sun, reminder=Thu, both on);
  `GET /api/me/preferences` synthesizes them and the email path
  (`@mishna/email-data`'s `loadCandidates`, fed to `@mishna/email-domain`'s `selectDue`)
  treats a missing row the same way. An admin can flip `weekly_enabled` /
  `reminder_enabled` on a user's behalf (`POST /api/admin/users/:id/set-email-prefs`) —
  it writes this same row, so the user sees and can undo it in Settings, and only the
  columns the body names (plus `updated_at`) are touched, leaving their
  timezone/weekdays — and the flag they didn't name — intact. Both values ride along as
  `weeklyEnabled`/`reminderEnabled` on the `GET /api/admin/users` and
  `/api/admin/users/:id` rows. Admin "send now" deliberately overrides the flags (it's a
  manual one-off, not the schedule) — **except a hard (mail-side) unsubscribe**, i.e. a
  row whose `unsubscribed_via` is `'one-click'`/`'link'` and whose flag for that kind is
  still off: that's a `409`, never a send (see the send-now routes below).
- `email_log(user_id, kind, week_start, sent_at)` — one row per email actually sent
  (`0004`), so each (user, kind, week) goes out at most once even though the cron fires
  hourly. Written by the email path (`email/sender.ts` after a successful send), consulted
  by `planSends` before sending. Admin "send now" deliberately bypasses this dedup.

`save()` upserts the group row and replaces its membership rows in one `db.batch()`
so the row and its members never drift apart.

## Concurrency

All `join`/`leave` route through **one** `AllocatorDO` instance
(`idFromName("allocator")`). Inside, an in-process promise chain serializes the
load→mutate→save cycle, so two simultaneous joins can't both claim the same free lot and
hand it to two users (D1 alone doesn't serialize across `await`s once a DO is involved).
Reads — assignments, `/me`, admin — hit D1 directly and need no coordination.

## Auth

`requireAuth` forwards the incoming `cookie` to the login worker via the `AUTH`
service binding (`/api/auth/get-session`, a better-auth built-in) and sets
`c.get("userId")` / `c.get("user")` (id, name, email, role, **isAdmin**), else `401`.

`requireAdmin` does the same, then requires `user.isAdmin === true`, else `403`.
This worker holds **no** admin config: `apps/login` is the single source of truth —
its `customSession` plugin stamps `isAdmin` onto the get-session response from its
`ADMIN_USER_IDS` **or** a `role` of `admin` on the user row (set via the set-role
route below). The admin user-management routes also proxy better-auth's
`/api/auth/admin/*` endpoints through the `AUTH` binding (the `adminAuthFetch` helper
forwards the caller's cookie — better-auth authorizes those against the same
`ADMIN_USER_IDS` — **and** their browser `Origin`, since better-auth rejects
state-changing admin POSTs that arrive without a trusted Origin).

## Routes

| Method & path | Behavior |
|---|---|
| `GET /api/corpus` | The static `MishnahDataset` (public; lets the client skip bundling it). |
| `GET /api/cycle` | `{ cycleStart, cycleEnd, daysElapsed, daysRemaining, totalDays }` for the current cycle (public; powers the landing-page progress bar without shipping `@hebcal/core` to the client). |
| `GET /api/join-options` | `{ options: JoinOption[] }` — the signup commitment choices as of today (`computeJoinOptions`), each weekly pace annotated with its approximate lot count, collapsing to a single "1 lot" option near the cycle end (public; keeps the lot math out of the clients, esp. Flutter). |
| `GET /api/unsubscribe?t=&lang=` | **Strictly read-only.** Renders a small self-contained bilingual HTML page with a confirm `<form method="post">`. Always `200`, even for a garbage token — it must never leak whether a token/user is real, and mail scanners GET every link in a message, so this must not mutate anything (public, no auth — the signed token is the authorization). |
| `POST /api/unsubscribe?t=&lang=` | The RFC 8058 one-click target *and* the form's action. Verifies the token, then turns the scope's emails off (`weekly_enabled`/`reminder_enabled`). Accepts, but doesn't require, the `List-Unsubscribe=One-Click` form body. `200 text/plain` for a machine POST, the HTML success page when `Accept: text/html`. **Always `200`** — a bad/malformed token gets the *error* page/text but still a `200`, because every other outcome (success, unknown user, a repeat POST) is one too and a `400` only for "this token didn't verify" leaks that it isn't real; a mailbox provider also reads a 4xx on the one-click POST as a broken unsubscribe, and the usual cause is the mail client truncating the URL. It's logged as a `{ evt: 'unsubscribe_bad_token', tokenLength, html }` warn line — never the token itself, which may still be a live credential. Unknown user and a repeat POST are both an idempotent `200`. **Never redirects** (RFC 8058 forbids it) (public). |
| `GET /api/memorized?t=&lang=` | The emailed "I've memorized this" CTA. **Strictly read-only**: no DB read, no session, and the token is deliberately *not verified* — always the same `200` confirm form, so a probe learns nothing. Mail scanners and link-preview bots GET every URL in a message; they do not submit forms (public). |
| `POST /api/memorized` | The confirm form's action. Verifies the token, checks `canMark`, marks the pinned bucket learned (one batched `recordCompletion` upsert, so a repeat click is a no-op), then decides about the session: **already the right user** → `303` to `/dashboard?memorized=1`; **signed out and inside the 7-day `canLogin` window** → mint via the `AUTH` binding, copy the `Set-Cookie`, then that same `303`; **signed out and past it, or a *different* user holds the browser** → `200` done page, no cookie, no redirect (never show A's dashboard to B, never swap B's session). A bad or expired token is a `200` error page that writes **nothing**, logged as `{ evt: 'memorized_bad_token', tokenLength }` — never the token, which may still be live (public). |
| `GET /api/me` | `{ joined, commitment, user: { id, name, email, role }, isAdmin }` (auth). |
| `GET /api/me/chaluka` | `{ commitment, joinedAt, assigned: MishnaRef[], completed: MishnaRef[], groupIds: string[] }` — the caller's whole-cycle portion (every mishna in their blocks, corpus order) + the learned subset, for the "My Chaluka" progress/stats view (auth). `groupIds` is parallel to `assigned` (group for `assigned[i]` is `groupIds[i]`): the group each completion is recorded under, so the Assignments page can check mishnayot off (per-ref because lots spill across groups at an overflow boundary). |
| `GET /api/me/preferences` | The caller's email prefs, defaults if no row (auth). |
| `PUT /api/me/preferences` `{ timezone, weeklyEmailDow, reminderEmailDow, weeklyEnabled, reminderEnabled }` | Validate (IANA tz via `Intl`, dow 0-6) + upsert (auth). Also maintains `0006`'s audit columns: both flags on clears them (this is how a user re-subscribes after a one-click unsubscribe), both off records `unsubscribed_via = 'settings'`. |
| `POST /api/join` `{ commitment: 1\|2\|3 }` | Validate, forward to `AllocatorDO.join` (auth). |
| `POST /api/leave` | Forward to `AllocatorDO.leave` (auth). |
| `GET /api/assignments/today` | The caller's **current** mishnayot — their *next still-unlearned* bucket — plus the `groupId` they belong to and the pager's navigation metadata `{ bucket, bucketCount, currentBucket }` (auth). Progress-based, not calendar-based: the slice advances as the user checks it off and empties once their whole portion is learned (`buildNextAssignment` → `AssignmentEngine.nextUnlearnedBucket` + `getBucketAssignment`). The `/today` route name is kept. |
| `GET /api/assignments?bucket=N` | The caller's mishnayot for an explicit, **positional** bucket index — the target of the dashboard's prev/next pager (next/prev relative to the current, next-unlearned bucket). Out-of-range indices clamp to the nearest real bucket (the served index comes back as `bucket`); a missing or negative `bucket` is a `400`. Same response shape + nav metadata as `/today` (auth). |
| `GET /api/completions` | `{ completed: MishnaRef[] }` — every mishna the caller has marked learned (auth). |
| `POST /api/completions` `{ ref, groupId }` | Mark a mishna learned; validates the ref + the caller's membership of `groupId`, then upserts (auth). |
| `DELETE /api/completions` `{ ref, groupId }` | Unmark a mishna; idempotent, scoped to the caller's rows (auth). |
| `GET /api/admin/stats` | Dashboard counters: `{ activeUsers, verifiedUsers, totalGroups, totalCompletions, weekCompletions, weekStart }` — set-based aggregates, no per-user loop (**admin**). |
| `GET /api/admin/groups` | Per group: `id`, `progress`, `members` (userIds) + `memberCount` (**admin**). |
| `GET /api/admin/groups/:id` | One group: `progress`, `memberCount`, `members: [{ id, name, email, emailVerified, blockSize, lots }]` (identity from `AUTH_DB`; `lots` = the member's lot numbers in this group, ascending) (**admin**). |
| `GET /api/admin/lots` | The static lot catalog: `[{ lot, mesechta, indexInMesechta, label, start, end, size }]` (120 entries; `label` is `mesechta:indexInMesechta`, e.g. `Peah:1`). Powers the group-detail edit UI (**admin**). |
| `POST /api/admin/groups/:groupId/members/:userId/lots` `{ lots: number[] }` | Admin override: set the member's lots in that group. Validates each lot is a real lot number (1-120; empty clears their lots); routes through the `AllocatorDO` (serialized with join/leave). Double-assignment is allowed — a lot another member holds becomes shared. `400` on a bad lot, `404` if the group/member is unknown (**admin**). |
| `GET /api/admin/users?limit&offset&search&sort` | One page of users (`limit` 1-50, default 50). `search` matches email (or name when it has no `@`); `sort` is `field:asc\|desc`. Pagination/search/sort delegate to better-auth `list-users`; merged with `participants`. Rows carry `emailVerified`, `createdAt` + `weeklyEnabled`/`reminderEnabled` (one full-table `user_email_prefs` read, defaults for missing rows). Returns `{ users, total, limit, offset }` (**admin**). |
| `GET /api/admin/users/:id` | One user: identity (+ `emailVerified`, `createdAt`, `weeklyEnabled`, `reminderEnabled`) + `{ joined, commitment, groups: [{ id, blockSize }] }` (**admin**). |
| `GET /api/admin/assignments?week&limit&offset` | One page of participants with the chosen week's mishnayot, each `{ ref…, groupId, done }`, plus `emailSent` (weekly). `week` defaults to the current week. Resolves blocks/completions/identities for the page subset via the batched email-path readers (**admin**). |
| `POST /api/admin/users/:id/remove-assignments` | `AllocatorDO.leave(id)` — frees the user's ranges, keeps the auth account (**admin**). |
| `POST /api/admin/users/:id/set-role` `{ role: 'admin'\|'user' }` | Promote/revoke admin by proxying better-auth `set-role` (writes the `role` column); apps/login's `customSession` treats `role==='admin'` as `isAdmin` on the next session, alongside `ADMIN_USER_IDS` (**admin**). |
| `POST /api/admin/users/:id/set-email-prefs` `{ weeklyEnabled?, reminderEnabled? }` | Turn either (or both) of the user's **scheduled** emails on/off by upserting their `user_email_prefs` row. Only the named flags + `updated_at` (+ the audit columns, from the row's resulting state — `'admin'` when the admin leaves both off) are written on conflict, so an omitted flag and their timezone/weekdays survive. The same row Settings edits, so the user can undo it; `selectDue` skips them on the next bulk run. Returns the resulting `{ weeklyEnabled, reminderEnabled }`. `400` if a flag isn't a boolean or neither is given (**admin**). |
| `POST/DELETE /api/admin/users/:id/completions` `{ ref, groupId }` | Mark/unmark a mishna learned on the user's behalf (the Assignments learn/unlearn toggle). Mirrors the self `/api/completions` routes, keyed on `:id` (**admin**). |
| `POST /api/admin/users/:id/send-weekly` | Build and send an extra weekly email inline (bypasses dedup); `502` if the send fails. Verified-only, like the bulk path. `409 { error: 'user unsubscribed', detail }` when this kind is off **and** it was turned off from the mail (`unsubscribed_via` = `'one-click'`/`'link'`) — the one flag state send-now won't override; `detail` is a full sentence the client toasts verbatim (**admin**). |
| `POST /api/admin/users/:id/send-reminder` | Same, for a reminder email (same `409` gate, on `reminder_enabled`) (**admin**). |
| `POST /api/admin/users/:id/send-verification` | Re-send the better-auth verification email for a *pending* user: looks up the address via the `get-user` admin proxy, then calls better-auth's public `send-verification-email` (forwarding the caller's Origin). `409` if already verified, `404` if no email, `502` on send failure (**admin**). |
| `DELETE /api/admin/users/:id` | Cascade: `AllocatorDO.leave(id)` then better-auth `remove-user` (**admin**). |
| `GET /api/admin/about?locale=en\|he` | The `www` site's editable Markdown (`about.md`) for the locale, read via the GitHub Contents API; `''` if not committed yet. `locale` defaults to `en`; an unknown value is `400`. `500` if the editor isn't configured, `502` on a GitHub failure (**admin**). |
| `POST /api/admin/about?locale=en\|he` `{ markdown }` | Commit new `about.md` for the locale via the GitHub Contents API (gets the current `sha`, then PUTs; handles first-create). The commit to `main` triggers CI → the `www` rebuild. `400` if `locale` is unknown or `markdown` isn't a string (**admin**). |
| `POST /api/admin/about/image` (raw image body, `x-filename` header) | Upload an editor image to the `ABOUT_BUCKET` R2 bucket under `about/<uuid>-<name>`; returns `{ url }` built from `R2_PUBLIC_BASE_URL`. Images never enter the repo. `500` if the bucket/base URL aren't configured (**admin**). |

The about-editor logic lives in `about.ts` (GitHub read/commit + base64 + filename
sanitizer); repo coordinates come from `wrangler.toml` `[vars]` (`GITHUB_OWNER`/`REPO`/
`BRANCH`, `ABOUT_MD_PATH` + `ABOUT_MD_PATH_HE`) and the `GITHUB_TOKEN` secret. The www
site is bilingual (`/en`, `/he`); the editor commits to one `about.md` at a time, chosen
by the `?locale=` the client sends — `ABOUT_MD_PATH` is the English page
(`apps/www/src/en/about.md`, moved from the old `src/content/about.md`) and the default,
`ABOUT_MD_PATH_HE` the Hebrew page (`apps/www/src/he/about.md`). The **domain-bearing** vars
here (`APP_ORIGIN`, `RESEND_FROM_EMAIL`, `R2_PUBLIC_BASE_URL`) and the worker `routes`
are generated from the repo-wide `config/domains.json` (`npm run sync:domains`; see the
root CLAUDE.md "Changing the domain") — don't hand-edit those values. The R2 bucket binding
(`ABOUT_BUCKET`) and `R2_PUBLIC_BASE_URL` are provisioned later — until then the handlers
fail loudly with a `500` (see the TODOs in `wrangler.toml`).

`groupId` on assignments is resolved by `buildBucketResponse` (the shared core behind
`buildNextAssignment`/`buildBucketAssignment`): it finds the group whose block
range contains the bucket's mishnayot. Completions reuse this id rather than re-deriving it
on every write. (On the single overflow-boundary day a user's mishnayot can span two
groups; they're all attributed to the first's group — accepted noise for a progress
rollup.)

## Email (cron + Workflow)

Email is owned here, not in a separate worker. The default export's `scheduled` handler
fires on an **hourly cron** and creates one `ReminderWorkflow` instance per tick (its id is
derived from `controller.scheduledTime`, so a double cron fire — cron is at-least-once —
dedupes to one run). The Workflow (`email/workflow.ts`) builds a `D1EmailRepository`
(`@mishna/email-data`) and calls `planSends` (`@mishna/email-domain`) to find who is
due an email *now* (08:00 in the user's own timezone; weekly on their weekly weekday,
reminder on their reminder weekday when something's still unlearned), then sends the fully
resolved `PreparedEmail`s in Resend-batch-sized chunks — each chunk a durable `step.do`,
with a free `step.sleep` between to stay under Resend's rate limit. It closes with a
`run-metrics` step that both logs and **returns** one
`{ evt: 'reminder_run', durationMs, planned, sent, batches }` line — the early-warning for
the per-invocation ceiling, and (since it is the workflow's output) what the tests assert
on instead of scraping logs.

The chunking itself is a pure function, `batchPlan(total, size)`, returning
`{ n, start, end, throttleAfter }` per batch. Split out because it is the only *decision*
the workflow makes and it is otherwise reachable only through the durable engine — where a
`step.sleep` has no result to introspect, so "a throttle between every pair of batches and
never after the last" could only be inferred from wall-clock timing. `workflow.spec.ts`
pins it directly, in microseconds.

**Email content — the next unlearned bucket.** Emails keep their calendar *schedule*
and per-week dedup (timing anchored to the user's weekly-email weekday; `email_log`
deduped on `(user, kind, weekStart)`), but their *content* is the user's **next
still-unlearned bucket** — the same `pace`-sized slice the dashboard shows, via
`@mishna/email-domain`'s `resolveOne` → the injected `AssignmentSource`
(`getNextAssignment`) → `refsForKind`. The weekly email shows the whole bucket; the
reminder shows only its still-pending mishnayot. Because the content is progress-based,
`planSends` loads completions for **every** due user (not just reminders).

**A finished user: skipped by the cron, NOT by send-now.** Both callers go through the
one function, `prepareSingle`, and the difference is an explicit parameter:
`buildPreparedEmails` passes `skipWhenEmpty: true` (a user who has learned their whole
portion gets no further scheduled mail), and `prepareOne` passes `false`. An admin who
presses "Send weekly" on a finished user asked for an email; sending nothing looks like a
broken button, so they get the templates' **empty state** — which is a real, deliberate
email. So the admin can see it coming, `GET /api/admin/users/:id` returns
`weeklyRefCount` / `reminderPendingCount` (derived with the same `resolveOne`), and the
admin user-detail page prints them next to the buttons with a warning when either is `0`.

**Scalability — batched reads.** `planSends` does **not** do a per-user query loop. It
loads all participants+prefs once (`loadCandidates`, addresses excluded), filters to those
at 08:00 local, then resolves the survivors with a handful of set-based `IN (...)` reads
(chunked under D1's 100-param ceiling): `alreadySent` (dedup), `loadBlocks`,
`loadCompleted` (all due users — the next-bucket content needs them), and
`loadEmails` (addresses for the due subset
only — not the whole `user` table every hour). So a run is O(due/100) subrequests, not
O(due); the ceiling is users-due-in-one-hour, kept well inside budget. `planSends` returns
`PreparedEmail`s (address + the exact mishnayot to render), so `processJobs` does no
further per-user DB reads — it renders, sends, and records the send (`deps.record` →
`D1EmailRepository.recordSent`). Those batched readers are now the `EmailRepository`
port's methods (`loadCandidates`/`alreadySent`/`loadBlocks`/`loadCompleted`/`loadEmails`),
implemented by `D1EmailRepository` in `@mishna/email-data`; the decision logic itself is
`@mishna/email-domain`.

**Idempotency is layered.** `email_log` dedups across runs/days (`recordSent` after a
successful send; `alreadySentSet` before). *Within* a run, each batch carries a
deterministic Resend `Idempotency-Key` (`reminder-batch-<sha256-of-the-batch>`), so if a
batch sends but the `email_log` write then throws and the `step.do` retries, Resend
collapses the re-send instead of double-mailing. The `httpTextResolver` cache lives on the
resolver (per batch), so 100 users needing one tractate fetch it once.

**A bad tractate degrades; it does not fail the batch.** `mishna-text`'s `getTractate`
throws on a name it doesn't know and on a fetch failure, and it runs *inside* a
`send-batch-N` step — so an unguarded throw fails that step, takes 99 innocent recipients
down with it, and retries forever. `httpTextResolver` therefore catches per tractate,
remembers the failure (one attempt and one log line per tractate per batch), emits a
structured `{ evt: 'tractate_load_failed', tractate, base, detail }` `console.error`, and
renders those refs with `hebrew: ''`. The recipient still gets their email with the
reference in it. The class of bug this hides — a `mishna-text` bump renaming a file — is
caught at CI time instead, by `email/quota.spec.ts`, which asserts every one of the corpus's
63 `nameEn` values resolves to a file. The loader is injected
(`httpTextResolver(base, loadTractate = getTractate)`) so all of that is unit-tested with
no network.

The admin "send now" routes resolve one `PreparedEmail` via `prepareOne` (per-user reads —
fine at volume 1) and send it **inline and synchronously** via the same `processJobs` path
(bypassing the dedup), so the admin gets the real result — a `502` on a Resend failure.
The week is anchored from the user's prefs (`localParts` + `weekStartOnOrBefore`).

They also bypass `weekly_enabled`/`reminder_enabled` — a manual one-off isn't the
schedule — with one exception, checked **before** anything is built: a **hard
unsubscribe**. If the flag for the kind being sent is off *and* `unsubscribed_via` says
the user turned it off from the mail itself (`'one-click'`/`'link'`, per
`isHardUnsubscribe`), the route answers `409 { error: 'user unsubscribed', detail }`.
Re-mailing someone who pressed Gmail's one-click button is what earns a spam report, and
it silently undoes a request we're bound to honor. Both halves of the test are needed:
`unsubscribed_via` survives a *partial* re-enable (see `unsubscribeAudit`), so a user
whose weekly an admin turned back on still reads `'one-click'` — the flag is what says
the kind is still off. An `'admin'`/`'settings'` off switch is ours to undo and is still
overridden.

**Verified-only.** The email path never mails an unverified address. `loadEmails`
(bulk) filters `WHERE "emailVerified" = 1`, and `loadRecipient` (admin send-now) returns
`null` unless the address is present and verified — so an unverified user is silently
skipped by the cron and yields no `PreparedEmail` for send-now. That's **two** predicates
in two files, i.e. two independent ways to lose the guarantee, so each has its own test in
`email/email.integration.test.ts` (the `planSends` pair and the `loadRecipient` block).
The `planSends` ones seed a **group** on purpose: without blocks the user has nothing to
send and `prepareSingle` drops them anyway, so the assertion would pass no matter what the
address filter did — which is exactly what it used to do. The "queues a verified
participant" control next to them is what keeps them honest. Google sign-ins are
verified automatically by better-auth; password sign-ups stay unverified until a
verification flow is added (`apps/login`). The admin views surface the flag so it's visible.

**Unsubscribe (RFC 8058 one-click).** Every scheduled email carries
`List-Unsubscribe: <https://…/api/unsubscribe?t=…>`, `List-Unsubscribe-Post:
List-Unsubscribe=One-Click` and a `List-Id`, plus a **visible** "Unsubscribe" footer
link (Gmail wants both). The link's `t` is a stateless HMAC-signed token
(`@mishna/email-domain`'s `unsubscribe-token.ts`): `base64url("v1.<userId>.<scope>") "."
base64url(HMAC-SHA256)`, signed with `UNSUBSCRIBE_SECRET` (a **comma-separated list** —
sign with the first, verify against all, which is the rotation story; the list is
**append-only — never prune by default**, see "One-time setup"). **No expiry, and
no timestamp in the payload at all** — an expired link on year-old mail earns a spam
report, so nothing would ever be enforced against one; and a clock in the payload would
make the token (hence the header and the footer) differ on every render, while the batch
`Idempotency-Key` covers only (user, kind, week) — Resend answers a reused key carrying a
different payload with `409 invalid_idempotent_request`, which would fail the retried
`step.do` and take the rest of that hour's batches with it. The token is a pure function
of (secret, userId, scope); `processJobs` run twice over the same jobs produces
byte-identical mail, and there's a test that says so.
**"I've memorized this" (the one-click check-off).** Every scheduled email that has
mishnayot in it carries a prominent CTA **above** the list: *"Click here when you've
memorized this."* Clicking it marks exactly the mishnayot that email showed as learned
and — for the first week — signs the reader in, so the whole loop is one click from the
inbox. (The empty-state emails get no CTA; there is nothing to have memorized.)

The link's `t` is `base64url("m1.<userId>.<bucket>.<expiresAt>") "." base64url(HMAC-SHA256)`
(`@mishna/email-domain`'s `memorized-token.ts`), signed with `MEMORIZED_SECRET`. Four
things about it are deliberate:

- **`bucket` is the whole "which mishnayot" payload, pinned at *plan* time.**
  `AssignmentEngine.getBucketAssignment` is a positional slice whose `pace` is anchored
  to the user's join date, so an index re-derives the exact refs for the rest of the
  cycle in ~2 characters. Recomputing it at click time would be a real bug:
  `nextUnlearnedBucket` advances the moment a bucket is complete, so anyone who checked
  the bucket off in the app *first* would have the emailed link mark the **next** bucket
  — mishnayot they never saw. `PreparedEmail.bucket` carries it; `plan-sends.spec.ts`
  and `memorized.integration.test.ts` both guard the drift.
- **It expires — and still re-renders byte-identically.** `expiresAt` is
  `weekStart + 30 days`, and `weekStart` is already a field of the job, so the token
  stays a pure function of (secret, job). This is the constraint the unsubscribe token
  gave up expiry for: the batch `Idempotency-Key` covers only (user, kind, week), and
  Resend answers a reused key carrying a different body with `409
  invalid_idempotent_request`, failing the retried `step.do` and taking the rest of the
  hour with it. A `Date.now()` anywhere in this payload brings that back.
  `email.integration.test.ts` proves it directly: two `processJobs` runs with the system
  clock advanced days between them must produce identical bytes.
- **Two windows over one signed instant.** `canMark` runs the full 30 days; `canLogin`
  closes after 7. A month-old link in a forwarded mailbox should still be able to say "I
  learned these" — idempotent, low-value, reversible — without still being an
  account-takeover primitive. Both derive from the same `expiresAt`, so there is exactly
  one field to forge and the MAC covers it.
- **Signing in never happens on this worker.** `POST /api/memorized` calls the login
  worker's `/internal/memorized-session` over the `AUTH` service binding; that endpoint
  is `createAuthEndpoint.serverOnly` (never on better-auth's HTTP router), lives on a
  path no zone route dispatches, and **verifies the same signed token rather than
  trusting a `userId`** — so even reaching it grants nothing beyond what holding a valid
  link already does. See `apps/login/CLAUDE.md`.

The CTA goes at the **top**, which is not just emphasis: Gmail clips messages over
~102 KB, and a long weekly can reach that, so a CTA under the list may simply not be in
what the reader sees. Like the unsubscribe footer it is its **own paragraph**, because
html-to-text renders an anchor as `text href` and sharing a line would bury the URL
mid-sentence in the text/plain part.

The footer renders the link as its **own paragraph**, not `"Chevras Mishnayos Baal Peh ·
Unsubscribe"` on one line — a contract with the plain-text part, where html-to-text
renders an anchor as `text href`, so a one-line footer would bury the URL mid-sentence
instead of putting it on a line of its own (`Unsubscribe https://…`). Don't collapse the
two `<Text>`s back together.
Verification is `crypto.subtle.verify`, never a string compare, and every
malformed input returns `null` rather than throwing. `scope` is always `all` today (the
product decision is that unsubscribing kills *both* scheduled emails); it's in the format
so granular links can ship later without invalidating old ones. The URL is injected into
the sender as `SenderDeps.unsubscribeUrlFor` (like `send`/`record`), so `processJobs`
stays offline-testable and the admin "send now" path — which goes through the same
`senderDeps()` — gets the headers too.

State is **self-managed in D1**, not Resend Audiences: the POST writes the same
`user_email_prefs.weekly_enabled`/`reminder_enabled` columns both settings screens edit
and `selectDue` honors, so a user can undo it in Settings on either client, plus the
`0006` audit columns (`unsubscribed_at`, `unsubscribed_via`). The upsert names both flags
in the **INSERT column list**, not only in the `ON CONFLICT DO UPDATE` branch — most
users have no prefs row at all, and letting the table's `DEFAULT 1` win on the insert
branch would silently no-op the unsubscribe for exactly them (covered by a test). The
audit columns track the row's **resulting** state, so they're written by every path that
touches the flags: both emails back on clears them (a re-subscribed user must not read
"unsubscribed via one-click" forever, or later suppression logic keyed on
`unsubscribed_at` would skip them), both off records the channel
(`'one-click'`/`'link'` from the mail, `'settings'` from a Settings save, `'admin'` from
the admin toggle), and one-on-one-off leaves the previous record standing.
`apps/login`'s verification/password-reset mail deliberately gets **none** of this: it's
transactional.

> **Ops guardrail — do not create a Resend Audience or send a Broadcast for this
> product from the Resend dashboard.** Unsubscribes live **only** in D1; Resend holds
> no Contacts for these users, so a Broadcast would mail everyone who unsubscribed — a
> legal and reputational problem, and one entirely invisible to this repo (no code
> change, no test, no log would show it). All bulk mail must go through
> `ReminderWorkflow` → `planSends` → `processJobs`, which honors
> `weekly_enabled`/`reminder_enabled` via `selectDue`; one-off admin mail goes through
> `POST /api/admin/users/:id/send-weekly|send-reminder`, which is gated on a hard
> unsubscribe. If a Broadcast is ever genuinely needed, the **prerequisite** is syncing
> D1's unsubscribe state into a Resend Audience (or adopting Resend Contacts as the
> source of truth) first — that's a design change, not an ops action.

Both routes answer with `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and
`X-Content-Type-Options: nosniff` (and the page repeats the referrer policy in a
`<meta>`): the URL is a never-expiring bearer token, and the pages link to the
same-origin `/settings`, where the default referrer policy would hand the full URL —
`?t=` included — to that navigation.

**Editing templates.** The emails now live in **`@mishna/email-templates`**
(`libs/shared/email-templates/src/lib/`: `weekly-email.tsx`, `reminder-email.tsx`, shared
`components/`, theme in `styles.ts`), rendered at send time by `render.tsx`'s
`weeklyEmail`/`reminderEmail`. `sender.ts`'s old `buildEmail` is that lib's
`composeEmail(job, resolved, opts)`. See its `CLAUDE.md` — in particular the note that
`jsx: "react-jsx"` must stay in **both** of that project's tsconfigs, because esbuild
resolves a tsconfig per source file and would otherwise emit `React.createElement` into
this worker's bundle.

Each renders to **both** an HTML and a `text/plain` part (`BuiltEmail.html` + `.text`,
`OutgoingEmail.text` is required, not optional), and Resend sends a
`multipart/alternative` when it gets both — a single-part HTML email is a spam-filter
signal and unreadable in text-only clients. The text is `toPlainText(html)` over the
**exact HTML being sent**, not a second `render(el, { plainText: true })`: one render
instead of two per email inside a 100-email Workflow step, and the two parts can't drift
apart. Both are pure, so the deterministic `Idempotency-Key` contract is unaffected (the
byte-identical-re-render test covers `text` for free). Two `toPlainText` behaviors the
output depends on: react-email skips the `<Preview>` preheader (its 150-char
zero-width-space padding never reaches the text part) and `wordwrap: false` is hard-set,
which is what keeps the long base64url unsubscribe URL on one unbroken, clickable line.
Preview them live in the browser with `npm run email:dev` (from the repo root) — it serves
the dev-only entries in `libs/shared/email-templates/src/lib/preview/` (one per email state,
with sample mishnayot) at
`http://localhost:3030`. The CLI only lists `.tsx`/`.jsx` files with a default export, so the
`.ts` sample-data file is ignored. Two install-time gotchas (react 18.3.1 pin and the
`react-dom/server.edge` alias) are documented at the top of `wrangler.toml` / in
`package.json`. The alias is a **workerd-condition** problem only — `@mishna/email-templates`'
own tests run in plain node, where `@react-email/render` resolves its `node` condition, and
they deliberately do not set it.

Assignments pass **all** of a user's blocks across groups straight to
`AssignmentEngine`, which sorts by corpus position internally. The admin
user-management routes proxy better-auth's admin plugin
(`/api/auth/admin/*` on the login worker) for identity, merging in join/group data
this worker owns. `/api/admin/groups` still returns `userId`s only.

**One source of truth for "a user's blocks."** A group's persisted `state` carries
*every* member's blocks, so deriving one user's portion means filtering to that user.
That rule is **not** re-implemented in the route/data layer — it lives once in
`@mishna/domain`'s `blocksForUser(states, userId)`. The web readers (`index.ts`
`userBlocks`/`groupIdForRef`/`userBlockSize`), the admin readers (`email/data.ts`
`loadBlocks`/`loadGroupBlocksFor`), and the bulk-email adapter (`@mishna/email-data`'s
`D1EmailRepository.loadBlocks`) all `JSON.parse` the raw group state and route through it.
(A divergent inline copy that returned the *whole group's* blocks was the bug that
motivated this — see the multi-member regression test in `email/email.integration.test.ts`.)
Genuinely per-group, all-members reads — e.g. `GET /api/admin/groups/:id` listing each
member's lots — deliberately do not filter.

## Testing email locally

Email is the scariest thing in this repo to change: it is the one path that leaves the
building, it fires from a cron you can't watch, and a mistake reaches real inboxes and
can't be taken back. So there is a local workbench — `/__dev/email/*` — that lets you
look at, and deliberately send, a **real** email built by the **real** code, entirely
on your machine.

### Cold start

```sh
npm run db:init:local        # 1. seed the local mishna-auth + mishna-app D1
npm run email:dev:server     # 2. serve the DEV entry point on :8787
npm run dev                  # 3. (another terminal) the Angular dev server on :4200
# then open http://localhost:8787/__dev/email
```

Step 3 is not optional if you want Hebrew text and safe links — see the `APP_ORIGIN`
gotcha below. If you'd rather not run Angular, pass
`?textOrigin=https://app.mishna2go.com` on `/render` (or `"textOrigin"` in the `/send`
body) and leave `APP_ORIGIN` pointing at localhost.

`email:dev:server` is:

```sh
npx wrangler dev apps/server/src/dev-entry.ts \
    --config apps/server/wrangler.toml --persist-to .wrangler/state --port 8787
```

The positional script **overrides `wrangler.toml`'s `main`**, so this runs with the
same config as production: same D1 databases, same DO/Workflow classes, same `[vars]`,
no second toml to drift. (`npm run dev`'s Angular proxy also targets :8787, so the
client works against this server exactly as it does against `nx serve server`.)

### 🔴 The `APP_ORIGIN` gotcha — read this before previewing anything

`wrangler.toml` `[vars]` pins `APP_ORIGIN = "https://app.mishna2go.com"` (generated
from `config/domains.json` — don't edit it there). Leave it and a locally-previewed
email points at **production** twice over:

1. **The unsubscribe link** — the visible footer link *and* the RFC 8058
   `List-Unsubscribe` header — becomes `https://app.mishna2go.com/api/unsubscribe?t=…`
   with a token signed by your local secret. Clicking it hits production.
2. **The "I've memorized this" CTA** — same problem, higher stakes. It becomes
   `https://app.mishna2go.com/api/memorized?t=…`, and that link is a *check-off* on a
   real user's portion and, for its first week, a *sign-in* credential. Your local
   `MEMORIZED_SECRET` won't verify against production's, so it will fail closed rather
   than actually do anything — but you will have put a credential-shaped URL naming a
   real user id into a locally-rendered email. Don't rely on the secrets differing.
3. **The Hebrew text fetch** — `httpTextResolver(APP_ORIGIN)` loads mishna-text's
   tractate JSON from `${APP_ORIGIN}/<tractate>.json`.

Override it in `apps/server/.dev.vars` (which beats `[vars]`):

```
APP_ORIGIN=http://localhost:4200
```

That fixes both at once: `nx serve client` copies `node_modules/mishna-text/data/*.json`
into its assets, so it really serves `http://localhost:4200/berakhot.json`; and
`apps/client/proxy.conf.json` proxies `/api/*` to `localhost:8787`, so the unsubscribe
link in the previewed email lands on your **local** worker. `apps/server/.dev.vars.example`
documents this, along with Resend's sandbox addresses (`delivered@resend.dev`,
`bounced@resend.dev`, `complained@resend.dev`), which exercise the real API without
touching a mailbox.

### The routes

| Route | What it does |
|---|---|
| `GET /__dev/email` | The workbench page: a user dropdown, a weekly/reminder radio, Preview into an iframe, and a "send to" box. ~150 lines of plain HTML/CSS/JS, no framework and no build step, inlined from `dev-page.ts` (this worker has no static-asset pipeline). |
| `GET /__dev/email/plan?at=<ISO>` | **Dry run — sends nothing.** The real `planSends` against the real local D1 at an arbitrary instant: *"who would get mail at 08:00 Sunday?"* Returns the `PreparedEmail[]` as JSON. |
| `GET /__dev/email/render?userId=&kind=&weekStart=&at=&textOrigin=&part=&raw=` | `prepareOne` → `composeEmail`. Defaults to `text/html` so the browser paints the actual email; `?raw=1` for the source, `?part=text` for the plain-text alternative, `?part=json` for the whole `OutgoingEmail` including the RFC 8058 headers. Real user, real mishnayot, real Hebrew, real signed unsubscribe token. Needs **no** `RESEND_API_KEY`. |
| `POST /__dev/email/send` `{userId, kind, to?, weekStart?, textOrigin?}` | 🔴 Sends ONE **real** email through the production `processJobs` + `senderDeps`. `to` overrides the recipient. Writes the `email_log` row, exactly like admin send-now — so the scheduled send for that (user, kind, week) is then deduped away. |
| `GET /__dev/email/cron?at=<ISO>&wait=&fresh=` | Creates a real `ReminderWorkflow` instance for that instant — the same thing the hourly `scheduled` handler does — and polls for its `RunMetrics`. **This really sends** to everyone due; run `/plan` at the same `at` first. |
| `GET /__dev/email/users` | The dropdown's options, read straight from `AUTH_DB` + `participants` + `user_email_prefs`. Not `GET /api/admin/users`: that needs a real admin session cookie from `apps/login`, which a page opened directly against :8787 doesn't have. |

Two things to know when a route says "nobody":

- `?at=` is **UTC**, and the send window is 08:00 in the *user's* zone. An
  `America/New_York` user is due at `12:00Z` (EDT) / `13:00Z` (EST).
- `planSends` honors `email_log`, so a (user, kind, week) you already sent this week —
  including via `/__dev/email/send` — comes back empty. That's correct, not a bug.

### Seeding a user

The workbench reads whatever is in your local D1, so the normal local flow is the
seeding path: run `npm run dev`, sign up / sign in through the app, and press Join.
Two requirements the email path enforces, which is usually why a user doesn't appear
or `/render` answers `400 no sendable recipient`:

- **Verified only.** `loadRecipient` returns `null` for an address that isn't
  `emailVerified = 1` in `mishna-auth`. A Google sign-in is verified automatically; a
  password sign-up isn't until it's confirmed. To force it locally:
  `npx wrangler d1 execute mishna-auth --local --persist-to .wrangler/state --config apps/login/wrangler.toml --command 'UPDATE "user" SET "emailVerified" = 1'`
- **Joined.** No blocks means no mishnayot; `/render` still works (you get the
  deliberate empty-state email), `/plan` skips them.

### 🔴 Why these routes cannot reach production

`POST /__dev/email/send` mails **any address** as **any user**, with no auth. It is
safe only because it is *structurally* undeployable, not because of a flag:
`wrangler.toml` pins `main = "src/index.ts"`, and `index.ts` never imports
`dev-entry.ts`, so `wrangler deploy` has no path to `dev-routes.ts` at all. There is no
env var to set wrong, no environment to forget, and no `requireAdmin` a future handler
can omit.

The claim is checked two ways. Mechanically, on the real deploy bundle:

```sh
cd apps/server && npx wrangler deploy --dry-run --outdir /tmp/wfb
grep -c '__dev' /tmp/wfb/index.js       # must print 0
```

and in CI, by `email/dev-routes.integration.test.ts`, which asserts the production
entry answers `404` for every `/__dev/*` route. **Do not mount `mountDevEmailRoutes`
from `index.ts`** — that is the one edit that would undo all of this, and both checks
exist to catch it.

### Previewing the templates alone

`npm run email:dev` (port 3030) is the cheaper, offline half: react-email's own preview
server over `libs/shared/email-templates/src/lib/preview/`, one entry per email
*state* with sample data — `weekly`, `weekly-single-tractate` (the common
one-heading case), `weekly-empty` (reachable in production via admin send-now),
`weekly-large` (~40 mishnayot: the returning-user shape, and where you'd see Gmail's
~102 KB clipping bury the unsubscribe footer), `weekly-no-unsubscribe` (the control —
a footer that lost its link still looks like a normal footer), `reminder`,
`reminder-empty`. No D1, no user, no worker. Use it for layout; use `/__dev/email` for
"what would *this* user actually receive".

## Migrations

The `mishna-app` schema is a set of numbered D1 migrations in `migrations/`, tracked by
D1 in a `d1_migrations` table (so each runs exactly once per database). `wrangler.toml`
points at them via `migrations_dir = "migrations"`.

**Add a change:** create the next file with
`wrangler d1 migrations create mishna-app <name> --config apps/server/wrangler.toml`
(or hand-write `NNNN_name.sql`), then apply it. The tests pick up new files automatically
(see Testing), so no test wiring is needed.

**Apply** (from the repo root):

```sh
npm run db:migrate:local     # local D1 (the one `npm run dev` uses)
npm run db:migrate:remote    # production D1 — run as part of deploy
```

Both wrap `wrangler d1 migrations apply mishna-app …` and only run the pending files.
The existing `0001`/`0002` use `IF NOT EXISTS` so adopting migrations was safe on the
already-provisioned databases; new migrations can be plain DDL (they only ever run once).
`0006_unsubscribe.sql` adds the unsubscribe audit columns to `user_email_prefs`.
`0005_lot_reset.sql` is a one-time **data** reset (not DDL): the switch to lot-based
allocation changed the `groups.state` JSON shape, so it clears
`groups`/`group_members`/`participants`/`completions` and everyone re-joins.

## One-time setup

```sh
wrangler d1 create mishna-app          # paste the id into wrangler.toml database_id
npm run db:migrate:remote              # apply migrations to the new remote DB
wrangler types                         # regenerate worker-configuration.d.ts after binding changes
wrangler secret put UNSUBSCRIBE_SECRET # HMAC key for the one-click unsubscribe links
                                       # (comma-separated list; rotate by prepending)
wrangler secret put MEMORIZED_SECRET   # HMAC key for the "I've memorized this" links.
                                       # Set the SAME value on apps/login too — this
                                       # worker mints these tokens, that one verifies
                                       # them when minting a session. Do it BEFORE
                                       # deploying the code: minting fails closed
                                       # without it, which would throw on every send.
```

**Rotating `UNSUBSCRIBE_SECRET`.** Prepend the new secret to the list and deploy — new
tokens are signed with the first entry, verification accepts any entry, so no live link
breaks and there's nothing else to do. The policy is that the list is **append-only:
never prune by default.** The tokens have no expiry and ride in mail recipients keep
forever, so removing a secret permanently kills the unsubscribe link in every message
signed with it, and a dead unsubscribe link is exactly what earns the spam report this
feature exists to prevent. Keeping one costs a single extra `crypto.subtle.verify` per
retired secret, and only on requests whose token doesn't match a newer one. If a secret
genuinely must be removed (compromise), the hard floor is **24 months** after the last
send that used it — a deliberate act that accepts breaking older mail still in inboxes.

**Rotating `MEMORIZED_SECRET` — the opposite policy, deliberately.** Same mechanism
(prepend, deploy, sign-with-first/verify-against-all), and it must be rotated on **both**
workers together. But this list is **prunable and revocable**, because these tokens
*do* expire: 30 days after their send, and one is a login credential for its first 7.
So a retired secret can be dropped once everything signed with it is dead — floor: **60
days** after its last send. And if a secret is ever suspected of leaking, **remove it
immediately**: that is the correct incident response here rather than the harm, since it
revokes every outstanding link in a single deploy and the worst outcome is a dead
button. Do not carry this list forward out of habit from `UNSUBSCRIBE_SECRET`'s.

For **local dev**, seed both apps' local D1 before `npm run dev`:

```sh
npm run db:init:local                  # mishna-auth schema + mishna-app migrations
```

If the local `mishna-app` schema is missing/stale, sign-in succeeds but `GET /api/me`
returns an opaque **500** (D1 throws on `SELECT ... FROM participants`), and the client
treats it as unauthenticated — looking like login is broken. Re-run `db:migrate:local`.

## Testing

`nx test server`. Tests run on `@cloudflare/vitest-pool-workers` (real D1 + DO
bindings); `applyMigrations` (in `apply-migrations.ts`) eager-loads every
`migrations/*.sql` and runs them in `beforeAll`, so the test schema can never drift from
what ships — adding a migration file is all that's needed. Tables are cleared in
`beforeEach`. The `AUTH` service binding is stubbed in `vitest.config.mts`:
`get-session` treats the forwarded `cookie` value as the user id (so a test
authenticates as whoever its `Cookie:` header names) and flags cookie `'admin'` as
`isAdmin` (mirroring apps/login's `customSession`), so only `as('admin')` clears
`requireAdmin`. The better-auth admin endpoints (`list-users`/`get-user`/
`remove-user`) are stubbed with a fixed user directory. `AUTH_DB` is a real (empty) local
D1, auto-provisioned from `wrangler.toml`; the email tests create its `user` table and seed
it themselves.

- `repository.test.ts` — the `D1GroupRepository` against the same scenarios as the
  domain's `InMemoryGroupRepository`.
- `index.integration.test.ts` — full flow via `SELF.fetch`: join → me → assignment →
  admin → leave.
- `email/email.integration.test.ts` — `planSends` (who's due) and `processJobs` (build →
  send → log) directly, with an injected `send` so it runs offline; plus the two
  guarantees that only show up in the wiring — a re-render of the same batch is
  byte-identical (the Resend 409 trap) and `senderDeps` really hands `processJobs` a
  signed unsubscribe URL. Those byte-level assertions are the **runtime** guard for the
  templates and must stay here even though `@mishna/email-templates` has its own
  (semantic, node-side) tests: workerd renders via `renderToReadableStream`, node via
  `renderToPipeableStream`, and identical output is not contractually guaranteed.
- `email/workflow.integration.test.ts` — the `ReminderWorkflow` through
  `introspectWorkflowInstance`, i.e. the **real durable engine** (real `step.do`
  checkpointing, real retries, real replay) with sleeps and retry backoff disabled.
  Covers batching (250 planned → `send-batch-0/1/2`, sends of 100/100/50, output
  `{planned:250, sent:250, batches:3}`, 250 `email_log` rows); 🔴 **a retry does not
  re-send earlier batches** — the most expensive bug this codebase could have, and one
  `email_log` cannot catch, since it is written *after* a send; a permanently failing
  batch → `errored`, the Resend message in `getError()`, and `email_log` rows only for
  the batches that completed; the throttle costing real time; the **cron handler**
  deduping a double fire (asserted on the transport — one Resend POST for two fires at
  the same `scheduledTime`, two for distinct hours); and a **headroom probe** — 2000
  synthetic jobs serialize to ~278 KB (≈139 B/job) as a single `plan-sends` step result
  and round-trip intact across replays. Only two things are stubbed, both at the network
  edge: `api.resend.com` (which doubles as the send counter) and the tractate JSON.
  `RESEND_API_KEY` is pinned to a fake value for this file, because a developer's
  `.dev.vars` may hold a real one.
- `email/dev-routes.integration.test.ts` — the local workbench. Its first job is the
  **gate**: every `/__dev/*` route is a `404` on the production entry (`SELF.fetch`),
  because `POST /__dev/email/send` mails any address as any user with no auth and the
  only thing stopping it in production is that `wrangler.toml`'s `main` never imports
  `dev-entry.ts`. Then the routes themselves against real D1: `/plan` is a dry run
  (no send, no `email_log` row), `/render` returns real Hebrew plus an unsubscribe
  token that really verifies, `/send` honors the `to` override and records the send.
  Like `workflow.integration.test.ts` it pins a **fake** `RESEND_API_KEY` and stubs
  global `fetch` for `api.resend.com` and the tractate JSON — a developer's
  `.dev.vars` may hold a real key.
- `email/workflow.spec.ts` — `batchPlan`, exhaustively and deterministically: contiguous
  gap-free chunks and a throttle between every pair of batches, never after the last.
- `email/quota.spec.ts` — `httpTextResolver` over an injected loader (no network): the
  63-name corpus↔`mishna-text` mapping, the per-resolver cache (a 100-ref batch spanning
  two tractates loads twice), missing perek/mishna → `hebrew: ''`, and the degrade path
  for an unloadable tractate (one structured `console.error`, other tractates unaffected).
- `unsubscribe.integration.test.ts` — the one-click unsubscribe: the token (round-trip,
  rotation, determinism, malformed/forged input, throws with no secret), `pickLang`'s
  q-value ranking, GET is read-only and its rendered form's `action` really
  unsubscribes when posted, POST flips both flags (including for a user with **no**
  prefs row), answers `200`-with-the-error-page (and writes nothing) on a bad token,
  is idempotent, never 3xx, sets the no-store/
  no-referrer/nosniff headers, and the audit columns' full lifecycle across Settings and
  the admin toggle. `UNSUBSCRIBE_SECRET` is bound in `vitest.config.mts`.
- `preferences.integration.test.ts` — email prefs + admin send-now. The inline send can't
  succeed here, so send-now surfaces as a `502` (the real build/send is covered offline in
  the email test above) — which is what makes it the "the gate did *not* fire"
  discriminator for the hard-unsubscribe `409` tests (one-click/link → `409`;
  settings/admin, a partial re-enable, and no prefs row → `502`). Read the `502` as
  "a send was attempted and failed", **not** as "there is no Resend key" — there is one,
  and it's fake on purpose (see below). Today it fails in `prepareOne`, because this file
  never creates the `AUTH_DB` "user" table.

🔴 **No test can reach Resend, and that is enforced twice.** `vitest.config.mts` binds
`RESEND_API_KEY` to the **empty string** (the same thing `apps/login`'s config does),
because this pool loads `apps/server/.dev.vars` — where a developer very likely has a
*real* key, on a verified sender domain. An explicit empty binding makes `.dev.vars` lose
for every file in the suite, and empty beats fake: Resend's constructor throws on a falsy
key, so the default state is "no client can exist" rather than "a client exists and its
requests 401" — the latter still has the worker calling out from a test run.

The two files that genuinely need a constructible client
(`workflow.integration.test.ts`, `dev-routes.integration.test.ts`) opt in per-file with a
fake key **and** a default-deny global `fetch` stub; `preferences.integration.test.ts`
keeps the empty binding and adds the stub anyway. Keep both halves — the binding is the
floor, the stub is what stops a constructed client from making a request. The failure mode
is not exotic: seeding `AUTH_DB` in `preferences.integration.test.ts` (an obvious
improvement) is enough to put a live send one line away.
