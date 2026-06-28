import { EmailRepository } from '@mishna/email-domain';
import { D1EmailRepository, chunked } from './d1-email-repository';

// The D1 query behavior is exercised against a real D1 binding in apps/server's
// email integration test (the same way D1GroupRepository is covered). Here we
// only smoke-test the storage-free surface: the chunking helper and that the
// adapter structurally satisfies the EmailRepository port.

describe('chunked', () => {
  it('splits into runs of at most `size`, defaulting to 100', () => {
    expect(chunked([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunked([])).toEqual([]);
    expect(chunked(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([
      100, 100, 50,
    ]);
  });
});

describe('D1EmailRepository', () => {
  it('satisfies the EmailRepository port', () => {
    // A construction-time type check: assigning to EmailRepository fails to compile
    // if a port method is missing or mis-typed.
    const repo: EmailRepository = new D1EmailRepository({
      db: {} as never,
      authDb: {} as never,
      structure: {} as never,
      chalakim: {} as never,
      idGen: () => 'id',
    });
    expect(typeof repo.loadCandidates).toBe('function');
    expect(typeof repo.recordSent).toBe('function');
  });
});
