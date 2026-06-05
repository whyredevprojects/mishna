import { Hono } from 'hono';
import { poweredBy } from 'hono/powered-by';
import {
  Block,
  Commitment,
  EmailKind,
  Group,
  MishnaRef,
  localParts,
  mishnahDataset,
  weekStartOnOrBefore,
  weekStartToDate,
} from '@mishna/domain';
import { AllocatorDO } from './allocator';
import { assignmentEngine, calendar, idGen, structure } from './domain';
import { D1GroupRepository } from './repository';
import { AuthVariables, requireAdmin, requireAuth } from './auth-middleware';
import { ReminderWorkflow, senderDeps } from './email/workflow';
import { prepareOne, processJobs } from './email/sender';
import {
  GroupBlock,
  alreadySentSet,
  loadCompletedFor,
  loadGroupBlocksFor,
  loadIdentitiesFor,
} from './email/data';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const app = new Hono<AppEnv>();

app.use('*', poweredBy());

// -- helpers ----------------------------------------------------------------

/** The single allocator Durable Object stub — the serialized write path. */
function allocator(env: Env) {
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
 * The week's assignment plus the group it belongs to. `groupId` is resolved from
 * the first mishna's block (null when the assignment is empty); the client echoes
 * it back when recording completions. At the single overflow boundary a user's
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

/** Whether `userId` belongs to `groupId` (the completion authorization check). */
function isGroupMember(env: Env, groupId: string, userId: string): Promise<unknown> {
  return env.DB.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(groupId, userId)
    .first();
}

/** Upsert a `(user, group, ref)` completion. Shared by the self + admin paths. */
function recordCompletion(
  env: Env,
  userId: string,
  ref: MishnaRef,
  groupId: string,
): Promise<unknown> {
  return env.DB.prepare(
    `INSERT INTO completions (user_id, group_id, mesechta, perek, mishna, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, group_id, mesechta, perek, mishna)
       DO UPDATE SET completed_at = excluded.completed_at`,
  )
    .bind(userId, groupId, ref.mesechta, ref.perek, ref.mishna, Date.now())
    .run();
}

/** Delete a `(user, group, ref)` completion. Idempotent. Shared self + admin. */
function removeCompletion(
  env: Env,
  userId: string,
  ref: MishnaRef,
  groupId: string,
): Promise<unknown> {
  return env.DB.prepare(
    `DELETE FROM completions
      WHERE user_id = ? AND group_id = ? AND mesechta = ? AND perek = ? AND mishna = ?`,
  )
    .bind(userId, groupId, ref.mesechta, ref.perek, ref.mishna)
    .run();
}

/** The group id whose tagged block contains `ref`, or null. In-memory, no I/O. */
function groupIdForRefInBlocks(
  entries: GroupBlock[],
  ref: MishnaRef,
): string | null {
  for (const e of entries) {
    if (blockContains(e.block, ref)) return e.groupId;
  }
  return null;
}

/** `?limit` (1-50, default 50) + `?offset` (>=0) for the paginated admin lists. */
function pageParams(c: { req: { query(name: string): string | undefined } }) {
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 50));
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  return { limit, offset };
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
// their join status + per-week commitment.
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

// -- email preferences ------------------------------------------------------
// Per-user email settings (timezone + which weekday each email lands on). Stored
// in user_email_prefs; users without a row get DEFAULT_PREFS. The email worker
// reads the same table.

const DEFAULT_PREFS = {
  timezone: 'America/New_York',
  weeklyEmailDow: 0,
  reminderEmailDow: 4,
  weeklyEnabled: true,
  reminderEnabled: true,
};
type EmailPrefs = typeof DEFAULT_PREFS;

interface PrefsRow {
  timezone: string;
  weekly_email_dow: number;
  reminder_email_dow: number;
  weekly_enabled: number;
  reminder_enabled: number;
}

function rowToPrefs(row: PrefsRow | null): EmailPrefs {
  if (!row) return { ...DEFAULT_PREFS };
  return {
    timezone: row.timezone,
    weeklyEmailDow: row.weekly_email_dow,
    reminderEmailDow: row.reminder_email_dow,
    weeklyEnabled: row.weekly_enabled === 1,
    reminderEnabled: row.reminder_enabled === 1,
  };
}

