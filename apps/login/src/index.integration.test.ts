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
});
