import { Hono } from 'hono';
import { poweredBy } from 'hono/powered-by';
import { Block, Commitment, Group, MishnaRef, mishnahDataset } from '@mishna/domain';
import { AllocatorDO } from './allocator';
import { assignmentEngine, calendar, idGen, structure } from './domain';
import { D1GroupRepository } from './repository';
import { AuthVariables, requireAdmin, requireAuth } from './auth-middleware';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const app = new Hono<AppEnv>();

app.use('*', poweredBy());

// -- helpers ----------------------------------------------------------------

/** The single allocator Durable Object stub — the serialized write path. */
function allocator(env: Env): DurableObjectStub {
  return env.ALLOCATOR.get(env.ALLOCATOR.idFromName('allocator'));
}

/** Every group the user holds a block in. */
function userGroups(env: Env, userId: string): Promise<Group[]> {
  const repo = new D1GroupRepository(env.DB, structure, idGen);
  return repo.loadGroupsForUser(userId);
}

/** Every block the user holds, flattened across all their groups. */
function flattenBlocks(groups: Group[]): Block[] {
  return groups.flatMap((g) => g.toState().blocks);
}

/** Whether `ref` falls within one of the block's ranges. */
function blockContains(block: Block, ref: MishnaRef): boolean {
  const i = structure.indexOf(ref);
  return block.ranges.some(
    (r) => structure.indexOf(r.start) <= i && i <= structure.indexOf(r.end),
  );
}

/**
 * The id of the group whose block for `userId` contains `ref`, or null if none.
 * A user holds at most one block per group, so the first match is unambiguous.
 */
function groupIdForRef(
  groups: Group[],
  userId: string,
  ref: MishnaRef,
): string | null {
  for (const group of groups) {
    const block = group
      .toState()
      .blocks.find((b) => b.userId === userId);
    if (block && blockContains(block, ref)) {
      return group.id;
    }
  }
  return null;
}

/**
 * The day's assignment plus the group it belongs to. `groupId` is resolved from
 * the first mishna's block (null when the assignment is empty); the client echoes
 * it back when recording completions. On the single overflow-boundary day a user's
 * mishnayot can span two groups — they're all attributed to the first's group.
 */
async function buildAssignment(env: Env, userId: string, date: Date) {
  const groups = await userGroups(env, userId);
  const assignment = assignmentEngine.getAssignment(flattenBlocks(groups), date);
  const groupId = assignment.mishnas.length
    ? groupIdForRef(groups, userId, assignment.mishnas[0])
    : null;
  const completed = await completedAmong(env, userId, assignment.mishnas);
  return { ...assignment, groupId, completed };
}

/** `refKey`-style identity for a mishna ("Berachos|1|1"); cross-cycle, group-agnostic. */
function refKey(ref: MishnaRef): string {
  return `${ref.mesechta}|${ref.perek}|${ref.mishna}`;
}

/** The subset of `refs` the user has already marked learned (any group). */
async function completedAmong(
  env: Env,
  userId: string,
  refs: MishnaRef[],
): Promise<MishnaRef[]> {
  if (refs.length === 0) {
    return [];
  }
  const { results } = await env.DB.prepare(
    'SELECT DISTINCT mesechta, perek, mishna FROM completions WHERE user_id = ?',
  )
    .bind(userId)
    .all<MishnaRef>();
  const done = new Set(results.map(refKey));
  return refs.filter((ref) => done.has(refKey(ref)));
}

/** Parses a `YYYY-MM-DD` query value as a UTC-midnight Date, or null if invalid. */
function parseUtcDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Calls a better-auth admin endpoint (`/api/auth/admin/<path>`) on the login worker
 * via the AUTH service binding, forwarding the caller's cookie so better-auth
 * authorizes against its `adminUserIds`. Used by the admin user-management routes.
 */
function adminAuthFetch(
  env: Env,
  cookie: string | undefined,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return env.AUTH.fetch(`https://login/api/auth/admin/${path}`, {
    ...init,
    headers: { cookie: cookie ?? '', ...(init?.headers ?? {}) },
  });
}

/** Total mishnayot a user holds in one group, summed across their blocks. */
function userBlockSize(blocks: Block[], userId: string): number {
  return blocks
    .filter((b) => b.userId === userId)
    .reduce((sum, b) => sum + b.totalSize, 0);
}

/** A well-formed `{ ref, groupId }` completion body, or null if malformed. */
function parseCompletionBody(
  body: unknown,
): { ref: MishnaRef; groupId: string } | null {
  const { ref, groupId } = (body ?? {}) as {
    ref?: Partial<MishnaRef>;
    groupId?: unknown;
  };
  if (typeof groupId !== 'string' || groupId === '') {
    return null;
  }
  if (
    !ref ||
    typeof ref.mesechta !== 'string' ||
    typeof ref.perek !== 'number' ||
    typeof ref.mishna !== 'number'
  ) {
    return null;
  }
  return { ref: ref as MishnaRef, groupId };
}

// -- routes -----------------------------------------------------------------

app.get('/', (c) => c.text('Mishna API'));

