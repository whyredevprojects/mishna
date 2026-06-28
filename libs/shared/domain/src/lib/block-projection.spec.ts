import { blocksForUser } from './block-projection';
import { GroupState } from './group';
import { Block } from './types';

// blocksForUser only inspects `userId`; the other fields are filler here.
function block(userId: string, id: string): Block {
  return {
    id,
    userId,
    lots: [],
    ranges: [],
    totalSize: 0,
    commitment: 1,
  };
}

function state(id: string, blocks: Block[]): GroupState {
  return { id, blocks };
}

describe('blocksForUser', () => {
  it("returns only the user's blocks from a shared, multi-member group", () => {
    // The bug this guards: a group's state carries every member's blocks.
    const shared = state('g1', [
      block('alice', 'a1'),
      block('bob', 'b1'),
      block('carol', 'c1'),
    ]);
    expect(blocksForUser([shared], 'bob')).toEqual([block('bob', 'b1')]);
  });

  it("flattens the user's blocks across multiple group states", () => {
    const g1 = state('g1', [block('alice', 'a1'), block('bob', 'b1')]);
    const g2 = state('g2', [block('bob', 'b2'), block('carol', 'c1')]);
    expect(blocksForUser([g1, g2], 'bob')).toEqual([
      block('bob', 'b1'),
      block('bob', 'b2'),
    ]);
  });

  it('returns an empty array when the user holds no blocks', () => {
    const g1 = state('g1', [block('alice', 'a1')]);
    expect(blocksForUser([g1], 'bob')).toEqual([]);
    expect(blocksForUser([], 'bob')).toEqual([]);
  });
});
