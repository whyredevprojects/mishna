import { Group } from './group';
import { MishnaStructure } from './mishna-structure';
import { pickInOrder, sequentialIdGen, tinyChalakim, tinyDataset } from './test-fixtures';

// Tiny corpus global indices:
//  0 Aleph1:1  1 Aleph1:2  2 Aleph2:1  3 Aleph2:2  4 Aleph2:3
//  5 Bet1:1    6 Bet1:2    7 Bet2:1    8 Bet2:2    9 Bet2:3
// Lots (see tinyChalakim): 1→[0,1] 2→[2,3,4] 3→[5,6] 4→[7,8,9]

describe('Group', () => {
  const structure = new MishnaStructure(tinyDataset);
  const chalakim = tinyChalakim();
  const newGroup = () =>
    new Group(structure, chalakim, sequentialIdGen(), { id: 'g' });
  const blockOf = (g: Group, userId: string) =>
    g.toState().blocks.find((b) => b.userId === userId);

  it('assigns the requested number of random lots and derives ranges/size', () => {
    const g = newGroup();
    // pickInOrder takes the lowest-numbered free lots: 1 and 2.
    expect(g.addUser('u1', 2, 2, [], pickInOrder)).toEqual({
      allocated: 2,
      lots: [1, 2],
    });
    const block = blockOf(g, 'u1');
    expect(block?.lots).toEqual([1, 2]);
    expect(block?.totalSize).toBe(5); // lot 1 (2) + lot 2 (3)
    expect(block?.ranges).toHaveLength(2);
    expect(block?.commitment).toBe(2);
  });

  it('gives successive users disjoint lots', () => {
    const g = newGroup();
    g.addUser('u1', 2, 2, [], pickInOrder); // lots 1,2
    g.addUser('u2', 2, 2, [], pickInOrder); // lots 3,4
    expect(blockOf(g, 'u1')?.lots).toEqual([1, 2]);
    expect(blockOf(g, 'u2')?.lots).toEqual([3, 4]);
  });

  it('allocates fewer than requested when the group runs out of lots', () => {
    const g = newGroup();
    expect(g.addUser('u1', 3, 3, [], pickInOrder)).toEqual({
      allocated: 3,
      lots: [1, 2, 3],
    });
    // Only lot 4 is left; a request for 3 yields just 1.
    expect(g.addUser('u2', 3, 3, [], pickInOrder)).toEqual({
      allocated: 1,
      lots: [4],
    });
    expect(g.isExhausted()).toBe(true);
    expect(g.addUser('u3', 1, 1, [], pickInOrder)).toEqual({
      allocated: 0,
      lots: [],
    });
    expect(blockOf(g, 'u3')).toBeUndefined();
  });

  it('excludes lot numbers the caller already holds elsewhere', () => {
    const g = newGroup();
    // The user already holds lots 1 and 2 in another group.
    expect(g.addUser('u1', 2, 3, [1, 2], pickInOrder)).toEqual({
      allocated: 2,
      lots: [3, 4],
    });
  });

  it('removeUser frees the user lots back to capacity', () => {
    const g = newGroup();
    g.addUser('u1', 2, 2, [], pickInOrder); // lots 1,2 (sizes 2+3)
    expect(g.capacityLeft()).toBe(5); // lots 3,4 → 2+3
    g.removeUser('u1');
    expect(g.capacityLeft()).toBe(10); // whole corpus free again
    expect(blockOf(g, 'u1')).toBeUndefined();
  });

  it('setUserLots replaces a user\'s lots with the exact set given', () => {
    const g = newGroup();
    g.addUser('u1', 2, 2, [], pickInOrder); // lots 1,2
    g.setUserLots('u1', [3, 4], 2);
    const block = blockOf(g, 'u1');
    expect(block?.lots).toEqual([3, 4]);
    expect(block?.totalSize).toBe(5); // lot 3 (2) + lot 4 (3)
    expect(block?.commitment).toBe(2);
  });

  it('setUserLots dedupes and sorts the lot numbers', () => {
    const g = newGroup();
    g.addUser('u1', 1, 1, [], pickInOrder); // lot 1
    g.setUserLots('u1', [4, 2, 4, 1], 1);
    expect(blockOf(g, 'u1')?.lots).toEqual([1, 2, 4]);
  });

  it('setUserLots with no lots removes the user\'s block', () => {
    const g = newGroup();
    g.addUser('u1', 2, 2, [], pickInOrder);
    g.setUserLots('u1', [], 2);
    expect(blockOf(g, 'u1')).toBeUndefined();
  });

  it('setUserLots allows a lot another member holds (double-assignment)', () => {
    const g = newGroup();
    g.addUser('u1', 2, 2, [], pickInOrder); // lots 1,2
    g.addUser('u2', 2, 2, [], pickInOrder); // lots 3,4
    g.setUserLots('u2', [1], 2); // lot 1 is still u1's
    expect(blockOf(g, 'u1')?.lots).toEqual([1, 2]);
    expect(blockOf(g, 'u2')?.lots).toEqual([1]);
    // Lots 3,4 are free again; the double-held lot 1 counts once.
    expect(g.capacityLeft()).toBe(5); // lot 3 (2) + lot 4 (3)
  });

  it('setUserLots throws on an unknown lot number', () => {
    const g = newGroup();
    g.addUser('u1', 1, 1, [], pickInOrder);
    expect(() => g.setUserLots('u1', [99], 1)).toThrow();
  });

  it('round-trips through toState / fromState', () => {
    const g = newGroup();
    g.addUser('u1', 2, 2, [], pickInOrder);
    g.addUser('u2', 1, 1, [], pickInOrder);
    const state = g.toState();

    const restored = Group.fromState(structure, chalakim, sequentialIdGen(), state);
    expect(restored.toState()).toEqual(state);
    expect(restored.capacityLeft()).toBe(g.capacityLeft());
  });
});