// Auth surface. In dev the client proxies all `/api/*` to this single worker, so
// better-auth's endpoints (sign-in, sign-out, get-session, …) are forwarded to the
// login worker via the AUTH service binding. In production this path is never hit:
// the login worker's more specific `/api/auth/*` route serves the browser directly.
// Re-wrap the response: a service-binding fetch yields immutable headers, which
// the poweredBy middleware can't write to ("Can't modify immutable headers").
app.all('/api/auth/*', async (c) => {
  const res = await c.env.AUTH.fetch(c.req.raw);
  return new Response(res.body, res);
});

// Static corpus, so the client need not bundle the 4192-mishna dataset. Public.
app.get('/api/corpus', (c) => c.json(mishnahDataset));

// The current learning cycle's bounds and progress. Public, so the landing page
// can show cycle urgency before login — and keeps @hebcal/core out of the client.
app.get('/api/cycle', (c) => {
  const today = new Date();
  const daysElapsed = calendar.daysSinceCycleStart(today);
  const daysRemaining = calendar.daysRemaining(today);
  return c.json({
    cycleStart: calendar.cycleStart(today).toISOString(),
    cycleEnd: calendar.cycleEnd(today).toISOString(),
    daysElapsed,
    daysRemaining,
    totalDays: daysElapsed + daysRemaining,
  });
});

// The caller's identity (for the settings page), whether they're an admin, and
// their join status + per-day commitment.
app.get('/api/me', requireAuth, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT commitment FROM participants WHERE user_id = ?',
  )
    .bind(user.id)
    .first<{ commitment: number }>();
  return c.json({
    joined: row !== null,
    commitment: row?.commitment ?? null,
    user: {
      id: user.id,
      name: user.name ?? null,
      email: user.email ?? null,
      role: user.role ?? null,
    },
    isAdmin: user.isAdmin === true,
  });
});

// Join the current cycle. Allocation runs through the AllocatorDO write mutex.
app.post('/api/join', requireAuth, async (c) => {
  const userId = c.get('userId');
  const body = await c.req
    .json<{ commitment?: number }>()
    .catch(() => ({} as { commitment?: number }));
  const commitment = body.commitment;
  if (commitment !== 1 && commitment !== 2 && commitment !== 3) {
    return c.json({ error: 'commitment must be 1, 2, or 3' }, 400);
  }

  const res = await allocator(c.env).fetch('https://allocator/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, commitment: commitment as Commitment }),
  });
  return new Response(res.body, res);
});

// Leave the cycle, returning the user's ranges to their groups' gap queues.
app.post('/api/leave', requireAuth, async (c) => {
  const userId = c.get('userId');
  const res = await allocator(c.env).fetch('https://allocator/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  return new Response(res.body, res);
});

// Today's mishnayot for the caller, plus the group they belong to.
app.get('/api/assignments/today', requireAuth, async (c) => {
  return c.json(await buildAssignment(c.env, c.get('userId'), new Date()));
});

// The caller's mishnayot for an explicit `?date=YYYY-MM-DD` (interpreted UTC).
app.get('/api/assignments', requireAuth, async (c) => {
  const date = parseUtcDate(c.req.query('date'));
  if (date === null) {
    return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  }
  return c.json(await buildAssignment(c.env, c.get('userId'), date));
});

// Every mishna the caller has marked learned (across groups, all cycles). The
// client intersects this with the day's assignment to render the checkboxes.
app.get('/api/completions', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT mesechta, perek, mishna FROM completions WHERE user_id = ?',
  )
    .bind(c.get('userId'))
    .all<MishnaRef>();
  return c.json({ completed: results });
});

// Mark a mishna learned. The body's `groupId` (handed down with the assignment)
// is validated against the caller's membership, then the ref is upserted.
app.post('/api/completions', requireAuth, async (c) => {
  const userId = c.get('userId');
  const parsed = parseCompletionBody(await c.req.json().catch(() => ({})));
  if (!parsed) {
    return c.json({ error: 'ref and groupId are required' }, 400);
  }
  try {
    structure.indexOf(parsed.ref);
  } catch {
    return c.json({ error: 'ref must be a valid mishna' }, 400);
  }
  const member = await c.env.DB.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(parsed.groupId, userId)
    .first();
  if (!member) {
    return c.json({ error: 'not a member of that group' }, 403);
  }

  await c.env.DB.prepare(
    `INSERT INTO completions (user_id, group_id, mesechta, perek, mishna, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, group_id, mesechta, perek, mishna)
       DO UPDATE SET completed_at = excluded.completed_at`,
  )
    .bind(
      userId,
      parsed.groupId,
      parsed.ref.mesechta,
      parsed.ref.perek,
      parsed.ref.mishna,
      Date.now(),
    )
    .run();
  return c.json({ ok: true });
});

