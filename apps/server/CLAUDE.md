# apps/server

Main REST API for the Mishna app (Cloudflare Worker, Hono). It is the HTTP
surface the Angular client calls **and** the production data layer for
`@mishna/domain`: it supplies the D1-backed `GroupRepository` the domain library
declares but doesn't ship, authenticates against `apps/login`, and serializes
allocation writes so concurrent joins can't corrupt a group.

## Layout (`src/`)

| File | Role |
|------|------|
| `index.ts` | Hono app + routes + the worker entry. Default export is `{ fetch, scheduled }` (the cron handler kicks off the `ReminderWorkflow`); also exports `{ AllocatorDO, ReminderWorkflow }`. |
| `domain.ts` | Module-scope domain singletons (`structure`, `calendar`, `assignmentEngine`, `idGen`), built once per isolate. |
| `repository.ts` | `D1GroupRepository implements GroupRepository` — the production persistence adapter. |
| `allocator.ts` | `AllocatorDO` Durable Object — the single, serialized write path for join/leave. |
| `auth-middleware.ts` | `requireAuth` — validates the session cookie via the `AUTH` service binding. |
| `email/` | The email module. The bulk **decision logic** (`planSends` — who is due at 08:00 local → `PreparedEmail[]`) and its **D1 reads** now live in the `@mishna/email-domain` + `@mishna/email-data` libs; this app owns the side-effecting half: `workflow.ts` (`ReminderWorkflow` + `senderDeps` + run metrics; builds a `D1EmailRepository` and calls the lib's `planSends`), `sender.ts` (`processJobs` — render → Resend batch w/ idempotency key → `deps.record`, plus `prepareOne` for admin; re-exports `PreparedEmail` from the lib), `data.ts` (the admin/send-now readers only — `loadGroupBlocksFor`/`loadIdentitiesFor`/`alreadySentSet`/`loadCompletedFor` + single-user `loadRecipient`/`loadBlocks`/`loadCompleted`; reuses `@mishna/email-data`'s `chunked`/`placeholders` and `@mishna/email-domain`'s `DEFAULT_EMAIL_PREFS`), `quota.ts` (week's mishnayot + Hebrew text via `mishna-text`), `unsubscribe.ts` (the signed one-click-unsubscribe token + URL + the self-contained bilingual landing page the `/api/unsubscribe` routes render), `templates/` (React Email components, one file per email, rendered to HTML at send time; English chrome with each mishna's Hebrew text kept RTL; `templates/preview/` holds the dev-only preview entries — see below). |
| `apply-migrations.ts` | Test support: eager-loads `migrations/*.sql` and applies them to a D1 binding (used by the test `beforeAll`s). |
| `migrations/` | Numbered D1 migrations (`0001_initial.sql`, `0002_completions.sql`, …) — the source of truth for the `mishna-app` schema. |

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
  manual one-off, not the schedule).
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
| `POST /api/unsubscribe?t=&lang=` | The RFC 8058 one-click target *and* the form's action. Verifies the token, then turns the scope's emails off (`weekly_enabled`/`reminder_enabled`). Accepts, but doesn't require, the `List-Unsubscribe=One-Click` form body. `200 text/plain` for a machine POST, the HTML success page when `Accept: text/html`; `400` on a bad/malformed token; unknown user and a repeat POST are both an idempotent `200`. **Never redirects** (RFC 8058 forbids it) (public). |
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
| `POST /api/admin/users/:id/send-weekly` | Build and send an extra weekly email inline (bypasses dedup); `502` if the send fails. Verified-only, like the bulk path (**admin**). |
| `POST /api/admin/users/:id/send-reminder` | Same, for a reminder email (**admin**). |
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
`run-metrics` step logging one `{ evt: 'reminder_run', durationMs, planned, sent, batches }`
line — the early-warning for the per-invocation ceiling.

**Email content — the next unlearned bucket.** Emails keep their calendar *schedule*
and per-week dedup (timing anchored to the user's weekly-email weekday; `email_log`
deduped on `(user, kind, weekStart)`), but their *content* is the user's **next
still-unlearned bucket** — the same `pace`-sized slice the dashboard shows, via `nextRefs`
(`email/quota.ts`) → `AssignmentEngine.getNextAssignment`. The weekly email shows the whole
bucket; the reminder shows only its still-pending mishnayot. Both are **skipped once the
user has learned their whole portion** (an empty next bucket), so a finished user gets no
further mail. Because the content is progress-based, `planSends` loads completions for
**every** due user (not just reminders).

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

