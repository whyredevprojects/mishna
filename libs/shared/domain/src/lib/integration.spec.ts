import { AssignmentEngine } from './assignment-engine';
import { Group } from './group';
import { GroupManager } from './group-manager';
import { InMemoryGroupRepository } from './group-repository';
import { MishnaStructure } from './mishna-structure';
import {
  blockIndices,
  fakeCalendar,
  pickInOrder,
  sequentialIdGen,
  tinyChalakim,
  tinyDataset,
} from './test-fixtures';

describe('integration', () => {
  const structure = new MishnaStructure(tinyDataset); // 10 mishnayot
  const chalakim = tinyChalakim(); // lots: 1→[0,1] 2→[2,3,4] 3→[5,6] 4→[7,8,9]

  it("a group's members' lots tile the corpus exactly once", () => {
    const g = new Group(structure, chalakim, sequentialIdGen(), { id: 'g' });
    g.addUser('u1', 2, 2, [], pickInOrder); // lots 1,2
    g.addUser('u2', 1, 1, [], pickInOrder); // lot 3
    g.addUser('u3', 1, 1, [], pickInOrder); // lot 4

    const covered = g
      .toState()
      .blocks.flatMap((b) => blockIndices(structure, b))
      .sort((a, b) => a - b);

    // every mishna covered exactly once, no gaps, no overlap
    expect(covered).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("weekly assignments walk a user's lots commitment-per-week, then run out", async () => {
    const repo = new InMemoryGroupRepository(
      structure,
      chalakim,
      sequentialIdGen('g'),
    );
    const manager = new GroupManager(repo, pickInOrder);
    await manager.join('u1', 2); // lots 1,2 → global 0..4, totalSize 5, pace 2/week

    const blocks = (await repo.loadGroupsForUser('u1'))
      .flatMap((g) => g.toState().blocks)
      .filter((b) => b.userId === 'u1');

    const seen: number[] = [];
    for (let week = 0; week < 4; week++) {
      const engine = new AssignmentEngine(
        structure,
        fakeCalendar({ daysSinceCycleStart: week * 7 }),
      );
      const { mishnas } = engine.getAssignment(blocks, new Date());
      seen.push(...mishnas.map((m) => structure.indexOf(m)));
    }
    // week 0: 0,1 · week 1: 2,3 · week 2: 4 (last one) · week 3: nothing left
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });
});
