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
    expect(await me.json()).toMatchObject({ joined: false, commitment: null });

    // Join with a commitment of 1/week.
    const join = await SELF.fetch('https://server/api/join', {
      method: 'POST',
      headers: { ...as('alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ commitment: 1 }),
    });
    expect(join.status).toBe(200);
    expect(await join.json()).toMatchObject({ joined: true, commitment: 1 });

    // /me now reflects the commitment.
    me = await SELF.fetch('https://server/api/me', { headers: as('alice') });
    expect(await me.json()).toMatchObject({ joined: true, commitment: 1 });

    // In week 0 of the cycle, the first joiner's first mishna is the corpus head.
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
      headers: as('admin'),
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
    expect(await me.json()).toMatchObject({ joined: false, commitment: null });
  });

  it('/api/me carries identity and the admin flag', async () => {
    const mine = await SELF.fetch('https://server/api/me', { headers: as('alice') });
    expect(await mine.json()).toMatchObject({
      user: { id: 'alice', name: 'alice name', email: 'alice@example.com' },
      isAdmin: false,
    });

    const adminMe = await SELF.fetch('https://server/api/me', { headers: as('admin') });
    expect(await adminMe.json()).toMatchObject({ isAdmin: true });
  });

  it('gates /api/admin/users behind admin', async () => {
    const denied = await SELF.fetch('https://server/api/admin/users', {
      headers: as('alice'),
    });
    expect(denied.status).toBe(403);

    const ok = await SELF.fetch('https://server/api/admin/users', {
      headers: as('admin'),
    });
    expect(ok.status).toBe(200);
  });

  it('admin can list users, view one, remove assignments, and delete', async () => {
    // alice joins so she has assignments to inspect/remove.
    await SELF.fetch('https://server/api/join', {
      method: 'POST',
      headers: { ...as('alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ commitment: 1 }),
    });

    // List merges the auth directory with join status.
    const list = await SELF.fetch('https://server/api/admin/users', {
      headers: as('admin'),
    });
    const { users } = (await list.json()) as {
      users: { id: string; joined: boolean; commitment: number | null }[];
    };
    const alice = users.find((u) => u.id === 'alice');
    expect(alice).toMatchObject({ joined: true, commitment: 1 });
    expect(users.find((u) => u.id === 'bob')).toMatchObject({ joined: false });

    // Detail shows her group membership.
    const detailRes = await SELF.fetch('https://server/api/admin/users/alice', {
      headers: as('admin'),
    });
    const detail = (await detailRes.json()) as {
      id: string;
      groups: { id: string; blockSize: number }[];
    };
    expect(detail.id).toBe('alice');
    expect(detail.groups.length).toBeGreaterThanOrEqual(1);

    // Remove assignments leaves the participant row gone but doesn't delete auth.
    const removed = await SELF.fetch(
      'https://server/api/admin/users/alice/remove-assignments',
      { method: 'POST', headers: as('admin') },
    );
    expect(removed.status).toBe(200);
    const afterMe = await SELF.fetch('https://server/api/me', { headers: as('alice') });
    expect(await afterMe.json()).toMatchObject({ joined: false });

    // Delete cascades: bob joins, then admin deletes him.
    await SELF.fetch('https://server/api/join', {
      method: 'POST',
      headers: { ...as('bob'), 'content-type': 'application/json' },
      body: JSON.stringify({ commitment: 2 }),
    });
    const del = await SELF.fetch('https://server/api/admin/users/bob', {
      method: 'DELETE',
      headers: as('admin'),
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ deleted: true });
    const bobRow = await env.DB.prepare(
      'SELECT 1 FROM participants WHERE user_id = ?',
    )
      .bind('bob')
      .first();
    expect(bobRow).toBeNull();
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

  describe('chaluka', () => {
    it('returns empty for a user who has not joined', async () => {
      const res = await SELF.fetch('https://server/api/me/chaluka', {
        headers: as('alice'),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        commitment: null,
        joinedAt: null,
        assigned: [],
        completed: [],
      });
    });

    it('reports the whole portion, join date, and learned subset', async () => {
      await SELF.fetch('https://server/api/join', {
        method: 'POST',
        headers: { ...as('alice'), 'content-type': 'application/json' },
        body: JSON.stringify({ commitment: 2 }),
      });

      let res = await SELF.fetch('https://server/api/me/chaluka', {
        headers: as('alice'),
      });
      let body = (await res.json()) as {
        commitment: number;
        joinedAt: string | null;
        assigned: MishnaRef[];
        completed: MishnaRef[];
      };
      expect(body.commitment).toBe(2);
      expect(body.joinedAt).toBeTruthy();
      // The portion is the whole-cycle allocation (commitment * weeks remaining),
      // in corpus order — the first joiner's portion starts at the corpus head.
      expect(body.assigned).toHaveLength(2 * calendar.weeksRemaining(new Date()));
      expect(body.assigned[0]).toEqual(structure.firstRef());
      expect(body.completed).toEqual([]);

      // Mark the head learned; it shows up in `completed`.
      const head = body.assigned[0];
      const groupId = (
        (await (
          await SELF.fetch('https://server/api/assignments/today', {
            headers: as('alice'),
          })
        ).json()) as { groupId: string }
      ).groupId;
      await SELF.fetch('https://server/api/completions', {
        method: 'POST',
        headers: { ...as('alice'), 'content-type': 'application/json' },
        body: JSON.stringify({ ref: head, groupId }),
      });

      res = await SELF.fetch('https://server/api/me/chaluka', {
        headers: as('alice'),
      });
      body = (await res.json()) as typeof body;
      expect(body.completed).toEqual([head]);
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
