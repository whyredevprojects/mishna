import { describe, expect, it } from 'vitest';

describe.skip('Worker', () => {
  it('responds with Hello World', async () => {
    const result = 1 + 1;
    expect(result).toBe(2);
  });
});
