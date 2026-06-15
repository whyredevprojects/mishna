import { GroupManager } from './group-manager';
import { InMemoryGroupRepository } from './group-repository';
import { MishnaStructure } from './mishna-structure';
import {
  fakeCalendar,
  pickInOrder,
  sequentialIdGen,
  tinyChalakim,
  tinyDataset,
} from './test-fixtures';

const START = '2026-01-01';

describe('GroupManager', () => {
  const structure = new MishnaStructure(tinyDataset);
  const chalakim = tinyChalakim(); // 4 lots per group, sizes 2,3,2,3

  // 3 weeks remaining -> budget = commitment * 3. Lot sizes are 2,3,2,3.
  const setup = () => {
    const repo = new InMemoryGroupRepository(
      structure,
      chalakim,
      sequentialIdGen('g'),
    );
    const manager = new GroupManager(
      repo,
      pickInOrder,
      fakeCalendar({ cycleLengthDays: 21 }),
    );
    return { repo, manager };
  };

  const userLots = async (repo: InMemoryGroupRepository, userId: string) =>
    (await repo.loadGroupsForUser(userId)).flatMap((g) =>
      g.toState().blocks.filter((b) => b.userId === userId).flatMap((b) => b.lots),
    );

  it('assigns lots up to the budget within a single group', async () => {
    const { repo, manager } = setup();
    await manager.join('u1', 2, START); // budget 6 -> lots 1 (2) + 2 (3); 3 would overflow

    const groups = await repo.loadAll();
    expect(groups).toHaveLength(1);
    expect(await userLots(repo, 'u1')).toEqual([1, 2]);
  });

  it('records the join date on the allocated block', async () => {
    const { repo, manager } = setup();
    await manager.join('u1', 2, START);
    const block = (await repo.loadGroupsForUser('u1'))
      .flatMap((g) => g.toState().blocks)
      .find((b) => b.userId === 'u1');
    expect(block?.startDate).toBe(START);
  });

  it('spills across groups when one runs out, never repeating a lot', async () => {
    const { repo, manager } = setup();
    await manager.join('u1', 3, START); // budget 9 -> lots 1,2,3 in g-0; lot 4 left
    await manager.join('u2', 3, START); // lot 4 from g-0, then a fresh g-1 for the rest

    const groups = await repo.loadAll();
    expect(groups).toHaveLength(2);

    const lots = await userLots(repo, 'u2');
    expect(lots).toHaveLength(3);
    // No lot number repeated, so the user never learns the same mishnayot twice.
    expect(new Set(lots).size).toBe(3);
  });

  it('removes the user from every group they belong to', async () => {
    const { repo, manager } = setup();
    await manager.join('u1', 3, START);
    await manager.join('u2', 3, START); // forces u2 across two groups
    expect(await repo.loadGroupsForUser('u2')).toHaveLength(2);

    await manager.removeUser('u2');
    expect(await repo.loadGroupsForUser('u2')).toHaveLength(0);
    // u1 still holds their lots.
    expect(await userLots(repo, 'u1')).toEqual([1, 2, 3]);
  });
});
