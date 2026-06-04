// Secrets aren't declared in wrangler.toml, so `wrangler types` can't see them.
// Merge them into the generated ambient Env here.
interface Env {
  /** Resend API key. Set with `wrangler secret put RESEND_API_KEY`. */
  RESEND_API_KEY: string;
}
