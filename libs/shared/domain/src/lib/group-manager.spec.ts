import { GroupManager } from './group-manager';
import { InMemoryGroupRepository } from './group-repository';
import { MishnaStructure } from './mishna-structure';
import { pickInOrder, sequentialIdGen, tinyChalakim, tinyDataset } from './test-fixtures';

describe('GroupManager', () => {
  const structure = new MishnaStructure(tinyDataset);
  const chalakim = tinyChalakim(); // 4 lots per group

  const setup = () => {
    const repo = new InMemoryGroupRepository(
      structure,
      chalakim,
      sequentialIdGen('g'),
    );
    const manager = new GroupManager(repo, pickInOrder);
    return { repo, manager };
  };

  const userLots = async (repo: InMemoryGroupRepository, userId: string) =>
    (await repo.loadGroupsForUser(userId)).flatMap((g) =>
      g.toState().blocks.filter((b) => b.userId === userId).flatMap((b) => b.lots),
    );

  it('assigns commitment-many lots within a single group', async () => {
    const { repo, manager } = setup();
    await manager.join('u1', 2);

    const groups = await repo.loadAll();
    expect(groups).toHaveLength(1);
    expect(await userLots(repo, 'u1')).toEqual([1, 2]);
  });

  it('spills across groups when one runs out, never repeating a lot', async () => {
    const { repo, manager } = setup();
    await manager.join('u1', 3); // lots 1,2,3 in g-0; lot 4 left
    await manager.join('u2', 3); // lot 4 from g-0, then a fresh g-1 for the rest

    const groups = await repo.loadAll();
    expect(groups).toHaveLength(2);

    const lots = await userLots(repo, 'u2');
    expect(lots).toHaveLength(3);
    // No lot number repeated, so the user never learns the same mishnayot twice.
    expect(new Set(lots).size).toBe(3);
  });

  it('removes the user from every group they belong to', async () => {
    const { repo, manager } = setup();
    await manager.join('u1', 3);
    await manager.join('u2', 3); // forces u2 across two groups
    expect(await repo.loadGroupsForUser('u2')).toHaveLength(2);

    await manager.removeUser('u2');
    expect(await repo.loadGroupsForUser('u2')).toHaveLength(0);
    // u1 still holds their lots.
    expect(await userLots(repo, 'u1')).toEqual([1, 2, 3]);
  });
});
