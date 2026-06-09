/**
 * Production environment. This is the default file; the `development` build
 * configuration swaps it for `environment.development.ts` via `fileReplacements`
 * (see apps/client/project.json).
 *
 * `turnstileSiteKey` is the Cloudflare Turnstile *public* site key (the secret
 * lives in apps/login). This is the real production widget, bound to
 * getchevrasmishnayos.com.
 */
export const environment = {
  production: true,
  turnstileSiteKey: '0x4AAAAAADhFwbhDJNP7CeZY',
};
