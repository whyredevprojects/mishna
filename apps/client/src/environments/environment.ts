/**
 * Production environment. This is the default file; the `development` build
 * configuration swaps it for `environment.development.ts` via `fileReplacements`
 * (see apps/client/project.json).
 *
 * `turnstileSiteKey` is the Cloudflare Turnstile *public* site key (the secret
 * lives in apps/login). This is the real production widget, bound to
 * app.getchevrasmishnayos.com (the app host; add it to the widget's allowed
 * hostnames in the Cloudflare dashboard).
 */
export const environment = {
  production: true,
  turnstileSiteKey: '0x4AAAAAADhFwbhDJNP7CeZY',
};
