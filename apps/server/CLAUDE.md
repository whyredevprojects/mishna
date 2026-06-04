# apps/server

Main REST API for the Mishna app (Cloudflare Worker, Hono). It is the HTTP
surface the Angular client calls **and** the production data layer for
`@mishna/domain`: it supplies the D1-backed `GroupRepository` the domain library
declares but doesn't ship, authenticates against `apps/login`, and serializes
allocation writes so concurrent joins can't corrupt a group.

## Layout (`src/`)

| File | Role |
|------|------|
| `index.ts` | Hono app + routes. Exports `default app` and `{ AllocatorDO }`. |
| `domain.ts` | Module-scope domain singletons (`structure`, `calendar`, `assignmentEngine`, `idGen`), built once per isolate. |
| `repository.ts` | `D1GroupRepository implements GroupRepository` — the production persistence adapter. |
| `allocator.ts` | `AllocatorDO` Durable Object — the single, serialized write path for join/leave. |
| `auth-middleware.ts` | `requireAuth` — validates the session cookie via the `AUTH` service binding. |
| `apply-migrations.ts` | Test support: eager-loads `migrations/*.sql` and applies them to a D1 binding (used by the test `beforeAll`s). |
| `migrations/` | Numbered D1 migrations (`0001_initial.sql`, `0002_completions.sql`, …) — the source of truth for the `mishna-app` schema. |

## Data model (D1 binding `DB`, database `mishna-app`)

Separate from the better-auth `mishna-auth` DB owned by `apps/login`.

- `groups(id, state, exhausted, capacity_left, updated_at)` — `state` is the JSON
  `GroupState` from `Group.toState()`; `exhausted`/`capacity_left` are denormalized
  from it on every save so queries don't parse JSON.
- `group_members(group_id, user_id)` — denormalized membership (index on `user_id`),
  rebuilt from `state.blocks[].userId` on each `save` so `loadGroupsForUser` is an
  indexed join.
- `participants(user_id, commitment, joined_at)` — who joined and their commitment;
  drives `/api/me` and rejects double-joins.
- `completions(user_id, group_id, mesechta, perek, mishna, completed_at)` — one row per
  mishna a user has marked learned, within a specific group. `group_id` is resolved
  server-side from the user's block and handed down with the assignment, so per-group
  rollups are a plain `GROUP BY group_id` (no join, exact under overflow) and rows are
  cycle-scoped (groups are recreated each cycle). `completed_at` (epoch ms) seeds a future
  offline last-write-wins sync.
- `user_email_prefs(user_id, timezone, weekly_email_dow, reminder_email_dow,
  weekly_enabled, reminder_enabled, updated_at)` — per-user email settings (`0003`). A
  missing row means defaults (`America/New_York`, weekly=Sun, reminder=Thu, both on);
  `GET /api/me/preferences` synthesizes them and the email worker treats a missing row
  the same way. Read+written here, read by `apps/email`.
- `email_log(user_id, kind, week_start, sent_at)` — one row per email actually sent
  (`0004`), so each (user, kind, week) goes out at most once even though the cron fires
  hourly. Written by `apps/email`; the server only references the table name when
  describing the dedup that admin "send now" bypasses (it sends synchronously via the
  `EMAIL` binding rather than through the cron orchestrator).

`save()` upserts the group row and replaces its membership rows in one `db.batch()`
so the row and its members never drift apart.

## Concurrency

