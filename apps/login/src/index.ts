import { createAuth } from './auth';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (
      !url.pathname.startsWith('/api/auth') &&
      url.pathname !== '/internal/memorized-session'
    ) {
      return new Response('Not found', { status: 404 });
    }

    try {
      // The emailed "I've memorized this" link's sign-in half, reached only over
      // apps/server's AUTH service binding. It is deliberately NOT under /api/auth/*:
      // this worker's wrangler `routes` claim only that prefix, so no hostname on the
      // zone dispatches /internal/* here, and `workers_dev`/`preview_urls` are off so
      // there is no *.workers.dev door either. The better-auth endpoint behind it is
      // `serverOnly` (never on the router) and verifies a signed token rather than
      // trusting a userId — four layers, documented in CLAUDE.md.
      //
      // POST only, and a bare 404 (not a 405) for anything else: a GET must never mint
      // a session, since mail scanners follow every link in a message.
      if (url.pathname === '/internal/memorized-session') {
        if (request.method !== 'POST') {
          return new Response('Not found', { status: 404 });
        }
        const t = request.headers.get('x-memorized-token') ?? '';
        // `asResponse` so the Set-Cookie `setSessionCookie` wrote comes back on a
        // real Response for apps/server to copy onto its redirect. `await`ed for the
        // same reason as the auth handler below: a rejection must be caught here, not
        // escape as an opaque 503.
        return await createAuth(env).api.mintMemorizedSession({
          headers: new Headers({ 'x-memorized-token': t }),
          asResponse: true,
        });
      }

      const auth = createAuth(env);
      // `await` so a rejected handler promise is caught here, not left to escape the
      // worker as an unhandled rejection — which Workers surfaces as an opaque 503
      // ("Can't read from request stream after response has been sent"). This turns
      // any unexpected auth/config error into a clean, logged 500.
      return await auth.handler(request);
    } catch (err) {
      // Log the stack, not just the error object — this fires when createAuth or the
      // handler throws out to the worker (better-auth's own internal errors are logged
      // via onAPIError.onError in auth.ts instead, since they don't rethrow here).
      console.error(
        'auth handler error\n',
        err instanceof Error ? err.stack : err,
      );
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  },
};