function loadPrefs(env: Env, userId: string): Promise<PrefsRow | null> {
  return env.DB.prepare(
    `SELECT timezone, weekly_email_dow, reminder_email_dow, weekly_enabled, reminder_enabled
       FROM user_email_prefs WHERE user_id = ?`,
  )
    .bind(userId)
    .first<PrefsRow>();
}

/** A real IANA timezone (Intl throws RangeError on an unknown one). */
function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isDow(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6;
}

// The caller's email preferences (defaults if they've never saved any).
app.get('/api/me/preferences', requireAuth, async (c) => {
  return c.json(rowToPrefs(await loadPrefs(c.env, c.get('userId'))));
});

// Upsert the caller's email preferences.
app.put('/api/me/preferences', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { timezone, weeklyEmailDow, reminderEmailDow, weeklyEnabled, reminderEnabled } =
    body as Partial<EmailPrefs>;
  if (!isValidTimeZone(timezone)) {
    return c.json({ error: 'timezone must be a valid IANA zone' }, 400);
  }
  if (!isDow(weeklyEmailDow) || !isDow(reminderEmailDow)) {
    return c.json({ error: 'weekday must be an integer 0-6' }, 400);
  }
  const weekly = weeklyEnabled !== false ? 1 : 0;
  const reminder = reminderEnabled !== false ? 1 : 0;
  await c.env.DB.prepare(
    `INSERT INTO user_email_prefs
       (user_id, timezone, weekly_email_dow, reminder_email_dow, weekly_enabled, reminder_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       timezone = excluded.timezone,
       weekly_email_dow = excluded.weekly_email_dow,
       reminder_email_dow = excluded.reminder_email_dow,
       weekly_enabled = excluded.weekly_enabled,
       reminder_enabled = excluded.reminder_enabled,
       updated_at = excluded.updated_at`,
  )
    .bind(
      c.get('userId'),
      timezone,
      weeklyEmailDow,
      reminderEmailDow,
      weekly,
      reminder,
      Date.now(),
    )
    .run();
  return c.json({
    timezone,
    weeklyEmailDow,
    reminderEmailDow,
    weeklyEnabled: weekly === 1,
    reminderEnabled: reminder === 1,
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

// This week's mishnayot for the caller, plus the group they belong to.
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
  if (!(await isGroupMember(c.env, parsed.groupId, userId))) {
    return c.json({ error: 'not a member of that group' }, 403);
  }

  await recordCompletion(c.env, userId, parsed.ref, parsed.groupId);
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

  await removeCompletion(c.env, userId, parsed.ref, parsed.groupId);
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
  emailVerified?: boolean;
  createdAt?: string;
}

/** Shape a better-auth admin user into the merged admin-list/detail row. */
function adminUserRow(u: AuthUser, commitment: number | null) {
  return {
    id: u.id,
    name: u.name ?? null,
    email: u.email ?? null,
    role: u.role ?? null,
    emailVerified: u.emailVerified === true,
    createdAt: u.createdAt ?? null,
    joined: commitment !== null,
    commitment,
  };
}

// One page of users with their join status and commitment. Pagination/search/sort
// are delegated to better-auth's list-users (the auth DB is the user directory);
// only the page's participant rows are merged in. `?search` matches email (or name
// when it has no '@'); `?sort` is `field:asc|desc` (e.g. createdAt:desc).
app.get('/api/admin/users', requireAdmin, async (c) => {
  const { limit, offset } = pageParams(c);
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const search = c.req.query('search')?.trim();
  if (search) {
    q.set('searchValue', search);
    q.set('searchField', search.includes('@') ? 'email' : 'name');
    q.set('searchOperator', 'contains');
  }
  const sort = c.req.query('sort');
  if (sort) {
    const [field, dir] = sort.split(':');
    q.set('sortBy', field);
    q.set('sortDirection', dir === 'asc' ? 'asc' : 'desc');
  }

  const res = await adminAuthFetch(
    c.env,
    c.req.header('cookie'),
    `list-users?${q.toString()}`,
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

  const merged = users.map((u) =>
    adminUserRow(u, commitmentByUser.get(u.id) ?? null),
  );
  return c.json({ users: merged, total: total ?? merged.length, limit, offset });
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
    ...adminUserRow(user, row?.commitment ?? null),
    groups: groupSummaries,
  });
});

// One group: progress plus its members resolved to identity + block size. The
// list view (/api/admin/groups) carries userIds only; this enriches one group.
app.get('/api/admin/groups/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const groupRow = await c.env.DB.prepare(
    'SELECT id, state, capacity_left FROM groups WHERE id = ?',
  )
    .bind(id)
    .first<{ id: string; state: string; capacity_left: number }>();
  if (!groupRow) {
    return c.json({ error: 'group not found' }, 404);
  }
  const blocks = Group.fromState(structure, idGen, JSON.parse(groupRow.state)).toState()
    .blocks;
  const { results: memberRows } = await c.env.DB.prepare(
    'SELECT user_id FROM group_members WHERE group_id = ?',
  )
    .bind(id)
    .all<{ user_id: string }>();
  const ids = memberRows.map((r) => r.user_id);
  const identities = await loadIdentitiesFor(c.env, ids);

  const total = structure.totalMishnayot;
  const members = ids.map((uid) => {
    const who = identities.get(uid);
    return {
      id: uid,
      name: who?.name ?? null,
      email: who?.email ?? null,
      emailVerified: who?.emailVerified ?? false,
      blockSize: userBlockSize(blocks, uid),
    };
  });
  return c.json({
    id: groupRow.id,
    progress: (total - groupRow.capacity_left) / total,
    memberCount: members.length,
    members,
  });
});

