// Secrets aren't declared in wrangler.toml, so `wrangler types` can't see them.
// Merge RESEND_API_KEY into both the global `Env` (what the worker code uses) and
// `Cloudflare.Env` (what `cloudflare:test`'s `env` / `ProvidedEnv` extend), so the
// secret is visible in both the worker and the tests.
interface Env {
  /** Resend API key. Set with `wrangler secret put RESEND_API_KEY`. */
  RESEND_API_KEY: string;
}

declare namespace Cloudflare {
  interface Env {
    /** Resend API key. Set with `wrangler secret put RESEND_API_KEY`. */
    RESEND_API_KEY: string;
  }
}
