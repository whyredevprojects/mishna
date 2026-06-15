import { AssignmentEngine } from './assignment-engine';
import { Group } from './group';
import { GroupManager } from './group-manager';
import { InMemoryGroupRepository } from './group-repository';
import { MishnaStructure } from './mishna-structure';
import {
  blockIndices,
  cycleDay,
  fakeCalendar,
  pickInOrder,
  sequentialIdGen,
  tinyChalakim,
  tinyDataset,
} from './test-fixtures';

const START = '2026-01-01';

describe('integration', () => {
  const structure = new MishnaStructure(tinyDataset); // 10 mishnayot
  const chalakim = tinyChalakim(); // lots: 1→[0,1] 2→[2,3,4] 3→[5,6] 4→[7,8,9]

  it("a group's members' lots tile the corpus exactly once", () => {
    const g = new Group(structure, chalakim, sequentialIdGen(), { id: 'g' });
    g.addUser('u1', 2, START, 5, [], pickInOrder, true); // lots 1,2
    g.addUser('u2', 1, START, 2, [], pickInOrder, true); // lot 3
    g.addUser('u3', 1, START, 100, [], pickInOrder, true); // lot 4

    const covered = g
      .toState()
      .blocks.flatMap((b) => blockIndices(structure, b))
      .sort((a, b) => a - b);

    // every mishna covered exactly once, no gaps, no overlap
    expect(covered).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("weekly assignments walk a user's lots from their start, then run out", async () => {
    const repo = new InMemoryGroupRepository(
      structure,
      chalakim,
      sequentialIdGen('g'),
    );
    // 3 weeks remaining -> budget 6 -> lots 1,2 (global 0..4, totalSize 5, pace 2).
    const calendar = fakeCalendar({ cycleLengthDays: 21 });
    const manager = new GroupManager(repo, pickInOrder, calendar);
    await manager.join('u1', 2, START);

    const blocks = (await repo.loadGroupsForUser('u1'))
      .flatMap((g) => g.toState().blocks)
      .filter((b) => b.userId === 'u1');

    const seen: number[] = [];
    const engine = new AssignmentEngine(structure, calendar);
    for (let week = 0; week < 4; week++) {
      const { mishnas } = engine.getAssignment(blocks, cycleDay(week * 7));
      seen.push(...mishnas.map((m) => structure.indexOf(m)));
    }
    // week 0: 0,1 · week 1: 2,3 · week 2: 4 (last one) · week 3: nothing left
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });
});
