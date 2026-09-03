import { env } from 'cloudflare:test';
import { getMigrations } from 'better-auth/db/migration';
import worker from '../src';
import { createAuth, devHttpAppOrigin } from './auth';
import { describe, expect, it, beforeAll } from 'vitest';

describe('devHttpAppOrigin', () => {
  const APP = 'https://app.mishna2go.com';

  it('adds the http twin of the app host when BETTER_AUTH_URL is loopback', () => {
    expect(devHttpAppOrigin(APP, 'http://localhost:4200')).toBe(
      'http://app.mishna2go.com',
    );
    expect(devHttpAppOrigin(APP, 'http://127.0.0.1:4200')).toBe(
      'http://app.mishna2go.com',
    );
  });

  it('adds nothing in production, where BETTER_AUTH_URL is the app host', () => {
    expect(devHttpAppOrigin(APP, APP)).toBeUndefined();
  });

  it('adds nothing when either origin is missing or not https', () => {
    expect(devHttpAppOrigin(undefined, 'http://localhost:4200')).toBeUndefined();
    expect(
      devHttpAppOrigin('http://app.mishna2go.com', 'http://localhost:4200'),
    ).toBeUndefined();
    expect(devHttpAppOrigin(APP, undefined)).toBeUndefined();
    expect(devHttpAppOrigin(APP, 'not a url')).toBeUndefined();
  });
});

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
