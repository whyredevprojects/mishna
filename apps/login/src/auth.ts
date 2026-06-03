import { betterAuth, type BetterAuthOptions } from "better-auth";

// Env-independent config. Shared with auth.config.ts so the offline schema
// generator (better-auth CLI) emits DDL for exactly this configuration.
// socialProviders / plugins (Google OAuth, magicLink) can be added here later.
export const authOptions = {
  emailAndPassword: { enabled: true },
  // Angular dev client origin; add the real client URL(s) before deploying.
  trustedOrigins: ["http://localhost:4200"],
} satisfies Partial<BetterAuthOptions>;

export function createAuth(env: Env) {
  return betterAuth({
    ...authOptions,
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
  });
}
