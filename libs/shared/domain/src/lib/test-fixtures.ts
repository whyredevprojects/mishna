import { CycleCalendar } from './cycle-calendar';
import { MishnaStructure } from './mishna-structure';
import { MishnahDataset } from './mishna-types';
import { Block, Commitment, IdGenerator } from './types';

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

/** A deterministic, monotonically increasing id generator for tests. */
export function sequentialIdGen(prefix = 'id'): IdGenerator {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

/** A CycleCalendar stub returning fixed day numbers, for deterministic tests. */
export function fakeCalendar(opts: {
  daysSinceCycleStart?: number;
  daysRemaining?: number;
}): CycleCalendar {
  return {
    daysSinceCycleStart: () => opts.daysSinceCycleStart ?? 0,
    daysRemaining: () => opts.daysRemaining ?? 0,
  } as unknown as CycleCalendar;
}

/** Builds a Block from [startIndex, endIndex] global-index range pairs. */
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
  return { id: `block-${userId}`, userId, ranges, totalSize, commitment };
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