/** The Sunday-anchored week-start (YYYY-MM-DD) for `now` in the default timezone.
 *  The admin dashboard/assignments use one shared week, independent of any user. */
function currentWeekStart(now: Date): string {
  return weekStartOnOrBefore(
    localParts(now, DEFAULT_PREFS.timezone),
    DEFAULT_PREFS.weeklyEmailDow,
  );
}

// Dashboard counters. A handful of set-based aggregates, so it stays cheap as the
// participant count grows (no per-user loop).
app.get('/api/admin/stats', requireAdmin, async (c) => {
  const weekStart = currentWeekStart(new Date());
  const weekStartMs = weekStartToDate(weekStart).getTime();
  const count = (q: D1PreparedStatement) =>
    q.first<{ n: number }>().then((r) => r?.n ?? 0);

  const [activeUsers, totalGroups, totalCompletions, weekCompletions, verifiedUsers] =
    await Promise.all([
      count(c.env.DB.prepare('SELECT COUNT(*) AS n FROM participants')),
      count(c.env.DB.prepare('SELECT COUNT(*) AS n FROM groups')),
      count(c.env.DB.prepare('SELECT COUNT(*) AS n FROM completions')),
      count(
        c.env.DB
          .prepare('SELECT COUNT(*) AS n FROM completions WHERE completed_at >= ?')
          .bind(weekStartMs),
      ),
      count(
        c.env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM "user" WHERE "emailVerified" = 1'),
      ),
    ]);

  return c.json({
    activeUsers,
    verifiedUsers,
    totalGroups,
    totalCompletions,
    weekCompletions,
    weekStart,
  });
});

