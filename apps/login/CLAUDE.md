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

## Before first deploy

- Set the real `BETTER_AUTH_URL` in `wrangler.toml` (currently a localhost
  placeholder).
- Add the real client origin(s) to `trustedOrigins` in `src/auth.ts` (currently
  only `http://localhost:4200`).
- `wrangler secret put BETTER_AUTH_SECRET`.

## Tests

`nx test login` runs against a real D1 binding via `@cloudflare/vitest-pool-workers`.
The test schema is seeded in `beforeAll` via better-auth's `getMigrations(...)`
(independent of `src/schema.sql`).
