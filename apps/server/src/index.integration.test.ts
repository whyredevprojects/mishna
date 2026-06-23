import { SELF, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MishnaRef, createMishnaStructure } from '@mishna/domain';
import { applyMigrations } from './apply-migrations';
import '.';

// The AUTH service binding is stubbed in vitest.config.mts to treat the
// forwarded `cookie` header value as the user id, so a request authenticates as
// whoever its `Cookie` header names.
function as(userId: string): HeadersInit {
  return { cookie: userId };
}

const structure = createMishnaStructure();

describe('server API integration', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    // The admin dashboard/group/assignment endpoints resolve identity (and the
    // verified flag) from the better-auth AUTH_DB user table; seed a stable
    // directory of verified users (the get-session stub names them by cookie).
    await env.AUTH_DB.exec(
      'CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT, "emailVerified" INTEGER NOT NULL DEFAULT 0)',
    );
    for (const id of ['alice', 'bob', 'admin']) {
      await env.AUTH_DB.prepare(
        'INSERT OR IGNORE INTO "user" (id, email, name, "emailVerified") VALUES (?, ?, ?, 1)',
      )
        .bind(id, `${id}@example.com`, `${id} name`)
        .run();
    }
  });
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM groups');
    await env.DB.exec('DELETE FROM group_members');
    await env.DB.exec('DELETE FROM participants');
    await env.DB.exec('DELETE FROM completions');
    await env.DB.exec('DELETE FROM email_log');
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

    // The joiner's first week is their join date (scheduling is anchored there),
    // so they get the start of their lots — a non-empty slice, not a mid-cycle
    // catch-up.
    const dateStr = new Date().toISOString().slice(0, 10);
    const assign = await SELF.fetch(
      `https://server/api/assignments?date=${dateStr}`,
      { headers: as('alice') },
    );
    const assignment = (await assign.json()) as {
      userId: string;
      mishnas: MishnaRef[];
    };
    expect(assignment.userId).toBe('alice');
    expect(assignment.mishnas.length).toBeGreaterThan(0);
    expect(() => structure.indexOf(assignment.mishnas[0])).not.toThrow();

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

  it('gives each group member their own assignment, not the first member\'s', async () => {
    // Two users join the same cycle; both land in the same group, which holds
    // both their blocks. Each must see their own slice — a regression guard for
    // the bug where the whole group's blocks were fed to the engine, so every
    // member resolved to the first block-owner's mishnayot (the corpus head).
    for (const id of ['alice', 'bob']) {
      const join = await SELF.fetch('https://server/api/join', {
        method: 'POST',
        headers: { ...as(id), 'content-type': 'application/json' },
        body: JSON.stringify({ commitment: 1 }),
      });
      expect(join.status).toBe(200);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    async function assignmentFor(id: string) {
      const res = await SELF.fetch(
        `https://server/api/assignments?date=${dateStr}`,
        { headers: as(id) },
      );
      return (await res.json()) as { userId: string; mishnas: MishnaRef[] };
    }

    const alice = await assignmentFor('alice');
    const bob = await assignmentFor('bob');

    expect(alice.userId).toBe('alice');
    expect(bob.userId).toBe('bob');
    expect(alice.mishnas.length).toBeGreaterThan(0);
    expect(bob.mishnas.length).toBeGreaterThan(0);
    // Disjoint lots within the group → different mishnayot for each member.
    expect(bob.mishnas[0]).not.toEqual(alice.mishnas[0]);
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

  it('gates set-role behind admin, validates the role, and proxies set-role', async () => {
    // Non-admins can't set roles.
    const denied = await SELF.fetch(
      'https://server/api/admin/users/alice/set-role',
      {
        method: 'POST',
        headers: { ...as('alice'), 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      },
    );
    expect(denied.status).toBe(403);

    // An invalid role is rejected before it reaches better-auth.
    const bad = await SELF.fetch(
      'https://server/api/admin/users/alice/set-role',
      {
        method: 'POST',
        headers: { ...as('admin'), 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'superuser' }),
      },
    );
    expect(bad.status).toBe(400);

    // Promote, then revoke — both proxy to the stubbed set-role endpoint. The Origin
    // header is forwarded to better-auth (which rejects state-changing admin calls
    // without a trusted Origin); the stub enforces that, so a 200 proves forwarding.
    const promote = await SELF.fetch(
      'https://server/api/admin/users/alice/set-role',
      {
        method: 'POST',
        headers: {
          ...as('admin'),
          'content-type': 'application/json',
          origin: 'http://localhost:4200',
        },
        body: JSON.stringify({ role: 'admin' }),
      },
    );
    expect(promote.status).toBe(200);
    expect(await promote.json()).toMatchObject({ role: 'admin' });

    const revoke = await SELF.fetch(
      'https://server/api/admin/users/alice/set-role',
      {
        method: 'POST',
        headers: {
          ...as('admin'),
          'content-type': 'application/json',
          origin: 'http://localhost:4200',
        },
        body: JSON.stringify({ role: 'user' }),
      },
    );
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ role: 'user' });

    // Without a forwarded Origin, better-auth (the stub) rejects it → surfaced as 502.
    const noOrigin = await SELF.fetch(
      'https://server/api/admin/users/alice/set-role',
      {
        method: 'POST',
        headers: { ...as('admin'), 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      },
    );
    expect(noOrigin.status).toBe(502);
  });

  it('gates send-verification behind admin, skips verified users, and forwards Origin', async () => {
    // Non-admins can't trigger it.
    const denied = await SELF.fetch(
      'https://server/api/admin/users/pending/send-verification',
      { method: 'POST', headers: as('alice') },
    );
    expect(denied.status).toBe(403);

    // An already-verified user is a no-op (409) rather than a wasted send.
    const verified = await SELF.fetch(
      'https://server/api/admin/users/alice/send-verification',
      {
        method: 'POST',
        headers: { ...as('admin'), origin: 'http://localhost:4200' },
      },
    );
    expect(verified.status).toBe(409);

    // A pending user gets the email; a 200 proves the Origin was forwarded (the
    // send-verification-email stub rejects calls without a trusted Origin).
    const sent = await SELF.fetch(
      'https://server/api/admin/users/pending/send-verification',
      {
        method: 'POST',
        headers: { ...as('admin'), origin: 'http://localhost:4200' },
      },
    );
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ sent: true });

    // Without a forwarded Origin, better-auth (the stub) rejects it → surfaced as 502.
    const noOrigin = await SELF.fetch(
      'https://server/api/admin/users/pending/send-verification',
      { method: 'POST', headers: as('admin') },
    );
    expect(noOrigin.status).toBe(502);
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
      const dateStr = new Date().toISOString().slice(0, 10);
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

    it('advances /today to the next bucket once the current one is learned', async () => {
      await joinAlice();
      const key = (m: MishnaRef) => `${m.mesechta}|${m.perek}|${m.mishna}`;
      const fetchToday = async () =>
        (await (
          await SELF.fetch('https://server/api/assignments/today', {
            headers: as('alice'),
          })
        ).json()) as {
          mishnas: MishnaRef[];
          groupId: string | null;
          completed: MishnaRef[];
        };

      const first = await fetchToday();
      expect(first.mishnas.length).toBeGreaterThan(0);
      expect(first.completed).toEqual([]);

      // Mark the whole current bucket learned.
      for (const ref of first.mishnas) {
        const res = await SELF.fetch(
          'https://server/api/completions',
          completionBody(ref, first.groupId as string),
        );
        expect(res.status).toBe(200);
      }

      // /today now shows the next bucket — different mishnayot, freshly unlearned.
      const next = await fetchToday();
      const firstKeys = new Set(first.mishnas.map(key));
      expect(next.mishnas.length).toBeGreaterThan(0);
      expect(next.mishnas.some((m) => firstKeys.has(key(m)))).toBe(false);
      expect(next.completed).toEqual([]);
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
      const dateStr = new Date().toISOString().slice(0, 10);
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
        groupIds: string[];
      };
      expect(body.commitment).toBe(2);
      expect(body.joinedAt).toBeTruthy();
      // The portion is the union of the user's two lots, in corpus order. Sizes
      // vary by lot, so just assert it's non-empty and every ref is valid.
      expect(body.assigned.length).toBeGreaterThan(0);
      for (const ref of body.assigned) {
        expect(() => structure.indexOf(ref)).not.toThrow();
      }
      expect(body.completed).toEqual([]);
      // groupIds is parallel to assigned, one non-empty group id per mishna.
      expect(body.groupIds).toHaveLength(body.assigned.length);
      expect(body.groupIds.every((id) => typeof id === 'string' && id !== '')).toBe(
        true,
      );

      // Mark the portion's first mishna learned; it shows up in `completed`. Its
      // group is the one carrying the joiner's first-week assignment (the
      // portion's start).
      const head = body.assigned[0];
      const todayStr = new Date().toISOString().slice(0, 10);
      const groupId = (
        (await (
          await SELF.fetch(`https://server/api/assignments?date=${todayStr}`, {
            headers: as('alice'),
          })
        ).json()) as { groupId: string }
      ).groupId;
      // The head's group (groupIds[0]) is exactly the group the first-week
      // assignment attributes it to.
      expect(body.groupIds[0]).toBe(groupId);
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

  describe('admin dashboard endpoints', () => {
    async function join(userId: string, commitment = 1): Promise<void> {
      await SELF.fetch('https://server/api/join', {
        method: 'POST',
        headers: { ...as(userId), 'content-type': 'application/json' },
        body: JSON.stringify({ commitment }),
      });
    }

    /** Today's date — a joiner's first week (scheduling is anchored to the join
     *  date), so assignment rows hold their first mishnayot regardless of which
     *  lots they drew. */
    function joinerFirstWeek(): string {
      return new Date().toISOString().slice(0, 10);
    }

    it('paginates and searches the user list', async () => {
      const page = await SELF.fetch(
        'https://server/api/admin/users?limit=2&offset=0',
        { headers: as('admin') },
      );
      const body = (await page.json()) as {
        users: { id: string; emailVerified: boolean }[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(body.total).toBe(3);
      expect(body.users).toHaveLength(2);
      expect(body.limit).toBe(2);
      expect(body.users[0].emailVerified).toBe(true);

      const search = await SELF.fetch(
        'https://server/api/admin/users?search=bob',
        { headers: as('admin') },
      );
      const sBody = (await search.json()) as { users: { id: string }[] };
      expect(sBody.users.map((u) => u.id)).toEqual(['bob']);
    });

    it('reports dashboard stats', async () => {
      await join('alice');
      const res = await SELF.fetch('https://server/api/admin/stats', {
        headers: as('admin'),
      });
      const s = (await res.json()) as {
        activeUsers: number;
        verifiedUsers: number;
        totalGroups: number;
        weekStart: string;
      };
      expect(s.activeUsers).toBe(1);
      expect(s.verifiedUsers).toBe(3);
      expect(s.totalGroups).toBeGreaterThanOrEqual(1);
      expect(s.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns one group with resolved members', async () => {
      await join('alice');
      const listRes = await SELF.fetch('https://server/api/admin/groups', {
        headers: as('admin'),
      });
      const { groups } = (await listRes.json()) as {
        groups: { id: string; members: string[] }[];
      };
      const gid = groups.find((g) => g.members.includes('alice'))?.id as string;
      expect(gid).toBeTruthy();

      const res = await SELF.fetch(`https://server/api/admin/groups/${gid}`, {
        headers: as('admin'),
      });
      const detail = (await res.json()) as {
        members: { id: string; email: string; emailVerified: boolean; blockSize: number }[];
      };
      const alice = detail.members.find((m) => m.id === 'alice');
      expect(alice).toMatchObject({
        email: 'alice@example.com',
        emailVerified: true,
      });
      expect(alice?.blockSize).toBeGreaterThan(0);

      const notFound = await SELF.fetch('https://server/api/admin/groups/nope', {
        headers: as('admin'),
      });
      expect(notFound.status).toBe(404);
    });

    it('serves the lot catalog (admin only)', async () => {
      const denied = await SELF.fetch('https://server/api/admin/lots', {
        headers: as('alice'),
      });
      expect(denied.status).toBe(403);

      const res = await SELF.fetch('https://server/api/admin/lots', {
        headers: as('admin'),
      });
      expect(res.status).toBe(200);
      const lots = (await res.json()) as {
        lot: number;
        mesechta: string;
        indexInMesechta: number;
        label: string;
        size: number;
      }[];
      expect(lots).toHaveLength(120);
      expect(lots[0]).toMatchObject({ lot: 1, indexInMesechta: 1 });
      expect(lots[0].label).toBe(`${lots[0].mesechta}:1`);
      for (const l of lots) {
        expect(l.size).toBeGreaterThan(0);
      }
    });

    it("lets an admin set a member's lots, validating and allowing double-assignment", async () => {
      await join('alice');
      await join('bob');

      // Both commitment-1 joiners land in the first non-exhausted group.
      const listRes = await SELF.fetch('https://server/api/admin/groups', {
        headers: as('admin'),
      });
      const { groups } = (await listRes.json()) as {
        groups: { id: string; members: string[] }[];
      };
      const gid = groups.find(
        (g) => g.members.includes('alice') && g.members.includes('bob'),
      )?.id as string;
      expect(gid).toBeTruthy();

      async function lotsOf(userId: string): Promise<number[]> {
        const res = await SELF.fetch(`https://server/api/admin/groups/${gid}`, {
          headers: as('admin'),
        });
        const { members } = (await res.json()) as {
          members: { id: string; lots: number[] }[];
        };
        return members.find((m) => m.id === userId)?.lots ?? [];
      }

      const setLots = (userId: string, lots: number[]) =>
        SELF.fetch(
          `https://server/api/admin/groups/${gid}/members/${userId}/lots`,
          {
            method: 'POST',
            headers: { ...as('admin'), 'content-type': 'application/json' },
            body: JSON.stringify({ lots }),
          },
        );

      // Set alice's lots; the response is sorted + deduped.
      const ok = await setLots('alice', [3, 1, 2, 2]);
      expect(ok.status).toBe(200);
      expect(await lotsOf('alice')).toEqual([1, 2, 3]);

      // Double-assignment: bob takes lot 1, which alice still holds — both keep it.
      const dbl = await setLots('bob', [1]);
      expect(dbl.status).toBe(200);
      expect(await lotsOf('bob')).toEqual([1]);
      expect(await lotsOf('alice')).toContain(1);

      // Invalid lot numbers are rejected before any write.
      const bad = await setLots('alice', [999]);
      expect(bad.status).toBe(400);
      expect(await lotsOf('alice')).toEqual([1, 2, 3]);

      // Non-admins can't edit lots.
      const forbidden = await SELF.fetch(
        `https://server/api/admin/groups/${gid}/members/alice/lots`,
        {
          method: 'POST',
          headers: { ...as('alice'), 'content-type': 'application/json' },
          body: JSON.stringify({ lots: [1] }),
        },
      );
      expect(forbidden.status).toBe(403);
    });

    it('lists a week of assignments and toggles a completion on the user behalf', async () => {
      await join('alice');
      const week = joinerFirstWeek();
      const res = await SELF.fetch(
        `https://server/api/admin/assignments?week=${week}`,
        { headers: as('admin') },
      );
      const body = (await res.json()) as {
        weekStart: string;
        total: number;
        rows: {
          userId: string;
          email: string;
          mishnas: { mesechta: string; perek: number; mishna: number; groupId: string | null; done: boolean }[];
        }[];
      };
      expect(body.weekStart).toBe(week);
      expect(body.total).toBe(1);
      const row = body.rows.find((r) => r.userId === 'alice');
      expect(row?.email).toBe('alice@example.com');
      const m = row?.mishnas.find((x) => x.groupId);
      if (!m || !m.groupId) throw new Error('expected a mishna with a group');
      expect(m.done).toBe(false);

      const completionBody = {
        ref: { mesechta: m.mesechta, perek: m.perek, mishna: m.mishna },
        groupId: m.groupId,
      };
      const post = await SELF.fetch(
        'https://server/api/admin/users/alice/completions',
        {
          method: 'POST',
          headers: { ...as('admin'), 'content-type': 'application/json' },
          body: JSON.stringify(completionBody),
        },
      );
      expect(post.status).toBe(200);
      const afterPost = await SELF.fetch('https://server/api/completions', {
        headers: as('alice'),
      });
      expect(((await afterPost.json()) as { completed: MishnaRef[] }).completed).toHaveLength(1);

      const del = await SELF.fetch(
        'https://server/api/admin/users/alice/completions',
        {
          method: 'DELETE',
          headers: { ...as('admin'), 'content-type': 'application/json' },
          body: JSON.stringify(completionBody),
        },
      );
      expect(del.status).toBe(200);
      const afterDel = await SELF.fetch('https://server/api/completions', {
        headers: as('alice'),
      });
      expect(((await afterDel.json()) as { completed: MishnaRef[] }).completed).toEqual([]);

      const forbidden = await SELF.fetch(
        'https://server/api/admin/users/alice/completions',
        {
          method: 'POST',
          headers: { ...as('alice'), 'content-type': 'application/json' },
          body: JSON.stringify(completionBody),
        },
      );
      expect(forbidden.status).toBe(403);
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
