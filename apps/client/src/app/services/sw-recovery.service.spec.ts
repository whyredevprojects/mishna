import { isChunkLoadError } from './sw-recovery.service';

describe('isChunkLoadError', () => {
  it('matches a ChunkLoadError by name', () => {
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'x' })).toBe(true);
  });

  it('matches a failed dynamic import message', () => {
    expect(
      isChunkLoadError(
        new TypeError('Failed to fetch dynamically imported module: /admin/chunk-X.js'),
      ),
    ).toBe(true);
  });

  it('matches the disallowed-MIME-type module error', () => {
    expect(
      isChunkLoadError('was blocked because of a disallowed MIME type ("text/html")'),
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new Error('network request failed'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
