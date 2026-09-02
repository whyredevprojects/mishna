import { createMiddleware } from 'hono/factory';

// ---------------------------------------------------------------------------
// Auth middleware
//
// Authenticates against the apps/login better-auth worker via the AUTH service
// binding. better-auth exposes a built-in `/api/auth/get-session` endpoint that
// reads the session cookie and returns `{ user, session }` (or null). We forward
// the incoming `cookie` header to it and trust the result.
//
// `requireAuth` stashes the user on the context (`c.get("userId")` / `c.get("user")`)
// or rejects with 401. `requireAdmin` additionally requires the session to be
// flagged `isAdmin` — apps/login stamps that onto the get-session response (via its
// customSession plugin) from its `ADMIN_USER_IDS`, so the login worker is the single
// source of truth and this worker needs no admin config of its own. Else 403.
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  name?: string;
  email?: string;
  role?: string | null;
  isAdmin?: boolean;
}

export type AuthVariables = { userId: string; user: SessionUser };

interface SessionResponse {
  user?: SessionUser | null;
}

type AuthContext = { Bindings: Env; Variables: AuthVariables };

/**
 * Resolves the session user from the forwarded cookie, or null.
 *
 * Exported for the one route that needs the *answer* rather than the gate: the
 * emailed "I've memorized this" POST is authorized by its signed token, but still has
 * to know whether this browser already holds a session, and whose.
 */
export async function sessionUser(cookie: string | undefined, env: Env): Promise<SessionUser | null> {
  if (!cookie) {
    return null;
  }
  const res = await env.AUTH.fetch('https://login/api/auth/get-session', {
    headers: { cookie },
  });
  if (!res.ok) {
    return null;
  }
  const session = (await res.json()) as SessionResponse | null;
  return session?.user?.id ? session.user : null;
}

export const requireAuth = createMiddleware<AuthContext>(async (c, next) => {
  const user = await sessionUser(c.req.header('cookie'), c.env);
  if (!user) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('userId', user.id);
  c.set('user', user);
  await next();
});

export const requireAdmin = createMiddleware<AuthContext>(async (c, next) => {
  const user = await sessionUser(c.req.header('cookie'), c.env);
  if (!user) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (user.isAdmin !== true) {
    return c.json({ error: 'forbidden' }, 403);
  }
  c.set('userId', user.id);
  c.set('user', user);
  await next();
});