// Unmark a mishna. Scoped to the caller's own rows, so it's idempotent and safe.
app.delete('/api/completions', requireAuth, async (c) => {
  const userId = c.get('userId');
  const parsed = parseCompletionBody(await c.req.json().catch(() => ({})));
  if (!parsed) {
    return c.json({ error: 'ref and groupId are required' }, 400);
  }
  try {
    structure.indexOf(parsed.ref);
  } catch {
    return c.json({ error: 'ref must be a valid mishna' }, 400);
  }

  await c.env.DB.prepare(
    `DELETE FROM completions
      WHERE user_id = ? AND group_id = ? AND mesechta = ? AND perek = ? AND mishna = ?`,
  )
    .bind(
      userId,
      parsed.groupId,
      parsed.ref.mesechta,
      parsed.ref.perek,
      parsed.ref.mishna,
    )
    .run();
  return c.json({ ok: true });
});

// Admin view: every group's progress and members.
app.get('/api/admin/groups', requireAdmin, async (c) => {
  const total = structure.totalMishnayot;
  const { results: groupRows } = await c.env.DB.prepare(
    'SELECT id, capacity_left FROM groups',
  ).all<{ id: string; capacity_left: number }>();
  const { results: memberRows } = await c.env.DB.prepare(
    'SELECT group_id, user_id FROM group_members',
  ).all<{ group_id: string; user_id: string }>();

  const membersByGroup = new Map<string, string[]>();
  for (const { group_id, user_id } of memberRows) {
    const list = membersByGroup.get(group_id) ?? [];
    list.push(user_id);
    membersByGroup.set(group_id, list);
  }

  const groups = groupRows.map((g) => {
    const members = membersByGroup.get(g.id) ?? [];
    return {
      id: g.id,
      progress: (total - g.capacity_left) / total,
      memberCount: members.length,
      members,
    };
  });

  return c.json({ count: groups.length, groups });
});

// -- admin: user management -------------------------------------------------
// All gated by requireAdmin. User identity lives in the apps/login auth DB, so
// list/get/delete proxy better-auth's admin plugin (/api/auth/admin/*); join
// status, commitment and group membership come from this worker's mishna-app DB.

interface AuthUser {
  id: string;
  name?: string;
  email?: string;
  role?: string | null;
}

// Every user with their join status and commitment.
app.get('/api/admin/users', requireAdmin, async (c) => {
  const res = await adminAuthFetch(
    c.env,
    c.req.header('cookie'),
    'list-users?limit=1000',
  );
  if (!res.ok) {
    return c.json({ error: 'failed to list users' }, 502);
  }
  const { users = [], total } = (await res.json()) as {
    users?: AuthUser[];
    total?: number;
  };

  const { results } = await c.env.DB.prepare(
    'SELECT user_id, commitment FROM participants',
  ).all<{ user_id: string; commitment: number }>();
  const commitmentByUser = new Map(results.map((r) => [r.user_id, r.commitment]));

  const merged = users.map((u) => ({
    id: u.id,
    name: u.name ?? null,
    email: u.email ?? null,
    role: u.role ?? null,
    joined: commitmentByUser.has(u.id),
    commitment: commitmentByUser.get(u.id) ?? null,
  }));
  return c.json({ users: merged, total: total ?? merged.length });
});

// One user's identity plus their join status, commitment and group membership.
app.get('/api/admin/users/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const res = await adminAuthFetch(
    c.env,
    c.req.header('cookie'),
    `get-user?id=${encodeURIComponent(id)}`,
  );
  if (!res.ok) {
    return c.json({ error: 'user not found' }, 404);
  }
  const user = (await res.json()) as AuthUser | null;
  if (!user?.id) {
    return c.json({ error: 'user not found' }, 404);
  }

  const row = await c.env.DB.prepare(
    'SELECT commitment FROM participants WHERE user_id = ?',
  )
    .bind(id)
    .first<{ commitment: number }>();

  const repo = new D1GroupRepository(c.env.DB, structure, idGen);
  const groups = await repo.loadGroupsForUser(id);
  const groupSummaries = groups.map((g) => ({
    id: g.id,
    blockSize: userBlockSize(g.toState().blocks, id),
  }));

  return c.json({
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    role: user.role ?? null,
    joined: row !== null,
    commitment: row?.commitment ?? null,
    groups: groupSummaries,
  });
});

// Return a user's mishnayot to their groups' gap queues (same path as /api/leave,
// but acting on an arbitrary user). Leaves the auth account intact.
app.post('/api/admin/users/:id/remove-assignments', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const res = await allocator(c.env).fetch('https://allocator/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: id }),
  });
  return new Response(res.body, res);
});

// Hard-delete a user. Removes their assignments first (so mishna-app holds no
// orphaned blocks/participants), then removes the better-auth account.
app.delete('/api/admin/users/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');

  const leave = await allocator(c.env).fetch('https://allocator/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: id }),
  });
  if (!leave.ok) {
    return c.json({ error: 'failed to remove assignments' }, 502);
  }

  const removed = await adminAuthFetch(
    c.env,
    c.req.header('cookie'),
    'remove-user',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: id }),
    },
  );
  if (!removed.ok) {
    return c.json({ error: 'failed to delete account' }, 502);
  }
  return c.json({ deleted: true });
});

export default app;
export { AllocatorDO };
