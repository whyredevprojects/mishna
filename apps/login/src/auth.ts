import { betterAuth } from "better-auth";

export function createAuth(env: Env) {
  return betterAuth({
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
    // socialProviders / plugins (Google OAuth, magicLink) can be added here later
  });
}
