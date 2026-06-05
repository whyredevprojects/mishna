import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { admin, customSession } from 'better-auth/plugins';

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
  // In production the client and auth share one host (getchevrasmishnayos.com), so
  // this is same-origin; localhost:4200 is the Angular dev server.
  trustedOrigins: ['http://localhost:4200', 'https://getchevrasmishnayos.com'],
  plugins: [admin()],
} satisfies Partial<BetterAuthOptions>;

/** Parses the comma-separated ADMIN_USER_IDS env var into a clean id list. */
export function parseAdminUserIds(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createAuth(env: Env) {
  const adminIds = parseAdminUserIds(env.ADMIN_USER_IDS);
  return betterAuth({
    ...authOptions,
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
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
