import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/server',
  plugins: [
    nxViteTsPaths(),
    nxCopyAssetsPlugin(['*.md']),
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // The login worker isn't running in tests, so stub the AUTH service
        // binding: treat the forwarded cookie value as the user id (so tests
        // pick who they are with a `Cookie:` header); no cookie -> no session.
        serviceBindings: {
          AUTH: async (request: Request) => {
            const cookie = request.headers.get('cookie');
            const body = cookie ? { user: { id: cookie } } : null;
            return new Response(JSON.stringify(body), {
              headers: { 'content-type': 'application/json' },
            });
          },
        },
      },
    }),
  ],
  test: {
    name: 'server',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/server',
      provider: 'v8' as const,
    },
  },
}));
