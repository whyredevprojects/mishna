import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IdGenerator, createMishnaStructure } from '@mishna/domain';
import { D1GroupRepository } from './repository';
import schema from './schema.sql?raw';

/** Applies schema.sql to a D1 binding, one statement at a time. */
async function applySchema(db: D1Database): Promise<void> {
  const sql = schema.replace(/--[^\n]*/g, '');
  for (const stmt of sql.split(';')) {
    const single = stmt.trim().replace(/\s+/g, ' ');
    if (single) {
      await db.exec(single);
    }
  }
}

/** Deterministic ids so saved/reloaded GroupStates compare exactly. */
function makeIdGen(): IdGenerator {
  let n = 0;
  return () => `id-${n++}`;
}

const structure = createMishnaStructure();

describe('D1GroupRepository', () => {
  beforeAll(() => applySchema(env.DB));

  let repo: D1GroupRepository;
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM groups');
    await env.DB.exec('DELETE FROM group_members');
    await env.DB.exec('DELETE FROM participants');
    repo = new D1GroupRepository(env.DB, structure, makeIdGen());
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
    group.addUser('alice', 5, 1);
    await repo.save(group);

    const reloaded = await repo.loadNonExhaustedGroup();
    expect(reloaded?.toState()).toEqual(group.toState());
  });

  it('loadGroupsForUser finds groups via denormalized membership', async () => {
    const group = await repo.createGroup();
    group.addUser('alice', 3, 1);
    group.addUser('bob', 2, 1);
    await repo.save(group);

    const forAlice = await repo.loadGroupsForUser('alice');
    expect(forAlice.map((g) => g.id)).toEqual([group.id]);

    const forBob = await repo.loadGroupsForUser('bob');
    expect(forBob.map((g) => g.id)).toEqual([group.id]);

    expect(await repo.loadGroupsForUser('carol')).toEqual([]);
  });

  it('save rebuilds membership when a user leaves', async () => {
    const group = await repo.createGroup();
    group.addUser('alice', 3, 1);
    await repo.save(group);
    expect(await repo.loadGroupsForUser('alice')).toHaveLength(1);

    group.removeUser('alice');
    await repo.save(group);
    expect(await repo.loadGroupsForUser('alice')).toEqual([]);
  });
});
