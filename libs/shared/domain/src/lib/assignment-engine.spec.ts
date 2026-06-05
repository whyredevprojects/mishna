import { AssignmentEngine } from './assignment-engine';
import { CycleCalendar } from './cycle-calendar';
import { MishnaStructure } from './mishna-structure';
import { fakeCalendar, makeBlock, tinyDataset } from './test-fixtures';

describe('AssignmentEngine', () => {
  const structure = new MishnaStructure(tinyDataset);
  const indicesOf = (mishnas: { mesechta: string; perek: number; mishna: number }[]) =>
    mishnas.map((m) => structure.indexOf(m));

  it('returns the week-0 slice', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ daysSinceCycleStart: 0 }),
    );
    const block = makeBlock(structure, 'u1', [[0, 9]], 3);
    const a = engine.getAssignment([block], new Date());
    expect(a.userId).toBe('u1');
    expect(indicesOf(a.mishnas)).toEqual([0, 1, 2]);
  });

  it('offsets by week * commitment', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ daysSinceCycleStart: 14 }), // week 2
    );
    const block = makeBlock(structure, 'u1', [[0, 9]], 3);
    // week 2, commitment 3 -> offset 6 -> [6,7,8]
    expect(indicesOf(engine.getAssignment([block], new Date()).mishnas)).toEqual(
      [6, 7, 8],
    );
  });

  it('streams across blocks from different groups in corpus order', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ daysSinceCycleStart: 7 }), // week 1
    );
    // intentionally out of order; engine should sort by corpus position
    const blockB = makeBlock(structure, 'u1', [[5, 6]], 2);
    const blockA = makeBlock(structure, 'u1', [[0, 1]], 2);
    const a = engine.getAssignment([blockB, blockA], new Date());
    // flattened = [0,1,5,6]; week 1, commitment 2 -> offset 2 -> [5,6]
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
      fakeCalendar({ daysSinceCycleStart: 7 }), // week 1, offset past the block
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
    // so different weekStart dates land in different week buckets.
    const base = new Date(Date.UTC(2026, 0, 1));
    const daysFromBase = (d: Date) =>
      Math.round((d.getTime() - base.getTime()) / 86_400_000);
    const dateAwareCalendar = {
      daysSinceCycleStart: daysFromBase,
      daysRemaining: () => 9999,
      weeksSinceCycleStart: (d: Date) => Math.floor(daysFromBase(d) / 7),
      weeksRemaining: () => Math.ceil(9999 / 7),
    } as unknown as CycleCalendar;
    const plusDays = (n: number) => new Date(base.getTime() + n * 86_400_000);

    it('returns the week bucket slice anchored at weekStart', () => {
      const engine = new AssignmentEngine(structure, dateAwareCalendar);
      const block = makeBlock(structure, 'u1', [[0, 9]], 1); // 1/week
      // base is week 0 -> [0]; +7 days is week 1 -> [1]
      expect(indicesOf(engine.getWeekAssignment([block], base))).toEqual([0]);
      expect(indicesOf(engine.getWeekAssignment([block], plusDays(7)))).toEqual([
        1,
      ]);
    });

    it('respects commitment and stops at the end of the block', () => {
      const engine = new AssignmentEngine(structure, dateAwareCalendar);
      const block = makeBlock(structure, 'u1', [[0, 9]], 2); // 2/week, only 10 total
      // week 0 -> offset 0 -> [0,1]; week 1 -> offset 2 -> [2,3]
      expect(indicesOf(engine.getWeekAssignment([block], base))).toEqual([0, 1]);
      expect(indicesOf(engine.getWeekAssignment([block], plusDays(7)))).toEqual([
        2, 3,
      ]);
      // week 5 -> offset 10, past the 10-mishna block -> []
      expect(engine.getWeekAssignment([block], plusDays(35))).toEqual([]);
    });
  });
});
