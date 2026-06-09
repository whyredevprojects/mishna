import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IdGenerator,
  createMishnaChalakim,
  createMishnaStructure,
} from '@mishna/domain';
import { D1GroupRepository } from './repository';
import { applyMigrations } from './apply-migrations';

/** Deterministic ids so saved/reloaded GroupStates compare exactly. */
function makeIdGen(): IdGenerator {
  let n = 0;
  return () => `id-${n++}`;
}

/** `() => 0` picks the lowest-numbered lots, so allocations are deterministic. */
const pickInOrder = () => 0;

const structure = createMishnaStructure();
const chalakim = createMishnaChalakim();

describe('D1GroupRepository', () => {
  beforeAll(() => applyMigrations(env.DB));

  let repo: D1GroupRepository;
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM groups');
    await env.DB.exec('DELETE FROM group_members');
    await env.DB.exec('DELETE FROM participants');
    repo = new D1GroupRepository(env.DB, structure, chalakim, makeIdGen());
  });

  it('createGroup persists a fresh group that loadNonExhaustedGroup finds', async () => {
    const created = await repo.createGroup();
    const loaded = await repo.loadNonExhaustedGroup();
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(created.id);
    expect(loaded?.toState()).toEqual(created.toState());
  });

  it('loadNonExhaustedGroup returns null when there are no groups', async () => {
    expect(await repo.loadNonExhaustedGroup()).toBeNull();
  });

  it('save round-trips group state via toState/fromState', async () => {
    const group = await repo.createGroup();
    group.addUser('alice', 2, 2, [], pickInOrder);
    await repo.save(group);

    const reloaded = await repo.loadNonExhaustedGroup();
    expect(reloaded?.toState()).toEqual(group.toState());
  });

  it('loadGroupsForUser finds groups via denormalized membership', async () => {
    const group = await repo.createGroup();
    group.addUser('alice', 3, 3, [], pickInOrder);
    group.addUser('bob', 2, 2, [], pickInOrder);
    await repo.save(group);

    const forAlice = await repo.loadGroupsForUser('alice');
    expect(forAlice.map((g) => g.id)).toEqual([group.id]);

    const forBob = await repo.loadGroupsForUser('bob');
    expect(forBob.map((g) => g.id)).toEqual([group.id]);

    expect(await repo.loadGroupsForUser('carol')).toEqual([]);
  });

  it('save rebuilds membership when a user leaves', async () => {
    const group = await repo.createGroup();
    group.addUser('alice', 3, 3, [], pickInOrder);
    await repo.save(group);
    expect(await repo.loadGroupsForUser('alice')).toHaveLength(1);

    group.removeUser('alice');
    await repo.save(group);
    expect(await repo.loadGroupsForUser('alice')).toEqual([]);
  });
});
