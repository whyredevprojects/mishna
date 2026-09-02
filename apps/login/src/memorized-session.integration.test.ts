import { SELF, env } from 'cloudflare:test';
import { getMigrations } from 'better-auth/db/migration';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  LOGIN_TTL_DAYS,
  MARK_TTL_DAYS,
  memorizedExpiresAt,
  mintMemorizedToken,
} from '@mishna/email-domain';
import { createAuth } from './auth';
import '../src';

// The sign-in half of the emailed "I've memorized this" link.
//
// This endpoint hands out real sessions, so most of what is asserted here is what it
// *refuses* to do. The two structural guarantees — that it has no URL under
// /api/auth/*, and that a GET can never reach it — are the first two tests, because
// they are the ones a refactor could silently break.

const SECRET = 'test-memorized-secret';
const ORIGIN = 'http://example.com';
const INTERNAL = `${ORIGIN}/internal/memorized-session`;
const DAY = 86400_000;

/** An expiry that puts `now` `days` into the token's life. */
function expiryPutting(days: number): number {
  return Math.floor(Date.now() / 1000) + (MARK_TTL_DAYS - days) * 86400;
}

async function post(token: string, init: RequestInit = {}) {
  return SELF.fetch(INTERNAL, {
    method: 'POST',
    headers: { 'x-memorized-token': token },
    ...init,
  });
}

async function sessionCount(): Promise<number> {
  const row = await (env as Env).DB.prepare(
    'SELECT COUNT(*) AS n FROM session',
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('memorized session minting', () => {
  let userId = '';

  beforeAll(async () => {
    const { runMigrations } = await getMigrations(
      createAuth(env as Env).options,
    );
    await runMigrations();

    const signUp = await SELF.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'memorized@example.com',
        password: 'password123',
        name: 'Memorized User',
      }),
    });
    const body = (await signUp.json()) as { user?: { id: string } };
    userId = body.user?.id ?? '';
    expect(userId).not.toBe('');
  });

  // -- the structural guarantees ---------------------------------------------

  it('has no URL under the public auth surface', async () => {
    // `createAuthEndpoint.serverOnly` keeps the endpoint off better-call's router, so
    // no path reaches it however it is spelled. If a refactor drops `.serverOnly`,
    // one of these stops being a 404.
    const token = await mintMemorizedToken(
      SECRET,
      userId,
      0,
      memorizedExpiresAt('2026-03-01'),
    );
    for (const path of [
      '/api/auth/memorized-session',
      '/api/auth/mint-memorized-session',
      '/api/auth/internal/memorized-session',
      '/api/auth/mintMemorizedSession',
    ]) {
      const res = await SELF.fetch(`${ORIGIN}${path}`, {
        method: 'POST',
        headers: { 'x-memorized-token': token },
      });
      expect(res.status, path).toBe(404);
      expect(res.headers.get('set-cookie'), path).toBeNull();
    }
  });

  it('never mints on a GET, whatever the token', async () => {
    // Mail scanners and link-preview bots GET every URL in a message. They do not
    // POST, and they certainly do not submit forms.
    const token = await mintMemorizedToken(SECRET, userId, 0, expiryPutting(0));
    const before = await sessionCount();
    for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
      const res = await SELF.fetch(INTERNAL, {
        method,
        headers: { 'x-memorized-token': token },
      });
      expect(res.status, method).toBe(404);
      expect(res.headers.get('set-cookie'), method).toBeNull();
    }
    expect(await sessionCount()).toBe(before);
  });

  // -- the happy path ---------------------------------------------------------

  it('mints a usable session for a valid, fresh token', async () => {
    const token = await mintMemorizedToken(SECRET, userId, 2, expiryPutting(0));
    const res = await post(token);
    expect(res.status).toBe(200);

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).not.toBe('');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    // Host-only: no Domain attribute (crossSubDomainCookies is off), so the cookie
    // cannot leak to a sibling subdomain.
    expect(cookie).not.toContain('Domain=');

    // The cookie is a real session, not a decoration.
    const session = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
      headers: { cookie: cookie.split(';')[0] },
    });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user?: { id: string } };
    expect(body.user?.id).toBe(userId);
  });

  // -- what it refuses --------------------------------------------------------

  it('refuses a token whose login window has closed, without touching session', async () => {
    // Day 8+: the mark half of this link still works (apps/server honours it for 30
    // days), but the credential half is over.
    const token = await mintMemorizedToken(
      SECRET,
      userId,
      0,
      expiryPutting(LOGIN_TTL_DAYS + 1),
    );
    const before = await sessionCount();
    const res = await post(token);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await sessionCount()).toBe(before);
  });

  it('accepts a token on the last day of the login window', async () => {
    const token = await mintMemorizedToken(
      SECRET,
      userId,
      0,
      expiryPutting(LOGIN_TTL_DAYS),
    );
    expect((await post(token)).status).toBe(200);
  });

  it.each([
    ['a forged signature', 'bTEuZm9yZ2VkLjAuOTk5OTk5OTk5OQ.Zm9yZ2Vk'],
    ['garbage', 'not-a-token'],
    ['an empty token', ''],
  ])('refuses %s', async (_label, token) => {
    const before = await sessionCount();
    const res = await post(token);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await sessionCount()).toBe(before);
  });

  it('refuses a token signed with a foreign secret', async () => {
    const token = await mintMemorizedToken(
      'some-other-secret',
      userId,
      0,
      expiryPutting(0),
    );
    const res = await post(token);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a bucket escalated under a stolen signature', async () => {
    const token = await mintMemorizedToken(SECRET, userId, 0, expiryPutting(0));
    const [, sig] = token.split('.');
    const forged = btoa(`m1.${userId}.9.${expiryPutting(0)}`)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const res = await post(`${forged}.${sig}`);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a validly-signed token for a user who does not exist', async () => {
    // A clean 401, not the opaque D1 500 the session→user foreign key would give.
    const token = await mintMemorizedToken(
      SECRET,
      'no-such-user',
      0,
      expiryPutting(0),
    );
    const res = await post(token);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a request with no token header at all', async () => {
    const res = await SELF.fetch(INTERNAL, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
