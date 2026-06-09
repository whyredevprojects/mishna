/**
 * Cloudflare Turnstile public site key, used to render the widget on the
 * sign-in / sign-up / forgot-password forms. This is a *public*, domain-bound
 * value (the secret key lives in apps/login), so hardcoding it here is safe and
 * keeps with this app's "no environment.ts" convention (see CLAUDE.md).
 *
 * The value below is Cloudflare's "always passes, visible" *testing* site key —
 * it works on any hostname, so it's ideal for local dev. Pair it with the test
 * secret in apps/login/.dev.vars.example.
 *
 * For production, create a Turnstile widget in the Cloudflare dashboard with
 * hostnames `getchevrasmishnayos.com` and `localhost` (one key serves both), and
 * replace the value below with that widget's site key.
 */
export const TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
