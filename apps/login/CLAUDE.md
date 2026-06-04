# apps/login

Cloudflare Worker providing authentication for the Mishna app via
[better-auth](https://better-auth.com). Email + password and Google OAuth are
enabled, plus the better-auth **admin plugin** (exposes `/api/auth/admin/*`).
Magic links etc. can be added later in `src/auth.ts`.

- `src/index.ts` — worker entry; routes `/api/auth/*` to the better-auth handler.
- `src/auth.ts` — `createAuth(env)` builds the better-auth instance from the D1
  binding + env vars. Env-independent options live in the exported `authOptions`,
  shared with `auth.config.ts`.
- `auth.config.ts` — **generation only** (not bundled in the worker). Exports a
  static `auth` backed by in-memory `better-sqlite3` so the better-auth CLI can
  emit DDL. See "Database schema" below.

## Database

Uses its **own** D1 database, `mishna-auth` (binding `DB` in `wrangler.toml`) —
separate from `apps/server`'s `mishna-app`. better-auth talks to D1 directly via
its built-in Kysely D1 dialect (`database: env.DB`).

### Schema

`src/schema.sql` holds the better-auth tables (`user`, `session`, `account`,
`verification`). It is **generated** — do not hand-edit. Regenerate with:

```bash
cd apps/login
npx @better-auth/cli@latest generate --config ./auth.config.ts --output ./src/schema.sql --yes
```

(`@better-auth/cli` can't reach D1 directly — D1 is only accessible from inside a
Worker — so we generate the SQL offline and apply it with Wrangler.)

### Applying the schema (wrangler d1 migrations)

Schema is applied via numbered migrations in `migrations/` (the default
`migrations_dir`), so it's idempotent and incremental rather than re-running full
DDL:

- `0001_init.sql` — baseline better-auth tables, written `CREATE TABLE IF NOT
  EXISTS` so it's a no-op on the already-provisioned DBs.
- `0002_admin_plugin_fields.sql` — the admin plugin's columns (`user.role/banned/
  banReason/banExpires`, `session.impersonatedBy`) as `ALTER TABLE ADD COLUMN`.

```bash
# Local dev D1 (.wrangler/state) — also run by `npm run db:init:local`
wrangler d1 migrations apply mishna-auth --local

# Production D1
wrangler d1 migrations apply mishna-auth --remote
```

Verify columns exist:

```bash
wrangler d1 execute mishna-auth --local --command "PRAGMA table_info(user)"
```

`src/schema.sql` stays the **generated reference** (full DDL of the current shape)
but is no longer the apply mechanism.

### Upgrading better-auth / enabling a plugin

1. Bump `better-auth` in `package.json` (and/or add the plugin to `authOptions` in
   `src/auth.ts`) and install.
2. Regenerate the reference: `npx @better-auth/cli@latest generate --config
   ./auth.config.ts --output ./src/schema.sql --yes`.
3. `git diff src/schema.sql`. If empty, done.
4. If it changed, add a new `migrations/NNNN_*.sql` with the delta as `ALTER TABLE`
   statements (types from the regenerated DDL) and `wrangler d1 migrations apply`.

## Authentication methods

- **Email + password** — enabled in `authOptions` (`src/auth.ts`). No email
  verification yet (`emailVerified` stays 0); add later via a `sendEmail` callback.
- **Google OAuth** — wired in `createAuth(env)` via `socialProviders.google`,
  reading `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from env (Wrangler secrets).
  Enabling it needs no schema change — the existing `account` table covers OAuth.

## Admin

The better-auth admin plugin is enabled in `authOptions` (`src/auth.ts`). Who is an
admin is configured at runtime, not in the DB: `createAuth(env)` passes
`admin({ adminUserIds })` parsed from the **`ADMIN_USER_IDS`** env var
(comma-separated better-auth user ids). Those ids get full admin permissions on the
`/api/auth/admin/*` endpoints (`list-users`, `get-user`, `remove-user`, …). The
`role` column stays NULL — admin status is not role-based here.

This worker is the **single source of truth** for admin status: a `customSession`
plugin stamps `isAdmin` (`adminUserIds.includes(user.id)`) onto the get-session
response. `apps/server` reads `user.isAdmin` from the session it already fetches to
gate its `/api/admin/*` routes, so `ADMIN_USER_IDS` lives only here — no need to
duplicate the secret on the server worker.

## Production topology (same-origin)

The client (Cloudflare Pages) and both workers all serve from one host,
`getchevrasmishnayos.com`, so the session cookie is first-party and there is **no
CORS**. Routing is by path at the edge (`routes` in each `wrangler.toml`), with
Cloudflare running the most specific match:

- `getchevrasmishnayos.com/api/auth/*` → **this** (login) worker
- `getchevrasmishnayos.com/api/*` → the server worker
- everything else → the Pages SPA

In **dev** there are no routes: `apps/client/proxy.conf.json` sends all `/api/*` to
the server worker, which forwards `/api/auth/*` here via the `AUTH` service binding.

## Before first deploy

- `BETTER_AUTH_URL` in `wrangler.toml` is `https://getchevrasmishnayos.com` (the
  public origin). `.dev.vars` overrides it to `http://localhost:8787` for dev.
- `trustedOrigins` in `src/auth.ts` is `http://localhost:4200` +
  `https://getchevrasmishnayos.com` (no trailing slash — matched against the Origin
  header).
- `wrangler secret put BETTER_AUTH_SECRET`.
- `wrangler secret put ADMIN_USER_IDS` (comma-separated user ids). For local dev,
  put it in `.dev.vars`. Must match `apps/server`'s `ADMIN_USER_IDS`.
- `wrangler secret put GOOGLE_CLIENT_ID` and `wrangler secret put
  GOOGLE_CLIENT_SECRET` (from a Google Cloud OAuth 2.0 Client). For local dev,
  put them in `.dev.vars`. Register **both** redirect URIs in the Google Cloud
  console: `https://getchevrasmishnayos.com/api/auth/callback/google` (prod) and
  `http://localhost:8787/api/auth/callback/google` (dev).
- The Pages project must have `getchevrasmishnayos.com` as a custom domain (its
  zone must be on this Cloudflare account for the worker `routes` to bind).

## Tests

`nx test login` runs against a real D1 binding via `@cloudflare/vitest-pool-workers`.
The test schema is seeded in `beforeAll` via better-auth's `getMigrations(...)`
(independent of `src/schema.sql`).
