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

# Production D1 — also run automatically on push to `main` by CI
# (`npm run db:migrate:remote`, which migrates both mishna-app and mishna-auth
# before deploy). The command stays available for manual/out-of-band applies.
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

- **Email + password** — enabled in `authOptions` (`src/auth.ts`).
- **Google OAuth** — wired in `createAuth(env)` via `socialProviders.google`,
  reading `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from env (Wrangler secrets).
  Enabling it needs no schema change — the existing `account` table covers OAuth.

## Captcha (Cloudflare Turnstile)

The better-auth **captcha plugin** (`cloudflare-turnstile`) guards the
bot-facing endpoints. It's middleware: on a POST to `/sign-in/email`,
`/sign-up/email`, or `/request-password-reset` (the plugin defaults) it reads the
`x-captcha-response` header, verifies it via Turnstile's `/siteverify`, and rejects
the request if the token is missing/invalid. The Angular client renders the widget
and sends that header (`apps/client` `TurnstileComponent` + `AuthService`); the
server worker forwards `/api/auth/*` with `c.req.raw`, so the header survives the
hop in both dev and prod.

- Wired in `createAuth(env)` (`src/auth.ts`) — it needs the runtime
  `TURNSTILE_SECRET_KEY` secret, like the email callbacks, and adds **no tables**
  (so the generated schema / migrations are untouched).
- **Gated on the secret**: the plugin is only added when `TURNSTILE_SECRET_KEY` is
  set. With no secret an empty key would reject every sign-in/up, and it lets the
  worker's own tests (run with no secret) exercise the auth flows. **Production
  must set the secret** for protection to be on.

## Email (verification + password reset)

`createAuth(env)` wires two better-auth email callbacks to **Resend**
(`src/email.ts`), self-contained in this worker (its own `RESEND_API_KEY` secret +
`RESEND_FROM_EMAIL` var — no call back into `apps/server`):

- **Email verification** — `emailVerification.sendOnSignUp: true` sends a "Verify
  your email" link on sign-up. It is **not** required to sign in
  (`requireEmailVerification` is off — flip it on in the `emailAndPassword` block to
  enforce, but that locks out existing unverified accounts). Verifying also opts the
  user into `apps/server`'s reminder mail, which only sends to verified addresses.
  Google sign-ins are verified automatically.
- **Password reset** — `emailAndPassword.sendResetPassword` emails a reset link.
  The client drives it via `request-password-reset` (with a `redirectTo` of the
  SPA's `/reset-password`) → `reset-password` (token + new password).

Both emails ship an HTML **and** a `text/plain` part (Resend sends a
`multipart/alternative` when it gets both) — an HTML-only message is a spam-filter
signal and unreadable in a text-only client, which here would mean a user who can't
verify or reset. The text half is hand-written next to the HTML in `shell()` (this
worker has no `@react-email/*` dependency and isn't worth one for two hardcoded
strings), so keep the two in sync when editing; `src/email.test.ts` pins the contract
that the URL sits bare on its own line and that `escapeHtml` never touches the text.

Both reuse the existing `verification` table — **no schema change / migration**.
The callbacks need runtime secrets so they live in `createAuth(env)`, not the
static `authOptions`; they `await` the Resend send (reliable on Workers without
`ctx.waitUntil`; transactional volume is low).

## Admin

The better-auth admin plugin is enabled in `authOptions` (`src/auth.ts`). Admin
status comes from **two** sources:

1. **`ADMIN_USER_IDS`** env var (comma-separated better-auth user ids) — bootstrap
   admins, configured at runtime, not in the DB. `createAuth(env)` passes
   `admin({ adminUserIds })`. These ids always have full admin permissions on the
   `/api/auth/admin/*` endpoints (`list-users`, `get-user`, `set-role`, …).
2. **The `user.role` column** — set to `'admin'` via the admin plugin's `set-role`
   endpoint (the client's "Make admin" button → `apps/server`
   `/api/admin/users/:id/set-role` proxies here). This grants admin without
   editing `ADMIN_USER_IDS`, and is the runtime mechanism for promoting users.
   It requires the `0002_admin_plugin_fields.sql` columns to exist in the DB —
   missing them makes `set-role` fail with a 500.

This worker is the **single source of truth** for admin status: a `customSession`
plugin stamps `isAdmin` (`adminUserIds.includes(user.id) || user.role === 'admin'`)
onto the get-session response. `apps/server` reads `user.isAdmin` from the session
it already fetches to gate its `/api/admin/*` routes, so `ADMIN_USER_IDS` lives only
here — no need to duplicate the secret on the server worker.

## Production topology (same-origin)

The client (Cloudflare Pages) and both workers all serve from one host,
`app.getchevrasmishnayos.com`, so the session cookie is first-party and there is **no
CORS**. (The apex/`www` host serves the separate static landing page in `apps/www`.)
Routing is by path at the edge (`routes` in each `wrangler.toml`), with
Cloudflare running the most specific match:

- `app.getchevrasmishnayos.com/api/auth/*` → **this** (login) worker
- `app.getchevrasmishnayos.com/api/*` → the server worker
- everything else → the Pages SPA

In **dev** there are no routes: `apps/client/proxy.conf.json` sends all `/api/*` to
the server worker, which forwards `/api/auth/*` here via the `AUTH` service binding.

## Before first deploy

- `BETTER_AUTH_URL` in `wrangler.toml` is `https://app.getchevrasmishnayos.com` (the
  public origin). It comes from the repo-wide `config/domains.json` via
  `npm run sync:domains` (see the root CLAUDE.md "Changing the domain") — don't hand-edit
  it. `.dev.vars` overrides it to `http://localhost:8787` for dev.
- `trustedOrigins` (no trailing slash — matched against the Origin header) is the dev
  loopback wildcards `http://localhost:*` / `http://127.0.0.1:*` (static in `authOptions`,
  so any dev port and either loopback host work without an `INVALID_ORIGIN`) **plus** two
  env-sourced app origins appended in `createAuth(env)`: `BETTER_AUTH_URL` (the cookie/
  callback host — localhost in dev, the app host in prod) and `APP_ORIGIN` (the canonical
  app host, `https://app.<apex>`). Both come from `config/domains.json` via
  `npm run sync:domains`, so they follow a rebrand automatically. `APP_ORIGIN` is trusted
  **in all envs, independently of `BETTER_AUTH_URL`**, and — unlike `BETTER_AUTH_URL` — is
  deliberately not overridden in `.dev.vars`: in dev the browser is on localhost, but the
  request reaches this worker through the server worker's `AUTH` service binding, and
  wrangler's dev binding presents *this worker's route host* (`APP_ORIGIN`) as the request
  `Origin` — so the app host must stay trusted even though the dev `BETTER_AUTH_URL` is
  localhost, or email/password sign-in/up fails with `INVALID_ORIGIN`.
- `wrangler secret put BETTER_AUTH_SECRET`.
- `wrangler secret put ADMIN_USER_IDS` (comma-separated user ids). For local dev,
  put it in `.dev.vars`. Must match `apps/server`'s `ADMIN_USER_IDS`.
- `wrangler secret put GOOGLE_CLIENT_ID` and `wrangler secret put
  GOOGLE_CLIENT_SECRET` (from a Google Cloud OAuth 2.0 Client). For local dev,
  put them in `.dev.vars`. Register **both** redirect URIs in the Google Cloud
  console: `https://app.getchevrasmishnayos.com/api/auth/callback/google` (prod) and
  `http://localhost:8787/api/auth/callback/google` (dev).
- `wrangler secret put RESEND_API_KEY` (for verification + password-reset email).
  For local dev, put it in `.dev.vars`. `RESEND_FROM_EMAIL` is a plain var in
  `wrangler.toml` (`noreply@getchevrasmishnayos.com`, the verified Resend domain).
- `wrangler secret put TURNSTILE_SECRET_KEY` (Cloudflare Turnstile bot protection).
  Create the widget in the Cloudflare dashboard for `app.getchevrasmishnayos.com` — its
  **site key** goes in `apps/client/src/environments/environment.ts`, its **secret
  key** here. (Dev uses Cloudflare's always-pass test keys, wired via
  `environment.development.ts` + `.dev.vars`.)
  For local dev, put `TURNSTILE_SECRET_KEY` in `.dev.vars` (the test secret
  `1x0000000000000000000000000000000AA` always passes). Without this secret the
  captcha plugin is **disabled** (see "Captcha" above).
- The Pages project must have `app.getchevrasmishnayos.com` as a custom domain (its
  zone must be on this Cloudflare account for the worker `routes` to bind).

## Tests

`nx test login` runs against a real D1 binding via `@cloudflare/vitest-pool-workers`.
The test schema is seeded in `beforeAll` via better-auth's `getMigrations(...)`
(independent of `src/schema.sql`).
