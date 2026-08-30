import { EmailRepository } from '@mishna/email-domain';
import { D1EmailRepository, chunked } from './d1-email-repository';

// The D1 *query* behavior is exercised against a real D1 binding in apps/server's
// email integration test (the same way D1GroupRepository is covered). Here we cover
// the storage-free surface: the chunking helper, the port conformance, and — against
// a fake D1 that only counts binds — the one property no real-D1 test would reach
// before it breaks in production, namely that no statement ever exceeds D1's
// 100-bind-parameter ceiling.

describe('chunked', () => {
  it('splits into runs of at most `size`, defaulting to 100', () => {
    expect(chunked([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunked([])).toEqual([]);
    expect(chunked(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([
      100, 100, 50,
    ]);
  });

  it('never emits an empty trailing chunk on an exact multiple', () => {
    expect(chunked(Array.from({ length: 200 }, (_, i) => i)).map((c) => c.length)).toEqual([
      100, 100,
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
    });
    expect(typeof repo.loadCandidates).toBe('function');
    expect(typeof repo.recordSent).toBe('function');
  });

  describe('the 100-bind ceiling', () => {
    /**
     * A D1 stand-in that records every statement's bind count and answers with no
     * rows. Enough to observe the chunking; the queries themselves are covered
     * against a real D1 in apps/server.
     */
    function fakeD1() {
      const binds: { sql: string; count: number }[] = [];
      const db = {
        prepare(sql: string) {
          const stmt = {
            bind: (...args: unknown[]) => {
              binds.push({ sql, count: args.length });
              return stmt;
            },
            all: async () => ({ results: [] }),
            first: async () => null,
            run: async () => ({}),
          };
          return stmt;
        },
      };
      return { db: db as never, binds };
    }

    const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);

    it('chunks every batched read under 100 binds', async () => {
      // 250 due users in one hour is well inside the design envelope, and *nothing*
      // currently crosses this boundary in a real test — so if a reader ever loses
      // its `chunked(...)` wrapper, this is the only place it shows up before D1
      // answers "too many SQL variables" at 08:00 on a Sunday.
      const { db, binds } = fakeD1();
      const repo = new D1EmailRepository({ db, authDb: db });

      await repo.loadBlocks(ids);
      await repo.loadCompleted(ids);
      await repo.loadEmails(ids);
      expect(binds.length).toBeGreaterThan(0);
      for (const b of binds) {
        expect(b.count, b.sql).toBeLessThanOrEqual(100);
      }
      // Three reads × three chunks each (100 + 100 + 50).
      expect(binds.map((b) => b.count)).toEqual([
        100, 100, 50, 100, 100, 50, 100, 100, 50,
      ]);
    });

    it('leaves room for the extra bind on alreadySent', async () => {
      // `alreadySent` also binds `sinceWeekStart`, so its id chunks are 99, not 100 —
      // a 100-id chunk there would be 101 params and fail.
      const { db, binds } = fakeD1();
      const repo = new D1EmailRepository({ db, authDb: db });
      await repo.alreadySent(ids, '2026-01-04');
      for (const b of binds) {
        expect(b.count, b.sql).toBeLessThanOrEqual(100);
      }
      expect(binds.map((b) => b.count)).toEqual([100, 100, 53]);
    });

    it('does nothing at all for an empty id list', async () => {
      const { db, binds } = fakeD1();
      const repo = new D1EmailRepository({ db, authDb: db });
      await repo.loadBlocks([]);
      await repo.loadCompleted([]);
      await repo.loadEmails([]);
      await repo.alreadySent([], '2026-01-04');
      expect(binds).toEqual([]);
    });
  });
});
