import { AssignmentEngine } from './assignment-engine';
import { Group } from './group';
import { GroupManager } from './group-manager';
import { InMemoryGroupRepository } from './group-repository';
import { MishnaStructure } from './mishna-structure';
import {
  blockIndices,
  fakeCalendar,
  sequentialIdGen,
  tinyDataset,
} from './test-fixtures';

describe('integration', () => {
  const structure = new MishnaStructure(tinyDataset); // 10 mishnayot

  it('tiles the corpus exactly after joins, a dropout, and a re-join', () => {
    const g = new Group(structure, sequentialIdGen(), { id: 'g' });
    g.addUser('u1', 3, 1); // 0-2
    g.addUser('u2', 3, 1); // 3-5
    g.addUser('u3', 4, 1); // 6-9  -> corpus full
    g.removeUser('u2'); // gap 3-5
    g.addUser('u4', 3, 1); // refills 3-5

    const covered = g
      .toState()
      .blocks.flatMap((b) => blockIndices(structure, b))
      .sort((a, b) => a - b);

    // every mishna covered exactly once, no gaps, no overlap
    expect(covered).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('one user fills one group and their weekly assignments tile that group', async () => {
    const repo = new InMemoryGroupRepository(structure, sequentialIdGen('g'));
    // ceil(70/7) = 10 weeks * commitment 1 = 10 mishnayot -> fills the group
    const manager = new GroupManager(repo, fakeCalendar({ daysRemaining: 70 }));
    await manager.join('u1', 1, new Date());

    const groups = await repo.loadAll();
    expect(groups).toHaveLength(1);
    const blocks = groups[0].toState().blocks.filter((b) => b.userId === 'u1');

    // walk all 10 weeks; the union of assignments must be the whole corpus
    const seen: number[] = [];
    for (let week = 0; week < 10; week++) {
      const engine = new AssignmentEngine(
        structure,
        fakeCalendar({ daysSinceCycleStart: week * 7 }),
      );
      const { mishnas } = engine.getAssignment(blocks, new Date());
      expect(mishnas).toHaveLength(1); // commitment 1
      seen.push(structure.indexOf(mishnas[0]));
    }
    expect(seen.sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });
});
