import {
  createExecutionContext,
  waitOnExecutionContext,
  env,
  SELF,
} from 'cloudflare:test';
import worker from '../src';
import { describe, expect, it, beforeAll } from 'vitest';

describe('Worker', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://example.com/migrate', {
      method: 'POST',
      headers: { 'x-migrate-secret': (env as Env).BETTER_AUTH_SECRET },
    });
    if (!res.ok) throw new Error(`Migration failed: ${await res.text()}`);
  });

  it('GET /api/auth/ok returns { status: "ok" }', async () => {
    const request = new Request('http://example.com/api/auth/ok');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as Env);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true });
  });

  it('unknown routes return 404', async () => {
    const request = new Request('http://example.com/unknown');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as Env);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });

  it('/migrate POST without secret returns 403', async () => {
    const request = new Request('http://example.com/migrate', {
      method: 'POST',
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as Env);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
  });
});
