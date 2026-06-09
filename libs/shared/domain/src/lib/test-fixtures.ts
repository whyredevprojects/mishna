import { CycleCalendar } from './cycle-calendar';
import { MishnaChalakim } from './mishna-chalakim';
import { MishnaStructure } from './mishna-structure';
import { MishnahDataset } from './mishna-types';
import { Block, Commitment, IdGenerator, MishnaLot, RandomSource } from './types';

/**
 * A tiny hand-built corpus whose boundary math is checkable by hand.
 *
 *   Aleph  perek 1: 2 mishnayot   global 0,1
 *          perek 2: 3 mishnayot   global 2,3,4
 *   Bet    perek 1: 2 mishnayot   global 5,6
 *          perek 2: 3 mishnayot   global 7,8,9
 *
 * Total: 10 mishnayot.
 */
export const tinyDataset: MishnahDataset = {
  sedarim: [
    {
      name: 'Seder Test',
      totalPerakim: 4,
      totalMishnayot: 10,
      masechtot: [
        {
          nameEn: 'Aleph',
          nameHe: 'אלף',
          perakimCount: 2,
          totalMishnayot: 5,
          perakim: [
            { perekNumber: 1, mishnayotCount: 2 },
            { perekNumber: 2, mishnayotCount: 3 },
          ],
        },
        {
          nameEn: 'Bet',
          nameHe: 'בית',
          perakimCount: 2,
          totalMishnayot: 5,
          perakim: [
            { perekNumber: 1, mishnayotCount: 2 },
            { perekNumber: 2, mishnayotCount: 3 },
          ],
        },
      ],
    },
  ],
  totals: { sedarim: 1, masechtot: 2, perakim: 4, mishnayot: 10 },
};

/**
 * A MishnaChalakim over `tinyDataset` (10 mishnayot) split into 4 lots that never
 * cross a mesechta boundary, matching the real corpus's discipline:
 *
 *   lot 1  Aleph 1:1–1:2   global 0,1      (2 mishnayot)
 *   lot 2  Aleph 2:1–2:3   global 2,3,4    (3 mishnayot)
 *   lot 3  Bet   1:1–1:2   global 5,6      (2 mishnayot)
 *   lot 4  Bet   2:1–2:3   global 7,8,9    (3 mishnayot)
 */
export function tinyChalakim(): MishnaChalakim {
  const lots: MishnaLot[] = [
    {
      lot: 1,
      range: {
        start: { mesechta: 'Aleph', perek: 1, mishna: 1 },
        end: { mesechta: 'Aleph', perek: 1, mishna: 2 },
      },
    },
    {
      lot: 2,
      range: {
        start: { mesechta: 'Aleph', perek: 2, mishna: 1 },
        end: { mesechta: 'Aleph', perek: 2, mishna: 3 },
      },
    },
    {
      lot: 3,
      range: {
        start: { mesechta: 'Bet', perek: 1, mishna: 1 },
        end: { mesechta: 'Bet', perek: 1, mishna: 2 },
      },
    },
    {
      lot: 4,
      range: {
        start: { mesechta: 'Bet', perek: 2, mishna: 1 },
        end: { mesechta: 'Bet', perek: 2, mishna: 3 },
      },
    },
  ];
  const byLot = new Map(lots.map((l) => [l.lot, l]));
  const byMesechta = new Map<string, MishnaLot[]>();
  for (const l of lots) {
    const key = l.range.start.mesechta;
    byMesechta.set(key, [...(byMesechta.get(key) ?? []), l]);
  }
  return new MishnaChalakim(byMesechta, byLot);
}

/** A deterministic, monotonically increasing id generator for tests. */
export function sequentialIdGen(prefix = 'id'): IdGenerator {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

/**
 * A RandomSource that always returns 0, so `Group.addUser` picks the lowest-
 * numbered (corpus-order) free lots first — deterministic and hand-checkable.
 */
export const pickInOrder: RandomSource = () => 0;

/**
 * A CycleCalendar stub returning fixed day numbers, for deterministic tests.
 * The week methods are derived from the day inputs exactly as the real calendar
 * derives them, so tests keep expressing scenarios in days.
 */
export function fakeCalendar(opts: {
  daysSinceCycleStart?: number;
  daysRemaining?: number;
}): CycleCalendar {
  const dsc = opts.daysSinceCycleStart ?? 0;
  const dr = opts.daysRemaining ?? 0;
  return {
    daysSinceCycleStart: () => dsc,
    daysRemaining: () => dr,
    weeksSinceCycleStart: () => Math.floor(dsc / 7),
    weeksRemaining: () => Math.ceil(dr / 7),
  } as unknown as CycleCalendar;
}

/**
 * Builds a Block from [startIndex, endIndex] global-index range pairs. `lots` is
 * left empty — the assignment-engine tests slice on `ranges` and ignore it.
 */
export function makeBlock(
  structure: MishnaStructure,
  userId: string,
  pairs: [number, number][],
  commitment: Commitment,
): Block {
  const ranges = pairs.map(([a, b]) => ({
    start: structure.refAt(a),
    end: structure.refAt(b),
  }));
  const totalSize = pairs.reduce((sum, [a, b]) => sum + (b - a + 1), 0);
  return { id: `block-${userId}`, userId, lots: [], ranges, totalSize, commitment };
}

/** Flattens a Block's ranges back into global indices, for tiling assertions. */
export function blockIndices(
  structure: MishnaStructure,
  block: Block,
): number[] {
  const out: number[] = [];
  for (const range of block.ranges) {
    for (const ref of structure.iterateRange(range)) {
      out.push(structure.indexOf(ref));
    }
  }
  return out;
}
