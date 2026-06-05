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
      console.error('auth handler error', err);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  },
};
