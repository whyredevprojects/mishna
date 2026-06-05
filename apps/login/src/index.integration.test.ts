import { SELF, env } from 'cloudflare:test';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from './auth';
import { describe, expect, it, beforeAll } from 'vitest';
import '../src';

describe('Integration', () => {
  beforeAll(async () => {
    const { runMigrations } = await getMigrations(createAuth(env as Env).options);
    await runMigrations();
  });

  it('GET /api/auth/ok returns { ok: true }', async () => {
    const response = await SELF.fetch('http://example.com/api/auth/ok');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it('sign-up with email and password succeeds', async () => {
    const response = await SELF.fetch('http://example.com/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123', name: 'Test User' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { user?: { email: string } };
    expect(body.user?.email).toBe('test@example.com');
  });

  it("customSession flags role 'admin' as isAdmin, even outside ADMIN_USER_IDS", async () => {
    // Sign up a fresh user (random id, not in ADMIN_USER_IDS) and keep their session.
    const email = 'promotable@example.com';
    const signUp = await SELF.fetch('http://example.com/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', name: 'Promote Me' }),
    });
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers.get('set-cookie') ?? '';
    expect(cookie).not.toBe('');

    // Before promotion: role is NULL, so the session is not admin.
    const before = await SELF.fetch('http://example.com/api/auth/get-session', {
      headers: { cookie },
    });
    expect(await before.json()).toMatchObject({ user: { isAdmin: false } });

    // Promote via the role column (what apps/server's set-role write does).
    await env.DB.prepare('UPDATE "user" SET "role" = ? WHERE "email" = ?')
      .bind('admin', email)
      .run();

    // customSession re-runs on every get-session (custom fields aren't cached),
    // so the next call reflects the new role.
    const after = await SELF.fetch('http://example.com/api/auth/get-session', {
      headers: { cookie },
    });
    expect(await after.json()).toMatchObject({ user: { isAdmin: true } });
  });
});
