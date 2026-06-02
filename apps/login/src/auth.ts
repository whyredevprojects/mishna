import { betterAuth } from "better-auth";

export function createAuth(env: Env) {
  return betterAuth({
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
    // Angular dev client origin; add the real client URL(s) before deploying.
    trustedOrigins: ["http://localhost:4200"],
    // socialProviders / plugins (Google OAuth, magicLink) can be added here later
  });
}
