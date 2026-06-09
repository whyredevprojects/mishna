/**
 * Development environment. Swapped in for `environment.ts` by the `development`
 * build configuration (`nx serve`) via `fileReplacements` in project.json.
 *
 * `turnstileSiteKey` is Cloudflare's "always passes, visible" *testing* site key —
 * it works on any hostname (incl. localhost). Pair it with the test secret in
 * apps/login/.dev.vars.example.
 */
export const environment = {
  production: false,
  turnstileSiteKey: '1x00000000000000000000AA',
};
