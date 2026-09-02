import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/server',
  resolve: {
    // @react-email/render's workerd build imports `react-dom/server.edge`, a
    // subpath react-dom 19 dropped; map it to `server.browser` (same
    // `renderToReadableStream`). Mirrors the alias in wrangler.toml.
    alias: { 'react-dom/server.edge': 'react-dom/server.browser' },
  },
  plugins: [
    nxViteTsPaths(),
    nxCopyAssetsPlugin(['*.md']),
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // Secrets aren't in wrangler.toml, so the ones the tests need are bound
        // here. These are test fixtures, not real keys: production sets both with
        // `wrangler secret put`.
        //
        // 🔴 RESEND_API_KEY is blanked deliberately, and must stay blanked — the same
        // thing apps/login's config does, for the same reason. This pool loads
        // `apps/server/.dev.vars`, where a developer very likely has a REAL key, on a
        // verified sender domain. An explicit empty binding makes `.dev.vars` lose for
        // every file in the suite, and empty is better than fake: Resend's constructor
        // throws on a falsy key, so the default state is "no client can exist" rather
        // than "a client exists and its requests 401" — the latter still leaves the
        // worker making outbound calls from a test run.
        //
        // The two files that need a constructible client (`workflow.integration.test.ts`,
        // `dev-routes.integration.test.ts`) opt in per-file with a fake key AND a
        // default-deny `fetch` stub. That opt-in is the whole safety story: keep both
        // halves. See "No test can reach Resend" in apps/server/CLAUDE.md.
        bindings: {
          UNSUBSCRIBE_SECRET: 'test-unsubscribe-secret',
          MEMORIZED_SECRET: 'test-memorized-secret',
          RESEND_API_KEY: '',
        },
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
              // Ids starting with 'pending' model an unverified address, so the
              // send-verification route's already-verified short-circuit can be tested.
              emailVerified: !id.startsWith('pending'),
              createdAt: '2026-06-01T00:00:00.000Z',
            });

            // The login worker's server-only session minter, reached over this
            // binding by POST /api/memorized. It decodes (does NOT verify — the real
            // one verifies, and apps/login's own tests cover that) the token's
            // payload to learn the user id, then answers with the cookie this stub's
            // get-session understands: the cookie value IS the user id.
            //
            // Tests assert "nothing was minted" via the absence of a Set-Cookie on
            // the response rather than by counting calls here: this binding runs in
            // the workerd pool, so a counter in this file would not be readable from
            // a test anyway — and the cookie is the thing that actually matters.
            if (url.pathname === '/internal/memorized-session') {
              const token = request.headers.get('x-memorized-token') ?? '';
              const payload = token.split('.')[0] ?? '';
              let userId = '';
              try {
                userId = atob(
                  payload.replace(/-/g, '+').replace(/_/g, '/'),
                ).split('.')[1];
              } catch {
                userId = '';
              }
              if (!userId) return new Response('Unauthorized', { status: 401 });
              return new Response(JSON.stringify({ ok: true }), {
                headers: {
                  'content-type': 'application/json',
                  'set-cookie': `${userId}; Path=/; HttpOnly; SameSite=Lax`,
                },
              });
            }
            if (url.pathname === '/api/auth/get-session') {
              return json(
                cookie
                  ? {
                      user: {
                        ...fakeUser(cookie),
                        isAdmin: cookie === 'admin',
                      },
                    }
                  : null,
              );
            }
            if (url.pathname === '/api/auth/admin/list-users') {
              // Honor the pagination/search the server forwards, so the paging tests
              // exercise the real query params (better-auth does this for real).
              const all = ['alice', 'bob', 'admin'].map(fakeUser);
              const needle = url.searchParams.get('searchValue')?.toLowerCase();
              const field = url.searchParams.get('searchField') ?? 'email';
              const filtered = needle
                ? all.filter((u) =>
                    String(field === 'name' ? u.name : u.email)
                      .toLowerCase()
                      .includes(needle),
                  )
                : all;
              const offset = Number(url.searchParams.get('offset')) || 0;
              const limit =
                Number(url.searchParams.get('limit')) || filtered.length;
              return json({
                users: filtered.slice(offset, offset + limit),
                total: filtered.length,
              });
            }
            if (url.pathname === '/api/auth/admin/get-user') {
              const id = url.searchParams.get('id');
              return json(id ? fakeUser(id) : null);
            }
            if (url.pathname === '/api/auth/admin/remove-user') {
              return json({ success: true });
            }
            if (url.pathname === '/api/auth/admin/set-role') {
              // Mirror better-auth: state-changing admin calls are rejected without a
              // trusted Origin (MISSING_OR_NULL_ORIGIN), so this guards that the server
              // forwards the caller's Origin.
              if (!request.headers.get('origin')) {
                return new Response(
                  JSON.stringify({ code: 'MISSING_OR_NULL_ORIGIN' }),
                  {
                    status: 403,
                    headers: { 'content-type': 'application/json' },
                  },
                );
              }
              return json({ success: true });
            }
            if (url.pathname === '/api/auth/send-verification-email') {
              // Public endpoint, but better-auth still enforces the trusted-Origin
              // CSRF check on POST — guard that the server forwards the Origin.
              if (!request.headers.get('origin')) {
                return new Response(
                  JSON.stringify({ code: 'MISSING_OR_NULL_ORIGIN' }),
                  {
                    status: 403,
                    headers: { 'content-type': 'application/json' },
                  },
                );
              }
              return json({ status: true });
            }
            return json(null);
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
