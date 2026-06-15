import { Group } from './group';
import { MishnaStructure } from './mishna-structure';
import { pickInOrder, sequentialIdGen, tinyChalakim, tinyDataset } from './test-fixtures';

// Tiny corpus global indices:
//  0 Aleph1:1  1 Aleph1:2  2 Aleph2:1  3 Aleph2:2  4 Aleph2:3
//  5 Bet1:1    6 Bet1:2    7 Bet2:1    8 Bet2:2    9 Bet2:3
// Lots (see tinyChalakim): 1→[0,1] (2)  2→[2,3,4] (3)  3→[5,6] (2)  4→[7,8,9] (3)

const START = '2026-01-01';

describe('Group', () => {
  const structure = new MishnaStructure(tinyDataset);
  const chalakim = tinyChalakim();
  const newGroup = () =>
    new Group(structure, chalakim, sequentialIdGen(), { id: 'g' });
  const blockOf = (g: Group, userId: string) =>
    g.toState().blocks.find((b) => b.userId === userId);

  it('hands out random lots up to the budget, stopping before it overflows', () => {
    const g = newGroup();
    // budget 5: lot 1 (2) + lot 2 (3) = 5 fits; lot 3 (2) would make 7 -> stop.
    expect(g.addUser('u1', 2, START, 5, [], pickInOrder, true)).toEqual({
      allocated: 2,
      lots: [1, 2],
      mishnayot: 5,
      stopped: 'budget',
    });
    const block = blockOf(g, 'u1');
    expect(block?.lots).toEqual([1, 2]);
    expect(block?.totalSize).toBe(5);
    expect(block?.commitment).toBe(2);
    expect(block?.startDate).toBe(START);
  });

  it('forces at least one lot even when it overflows the budget', () => {
    const g = newGroup();
    // budget 1 is below any lot; mustTakeAtLeastOne -> the first lot anyway.
    expect(g.addUser('u1', 1, START, 1, [], pickInOrder, true)).toEqual({
      allocated: 1,
      lots: [1],
      mishnayot: 2,
      stopped: 'budget',
    });
  });

  it('takes nothing when the budget is too small and not forced', () => {
    const g = newGroup();
    expect(g.addUser('u1', 1, START, 1, [], pickInOrder, false)).toEqual({
      allocated: 0,
      lots: [],
      mishnayot: 0,
      stopped: 'budget',
    });
    expect(blockOf(g, 'u1')).toBeUndefined();
  });

  it('reports groupFull when the budget outlasts the free lots', () => {
    const g = newGroup();
    // budget 100 > whole corpus (10): takes all 4 lots, then runs out.
    expect(g.addUser('u1', 3, START, 100, [], pickInOrder, true)).toEqual({
      allocated: 4,
      lots: [1, 2, 3, 4],
      mishnayot: 10,
      stopped: 'groupFull',
    });
    expect(g.isExhausted()).toBe(true);
  });

  // A RandomSource that returns the queued values in turn, then 0 forever. Lets a
  // test steer the *random* picks (each picks pool[floor(r * pool.length)], the pool
  // being the free lots in ascending order) while consecutive picks take no value.
  const scripted =
    (...values: number[]): (() => number) =>
    () =>
      values.length ? (values.shift() as number) : 0;

  it('takes the next consecutive lot after the random first one', () => {
    const g = newGroup();
    // 0.3 * 4 → index 1 → lot 2 is the random first pick; the 2nd is lot 2+1 = 3.
    // budget 5: lot 2 (3) + lot 3 (2) = 5; lot 4 would overflow.
    expect(g.addUser('u1', 1, START, 5, [], scripted(0.3), true)).toEqual({
      allocated: 2,
      lots: [2, 3],
      mishnayot: 5,
      stopped: 'budget',
    });
  });

  it('chains three consecutive lots from the random first one', () => {
    const g = newGroup();
    // First pick lot 2 (0.3 * 4 → 1), then 3, then 4 — a continuous run; budget 8
    // (3+2+3) stops before the random fallback would take lot 1.
    expect(g.addUser('u1', 1, START, 8, [], scripted(0.3), true)).toEqual({
      allocated: 3,
      lots: [2, 3, 4],
      mishnayot: 8,
      stopped: 'budget',
    });
  });

  it('falls back to random when the next lot is off the end of the corpus', () => {
    const g = newGroup();
    // First pick lot 4 (0.8 * 4 → 3); lot 5 does not exist, so the 2nd pick is
    // random again — 0 picks the lowest remaining free lot, lot 1. budget 5 (3+2).
    expect(g.addUser('u1', 1, START, 5, [], scripted(0.8, 0), true)).toEqual({
      allocated: 2,
      lots: [1, 4],
      mishnayot: 5,
      stopped: 'budget',
    });
  });

  it('falls back to random when the next lot is already taken', () => {
    const g = newGroup();
    g.addUser('u1', 1, START, 1, [], scripted(0.3), true); // lot 2
    // u2's first pick is lot 1 (0); the next lot 2 is u1's, so the 2nd pick is
    // random and lands on lot 3. budget 5 (2+2).
    expect(g.addUser('u2', 1, START, 5, [], scripted(0, 0), true)).toEqual({
      allocated: 2,
      lots: [1, 3],
      mishnayot: 4,
      stopped: 'budget',
    });
  });

  it('continues the run from the `after` anchor', () => {
    const g = newGroup();
    // Seeded after lot 1: the first pick is the consecutive lot 2, not random
    // (the scripted random value goes unused). budget 3 (lot 2) stops there.
    expect(g.addUser('u1', 1, START, 3, [], scripted(0.8), true, 1)).toEqual({
      allocated: 1,
      lots: [2],
      mishnayot: 3,
      stopped: 'budget',
    });
  });

  it('gives successive users disjoint lots', () => {
    const g = newGroup();
    g.addUser('u1', 2, START, 5, [], pickInOrder, true); // lots 1,2
    g.addUser('u2', 2, START, 5, [], pickInOrder, true); // lots 3,4
    expect(blockOf(g, 'u1')?.lots).toEqual([1, 2]);
    expect(blockOf(g, 'u2')?.lots).toEqual([3, 4]);
  });

  it('excludes lot numbers the caller already holds elsewhere', () => {
    const g = newGroup();
    // The user already holds lots 1 and 2 in another group.
    expect(g.addUser('u1', 2, START, 5, [1, 2], pickInOrder, true)).toEqual({
      allocated: 2,
      lots: [3, 4],
      mishnayot: 5,
      stopped: 'groupFull',
    });
  });

  it('removeUser frees the user lots back to capacity', () => {
    const g = newGroup();
    g.addUser('u1', 2, START, 5, [], pickInOrder, true); // lots 1,2 (2+3)
    expect(g.capacityLeft()).toBe(5); // lots 3,4 → 2+3
    g.removeUser('u1');
    expect(g.capacityLeft()).toBe(10);
    expect(blockOf(g, 'u1')).toBeUndefined();
  });

  it("setUserLots replaces a user's lots with the exact set given", () => {
    const g = newGroup();
    g.addUser('u1', 2, START, 5, [], pickInOrder, true); // lots 1,2
    g.setUserLots('u1', [3, 4], 2);
    const block = blockOf(g, 'u1');
    expect(block?.lots).toEqual([3, 4]);
    expect(block?.totalSize).toBe(5);
    expect(block?.commitment).toBe(2);
  });

  it('setUserLots preserves the existing start date when none is given', () => {
    const g = newGroup();
    g.addUser('u1', 2, START, 5, [], pickInOrder, true);
    g.setUserLots('u1', [3, 4], 2);
    expect(blockOf(g, 'u1')?.startDate).toBe(START);
  });

  it('setUserLots dedupes and sorts the lot numbers', () => {
    const g = newGroup();
    g.addUser('u1', 1, START, 2, [], pickInOrder, true); // lot 1
    g.setUserLots('u1', [4, 2, 4, 1], 1);
    expect(blockOf(g, 'u1')?.lots).toEqual([1, 2, 4]);
  });

  it("setUserLots with no lots removes the user's block", () => {
    const g = newGroup();
    g.addUser('u1', 2, START, 5, [], pickInOrder, true);
    g.setUserLots('u1', [], 2);
    expect(blockOf(g, 'u1')).toBeUndefined();
  });

  it('setUserLots throws on an unknown lot number', () => {
    const g = newGroup();
    g.addUser('u1', 1, START, 2, [], pickInOrder, true);
    expect(() => g.setUserLots('u1', [99], 1)).toThrow();
  });

  it('round-trips through toState / fromState', () => {
    const g = newGroup();
    g.addUser('u1', 2, START, 5, [], pickInOrder, true);
    g.addUser('u2', 1, START, 2, [], pickInOrder, true);
    const state = g.toState();

    const restored = Group.fromState(structure, chalakim, sequentialIdGen(), state);
    expect(restored.toState()).toEqual(state);
    expect(restored.capacityLeft()).toBe(g.capacityLeft());
  });
});
