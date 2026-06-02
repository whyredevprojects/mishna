import { Group } from './group';
import { MishnaStructure } from './mishna-structure';
import { sequentialIdGen, tinyDataset } from './test-fixtures';
import { BlockRange } from './types';

// Tiny corpus global indices:
//  0 Aleph1:1  1 Aleph1:2  2 Aleph2:1  3 Aleph2:2  4 Aleph2:3
//  5 Bet1:1    6 Bet1:2    7 Bet2:1    8 Bet2:2    9 Bet2:3

describe('Group', () => {
  const structure = new MishnaStructure(tinyDataset);
  const pair = (r: BlockRange): [number, number] => [
    structure.indexOf(r.start),
    structure.indexOf(r.end),
  ];
  const newGroup = () => new Group(structure, sequentialIdGen(), { id: 'g' });
  const blockOf = (g: Group, userId: string) =>
    g.toState().blocks.find((b) => b.userId === userId);

  it('allocates the tail to a single user as one contiguous range', () => {
    const g = newGroup();
    expect(g.addUser('u1', 4, 1)).toEqual({ allocated: 4 });
    const block = blockOf(g, 'u1');
    expect(block?.ranges.map(pair)).toEqual([[0, 3]]);
    expect(block?.totalSize).toBe(4);
  });

  it('gives successive users contiguous non-overlapping ranges', () => {
    const g = newGroup();
    g.addUser('u1', 4, 1);
    g.addUser('u2', 2, 1);
    expect(blockOf(g, 'u1')?.ranges.map(pair)).toEqual([[0, 3]]);
    expect(blockOf(g, 'u2')?.ranges.map(pair)).toEqual([[4, 5]]);
  });

  it('returns less than requested when the group is exhausted', () => {
    const g = newGroup();
    expect(g.addUser('u1', 100, 1)).toEqual({ allocated: 10 });
    expect(g.isExhausted()).toBe(true);
    expect(g.addUser('u2', 3, 1)).toEqual({ allocated: 0 });
    expect(blockOf(g, 'u2')).toBeUndefined();
  });

  it('removeUser returns the ranges to the gap queue', () => {
    const g = newGroup();
    g.addUser('u1', 4, 1); // 0-3
    g.addUser('u2', 2, 1); // 4-5
    expect(g.capacityLeft()).toBe(4); // tail 6-9
    g.removeUser('u1');
    expect(g.capacityLeft()).toBe(8); // gap 0-3 + tail 6-9
    expect(blockOf(g, 'u1')).toBeUndefined();
  });

  it('drains gaps front-to-back before the tail, splitting partially', () => {
    const g = newGroup();
    g.addUser('u1', 4, 1); // 0-3
    g.addUser('u2', 2, 1); // 4-5, tail now at 6
    g.removeUser('u1'); // gap 0-3
    // u3 wants 6: 4 from the gap, then 2 from the tail -> non-contiguous block
    expect(g.addUser('u3', 6, 1)).toEqual({ allocated: 6 });
    expect(blockOf(g, 'u3')?.ranges.map(pair)).toEqual([
      [0, 3],
      [6, 7],
    ]);
  });

  it('consumes a gap partially, leaving the remainder', () => {
    const g = newGroup();
    g.addUser('u1', 4, 1); // 0-3
    g.removeUser('u1'); // gap 0-3
    g.addUser('u2', 2, 1); // takes 0-1 from the gap
    expect(blockOf(g, 'u2')?.ranges.map(pair)).toEqual([[0, 1]]);
    // remaining gap is 2-3; a third user picks it up next
    g.addUser('u3', 1, 1);
    expect(blockOf(g, 'u3')?.ranges.map(pair)).toEqual([[2, 2]]);
  });

  it('merges adjacent gaps into one', () => {
    const g = newGroup();
    g.addUser('u1', 4, 1); // 0-3
    g.addUser('u2', 4, 1); // 4-7
    g.removeUser('u1'); // gap 0-3
    g.removeUser('u2'); // gap 4-7 -> merges with 0-3
    // a single user can now take the whole merged 0-7 contiguously
    g.addUser('u3', 8, 1);
    expect(blockOf(g, 'u3')?.ranges.map(pair)).toEqual([[0, 7]]);
  });

  it('round-trips through toState / fromState', () => {
    const g = newGroup();
    g.addUser('u1', 4, 1);
    g.addUser('u2', 2, 1);
    g.removeUser('u1'); // leave a gap so tail + gaps both have state
    const state = g.toState();

    const restored = Group.fromState(structure, sequentialIdGen(), state);
    expect(restored.toState()).toEqual(state);
    expect(restored.capacityLeft()).toBe(g.capacityLeft());
  });
});
