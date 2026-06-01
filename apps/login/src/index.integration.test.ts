import { SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import '../src';

// an integration test using SELF
it('sends request (integration style)', async () => {
  const response = await SELF.fetch('http://example.com');
  expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
});
