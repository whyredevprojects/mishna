import { createMiddleware } from 'hono/factory';

// ---------------------------------------------------------------------------
// requireAuth
//
// Authenticates against the apps/login better-auth worker via the AUTH service
// binding. better-auth exposes a built-in `/api/auth/get-session` endpoint that
// reads the session cookie and returns `{ user, session }` (or null). We simply
// forward the incoming `cookie` header to it and trust the result.
//
// On success the user id is stashed on the context (`c.get("userId")`); on any
// failure the request is rejected with 401.
// ---------------------------------------------------------------------------

export type AuthVariables = { userId: string };

interface SessionResponse {
  user?: { id?: string } | null;
}

export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const cookie = c.req.header('cookie');
  if (!cookie) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const res = await c.env.AUTH.fetch('https://login/api/auth/get-session', {
    headers: { cookie },
  });
  if (!res.ok) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const session = (await res.json()) as SessionResponse | null;
  const userId = session?.user?.id;
  if (!userId) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  c.set('userId', userId);
  await next();
});
