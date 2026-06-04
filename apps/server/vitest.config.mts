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
        // binding. get-session treats the forwarded cookie value as the user id
        // (so tests pick who they are with a `Cookie:` header; no cookie -> no
        // session) and flags cookie 'admin' as the admin (mirroring apps/login's
        // customSession). The better-auth admin endpoints the server proxies are
        // stubbed with a fixed user directory.
        serviceBindings: {
          AUTH: async (request: Request) => {
            const url = new URL(request.url);
            const cookie = request.headers.get('cookie');
            const json = (body: unknown) =>
              new Response(JSON.stringify(body), {
                headers: { 'content-type': 'application/json' },
              });
            const fakeUser = (id: string) => ({
              id,
              name: `${id} name`,
              email: `${id}@example.com`,
              role: null,
            });

            if (url.pathname === '/api/auth/get-session') {
              return json(
                cookie
                  ? { user: { ...fakeUser(cookie), isAdmin: cookie === 'admin' } }
                  : null,
              );
            }
            if (url.pathname === '/api/auth/admin/list-users') {
              return json({
                users: ['alice', 'bob', 'admin'].map(fakeUser),
                total: 3,
              });
            }
            if (url.pathname === '/api/auth/admin/get-user') {
              const id = url.searchParams.get('id');
              return json(id ? fakeUser(id) : null);
            }
            if (url.pathname === '/api/auth/admin/remove-user') {
              return json({ success: true });
            }
            return json(null);
          },
          // The apps/email worker isn't running in tests, so stub its /internal/send
          // route (hit by admin "send now"). It echoes a successful send, except for
          // user 'sendfail', for which it returns 500 so the server's 502 path is testable.
          EMAIL: async (request: Request) => {
            const job = (await request.json().catch(() => ({}))) as {
              userId?: string;
            };
            if (job.userId === 'sendfail') {
              return new Response(
                JSON.stringify({ error: 'Resend batch failed: boom' }),
                { status: 500, headers: { 'content-type': 'application/json' } },
              );
            }
            return new Response(JSON.stringify({ sent: 1, job }), {
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
