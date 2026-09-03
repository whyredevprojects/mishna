import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { admin, captcha, customSession } from 'better-auth/plugins';
import { sendResetPasswordEmail, sendVerificationEmail } from './email';
import { memorizedSession } from './memorized-session';

// Env-independent config. Shared with auth.config.ts so the offline schema
// generator (better-auth CLI) emits DDL for exactly this configuration.
// Google OAuth is wired per-env in createAuth (it needs runtime secrets);
// enabling it adds no new tables (the generated `account` table already
// covers OAuth), so this object stays the source of truth for schema generation.
//
// The admin plugin is listed here (with no args) only so the schema generator
// emits its columns (user.role/banned/banReason/banExpires, session.impersonatedBy).
// Who actually counts as an admin is a runtime concern, so createAuth re-builds
// the plugin with `adminUserIds` from the environment (see below).
export const authOptions = {
  emailAndPassword: { enabled: true, minPasswordLength: 4 },
  // Origins better-auth accepts state-changing requests from. No trailing slash —
  // these are compared against the request's Origin header, which never has one.
  // Only the dev origins are static; the production app origin is the same host as
  // BETTER_AUTH_URL (the client and auth share one host), so createAuth derives it
  // from env rather than duplicating it here — config/domains.json stays the single
  // source. The dev entries are loopback wildcards (better-auth supports port
  // wildcards): they cover the Angular dev server on any port (it falls back off
  // 4200 when that's taken) and either loopback host, so a stray 127.0.0.1 or
  // non-4200 port doesn't fail sign-in/up with INVALID_ORIGIN.
  trustedOrigins: ['http://localhost:*', 'http://127.0.0.1:*'],
  plugins: [admin()],
} satisfies Partial<BetterAuthOptions>;

