// ---------------------------------------------------------------------------
// Minting a session from an emailed "I've memorized this" link.
//
// The CTA at the top of every scheduled email is meant to be one click: mark the
// mishnayos, and land in the app signed in. `apps/server` owns the marking; this is
// the sign-in half, and it lives here because only this worker has better-auth's
// session tables, cookie secret and cookie conventions.
//
// **Why this is not the `magicLink` plugin.** That plugin publishes a *public*
// `POST /sign-in/magic-link` taking `{ email }`, which on our topology
// (app.<apex>/api/auth/* routes straight here) would be a new "make us email any
// address" endpoint — one the Turnstile captcha plugin's default endpoint list does
// not cover. `oneTimeToken` is no help either: `generateOneTimeToken` sits behind
// `sessionMiddleware`, so it needs the session we are trying to create.
//
// **Why `createAuthEndpoint.serverOnly`.** better-call's router skips an endpoint
// whose `metadata.SERVER_ONLY` is set (`better-call/dist/router.mjs`), while
// `getEndpoints` still exposes it on `auth.api`. So this handler is callable from
// trusted server code inside this worker and **has no URL at all** — there is no path
// under /api/auth/* that reaches it.
//
// **Why it verifies a token instead of trusting a userId.** This is the layer that
// actually matters. `apps/server` reaches the endpoint over the AUTH service binding,
// and it would be less code to pass `{ userId }` and protect the hop with a shared
// secret. But that shape is a mint-a-session-for-anyone primitive if it is ever
// reachable, and it needs a second secret to guard. Verifying the same signed token
// the recipient clicked means the worst an attacker gains from reaching this endpoint
// is the power they already had by holding a valid, unexpired link: sign in as that
// link's owner. See `apps/login/CLAUDE.md` for the four layers this is the last of.
// ---------------------------------------------------------------------------

import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { canLogin, verifyMemorizedToken } from '@mishna/email-domain';

/**
 * A one-endpoint plugin exposing
 * `auth.api.mintMemorizedSession({ headers: { 'x-memorized-token': t } })`.
 *
 * The token travels in a header rather than a JSON body only because a typed body
 * would mean declaring a zod schema, and zod is not a dependency of this workspace —
 * not worth adding one for a single string. The hop is an in-process service binding
 * (no network, no proxy logs), so a header is as private as a body here.
 *
 * Adds **no tables** — it only writes `session` rows through better-auth's own
 * internal adapter — so `schema.sql` and `migrations/` are untouched, and the static
 * `authOptions` the schema generator reads does not need it.
 *
 * Gated on `MEMORIZED_SECRET` at the `createAuth` call site, the same way `captcha`
 * is: with no secret every call here would be an `UNAUTHORIZED`, which is the correct
 * fail-closed behavior but is worth making explicit at the wiring.
 */
export const memorizedSession = (secret: string | undefined) =>
  ({
    id: 'memorized-session',
    endpoints: {
      mintMemorizedSession: createAuthEndpoint.serverOnly(
        { method: 'POST' },
        async (ctx) => {
          // Every refusal *returns* a 401 rather than throwing `APIError`. Under
          // `asResponse: true` a throw still produces the right response, but it also
          // surfaces as an unhandled rejection — which Vitest fails the whole run on,
          // and which would be noise in production logs for what is an entirely
          // routine outcome here (an old link, a scanner, a stale forward).
          const denied = () => {
            ctx.setStatus(401);
            return ctx.json({ ok: false });
          };

          const token = ctx.headers?.get('x-memorized-token');
          const claims = await verifyMemorizedToken(secret, token);
          if (!claims) return denied();

          // The *login* window, not the marking one. A month-old link may still say
          // "I learned these"; only a week-old one may still sign someone in. Checked
          // here as well as in apps/server on purpose — this endpoint is the thing
          // that hands out credentials, so it must not depend on its caller having
          // checked. Both enforcements are tested independently.
          if (!canLogin(claims, new Date())) return denied();

          // `session.userId` has a foreign key to `user`. Without this lookup an id
          // for a deleted user surfaces as an opaque D1 500 rather than a clean 401.
          const user = await ctx.context.internalAdapter.findUserById(
            claims.userId,
          );
          if (!user) return denied();

          const session = await ctx.context.internalAdapter.createSession(
            claims.userId,
          );
          // better-auth's own cookie writer: name, `__Secure-` prefix, signing with
          // BETTER_AUTH_SECRET, HttpOnly / SameSite=Lax / Path=/ / host-only, and the
          // configured maxAge all come from the library. Nothing about this cookie is
          // hand-rolled, so it is identical to one from an ordinary email sign-in.
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