// One page of participants with the chosen week's mishnayot, each tagged with its
// group and learned-state, plus whether the weekly email went out. `?week=YYYY-MM-DD`
// selects the week (defaults to the current one). Resolves blocks/completions/emails
// only for the page's user subset via the batched email-path readers — a few
// subrequests regardless of headcount.
app.get('/api/admin/assignments', requireAdmin, async (c) => {
  const { limit, offset } = pageParams(c);
  const weekStart = parseUtcDate(c.req.query('week'))
    ? (c.req.query('week') as string)
    : currentWeekStart(new Date());
  const weekDate = weekStartToDate(weekStart);

  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM participants')
    .first<{ n: number }>()
    .then((r) => r?.n ?? 0);
  const { results: pageRows } = await c.env.DB.prepare(
    'SELECT user_id FROM participants ORDER BY joined_at, user_id LIMIT ? OFFSET ?',
  )
    .bind(limit, offset)
    .all<{ user_id: string }>();
  const ids = pageRows.map((r) => r.user_id);
  if (ids.length === 0) {
    return c.json({ weekStart, rows: [], total });
  }

  const [groupBlocks, completedByUser, identities, sent] = await Promise.all([
    loadGroupBlocksFor(c.env, ids),
    loadCompletedFor(c.env, ids),
    loadIdentitiesFor(c.env, ids),
    alreadySentSet(c.env, ids, weekStart),
  ]);

  const rows = ids.map((uid) => {
    const entries = groupBlocks.get(uid) ?? [];
    const refs = assignmentEngine.getWeekAssignment(
      entries.map((e) => e.block),
      weekDate,
    );
    const done = completedByUser.get(uid) ?? new Set<string>();
    const who = identities.get(uid);
    const mishnas = refs.map((ref) => ({
      mesechta: ref.mesechta,
      perek: ref.perek,
      mishna: ref.mishna,
      groupId: groupIdForRefInBlocks(entries, ref),
      done: done.has(refKey(ref)),
    }));
    return {
      userId: uid,
      name: who?.name ?? null,
      email: who?.email ?? null,
      emailVerified: who?.emailVerified ?? false,
      emailSent: sent.has(`${uid}|weekly|${weekStart}`),
      mishnas,
    };
  });

  return c.json({ weekStart, rows, total });
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

// Admin "send now": send an extra weekly or reminder email for a user, bypassing the
// once-per-week dedup. Reuses the user's prefs to anchor the week (so the email covers
// the same quota the scheduled one would). Unlike the scheduled path (the ReminderWorkflow,
// kicked off by the cron), this builds and sends the one email *inline* and synchronously,
// so the admin gets the real success/failure back (a 502 on a Resend error). Volume is 1,
// so there's nothing to fan out.
async function sendEmailNow(
  env: Env,
  userId: string,
  kind: EmailKind,
): Promise<Response> {
  const prefs = rowToPrefs(await loadPrefs(env, userId));
  const parts = localParts(new Date(), prefs.timezone);
  const weekStart = weekStartOnOrBefore(parts, prefs.weeklyEmailDow);
  try {
    const prepared = await prepareOne(env, userId, kind, weekStart);
    await processJobs(env, prepared ? [prepared] : [], senderDeps(env));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json({ error: 'email send failed', detail }, { status: 502 });
  }
  return Response.json({ sent: true, kind, weekStart });
}

app.post('/api/admin/users/:id/send-weekly', requireAdmin, (c) =>
  sendEmailNow(c.env, c.req.param('id'), 'weekly'),
);

app.post('/api/admin/users/:id/send-reminder', requireAdmin, (c) =>
  sendEmailNow(c.env, c.req.param('id'), 'reminder'),
);

// Admin mark/unmark a mishna learned on a user's behalf (the Assignments view's
// learn/unlearn toggle). Mirrors the self /api/completions routes — same validation
// and membership check — but keyed on the path's user id rather than the caller.
app.post('/api/admin/users/:id/completions', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const parsed = parseCompletionBody(await c.req.json().catch(() => ({})));
  if (!parsed) {
    return c.json({ error: 'ref and groupId are required' }, 400);
  }
  try {
    structure.indexOf(parsed.ref);
  } catch {
    return c.json({ error: 'ref must be a valid mishna' }, 400);
  }
  if (!(await isGroupMember(c.env, parsed.groupId, id))) {
    return c.json({ error: 'user is not a member of that group' }, 403);
  }
  await recordCompletion(c.env, id, parsed.ref, parsed.groupId);
  return c.json({ ok: true });
});

app.delete('/api/admin/users/:id/completions', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const parsed = parseCompletionBody(await c.req.json().catch(() => ({})));
  if (!parsed) {
    return c.json({ error: 'ref and groupId are required' }, 400);
  }
  await removeCompletion(c.env, id, parsed.ref, parsed.groupId);
  return c.json({ ok: true });
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

// The worker entry point. `fetch` serves the Hono API; `scheduled` fires on the cron
// (hourly) and kicks off the ReminderWorkflow — a durable, multi-step bulk send. The
// instance id is derived from the cron's scheduledTime, so a double cron fire (cron has
// at-least-once semantics) dedupes to a single workflow run rather than two campaigns.
export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await env.REMINDER_WORKFLOW.create({
      id: `reminder-${controller.scheduledTime}`,
      params: { scheduledTime: controller.scheduledTime },
    });
  },
} satisfies ExportedHandler<Env>;

export { AllocatorDO, ReminderWorkflow };