/** Parses the comma-separated ADMIN_USER_IDS env var into a clean id list. */
export function parseAdminUserIds(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The `http://` twin of `appOrigin`, to be trusted **in local dev only** — or
 * `undefined` when there is nothing to add.
 *
 * In dev this worker is reached through the server worker's AUTH service binding, and
 * wrangler's local binding presents this worker's *route* host from wrangler.toml
 * (`app.<apex>/api/auth/*`) as the request Origin. There is no TLS in front of
 * `wrangler dev`, so it arrives as `http://app.<apex>` — the same host APP_ORIGIN
 * names, one scheme off. better-auth compares trusted origins as plain strings, so
 * that one character is the difference between a sign-up succeeding and a 403
 * INVALID_ORIGIN ("Invalid origin: http://app.<apex>" in the login worker's log).
 *
 * Gated on BETTER_AUTH_URL being a loopback origin, which is true only under
 * `.dev.vars`: in production the app host stays https-only, since a browser will
 * never send an http Origin for it.
 */
export function devHttpAppOrigin(
  appOrigin: string | undefined,
  betterAuthUrl: string | undefined,
): string | undefined {
  if (!appOrigin?.startsWith('https://')) return undefined;
  let authHost: string;
  try {
    authHost = new URL(betterAuthUrl ?? '').hostname;
  } catch {
    return undefined;
  }
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(authHost)) {
    return undefined;
  }
  return `http://${appOrigin.slice('https://'.length)}`;
}

export function createAuth(env: Env) {
  const adminIds = parseAdminUserIds(env.ADMIN_USER_IDS);
  return betterAuth({
    ...authOptions,
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Surface auth failures. better-auth swallows a non-APIError throw (a D1/SQL
    // error, a Resend/module failure, a stream error): it returns a bare 500 and
    // only logs via its own logger when isAPIError(e) (see api/index.mjs router),
    // and with onAPIError.throw defaulting to false the error never reaches the
    // worker's try/catch either — so the request just 500s with no diagnostic.
    // Log the full error + stack for every failure (throw stays false so clients
    // still get better-auth's clean response).
    onAPIError: {
      onError: (error, ctx) => {
        const detail =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error('[better-auth] API error', '\n', detail);
      },
    },
    // Trusted origins = the static dev loopback wildcards (authOptions) plus the two
    // env-sourced app origins. BETTER_AUTH_URL is the cookie/callback host (localhost
    // in dev, the app host in prod). APP_ORIGIN is the *canonical* app host in ALL
    // envs — trusted independently of BETTER_AUTH_URL: in dev the request reaches this
    // worker via the server worker's AUTH service binding, and wrangler's dev binding
    // presents this worker's route host — the same host APP_ORIGIN names — as the
    // request Origin, so it must be trusted even though BETTER_AUTH_URL is localhost.
    // Both come from the single source (config/domains.json → wrangler.toml).
    // Deduped (they're equal in prod).
    // Plus, in dev only, the http:// form of that host — what the binding actually
    // presents, since wrangler dev has no TLS (see devHttpAppOrigin).
    trustedOrigins: [
      ...new Set(
        [
          ...authOptions.trustedOrigins,
          env.BETTER_AUTH_URL,
          env.APP_ORIGIN,
          devHttpAppOrigin(env.APP_ORIGIN, env.BETTER_AUTH_URL),
        ].filter(Boolean),
      ),
    ],
    // Transactional auth email via Resend (apps/login/src/email.ts). These callbacks
    // need runtime secrets (RESEND_API_KEY), so they live here, not in the static
    // authOptions. Both reuse the existing `verification` table — no schema change.
    // We `await` the send (rather than fire-and-forget) so it isn't dropped on
    // Workers without ctx.waitUntil; transactional volume is low.
    emailAndPassword: {
      ...authOptions.emailAndPassword,
      sendResetPassword: async ({ user, url }) => {
        // A failing send must not 503 the request: better-auth returns 200 for a
        // reset request regardless (so it can't be used to probe which emails exist),
        // so swallow + log rather than throw.
        try {
          await sendResetPasswordEmail(env, { to: user.email, url });
        } catch (err) {
          console.error('sendResetPassword failed', err);
        }
      },
    },
    // Confirmation email on sign-up. Not *required* to sign in (would lock out
    // existing unverified accounts) — flip emailAndPassword.requireEmailVerification
    // to enforce. Verifying also opts the user into apps/server's reminder mail,
    // which only sends to verified addresses.
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        // Verification isn't required to sign in, so a failed send must never block
        // sign-up. (better-auth already tolerates this, but make the intent explicit.)
        try {
          await sendVerificationEmail(env, { to: user.email, url });
        } catch (err) {
          console.error('sendVerificationEmail failed', err);
        }
      },
    },
    // Re-build the admin plugin with the runtime admin list. `adminUserIds`
    // grants full admin permissions to those user ids (the admin endpoints
    // under /api/auth/admin/* authorize against it). It doesn't change the
    // schema, so the no-arg admin() in authOptions still drives generation.
    //
    // customSession stamps `isAdmin` onto the get-session response so this worker
    // is the single source of truth for who's an admin: apps/server reads it from
    // the session it already fetches and needs no ADMIN_USER_IDS of its own. The
    // callback runs on every get-session (custom fields are never cached).
    //
    // Two paths grant admin: the `ADMIN_USER_IDS` env bootstrap (seed admins, set at
    // deploy time) OR a `role` of 'admin' on the user row — which admins can set at
    // runtime via the admin plugin's set-role endpoint (see apps/server's
    // /api/admin/users/:id/set-role). The role path layers on top of the env seed;
    // it doesn't replace it.
    plugins: [
      // Cloudflare Turnstile bot protection. This middleware reads the
      // `x-captcha-response` header on POSTs to the default endpoints
      // (`/sign-in/email`, `/sign-up/email`, `/request-password-reset`),
      // verifies it against Turnstile's /siteverify, and rejects the request if
      // it's missing/invalid. The secret key is a runtime Wrangler secret, so —
      // like the email callbacks — it lives here, not in static authOptions. The
      // plugin adds no tables, so the generated schema/migrations are unchanged.
      //
      // Gated on the secret being configured: with no secret an empty-string key
      // would reject *every* sign-in/up, and it lets the worker's own tests (which
      // run with no TURNSTILE_SECRET_KEY) exercise the auth flows unguarded.
      // Production must set the secret (see CLAUDE.md) for protection to be on.
      ...(env.TURNSTILE_SECRET_KEY
        ? [
            captcha({
              provider: 'cloudflare-turnstile',
              secretKey: env.TURNSTILE_SECRET_KEY,
            }),
          ]
        : []),
      // The emailed "I've memorized this" link's sign-in half. Server-only: it is
      // never registered on the HTTP router, and is reached solely through
      // `auth.api.mintMemorizedSession` from this worker's /internal route (see
      // index.ts and memorized-session.ts). Gated on the secret like captcha above —
      // with none configured every call fails closed as UNAUTHORIZED.
      ...(env.MEMORIZED_SECRET ? [memorizedSession(env.MEMORIZED_SECRET)] : []),
      admin({ adminUserIds: adminIds }),
      customSession(async ({ user, session }) => ({
        user: {
          ...user,
          isAdmin:
            adminIds.includes(user.id) ||
            (user as { role?: string | null }).role === 'admin',
        },
        session,
      })),
    ],
    // Google OAuth. Credentials are supplied as Wrangler secrets
    // (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET); see CLAUDE.md.
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
  });
}
