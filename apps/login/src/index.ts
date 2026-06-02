import { createAuth } from './auth';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = createAuth(env);
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/auth')) {
      return auth.handler(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
