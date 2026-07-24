import { Hono, type Context } from 'hono';
import { poweredBy } from 'hono/powered-by';
import {
  Block,
  Commitment,
  EmailKind,
  Group,
  GroupState,
  MishnaRef,
  blocksForUser,
  computeJoinOptions,
  localParts,
  mishnahDataset,
  weekStartOnOrBefore,
  weekStartToDate,
} from '@mishna/domain';
import { DEFAULT_EMAIL_PREFS, EmailPrefs } from '@mishna/email-domain';
import { AllocatorDO } from './allocator';
import {
  assignmentEngine,
  calendar,
  chalakim,
  idGen,
  lotCatalog,
  structure,
} from './domain';
import { D1GroupRepository } from './repository';
import {
  AboutConfigError,
  AboutLocale,
  readAbout,
  safeFilename,
  writeAbout,
} from './about';
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
  const repo = new D1GroupRepository(env.DB, structure, chalakim, idGen);
  return repo.loadGroupsForUser(userId);
}

/**
 * Only the blocks `userId` holds, flattened across all their groups. Routes through
 * the domain's `blocksForUser` — a group's state carries every member's blocks, so
 * the per-user filter is one shared rule, not re-implemented here.
 */
function userBlocks(groups: Group[], userId: string): Block[] {
  return blocksForUser(
    groups.map((g) => g.toState()),
    userId,
  );
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
    // At most one block per group is this user's; route the filter through the
    // shared rule rather than re-finding by userId here.
    const [block] = blocksForUser([group.toState()], userId);
    if (block && blockContains(block, ref)) {
      return group.id;
    }
  }
  return null;
}

/**
 * The "current mishnayos" the dashboard opens on: the user's *next still-unlearned*
 * bucket (progress-based, not the calendar week). `groupId` is resolved from the
 * first mishna's block (null when empty); the client echoes it back when recording
 * completions. The slice advances as the user checks it off and empties once the
 * whole portion is learned. Carries the navigation metadata the prev/next pager
 * needs: `bucket` (the index shown), `bucketCount` (total), and `currentBucket`
 * (the next-unlearned index — equal to `bucket` here). At the single overflow
 * boundary a user's mishnayot can span two groups — all attributed to the first's.
 */
async function buildNextAssignment(env: Env, userId: string, date: Date) {
  return buildBucketResponse(env, userId, date, null);
}

/**
 * Like {@link buildNextAssignment} but for an explicit, positional bucket index —
 * the target of the dashboard's prev/next pager. Out-of-range indices clamp to the
 * nearest real bucket, and the served index comes back as `bucket` so the client
 * can resync. `null` selects the next-unlearned bucket (the "current" view).
 */
async function buildBucketAssignment(
  env: Env,
  userId: string,
  bucketIndex: number,
) {
  return buildBucketResponse(env, userId, new Date(), bucketIndex);
}

/** Shared core: resolve a bucket (current when `requested` is null) + nav metadata. */
async function buildBucketResponse(
  env: Env,
  userId: string,
  date: Date,
  requested: number | null,
) {
  const groups = await userGroups(env, userId);
  const blocks = userBlocks(groups, userId);
  const allCompleted = await allCompletions(env, userId);

  const bucketCount = assignmentEngine.bucketCount(blocks, date);
  const currentBucket = assignmentEngine.nextUnlearnedBucket(
    blocks,
    allCompleted,
    date,
  );
  // The current view shows the next-unlearned bucket (which may be the finished
  // state, one past the last). An explicit index clamps to the real buckets.
  const bucket =
    requested === null
      ? currentBucket
      : bucketCount === 0
        ? 0
        : Math.min(Math.max(0, requested), bucketCount - 1);

  const assignment = assignmentEngine.getBucketAssignment(blocks, bucket, date);
  const groupId = assignment.mishnas.length
    ? groupIdForRef(groups, userId, assignment.mishnas[0])
    : null;
  const done = new Set(allCompleted.map(refKey));
  const completed = assignment.mishnas.filter((ref) => done.has(refKey(ref)));
  return { ...assignment, groupId, completed, bucket, bucketCount, currentBucket };
}

