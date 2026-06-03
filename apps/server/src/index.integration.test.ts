import { SELF, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CycleCalendar, MishnaRef, createMishnaStructure } from '@mishna/domain';
import { applyMigrations } from './apply-migrations';
import '.';

// The AUTH service binding is stubbed in vitest.config.mts to treat the
// forwarded `cookie` header value as the user id, so a request authenticates as
// whoever its `Cookie` header names.
function as(userId: string): HeadersInit {
  return { cookie: userId };
}

const structure = createMishnaStructure();
const calendar = new CycleCalendar();

describe('server API integration', () => {
  beforeAll(() => applyMigrations(env.DB));
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM groups');
    await env.DB.exec('DELETE FROM group_members');
    await env.DB.exec('DELETE FROM participants');
    await env.DB.exec('DELETE FROM completions');
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('https://server/api/me');
    expect(res.status).toBe(401);
  });

  it('serves the static corpus without auth', async () => {
    const res = await SELF.fetch('https://server/api/corpus');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totals: { mishnayot: number } };
    expect(body.totals.mishnayot).toBe(structure.totalMishnayot);
  });

  it('runs the full join -> me -> assignment -> admin -> leave flow', async () => {
    // Not joined yet.
    let me = await SELF.fetch('https://server/api/me', { headers: as('alice') });
    expect(await me.json()).toEqual({ joined: false, commitment: null });

    // Join with a commitment of 1/day.
    const join = await SELF.fetch('https://server/api/join', {
      method: 'POST',
      headers: { ...as('alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ commitment: 1 }),
    });
    expect(join.status).toBe(200);
    expect(await join.json()).toMatchObject({ joined: true, commitment: 1 });

    // /me now reflects the commitment.
    me = await SELF.fetch('https://server/api/me', { headers: as('alice') });
    expect(await me.json()).toEqual({ joined: true, commitment: 1 });

    // On day 0 of the cycle, the first joiner's first mishna is the corpus head.
    const cycleStart = calendar.cycleStart(new Date());
    const dateStr = cycleStart.toISOString().slice(0, 10);
    const assign = await SELF.fetch(
      `https://server/api/assignments?date=${dateStr}`,
      { headers: as('alice') },
    );
    const assignment = (await assign.json()) as {
      userId: string;
      mishnas: MishnaRef[];
    };
    expect(assignment.userId).toBe('alice');
    expect(assignment.mishnas).toHaveLength(1);
    expect(assignment.mishnas[0]).toEqual(structure.firstRef());

    // today's endpoint also resolves.
    const today = await SELF.fetch('https://server/api/assignments/today', {
      headers: as('alice'),
    });
    expect(today.status).toBe(200);
    expect(((await today.json()) as { mishnas: MishnaRef[] }).mishnas).toBeInstanceOf(Array);

    // Admin view shows the group, alice as a member, and partial progress.
    const admin = await SELF.fetch('https://server/api/admin/groups', {
      headers: as('alice'),
    });
    const adminBody = (await admin.json()) as {
      count: number;
      groups: { progress: number; memberCount: number; members: string[] }[];
    };
    expect(adminBody.count).toBeGreaterThanOrEqual(1);
    const group = adminBody.groups.find((g) => g.members.includes('alice'));
    expect(group).toBeDefined();
    expect(group?.memberCount).toBe(group?.members.length);
    expect(group?.progress).toBeGreaterThan(0);
    expect(group?.progress).toBeLessThanOrEqual(1);

    // Leave, and /me reflects it.
    const leave = await SELF.fetch('https://server/api/leave', {
      method: 'POST',
      headers: as('alice'),
    });
    expect(await leave.json()).toMatchObject({ joined: false });

    me = await SELF.fetch('https://server/api/me', { headers: as('alice') });
    expect(await me.json()).toEqual({ joined: false, commitment: null });
  });

  describe('completion tracking', () => {
    async function joinAlice(): Promise<void> {
      await SELF.fetch('https://server/api/join', {
        method: 'POST',
        headers: { ...as('alice'), 'content-type': 'application/json' },
        body: JSON.stringify({ commitment: 1 }),
      });
    }

    /** alice's day-0 assignment: the corpus head plus her resolved group. */
    async function aliceDayZero(): Promise<{ ref: MishnaRef; groupId: string }> {
      const dateStr = calendar.cycleStart(new Date()).toISOString().slice(0, 10);
      const res = await SELF.fetch(
        `https://server/api/assignments?date=${dateStr}`,
        { headers: as('alice') },
      );
      const body = (await res.json()) as {
        mishnas: MishnaRef[];
        groupId: string | null;
      };
      expect(body.groupId).toBeTruthy();
      return { ref: body.mishnas[0], groupId: body.groupId as string };
    }

    function completionBody(ref: MishnaRef, groupId: string): RequestInit {
      return {
        method: 'POST',
        headers: { ...as('alice'), 'content-type': 'application/json' },
        body: JSON.stringify({ ref, groupId }),
      };
    }

    async function listFor(userId: string): Promise<MishnaRef[]> {
      const res = await SELF.fetch('https://server/api/completions', {
        headers: as(userId),
      });
      return ((await res.json()) as { completed: MishnaRef[] }).completed;
    }

    it('attaches the group to the assignment', async () => {
      await joinAlice();
      const today = await SELF.fetch('https://server/api/assignments/today', {
        headers: as('alice'),
      });
      const body = (await today.json()) as { groupId: string | null };
      expect(body.groupId).toBeTruthy();
    });

    it('round-trips a completion and is idempotent', async () => {
      await joinAlice();
      const { ref, groupId } = await aliceDayZero();

      expect(await listFor('alice')).toEqual([]);

      const post = await SELF.fetch(
        'https://server/api/completions',
        completionBody(ref, groupId),
      );
      expect(post.status).toBe(200);

      const completed = await listFor('alice');
      expect(completed).toHaveLength(1);
      expect(completed[0]).toEqual(ref);

      // group_id is stamped from the request.
      const row = await env.DB.prepare(
        'SELECT group_id FROM completions WHERE user_id = ?',
      )
        .bind('alice')
        .first<{ group_id: string }>();
      expect(row?.group_id).toBe(groupId);

      // The assignment now carries its own completion state for its mishnas.
      const dateStr = calendar.cycleStart(new Date()).toISOString().slice(0, 10);
      const dayZero = await SELF.fetch(
        `https://server/api/assignments?date=${dateStr}`,
        { headers: as('alice') },
      );
      const dayZeroBody = (await dayZero.json()) as { completed: MishnaRef[] };
      expect(dayZeroBody.completed).toEqual([ref]);

      // Re-marking is a no-op, not a duplicate.
      const again = await SELF.fetch(
        'https://server/api/completions',
        completionBody(ref, groupId),
      );
      expect(again.status).toBe(200);
      expect(await listFor('alice')).toHaveLength(1);

      // Delete, then delete again (idempotent).
      const delInit = {
        method: 'DELETE',
        headers: { ...as('alice'), 'content-type': 'application/json' },
        body: JSON.stringify({ ref, groupId }),
      };
      const del = await SELF.fetch('https://server/api/completions', delInit);
      expect(del.status).toBe(200);
      expect(await listFor('alice')).toEqual([]);

      const delAgain = await SELF.fetch('https://server/api/completions', delInit);
      expect(delAgain.status).toBe(200);
    });

    it('rejects an unknown ref with 400', async () => {
      await joinAlice();
      const { groupId } = await aliceDayZero();
      const res = await SELF.fetch(
        'https://server/api/completions',
        completionBody({ mesechta: 'Nope', perek: 1, mishna: 1 }, groupId),
      );
      expect(res.status).toBe(400);
    });

    it('rejects a group the caller does not belong to with 403', async () => {
      await joinAlice();
      const res = await SELF.fetch(
        'https://server/api/completions',
        completionBody(structure.firstRef(), 'not-a-group'),
      );
      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated completion requests with 401', async () => {
      const res = await SELF.fetch('https://server/api/completions');
      expect(res.status).toBe(401);
    });

    it('isolates completions per user', async () => {
      await joinAlice();
      const { ref, groupId } = await aliceDayZero();
      await SELF.fetch(
        'https://server/api/completions',
        completionBody(ref, groupId),
      );
      expect(await listFor('bob')).toEqual([]);
    });
  });

  it('rejects an invalid commitment and a double-join', async () => {
    const bad = await SELF.fetch('https://server/api/join', {
      method: 'POST',
      headers: { ...as('bob'), 'content-type': 'application/json' },
      body: JSON.stringify({ commitment: 4 }),
    });
    expect(bad.status).toBe(400);

    const first = await SELF.fetch('https://server/api/join', {
      method: 'POST',
      headers: { ...as('bob'), 'content-type': 'application/json' },
      body: JSON.stringify({ commitment: 2 }),
    });
    expect(first.status).toBe(200);

    const second = await SELF.fetch('https://server/api/join', {
      method: 'POST',
      headers: { ...as('bob'), 'content-type': 'application/json' },
      body: JSON.stringify({ commitment: 2 }),
    });
    expect(second.status).toBe(409);
  });
});