The admin "send now" routes resolve one `PreparedEmail` via `prepareOne` (per-user reads —
fine at volume 1) and send it **inline and synchronously** via the same `processJobs` path
(bypassing the dedup), so the admin gets the real result — a `502` on a Resend failure.
The week is anchored from the user's prefs (`localParts` + `weekStartOnOrBefore`).

**Verified-only.** The email path never mails an unverified address. `loadEmails`
(bulk) filters `WHERE "emailVerified" = 1`, and `loadRecipient` (admin send-now) returns
`null` unless the address is present and verified — so an unverified user is silently
skipped by the cron and yields no `PreparedEmail` for send-now. Google sign-ins are
verified automatically by better-auth; password sign-ups stay unverified until a
verification flow is added (`apps/login`). The admin views surface the flag so it's visible.

**Unsubscribe (RFC 8058 one-click).** Every scheduled email carries
`List-Unsubscribe: <https://…/api/unsubscribe?t=…>`, `List-Unsubscribe-Post:
List-Unsubscribe=One-Click` and a `List-Id`, plus a **visible** "Unsubscribe" footer
link (Gmail wants both). The link's `t` is a stateless HMAC-signed token
(`email/unsubscribe.ts`): `base64url("v1.<userId>.<scope>") "."
base64url(HMAC-SHA256)`, signed with `UNSUBSCRIBE_SECRET` (a **comma-separated list** —
sign with the first, verify against all, which is the rotation story). **No expiry, and
no timestamp in the payload at all** — an expired link on year-old mail earns a spam
report, so nothing would ever be enforced against one; and a clock in the payload would
make the token (hence the header and the footer) differ on every render, while the batch
`Idempotency-Key` covers only (user, kind, week) — Resend answers a reused key carrying a
different payload with `409 invalid_idempotent_request`, which would fail the retried
`step.do` and take the rest of that hour's batches with it. The token is a pure function
of (secret, userId, scope); `processJobs` run twice over the same jobs produces
byte-identical mail, and there's a test that says so.
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

Both routes answer with `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and
`X-Content-Type-Options: nosniff` (and the page repeats the referrer policy in a
`<meta>`): the URL is a never-expiring bearer token, and the pages link to the
same-origin `/settings`, where the default referrer policy would hand the full URL —
`?t=` included — to that navigation.

**Editing templates.** The emails are React Email components in `src/email/templates/`
(`weekly-email.tsx`, `reminder-email.tsx`, shared `components/`, theme in `styles.ts`),
rendered to HTML at send time by `templates/index.tsx`'s `weeklyEmail`/`reminderEmail`.
Preview them live in the browser with `npm run email:dev` (from the repo root) — it serves
the dev-only entries in `templates/preview/` (one per email state, with sample mishnayot) at
`http://localhost:3030`. The CLI only lists `.tsx`/`.jsx` files with a default export, so the
`.ts` sample-data file is ignored. Two install-time gotchas (react 18.3.1 pin and the
`react-dom/server.edge` alias) are documented at the top of `wrangler.toml` / in
`package.json`.

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
```

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
  signed unsubscribe URL.
- `unsubscribe.integration.test.ts` — the one-click unsubscribe: the token (round-trip,
  rotation, determinism, malformed/forged input, throws with no secret), `pickLang`'s
  q-value ranking, GET is read-only and its rendered form's `action` really
  unsubscribes when posted, POST flips both flags (including for a user with **no**
  prefs row), 400s on a bad token, is idempotent, never 3xx, sets the no-store/
  no-referrer/nosniff headers, and the audit columns' full lifecycle across Settings and
  the admin toggle. `UNSUBSCRIBE_SECRET` is bound in `vitest.config.mts`.
- `preferences.integration.test.ts` — email prefs + admin send-now. The send path has no
  `RESEND_API_KEY` in tests, so `senderDeps()` throws and send-now surfaces as a `502`
  (the real build/send is covered offline in the email test above).
