import { describe, expect, it, vi } from 'vitest';
import { MishnaRef, mishnahDataset } from '@mishna/domain';
import { getJsonFileName } from 'mishna-text/tractate-index';
import { TractateLoader, httpTextResolver } from './quota';

// The one piece of the email content path that does I/O. `httpTextResolver` takes an
// injected loader, so all of this runs offline and in milliseconds — no `SELF.fetch`,
// no D1, no network.

const BASE = 'https://app.test';

/** Every English tractate name the corpus model knows (the `mesechta` on a ref). */
const CORPUS_NAMES: string[] = mishnahDataset.sedarim.flatMap((s) =>
  s.masechtot.map((m) => m.nameEn),
);

/** A minimal tractate document: perek 1 with mishnayot 1..n. */
function tractate(name: string, hebrewName: string, mishnayot = 3) {
  return {
    name,
    hebrewName,
    sefariaId: name,
    seder: 'Zeraim',
    sederHebrewName: 'זרעים',
    perakim: [
      {
        perek: 1,
        mishnayot: Array.from({ length: mishnayot }, (_, i) => ({
          mishna: i + 1,
          hebrew: `${name} 1:${i + 1} hebrew`,
          english: `${name} 1:${i + 1} english`,
        })),
      },
    ],
  };
}

const ref = (mesechta: string, perek: number, mishna: number): MishnaRef => ({
  mesechta,
  perek,
  mishna,
});

describe('the tractate name mapping', () => {
  // The email's Hebrew text is fetched by `MishnaRef.mesechta`, which comes from
  // @mishna/domain's corpus dataset, and looked up in `mishna-text`'s file index.
  // Those are two independently-versioned lists of the same 63 names. A `mishna-text`
  // bump that renames one file turns every email for that tractate into a body-less
  // shell — silently, since D3 now degrades instead of throwing. This is the test
  // that catches it at CI time instead of at 08:00 on a Sunday.
  it('resolves a file for every tractate in the corpus', () => {
    const missing = CORPUS_NAMES.filter((n) => getJsonFileName(n) === undefined);
    expect(missing, `unmapped tractate names: ${missing.join(', ')}`).toEqual([]);
  });

  it('covers the whole corpus (a sanity bound on the list itself)', () => {
    // If this number moves, the corpus changed — which is a real event worth noticing,
    // not something to silently re-baseline.
    expect(CORPUS_NAMES).toHaveLength(63);
    expect(new Set(CORPUS_NAMES).size).toBe(63);
  });
});

describe('httpTextResolver', () => {
  it('resolves refs to their Hebrew text and tractate name', async () => {
    const load: TractateLoader = async (_base, name) =>
      tractate(name, 'ברכות') as never;
    const out = await httpTextResolver(BASE, load)([ref('Berakhot', 1, 2)]);
    expect(out).toEqual([
      {
        ref: { mesechta: 'Berakhot', perek: 1, mishna: 2 },
        tractateHebrew: 'ברכות',
        hebrew: 'Berakhot 1:2 hebrew',
      },
    ]);
  });

  it('preserves the input order of the refs', async () => {
    // The templates group by tractate as they walk the list, so a reordered result
    // would emit a heading per mishna instead of per tractate.
    const load = vi.fn<TractateLoader>(
      async (_b, name) => tractate(name, `he-${name}`) as never,
    );
    const refs = [
      ref('Peah', 1, 1),
      ref('Berakhot', 1, 3),
      ref('Peah', 1, 2),
      ref('Berakhot', 1, 1),
    ];
    const out = await httpTextResolver(BASE, load)(refs);
    expect(out.map((r) => r.ref)).toEqual(refs);
  });

  it('fetches each tractate once per resolver, however many refs need it', async () => {
    // The cache lives on the resolver, not the call, so a 100-email batch where
    // everyone needs the same tractate fetches it once rather than 100×. This is what
    // keeps a `send-batch` step inside the per-invocation subrequest budget.
    const load = vi.fn<TractateLoader>(
      async (_b, name) => tractate(name, `he-${name}`, 50) as never,
    );
    const resolve = httpTextResolver(BASE, load);
    const refs: MishnaRef[] = [];
    for (let i = 0; i < 50; i++) {
      refs.push(ref('Berakhot', 1, (i % 50) + 1));
      refs.push(ref('Peah', 1, (i % 50) + 1));
    }
    expect(refs).toHaveLength(100);

    const out = await resolve(refs);
    expect(out).toHaveLength(100);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.map((c) => c[1]).sort()).toEqual(['Berakhot', 'Peah']);
    // ...and a second call on the same resolver adds no fetches at all.
    await resolve(refs);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('renders an empty body for a perek or mishna the file does not have', async () => {
    // A corpus/text mismatch on a single mishna must not take the email down.
    const load: TractateLoader = async (_b, name) =>
      tractate(name, 'ברכות') as never;
    const out = await httpTextResolver(BASE, load)([
      ref('Berakhot', 9, 1), // no such perek
      ref('Berakhot', 1, 99), // no such mishna
    ]);
    expect(out.map((r) => r.hebrew)).toEqual(['', '']);
    // The reference and the tractate name still render, so the recipient can look it up.
    expect(out.every((r) => r.tractateHebrew === 'ברכות')).toBe(true);
  });

  describe('when a tractate cannot be loaded (D3: degrade, do not throw)', () => {
    // `getTractate` throws on an unknown name *and* on a fetch failure, and this
    // resolver runs inside a `send-batch-N` workflow step. Letting it throw fails the
    // whole step — 99 innocent recipients get nothing, and the step retries forever.
    // So: log the tractate (the one thing an operator needs) and send the email with
    // the body missing.
    const failing: TractateLoader = async (_b, name) => {
      throw new Error(`Tractate not found: ${name}`);
    };

    it('does not throw, and still returns one entry per ref', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const out = await httpTextResolver(BASE, failing)([
          ref('Nonexistent', 1, 1),
          ref('Nonexistent', 1, 2),
        ]);
        expect(out).toHaveLength(2);
        expect(out.map((r) => r.hebrew)).toEqual(['', '']);
        expect(out.map((r) => r.tractateHebrew)).toEqual(['', '']);
      } finally {
        err.mockRestore();
      }
    });

    it('logs the failing tractate by name, once per resolver', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await httpTextResolver(BASE, failing)([
          ref('Nonexistent', 1, 1),
          ref('Nonexistent', 1, 2),
          ref('Nonexistent', 2, 1),
        ]);
        // One remembered failure, not one log line (and one retry) per ref.
        expect(err).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(String(err.mock.calls[0][0]));
        expect(logged).toMatchObject({
          evt: 'tractate_load_failed',
          tractate: 'Nonexistent',
          base: BASE,
        });
        expect(logged.detail).toContain('Nonexistent');
      } finally {
        err.mockRestore();
      }
    });

    it('still resolves the tractates that DO load', async () => {
      // The whole point: one bad name must not cost the other 99 recipients their mail.
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const load: TractateLoader = async (_b, name) => {
          if (name === 'Broken') throw new Error('boom');
          return tractate(name, `he-${name}`) as never;
        };
        const out = await httpTextResolver(BASE, load)([
          ref('Broken', 1, 1),
          ref('Berakhot', 1, 1),
        ]);
        expect(out[0].hebrew).toBe('');
        expect(out[1].hebrew).toBe('Berakhot 1:1 hebrew');
      } finally {
        err.mockRestore();
      }
    });
  });
});
