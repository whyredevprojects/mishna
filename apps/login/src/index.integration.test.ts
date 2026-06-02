import { SELF, env } from 'cloudflare:test';
import { describe, expect, it, beforeAll } from 'vitest';
import '../src';

describe('Integration', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://example.com/migrate', {
      method: 'POST',
      headers: { 'x-migrate-secret': (env as Env).BETTER_AUTH_SECRET },
    });
    if (!res.ok) throw new Error(`Migration failed: ${await res.text()}`);
  });

  it('GET /api/auth/ok returns { status: "ok" }', async () => {
    const response = await SELF.fetch('http://example.com/api/auth/ok');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true });
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
