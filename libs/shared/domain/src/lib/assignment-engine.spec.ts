import { AssignmentEngine } from './assignment-engine';
import { MishnaStructure } from './mishna-structure';
import { cycleDay, fakeCalendar, makeBlock, tinyDataset } from './test-fixtures';

describe('AssignmentEngine', () => {
  const structure = new MishnaStructure(tinyDataset);
  const indicesOf = (
    mishnas: { mesechta: string; perek: number; mishna: number }[],
  ) => mishnas.map((m) => structure.indexOf(m));
  const iso = (n: number) => cycleDay(n).toISOString();

  it('returns the start-week slice, paced to finish by the cycle end', () => {
    // 10 mishnayot over a 5-week-remaining cycle -> pace ceil(10/5) = 2.
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ cycleLengthDays: 35 }),
    );
    const block = makeBlock(structure, 'u1', [[0, 9]], 3, iso(0));
    const a = engine.getAssignment([block], cycleDay(0));
    expect(a.userId).toBe('u1');
    expect(indicesOf(a.mishnas)).toEqual([0, 1]);
  });

  it('advances one pace-sized slice per week from the start', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ cycleLengthDays: 35 }),
    );
    const block = makeBlock(structure, 'u1', [[0, 9]], 3, iso(0));
    // pace 2, week 2 -> offset 4 -> [4,5]
    expect(
      indicesOf(engine.getAssignment([block], cycleDay(14)).mishnas),
    ).toEqual([4, 5]);
  });

  it('starts a mid-cycle joiner at the beginning of their lots (no catch-up)', () => {
    // Joins 100 days into a year-long cycle. Their first week must be the start
    // of their lots, not the middle.
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ cycleLengthDays: 364 }),
    );
    const block = makeBlock(structure, 'u1', [[0, 9]], 1, iso(100));
    expect(
      indicesOf(engine.getAssignment([block], cycleDay(100)).mishnas),
    ).toEqual([0]);
    expect(
      indicesOf(engine.getAssignment([block], cycleDay(107)).mishnas),
    ).toEqual([1]);
  });

  it('streams across blocks from different groups in corpus order', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ cycleLengthDays: 14 }),
    );
    // intentionally out of order; engine should sort by corpus position
    const blockB = makeBlock(structure, 'u1', [[5, 6]], 2, iso(0));
    const blockA = makeBlock(structure, 'u1', [[0, 1]], 2, iso(0));
    const a = engine.getAssignment([blockB, blockA], cycleDay(7));
    // flattened = [0,1,5,6]; total 4 over 2 weeks -> pace 2; week 1 -> offset 2 -> [5,6]
    expect(indicesOf(a.mishnas)).toEqual([5, 6]);
  });

  it('returns nothing before the user has started', () => {
    const engine = new AssignmentEngine(structure, fakeCalendar());
    const block = makeBlock(structure, 'u1', [[0, 9]], 1, iso(10));
    expect(engine.getAssignment([block], cycleDay(3)).mishnas).toEqual([]);
  });

  it('returns an empty slice once the user has finished their lots', () => {
    // 2 mishnayot over a 1-week-remaining cycle -> pace 2, done after week 0.
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ cycleLengthDays: 7 }),
    );
    const block = makeBlock(structure, 'u1', [[0, 1]], 2, iso(0));
    expect(indicesOf(engine.getAssignment([block], cycleDay(0)).mishnas)).toEqual(
      [0, 1],
    );
    expect(engine.getAssignment([block], cycleDay(7)).mishnas).toEqual([]);
  });

  it('falls back to the cycle start when a block has no startDate', () => {
    const engine = new AssignmentEngine(
      structure,
      fakeCalendar({ cycleLengthDays: 35 }),
    );
    const block = makeBlock(structure, 'u1', [[0, 9]], 3); // no startDate
    expect(indicesOf(engine.getAssignment([block], cycleDay(0)).mishnas)).toEqual(
      [0, 1],
    );
  });

  it('handles a user with no blocks', () => {
    const engine = new AssignmentEngine(structure, fakeCalendar());
    expect(engine.getAssignment([], cycleDay(0)).mishnas).toEqual([]);
  });

  describe('getWeekAssignment', () => {
    it('returns the week bucket slice anchored at weekStart', () => {
      // 10 mishnayot over 10 weeks remaining -> pace 1.
      const engine = new AssignmentEngine(
        structure,
        fakeCalendar({ cycleLengthDays: 70 }),
      );
      const block = makeBlock(structure, 'u1', [[0, 9]], 1, iso(0));
      expect(indicesOf(engine.getWeekAssignment([block], cycleDay(0)))).toEqual([
        0,
      ]);
      expect(indicesOf(engine.getWeekAssignment([block], cycleDay(7)))).toEqual([
        1,
      ]);
    });

    it('paces the portion and stops at the end of the block', () => {
      const engine = new AssignmentEngine(
        structure,
        fakeCalendar({ cycleLengthDays: 35 }),
      );
      const block = makeBlock(structure, 'u1', [[0, 9]], 2, iso(0)); // pace 2
      expect(indicesOf(engine.getWeekAssignment([block], cycleDay(0)))).toEqual([
        0, 1,
      ]);
      expect(indicesOf(engine.getWeekAssignment([block], cycleDay(7)))).toEqual([
        2, 3,
      ]);
      // week 5 -> offset 10, past the 10-mishna block -> []
      expect(engine.getWeekAssignment([block], cycleDay(35))).toEqual([]);
    });
  });
});
