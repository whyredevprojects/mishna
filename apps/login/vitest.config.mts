import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/login',
  plugins: [
    nxViteTsPaths(),
    nxCopyAssetsPlugin(['*.md']),
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      // Force the captcha plugin OFF in tests, regardless of the developer's local
      // .dev.vars. The pool loads .dev.vars, and CLAUDE.md tells devs to put the
      // Turnstile *test* secret there — which would otherwise enable the captcha
      // plugin in-process and 400 the token-less sign-in/up tests (they assert the
      // un-captcha'd flow). An explicit empty binding overrides .dev.vars so
      // createAuth gates captcha off (env.TURNSTILE_SECRET_KEY falsy). See auth.ts.
      // RESEND_API_KEY is blanked for the same reason: keep tests hermetic (the
      // verification-email send fails-and-is-swallowed, as the sign-up test asserts)
      // and never dispatch a real email from a test run.
      miniflare: { bindings: { TURNSTILE_SECRET_KEY: '', RESEND_API_KEY: '' } },
    }),
  ],
  test: {
    name: 'login',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/login',
      provider: 'v8' as const,
    },
  },
}));
