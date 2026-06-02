import { env } from 'cloudflare:test';
import { getMigrations } from 'better-auth/db/migration';
import worker from '../src';
import { createAuth } from './auth';
import { describe, expect, it, beforeAll } from 'vitest';

describe('Worker', () => {
  beforeAll(async () => {
    const { runMigrations } = await getMigrations(createAuth(env as Env).options);
    await runMigrations();
  });

  it('GET /api/auth/ok returns { ok: true }', async () => {
    const response = await worker.fetch(
      new Request('http://example.com/api/auth/ok'),
      env as Env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it('unknown routes return 404', async () => {
    const response = await worker.fetch(
      new Request('http://example.com/unknown'),
      env as Env,
    );
    expect(response.status).toBe(404);
  });
});
