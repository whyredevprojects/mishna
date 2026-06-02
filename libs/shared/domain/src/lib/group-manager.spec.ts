import { GroupManager } from './group-manager';
import { InMemoryGroupRepository } from './group-repository';
import { MishnaStructure } from './mishna-structure';
import { fakeCalendar, sequentialIdGen, tinyDataset } from './test-fixtures';

describe('GroupManager', () => {
  const structure = new MishnaStructure(tinyDataset); // 10 mishnayot per group

  const setup = (daysRemaining: number) => {
    const repo = new InMemoryGroupRepository(structure, sequentialIdGen('g'));
    const manager = new GroupManager(repo, fakeCalendar({ daysRemaining }));
    return { repo, manager };
  };

  it('spills a large commitment across multiple groups', async () => {
    const { repo, manager } = setup(25); // remaining = 1 * 25
    await manager.join('u1', 1, new Date());

    const groups = await repo.loadAll();
    expect(groups).toHaveLength(3); // 10 + 10 + 5
    const allocated = groups.reduce(
      (sum, g) =>
        sum +
        (g.toState().blocks.find((b) => b.userId === 'u1')?.totalSize ?? 0),
      0,
    );
    expect(allocated).toBe(25);
  });

  it('stops exactly at the commitment within a single group', async () => {
    const { repo, manager } = setup(6);
    await manager.join('u1', 1, new Date());
    const groups = await repo.loadAll();
    expect(groups).toHaveLength(1);
    expect(groups[0].toState().blocks[0].totalSize).toBe(6);
    expect(groups[0].isExhausted()).toBe(false);
  });

  it('removes the user from every group they belong to', async () => {
    const { repo, manager } = setup(25);
    await manager.join('u1', 1, new Date());
    expect(await repo.loadGroupsForUser('u1')).toHaveLength(3);

    await manager.removeUser('u1');
    expect(await repo.loadGroupsForUser('u1')).toHaveLength(0);
    // ranges came back as capacity (gaps), nothing left allocated to u1
    const groups = await repo.loadAll();
    for (const g of groups) {
      expect(g.capacityLeft()).toBe(10);
    }
  });
});