/** `refKey`-style identity for a mishna ("Berachos|1|1"); cross-cycle, group-agnostic. */
function refKey(ref: MishnaRef): string {
  return `${ref.mesechta}|${ref.perek}|${ref.mishna}`;
}

/** Every mishna the user has marked learned (distinct, across groups/cycles). */
async function allCompletions(env: Env, userId: string): Promise<MishnaRef[]> {
  const { results } = await env.DB.prepare(
    'SELECT DISTINCT mesechta, perek, mishna FROM completions WHERE user_id = ?',
  )
    .bind(userId)
    .all<MishnaRef>();
  return results;
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
  const done = new Set((await allCompletions(env, userId)).map(refKey));
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
 * via the AUTH service binding. Forwards the caller's cookie (so better-auth authorizes
 * against its `adminUserIds`) and their browser `Origin`: better-auth rejects
 * state-changing (POST) admin calls that arrive without a trusted Origin
 * (`MISSING_OR_NULL_ORIGIN`). The caller's Origin is same-origin in prod
 * (app.getchevrasmishnayos.com) and localhost:4200 in dev — both in `trustedOrigins` — so
 * forwarding it satisfies the check while keeping CSRF protection intact.
 * Used by the admin user-management routes.
 */
function adminAuthFetch(
  c: Context<{ Bindings: Env; Variables: AuthVariables }>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const origin = c.req.header('origin');
  return c.env.AUTH.fetch(`https://login/api/auth/admin/${path}`, {
    ...init,
    headers: {
      cookie: c.req.header('cookie') ?? '',
      ...(origin ? { origin } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

/** Total mishnayot a user holds in one group, summed across their blocks. */
function userBlockSize(state: GroupState, userId: string): number {
  return blocksForUser([state], userId).reduce(
    (sum, b) => sum + b.totalSize,
    0,
  );
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

/** The set of valid lot numbers (1..120), for validating admin lot edits. */
const validLotNumbers = new Set(chalakim.allLotNumbers());

/**
 * Parses a `{ lots: number[] }` body into a clean lot-number array, or null if
 * malformed. Every entry must be an integer that names a real lot; an empty array
 * is valid (it clears the member's lots in the group).
 */
function parseLotsBody(body: unknown): number[] | null {
  const lots = (body as { lots?: unknown })?.lots;
  if (!Array.isArray(lots)) {
    return null;
  }
  for (const v of lots) {
    if (typeof v !== 'number' || !Number.isInteger(v) || !validLotNumbers.has(v)) {
      return null;
    }
  }
  return lots as number[];
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

// The signup commitment choices as of today: each weekly pace annotated with the
// approximate number of lots it commits to from now to the cycle end, collapsing
// to a single "1 lot" option near the end. Public — the signup form needs it
// before the user has joined, and keeps the lot math out of the clients.
app.get('/api/join-options', (c) => {
  return c.json({
    options: computeJoinOptions(structure, chalakim, calendar, new Date()),
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

// The caller's whole-cycle portion ("chaluka"): every mishna in their blocks
// (corpus order) and the subset they've marked learned, plus their weekly goal
// and join date. Powers the "My Chaluka" higher-level progress + stats view.
app.get('/api/me/chaluka', requireAuth, async (c) => {
  const userId = c.get('userId');
  const groups = await userGroups(c.env, userId);
  // Each of the user's block ranges, tagged with the group that owns it, so a
  // completion can be attributed to the right group. A user holds at most one
  // block per group, but their lots spill into a second group at an overflow
  // boundary, so the group must be tracked per range (hence per mishna).
  const tagged = groups.flatMap((g) => {
    const [block] = blocksForUser([g.toState()], userId);
    return block ? block.ranges.map((range) => ({ range, groupId: g.id })) : [];
  });
  tagged.sort(
    (a, b) => structure.indexOf(a.range.start) - structure.indexOf(b.range.start),
  );

  // assigned + groupIds are emitted in lockstep so they never drift: the group
  // for assigned[i] is groupIds[i].
  const assigned: MishnaRef[] = [];
  const groupIds: string[] = [];
  for (const { range, groupId } of tagged) {
    for (const ref of structure.iterateRange(range)) {
      assigned.push(ref);
      groupIds.push(groupId);
    }
  }
  const completed = await completedAmong(c.env, userId, assigned);

  const row = await c.env.DB.prepare(
    'SELECT commitment, joined_at FROM participants WHERE user_id = ?',
  )
    .bind(userId)
    .first<{ commitment: number; joined_at: number }>();

  return c.json({
    commitment: row?.commitment ?? null,
    joinedAt: row ? new Date(row.joined_at).toISOString() : null,
    assigned,
    completed,
    groupIds,
  });
});

// -- email preferences ------------------------------------------------------
// Per-user email settings (timezone + which weekday each email lands on). Stored
// in user_email_prefs; users without a row get DEFAULT_EMAIL_PREFS (the shared
// default, from @mishna/email-domain — the email path reads the same table).

interface PrefsRow {
  timezone: string;
  weekly_email_dow: number;
  reminder_email_dow: number;
  weekly_enabled: number;
  reminder_enabled: number;
}

function rowToPrefs(row: PrefsRow | null): EmailPrefs {
  if (!row) return { ...DEFAULT_EMAIL_PREFS };
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

// Leave the cycle, freeing the user's lots back to their groups.
app.post('/api/leave', requireAuth, async (c) => {
  const userId = c.get('userId');
  const res = await allocator(c.env).fetch('https://allocator/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  return new Response(res.body, res);
});

// The caller's current mishnayot: their next still-unlearned bucket (advances as
// they check it off), plus the group those mishnayot belong to.
app.get('/api/assignments/today', requireAuth, async (c) => {
  return c.json(await buildNextAssignment(c.env, c.get('userId'), new Date()));
});

// The caller's mishnayot for an explicit, positional bucket (`?bucket=N`) — the
// target of the dashboard's prev/next pager (next/prev relative to the current,
// next-unlearned bucket). Out-of-range indices clamp to the nearest real bucket.
app.get('/api/assignments', requireAuth, async (c) => {
  const raw = c.req.query('bucket');
  const bucket = Number(raw);
  if (raw === undefined || !Number.isInteger(bucket) || bucket < 0) {
    return c.json({ error: 'bucket must be a non-negative integer' }, 400);
  }
  return c.json(await buildBucketAssignment(c.env, c.get('userId'), bucket));
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

/** The two email on/off flags, as the admin rows and the admin write route carry them. */
type EmailToggles = Pick<EmailPrefs, 'weeklyEnabled' | 'reminderEnabled'>;

/** Shape a better-auth admin user into the merged admin-list/detail row. */
function adminUserRow(
  u: AuthUser,
  commitment: number | null,
  toggles: EmailToggles,
) {
  return {
    id: u.id,
    name: u.name ?? null,
    email: u.email ?? null,
    role: u.role ?? null,
    emailVerified: u.emailVerified === true,
    createdAt: u.createdAt ?? null,
    joined: commitment !== null,
    commitment,
    weeklyEnabled: toggles.weeklyEnabled,
    reminderEnabled: toggles.reminderEnabled,
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

  const res = await adminAuthFetch(c, `list-users?${q.toString()}`);
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

  // Email opt-out is a pair of per-user prefs flags; a missing row means the defaults.
  const { results: prefRows } = await c.env.DB.prepare(
    'SELECT user_id, weekly_enabled, reminder_enabled FROM user_email_prefs',
  ).all<{ user_id: string; weekly_enabled: number; reminder_enabled: number }>();
  const togglesByUser = new Map<string, EmailToggles>(
    prefRows.map((r) => [
      r.user_id,
      {
        weeklyEnabled: r.weekly_enabled === 1,
        reminderEnabled: r.reminder_enabled === 1,
      },
    ]),
  );

  const merged = users.map((u) =>
    adminUserRow(
      u,
      commitmentByUser.get(u.id) ?? null,
      togglesByUser.get(u.id) ?? DEFAULT_EMAIL_PREFS,
    ),
  );
  return c.json({ users: merged, total: total ?? merged.length, limit, offset });
});

// One user's identity plus their join status, commitment and group membership.
app.get('/api/admin/users/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const res = await adminAuthFetch(
    c,
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

  const prefs = rowToPrefs(await loadPrefs(c.env, id));

  const repo = new D1GroupRepository(c.env.DB, structure, chalakim, idGen);
  const groups = await repo.loadGroupsForUser(id);
  const groupSummaries = groups.map((g) => ({
    id: g.id,
    blockSize: userBlockSize(g.toState(), id),
  }));

  return c.json({
    ...adminUserRow(user, row?.commitment ?? null, prefs),
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
  // The whole group's blocks (every member) — this view is per-group, not per-user.
  const state: GroupState = JSON.parse(groupRow.state);
  const blocks = state.blocks;
  const { results: memberRows } = await c.env.DB.prepare(
    'SELECT user_id FROM group_members WHERE group_id = ?',
  )
    .bind(id)
    .all<{ user_id: string }>();
  const ids = memberRows.map((r) => r.user_id);
  const identities = await loadIdentitiesFor(c.env, ids);

  // Lot numbers each member holds in this group (a user has at most one block here).
  const lotsByUser = new Map<string, number[]>();
  for (const b of blocks) {
    const list = lotsByUser.get(b.userId) ?? [];
    list.push(...b.lots);
    lotsByUser.set(b.userId, list);
  }

  const total = structure.totalMishnayot;
  const members = ids.map((uid) => {
    const who = identities.get(uid);
    return {
      id: uid,
      name: who?.name ?? null,
      email: who?.email ?? null,
      emailVerified: who?.emailVerified ?? false,
      blockSize: userBlockSize(state, uid),
      lots: (lotsByUser.get(uid) ?? []).sort((a, b) => a - b),
    };
  });
  return c.json({
    id: groupRow.id,
    progress: (total - groupRow.capacity_left) / total,
    memberCount: members.length,
    members,
  });
});

// The static lot catalog (120 lots with mesechta label + range). Powers the admin
// group-detail edit UI: label lookup for the Lots column and the "all lots" reference
// dialog. Static, so the client caches it for a long time.
app.get('/api/admin/lots', requireAdmin, (c) => c.json(lotCatalog));

// Admin override: set a member's lots within one group. Validates the lot numbers,
// then routes through the AllocatorDO (the same serialized write path as join/leave)
// so it can't race a concurrent claim. Double-assignment is allowed — the UI warns.
app.post(
  '/api/admin/groups/:groupId/members/:userId/lots',
  requireAdmin,
  async (c) => {
    const groupId = c.req.param('groupId');
    const userId = c.req.param('userId');
    const lots = parseLotsBody(await c.req.json().catch(() => ({})));
    if (lots === null) {
      return c.json(
        { error: 'lots must be an array of lot numbers (1-120)' },
        400,
      );
    }
    const res = await allocator(c.env).fetch('https://allocator/set-lots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId, userId, lots }),
    });
    return new Response(res.body, res);
  },
);

/** The Sunday-anchored week-start (YYYY-MM-DD) for `now` in the default timezone.
 *  The admin dashboard/assignments use one shared week, independent of any user. */
function currentWeekStart(now: Date): string {
  return weekStartOnOrBefore(
    localParts(now, DEFAULT_EMAIL_PREFS.timezone),
    DEFAULT_EMAIL_PREFS.weeklyEmailDow,
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

// Free a user's lots back to their groups (same path as /api/leave, but acting on
// an arbitrary user). Leaves the auth account intact.
app.post('/api/admin/users/:id/remove-assignments', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const res = await allocator(c.env).fetch('https://allocator/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: id }),
  });
  return new Response(res.body, res);
});

// Promote a user to admin (role 'admin') or revoke it (role 'user'). Proxies the
// better-auth admin plugin's set-role endpoint, which writes the `role` column on the
// auth user row. apps/login's customSession then treats role 'admin' as isAdmin on the
// next session, so the grant takes effect without touching ADMIN_USER_IDS.
app.post('/api/admin/users/:id/set-role', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const { role } = (await c.req.json().catch(() => ({}))) as { role?: unknown };
  if (role !== 'admin' && role !== 'user') {
    return c.json({ error: 'role must be admin or user' }, 400);
  }
  const res = await adminAuthFetch(c, 'set-role', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: id, role }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('set-role failed', res.status, detail);
    return c.json({ error: 'failed to set role', status: res.status, detail }, 502);
  }
  return c.json({ role });
});

// Turn a user's *scheduled* emails on or off on their behalf — either flag, or both in
// one call; an omitted flag is left alone. This writes the very row PUT/GET
// /api/me/preferences owns, so the user sees the change in Settings and can undo it
// there, and selectDue skips them on the next bulk run. Only the named columns are
// touched on conflict, so their timezone and send weekdays survive. (Admin "send now"
// deliberately ignores these flags: it's a manual one-off, not the schedule.)
app.post('/api/admin/users/:id/set-email-prefs', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const { weeklyEnabled, reminderEnabled } = (await c.req
    .json()
    .catch(() => ({}))) as {
    weeklyEnabled?: unknown;
    reminderEnabled?: unknown;
  };
  if (
    (weeklyEnabled !== undefined && typeof weeklyEnabled !== 'boolean') ||
    (reminderEnabled !== undefined && typeof reminderEnabled !== 'boolean')
  ) {
    return c.json({ error: 'weeklyEnabled/reminderEnabled must be booleans' }, 400);
  }
  if (weeklyEnabled === undefined && reminderEnabled === undefined) {
    return c.json({ error: 'weeklyEnabled or reminderEnabled is required' }, 400);
  }
  // Column names come from this fixed pair, never from the body.
  const columns: string[] = [];
  if (weeklyEnabled !== undefined) columns.push('weekly_enabled');
  if (reminderEnabled !== undefined) columns.push('reminder_enabled');
  const setClause = columns.map((col) => `${col} = excluded.${col}`).join(',\n       ');

  await c.env.DB.prepare(
    `INSERT INTO user_email_prefs
       (user_id, timezone, weekly_email_dow, reminder_email_dow, weekly_enabled, reminder_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       ${setClause},
       updated_at = excluded.updated_at`,
  )
    .bind(
      id,
      DEFAULT_EMAIL_PREFS.timezone,
      DEFAULT_EMAIL_PREFS.weeklyEmailDow,
      DEFAULT_EMAIL_PREFS.reminderEmailDow,
      (weeklyEnabled ?? DEFAULT_EMAIL_PREFS.weeklyEnabled) ? 1 : 0,
      (reminderEnabled ?? DEFAULT_EMAIL_PREFS.reminderEnabled) ? 1 : 0,
      Date.now(),
    )
    .run();

  const prefs = rowToPrefs(await loadPrefs(c.env, id));
  return c.json({
    weeklyEnabled: prefs.weeklyEnabled,
    reminderEnabled: prefs.reminderEnabled,
  });
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
    await processJobs(prepared ? [prepared] : [], senderDeps(env));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('send email now failed', kind, userId, '—', detail);
    return Response.json({ error: 'email send failed', detail }, { status: 502 });
  }
  return Response.json({ sent: true, kind, weekStart });
}

// Re-send the better-auth verification email for a pending user. Looks up the
// address via the admin get-user proxy, then hits better-auth's public
// send-verification-email endpoint (which runs apps/login's Resend callback).
app.post('/api/admin/users/:id/send-verification', requireAdmin, async (c) => {
  const id = c.req.param('id');

  const userRes = await adminAuthFetch(c, `get-user?id=${encodeURIComponent(id)}`);
  if (!userRes.ok) return c.json({ error: 'user not found' }, 404);
  const user = (await userRes.json()) as {
    email?: string;
    emailVerified?: boolean;
  };
  if (!user.email) return c.json({ error: 'user has no email' }, 404);
  if (user.emailVerified) return c.json({ error: 'already verified' }, 409);

  // send-verification-email is NOT under /admin/*, so call it directly (not via
  // adminAuthFetch). It needs no session but better-auth still enforces the
  // trusted-Origin CSRF check on POST — forward the caller's Origin like
  // adminAuthFetch does.
  const origin = c.req.header('origin');
  const res = await c.env.AUTH.fetch(
    'https://login/api/auth/send-verification-email',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify({ email: user.email, callbackURL: '/' }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('send-verification-email failed', res.status, detail);
    return c.json({ error: 'failed to send verification email' }, 502);
  }
  return c.json({ sent: true });
});

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
    c,
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

// -- admin: about page editor -----------------------------------------------
// Back the Angular /admin/about editor. Read/commit the www site's about.md via the
// GitHub Contents API (see about.ts), and upload editor images to R2. Repo coords
// come from wrangler.toml [vars]; GITHUB_TOKEN + the ABOUT_BUCKET R2 binding are
// provisioned separately. Missing config fails loudly (500) rather than silently.

/**
 * Resolves the `?locale=` query param to a supported About locale, defaulting to `'en'`.
 * Returns `null` for an unknown value so the route can answer `400`.
 */
function aboutLocale(c: Context<AppEnv>): AboutLocale | null {
  const raw = c.req.query('locale');
  if (raw === undefined || raw === 'en') return 'en';
  if (raw === 'he') return 'he';
  return null;
}

/** Maps an about.ts failure to a response: 500 for missing config, 502 for GitHub. */
function aboutError(
  c: Context<AppEnv>,
  err: unknown,
): Response {
  if (err instanceof AboutConfigError) {
    return c.json({ error: err.message }, 500);
  }
  console.error('about endpoint failed', err);
  return c.json(
    {
      error: 'about request failed',
      detail: err instanceof Error ? err.message : String(err),
    },
    502,
  );
}

// Current Markdown of the about page for `?locale=en|he` (empty string if not committed
// yet). Defaults to English; an unknown locale is a 400.
app.get('/api/admin/about', requireAdmin, async (c) => {
  const locale = aboutLocale(c);
  if (!locale) {
    return c.json({ error: 'unknown locale' }, 400);
  }
  try {
    const markdown = await readAbout(c.env, locale);
    return c.json({ markdown });
  } catch (err) {
    return aboutError(c, err);
  }
});

// Commit new Markdown for the about page of `?locale=en|he` (triggers the www rebuild on
// push to main). Defaults to English; an unknown locale is a 400.
app.post('/api/admin/about', requireAdmin, async (c) => {
  const locale = aboutLocale(c);
  if (!locale) {
    return c.json({ error: 'unknown locale' }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as { markdown?: unknown };
  if (typeof body.markdown !== 'string') {
    return c.json({ error: 'markdown is required' }, 400);
  }
  try {
    await writeAbout(c.env, locale, body.markdown);
    return c.json({ ok: true });
  } catch (err) {
    return aboutError(c, err);
  }
});

// Upload an editor image to R2; returns its public URL. Images never enter the repo.
app.post('/api/admin/about/image', requireAdmin, async (c) => {
  if (!c.env.ABOUT_BUCKET) {
    return c.json(
      {
        error:
          'image upload is not configured: the ABOUT_BUCKET R2 binding is missing. ' +
          'Provision the bucket and uncomment the [[r2_buckets]] block in apps/server/wrangler.toml.',
      },
      500,
    );
  }
  const base = c.env.R2_PUBLIC_BASE_URL;
  if (!base) {
    return c.json(
      {
        error:
          'image upload is not configured: R2_PUBLIC_BASE_URL is not set in apps/server/wrangler.toml [vars].',
      },
      500,
    );
  }
  if (!c.req.raw.body) {
    return c.json({ error: 'request body is empty' }, 400);
  }

  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  const key = `about/${crypto.randomUUID()}-${safeFilename(c.req.header('x-filename'))}`;
  await c.env.ABOUT_BUCKET.put(key, c.req.raw.body, {
    httpMetadata: { contentType },
  });
  return c.json({ url: `${base.replace(/\/+$/, '')}/${key}` });
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