All `join`/`leave` route through **one** `AllocatorDO` instance
(`idFromName("allocator")`). Inside, an in-process promise chain serializes the
load→mutate→save cycle, so two simultaneous joins can't both read the same tail and
double-allocate it (D1 alone doesn't serialize across `await`s once a DO is involved).
Reads — assignments, `/me`, admin — hit D1 directly and need no coordination.

## Auth

`requireAuth` forwards the incoming `cookie` to the login worker via the `AUTH`
service binding (`/api/auth/get-session`, a better-auth built-in) and sets
`c.get("userId")` / `c.get("user")` (id, name, email, role, **isAdmin**), else `401`.

`requireAdmin` does the same, then requires `user.isAdmin === true`, else `403`.
This worker holds **no** admin config: `apps/login` is the single source of truth —
its `customSession` plugin stamps `isAdmin` onto the get-session response from its
`ADMIN_USER_IDS`. The admin user-management routes also proxy better-auth's
`/api/auth/admin/*` endpoints through the `AUTH` binding (forwarding the caller's
cookie; better-auth authorizes those against the same `ADMIN_USER_IDS`).

## Routes

| Method & path | Behavior |
|---|---|
| `GET /api/corpus` | The static `MishnahDataset` (public; lets the client skip bundling it). |
| `GET /api/cycle` | `{ cycleStart, cycleEnd, daysElapsed, daysRemaining, totalDays }` for the current cycle (public; powers the landing-page progress bar without shipping `@hebcal/core` to the client). |
| `GET /api/me` | `{ joined, commitment, user: { id, name, email, role }, isAdmin }` (auth). |
| `GET /api/me/preferences` | The caller's email prefs, defaults if no row (auth). |
| `PUT /api/me/preferences` `{ timezone, weeklyEmailDow, reminderEmailDow, weeklyEnabled, reminderEnabled }` | Validate (IANA tz via `Intl`, dow 0-6) + upsert (auth). |
| `POST /api/join` `{ commitment: 1\|2\|3 }` | Validate, forward to `AllocatorDO.join` (auth). |
| `POST /api/leave` | Forward to `AllocatorDO.leave` (auth). |
| `GET /api/assignments/today` | Today's mishnayot for the caller, plus the `groupId` they belong to (auth). |
| `GET /api/assignments?date=YYYY-MM-DD` | Same for an explicit UTC date (auth). |
| `GET /api/completions` | `{ completed: MishnaRef[] }` — every mishna the caller has marked learned (auth). |
| `POST /api/completions` `{ ref, groupId }` | Mark a mishna learned; validates the ref + the caller's membership of `groupId`, then upserts (auth). |
| `DELETE /api/completions` `{ ref, groupId }` | Unmark a mishna; idempotent, scoped to the caller's rows (auth). |
| `GET /api/admin/groups` | Per group: `id`, `progress`, `members` (userIds) + `memberCount` (**admin**). |
| `GET /api/admin/users` | `{ users: [{ id, name, email, role, joined, commitment }], total }` — better-auth `list-users` merged with `participants` (**admin**). |
| `GET /api/admin/users/:id` | One user: identity + `{ joined, commitment, groups: [{ id, blockSize }] }` (**admin**). |
| `POST /api/admin/users/:id/remove-assignments` | `AllocatorDO.leave(id)` — frees the user's ranges, keeps the auth account (**admin**). |
| `POST /api/admin/users/:id/send-weekly` | Synchronously send an extra weekly email via the `EMAIL` service binding (bypasses dedup); `502` if the send fails (**admin**). |
| `POST /api/admin/users/:id/send-reminder` | Same, for a reminder email (**admin**). |
| `DELETE /api/admin/users/:id` | Cascade: `AllocatorDO.leave(id)` then better-auth `remove-user` (**admin**). |

`groupId` on assignments is resolved by `buildAssignment`: it finds the group whose block
range contains the day's mishnayot. Completions reuse this id rather than re-deriving it
on every write. (On the single overflow-boundary day a user's mishnayot can span two
groups; they're all attributed to the first's group — accepted noise for a progress
rollup.)

The admin "send now" routes build an `EmailJob` (`{ userId, kind, weekStart }`, from
`@mishna/domain`) and POST it to `apps/email`'s `/internal/send` route via the `EMAIL`
service binding — **synchronously**, so the admin gets the real result (and a `502` on
failure). This is deliberately *not* the queue: volume is 1, the queue can't report
success/failure back, and cross-process queues aren't delivered in local `wrangler dev`
(service bindings are, via the dev registry, like `AUTH`→login). The scheduled/bulk path
still fans out through the queue — only the email worker produces to it now. The week is
anchored from the user's prefs (`localParts` + `weekStartOnOrBefore`).

Assignments pass **all** of a user's blocks across groups straight to
`AssignmentEngine`, which sorts by corpus position internally. The admin
user-management routes proxy better-auth's admin plugin
(`/api/auth/admin/*` on the login worker) for identity, merging in join/group data
this worker owns. `/api/admin/groups` still returns `userId`s only.

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

## One-time setup

```sh
wrangler d1 create mishna-app          # paste the id into wrangler.toml database_id
npm run db:migrate:remote              # apply migrations to the new remote DB
wrangler types                         # regenerate worker-configuration.d.ts after binding changes
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
`remove-user`) are stubbed with a fixed user directory.

- `repository.test.ts` — the `D1GroupRepository` against the same scenarios as the
  domain's `InMemoryGroupRepository`.
- `index.integration.test.ts` — full flow via `SELF.fetch`: join → me → assignment →
  admin → leave.
