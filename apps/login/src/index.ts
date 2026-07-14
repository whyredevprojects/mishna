import { createAuth } from './auth';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/auth')) {
      return new Response('Not found', { status: 404 });
    }

    try {
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
      console.error('auth handler error\n', err instanceof Error ? err.stack : err);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  },
};
