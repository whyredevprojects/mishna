/* eslint-disable @typescript-eslint/no-empty-function */
import { SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import '.';

describe('Test the application', () => {
  beforeAll(() => {});
  afterAll(() => {});
  it('Should return 200 response', async () => {
    const res = await SELF.fetch('http://localhost/');
    expect(res.status).toBe(200);
  });
});
