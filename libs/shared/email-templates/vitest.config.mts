import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

// Plain **node** vitest, deliberately: no `@cloudflare/vitest-pool-workers` and, in
// particular, **no `react-dom/server.edge` alias**. That alias exists in
// apps/server's config only because @react-email/render's `workerd` export condition
// imports a react-dom subpath react 18/19 doesn't ship; under node, `@react-email/render`
// resolves its `node` condition and uses `renderToPipeableStream` instead. Adding the
// alias here would be cargo cult.
//
// The node and workerd renderers produce the same static markup, but that is not
// contractually guaranteed — so these tests assert *semantics*, and the byte-level
// guarantees (a byte-identical re-render, the plain-text part, the headers) stay in
// apps/server's workerd integration test, which runs in the real runtime.
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/shared/email-templates',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'email-templates',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/shared/email-templates',
      provider: 'v8' as const,
    },
  },
}));
