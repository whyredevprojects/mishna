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

const DAY_MS = 86_400_000;

/** A fixed default cycle start (UTC midnight) for date-based fixtures. */
export const FAKE_CYCLE_START = new Date(Date.UTC(2026, 0, 1));

/** A date `n` whole days after the fake cycle start (UTC midnight). */
export function cycleDay(n: number): Date {
  return new Date(FAKE_CYCLE_START.getTime() + n * DAY_MS);
}

/**
 * A date-aware CycleCalendar stub, anchored at a cycle start with a fixed length.
 * Every answer is derived from the real Date argument the same way the live
 * calendar does, so tests express scenarios with `cycleDay(n)` dates (and block
 * `startDate`s) rather than pre-baked day counts.
 */
export function fakeCalendar(opts?: {
  cycleStart?: Date;
  cycleLengthDays?: number;
}): CycleCalendar {
  const start = opts?.cycleStart ?? FAKE_CYCLE_START;
  const end = new Date(start.getTime() + (opts?.cycleLengthDays ?? 364) * DAY_MS);
  const daysSince = (d: Date) => Math.floor((d.getTime() - start.getTime()) / DAY_MS);
  const daysLeft = (d: Date) => Math.floor((end.getTime() - d.getTime()) / DAY_MS);
  return {
    cycleStart: () => start,
    cycleEnd: () => end,
    daysSinceCycleStart: daysSince,
    daysRemaining: daysLeft,
    weeksSinceCycleStart: (d: Date) => Math.floor(daysSince(d) / 7),
    weeksRemaining: (d: Date) => Math.ceil(daysLeft(d) / 7),
  } as unknown as CycleCalendar;
}

/**
 * Builds a Block from [startIndex, endIndex] global-index range pairs. `lots` is
 * left empty — the assignment-engine tests slice on `ranges` and ignore it.
 * `startDate` is the ISO join date the engine schedules from.
 */
export function makeBlock(
  structure: MishnaStructure,
  userId: string,
  pairs: [number, number][],
  commitment: Commitment,
  startDate?: string,
): Block {
  const ranges = pairs.map(([a, b]) => ({
    start: structure.refAt(a),
    end: structure.refAt(b),
  }));
  const totalSize = pairs.reduce((sum, [a, b]) => sum + (b - a + 1), 0);
  return {
    id: `block-${userId}`,
    userId,
    lots: [],
    ranges,
    totalSize,
    commitment,
    startDate,
  };
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
