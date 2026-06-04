import { AssignmentEngine } from './assignment-engine';
import { CycleCalendar } from './cycle-calendar';
import { MishnaStructure } from './mishna-structure';
import { fakeCalendar, makeBlock, tinyDataset } from './test-fixtures';

describe('AssignmentEngine', () => {
  const structure = new MishnaStructure(tinyDataset);
  const indicesOf = (mishnas: { mesechta: string; perek: number; mishna: number }[]) =>
    mishnas.map((m) => structure.indexOf(m));

  it('returns the day-0 slice', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ daysSinceCycleStart: 0 }),
    );
    const block = makeBlock(structure, 'u1', [[0, 9]], 3);
    const a = engine.getAssignment([block], new Date());
    expect(a.userId).toBe('u1');
    expect(indicesOf(a.mishnas)).toEqual([0, 1, 2]);
  });

  it('offsets by day * commitment', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ daysSinceCycleStart: 2 }),
    );
    const block = makeBlock(structure, 'u1', [[0, 9]], 3);
    expect(indicesOf(engine.getAssignment([block], new Date()).mishnas)).toEqual(
      [6, 7, 8],
    );
  });

  it('streams across blocks from different groups in corpus order', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ daysSinceCycleStart: 1 }),
    );
    // intentionally out of order; engine should sort by corpus position
    const blockB = makeBlock(structure, 'u1', [[5, 6]], 2);
    const blockA = makeBlock(structure, 'u1', [[0, 1]], 2);
    const a = engine.getAssignment([blockB, blockA], new Date());
    // flattened = [0,1,5,6]; day 1, commitment 2 -> offset 2 -> [5,6]
    expect(indicesOf(a.mishnas)).toEqual([5, 6]);
  });

  it('returns nothing before the cycle starts', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ daysSinceCycleStart: -1 }),
    );
    const block = makeBlock(structure, 'u1', [[0, 9]], 1);
    expect(engine.getAssignment([block], new Date()).mishnas).toEqual([]);
  });

  it('returns a short/empty slice once the user has finished', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ daysSinceCycleStart: 5 }),
    );
    const block = makeBlock(structure, 'u1', [[0, 1]], 2); // only 2 mishnayot
    expect(engine.getAssignment([block], new Date()).mishnas).toEqual([]);
  });

  it('handles a user with no blocks', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ daysSinceCycleStart: 0 }),
    );
    expect(engine.getAssignment([], new Date()).mishnas).toEqual([]);
  });

  describe('getWeekAssignment', () => {
    // A calendar that maps each UTC day onto a cycle-day number relative to base,
    // so consecutive dates advance the assignment (the fixed fakeCalendar can't).
    const base = new Date(Date.UTC(2026, 0, 1));
    const dateAwareCalendar = {
      daysSinceCycleStart: (d: Date) =>
        Math.round((d.getTime() - base.getTime()) / 86_400_000),
      daysRemaining: () => 9999,
    } as unknown as CycleCalendar;

    it('concatenates the daily slices across the week in corpus order', () => {
      const engine = new AssignmentEngine(structure, dateAwareCalendar);
      const block = makeBlock(structure, 'u1', [[0, 9]], 1); // 1/day
      // days 0..6 -> indices 0,1,2,3,4,5,6
      expect(indicesOf(engine.getWeekAssignment([block], base, 7))).toEqual([
        0, 1, 2, 3, 4, 5, 6,
      ]);
    });

    it('respects commitment and stops at the end of the block', () => {
      const engine = new AssignmentEngine(structure, dateAwareCalendar);
      const block = makeBlock(structure, 'u1', [[0, 9]], 2); // 2/day, only 10 total
      // days 0..6 would want 14, but the block holds 10: indices 0..9
      expect(indicesOf(engine.getWeekAssignment([block], base, 7))).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });
  });
});
