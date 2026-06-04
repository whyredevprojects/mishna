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
| `schema.sql` | D1 schema for the `mishna-app` database. |

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
| `POST /api/join` `{ commitment: 1\|2\|3 }` | Validate, forward to `AllocatorDO.join` (auth). |
| `POST /api/leave` | Forward to `AllocatorDO.leave` (auth). |
| `GET /api/assignments/today` | Today's mishnayot for the caller (auth). |
| `GET /api/assignments?date=YYYY-MM-DD` | Same for an explicit UTC date (auth). |
| `GET /api/admin/groups` | Per group: `id`, `progress`, `members` (userIds) + `memberCount` (**admin**). |
| `GET /api/admin/users` | `{ users: [{ id, name, email, role, joined, commitment }], total }` — better-auth `list-users` merged with `participants` (**admin**). |
| `GET /api/admin/users/:id` | One user: identity + `{ joined, commitment, groups: [{ id, blockSize }] }` (**admin**). |
| `POST /api/admin/users/:id/remove-assignments` | `AllocatorDO.leave(id)` — frees the user's ranges, keeps the auth account (**admin**). |
| `DELETE /api/admin/users/:id` | Cascade: `AllocatorDO.leave(id)` then better-auth `remove-user` (**admin**). |

Assignments pass **all** of a user's blocks across groups straight to
`AssignmentEngine`, which sorts by corpus position internally. The admin
user-management routes proxy better-auth's admin plugin
(`/api/auth/admin/*` on the login worker) for identity, merging in join/group data
this worker owns. `/api/admin/groups` still returns `userId`s only.

## One-time setup

```sh
wrangler d1 create mishna-app          # paste the id into wrangler.toml database_id
wrangler d1 execute mishna-app --file src/schema.sql
wrangler types                         # regenerate worker-configuration.d.ts after binding changes
```

For **local dev**, apply both apps' schemas to the local D1 before `npm run dev`:

```sh
npm run db:init:local                  # initializes mishna-auth + mishna-app local D1
```

If the local `mishna-app` schema is missing, sign-in succeeds but `GET /api/me` returns an
opaque **500** (D1 throws on `SELECT ... FROM participants`), and the client treats it as
unauthenticated — looking like login is broken.

## Testing

`nx test server`. Tests run on `@cloudflare/vitest-pool-workers` (real D1 + DO
bindings); `schema.sql` is applied in `beforeAll` and tables are cleared in
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
