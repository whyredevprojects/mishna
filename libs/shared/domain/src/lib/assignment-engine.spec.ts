import { AssignmentEngine } from './assignment-engine';
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
});
