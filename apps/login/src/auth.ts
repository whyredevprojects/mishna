import { betterAuth, type BetterAuthOptions } from 'better-auth';

// Env-independent config. Shared with auth.config.ts so the offline schema
// generator (better-auth CLI) emits DDL for exactly this configuration.
// Google OAuth is wired per-env in createAuth (it needs runtime secrets);
// enabling it adds no new tables (the generated `account` table already
// covers OAuth), so this object stays the source of truth for schema generation.
export const authOptions = {
  emailAndPassword: { enabled: true, minPasswordLength: 4 },
  // Origins better-auth accepts state-changing requests from. No trailing slash —
  // these are compared against the request's Origin header, which never has one.
  // In production the client and auth share one host (getchevrasmishnayos.com), so
  // this is same-origin; localhost:4200 is the Angular dev server.
  trustedOrigins: [
    'http://localhost:4200',
    'https://getchevrasmishnayos.com',
  ],
} satisfies Partial<BetterAuthOptions>;

export function createAuth(env: Env) {
  return betterAuth({
    ...authOptions,
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
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
