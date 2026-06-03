# apps/login

Cloudflare Worker providing authentication for the Mishna app via
[better-auth](https://better-auth.com). Currently email + password is enabled;
Google OAuth / magic links can be added later in `src/auth.ts`.

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

### Applying the schema

```bash
# Local dev D1 (.wrangler/state)
wrangler d1 execute mishna-auth --local --file src/schema.sql

# Production D1
wrangler d1 execute mishna-auth --remote --file src/schema.sql
```

Verify tables exist:

```bash
wrangler d1 execute mishna-auth --local --command "select name from sqlite_master where type='table'"
```

### Upgrading better-auth

The core email/password schema is stable, so this is usually a no-op — but check:

1. Bump `better-auth` in `package.json` and install.
2. Re-run the generate command above.
3. `git diff src/schema.sql`. If empty, done.
4. If it changed (e.g. after enabling a plugin like magic-link or 2FA, which add
   columns/tables), the diff shows what's new. The generated file is full
   `create table` DDL, so for an **existing** production DB apply only the delta as
   `ALTER TABLE` statements (a fresh local DB can just re-run the full file).

## Authentication methods

- **Email + password** — enabled in `authOptions` (`src/auth.ts`). No email
  verification yet (`emailVerified` stays 0); add later via a `sendEmail` callback.
- **Google OAuth** — wired in `createAuth(env)` via `socialProviders.google`,
  reading `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from env (Wrangler secrets).
  Enabling it needs no schema change — the existing `account` table covers OAuth.

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
