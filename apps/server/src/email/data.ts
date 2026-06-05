import { Block, Group, MishnaRef } from '@mishna/domain';
import { idGen, structure } from '../domain';

// ---------------------------------------------------------------------------
// Data access for the email path. Reads from two D1 databases:
//   DB       — mishna-app: participants, user_email_prefs, completions, groups,
//              group_members, email_log (the server owns the schema/migrations).
//   AUTH_DB  — mishna-auth: the better-auth `user` table (email + name only).
// They're separate databases, so user identity is merged in memory.
// ---------------------------------------------------------------------------

export interface Recipient {
  userId: string;
  email: string;
  name: string | null;
  timezone: string;
  weeklyEmailDow: number;
  reminderEmailDow: number;
  weeklyEnabled: boolean;
  reminderEnabled: boolean;
}

/**
 * A participant + their email preferences, *without* the email address. The bulk
 * email path resolves who is due from these (timezone math needs every prefs row),
 * then fetches addresses only for the due subset — so we don't load the whole
 * `AUTH_DB` user table every hour.
 */
export interface Candidate {
  userId: string;
  timezone: string;
  weeklyEmailDow: number;
  reminderEmailDow: number;
  weeklyEnabled: boolean;
  reminderEnabled: boolean;
}

/**
 * Split `items` into runs of at most `size`, so `IN (?, ?, …)` lookups stay under
 * D1's 100-bind-parameter ceiling. `size` defaults to 100; callers that bind extra
 * params alongside the chunk pass a smaller size.
 */
export function chunked<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function placeholders(n: number): string {
  return new Array(n).fill('?').join(',');
}

const DEFAULTS = {
  timezone: 'America/New_York',
  weeklyEmailDow: 0,
  reminderEmailDow: 4,
  weeklyEnabled: true,
  reminderEnabled: true,
};

interface ParticipantRow {
  user_id: string;
}
interface PrefsRow {
  user_id: string;
  timezone: string;
  weekly_email_dow: number;
  reminder_email_dow: number;
  weekly_enabled: number;
  reminder_enabled: number;
}
interface UserRow {
  id: string;
  email: string;
  name: string | null;
  emailVerified: number;
}

/**
 * Every joined participant with their email preferences (defaults where no prefs
 * row exists), but *without* addresses. Two full-table queries, merged in memory —
 * cheap regardless of headcount (a few MB of small rows). The bulk path filters
 * these to the ones due at 08:00 local and only then resolves emails for that
 * subset (`loadEmailsFor`), instead of loading the whole user table every hour.
 */
export async function loadCandidates(env: Env): Promise<Candidate[]> {
  const [participants, prefs] = await Promise.all([
    env.DB.prepare('SELECT user_id FROM participants').all<ParticipantRow>(),
    env.DB
      .prepare(
        `SELECT user_id, timezone, weekly_email_dow, reminder_email_dow,
                weekly_enabled, reminder_enabled FROM user_email_prefs`,
      )
      .all<PrefsRow>(),
  ]);

  const prefsByUser = new Map(prefs.results.map((p) => [p.user_id, p]));
  return participants.results.map(({ user_id }) =>
    buildCandidate(user_id, prefsByUser.get(user_id)),
  );
}

/**
 * Addresses for the given user ids, as `userId → email` (users with no usable
 * address, or whose email isn't verified, are omitted). Chunked under D1's
 * 100-param ceiling. Read from `AUTH_DB`. The `emailVerified = 1` filter is the
 * email path's verified-only guard: we never mail an unverified address. Google
 * sign-ins are verified automatically; password sign-ups stay unverified.
 */
export async function loadEmailsFor(
  env: Env,
  userIds: string[],
): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  for (const chunk of chunked(userIds)) {
    const { results } = await env.AUTH_DB.prepare(
      `SELECT id, email FROM "user"
        WHERE "emailVerified" = 1 AND id IN (${placeholders(chunk.length)})`,
    )
      .bind(...chunk)
      .all<{ id: string; email: string | null }>();
    for (const r of results) if (r.email) byId.set(r.id, r.email);
  }
  return byId;
}

/** One user's identity for the admin views, regardless of join/verification. */
export interface Identity {
  email: string | null;
  name: string | null;
  emailVerified: boolean;
}

/**
 * Identities (name/email/verified) for the given user ids, from `AUTH_DB`, as
 * `userId → Identity`. Unlike `loadEmailsFor` this keeps unverified users (the
 * admin needs to *see* who's unverified) and carries the flag through. Chunked.
 */
export async function loadIdentitiesFor(
  env: Env,
  userIds: string[],
): Promise<Map<string, Identity>> {
  const byId = new Map<string, Identity>();
  for (const chunk of chunked(userIds)) {
    const { results } = await env.AUTH_DB.prepare(
      `SELECT id, email, name, "emailVerified" AS emailVerified
         FROM "user" WHERE id IN (${placeholders(chunk.length)})`,
    )
      .bind(...chunk)
      .all<UserRow>();
    for (const r of results) {
      byId.set(r.id, {
        email: r.email ?? null,
        name: r.name ?? null,
        emailVerified: r.emailVerified === 1,
      });
    }
  }
  return byId;
}

/** One of a user's blocks together with the group it lives in. */
export interface GroupBlock {
  groupId: string;
  block: Block;
}

/**
 * The blocks a user holds, *tagged with their group id*, as `userId → GroupBlock[]`.
 * Like `loadBlocksFor` but keeps each block's group so callers can resolve the
 * `groupId` a given mishna belongs to (needed when acting on a completion). Chunked.
 */
export async function loadGroupBlocksFor(
  env: Env,
  userIds: string[],
): Promise<Map<string, GroupBlock[]>> {
  const byUser = new Map<string, GroupBlock[]>();
  for (const chunk of chunked(userIds)) {
    const { results } = await env.DB.prepare(
      `SELECT g.id AS group_id, m.user_id AS user_id, g.state AS state
         FROM groups g
         JOIN group_members m ON g.id = m.group_id
        WHERE m.user_id IN (${placeholders(chunk.length)})`,
    )
      .bind(...chunk)
      .all<{ group_id: string; user_id: string; state: string }>();
    for (const r of results) {
      const blocks = Group.fromState(structure, idGen, JSON.parse(r.state)).toState()
        .blocks;
      const mine = blocks
        .filter((b) => b.userId === r.user_id)
        .map((block) => ({ groupId: r.group_id, block }));
      const existing = byUser.get(r.user_id);
      if (existing) existing.push(...mine);
      else byUser.set(r.user_id, mine);
    }
  }
  return byUser;
}

/**
 * The set of `${userId}|${kind}|${weekStart}` already in `email_log`, for the given
 * users. Bounded to `sinceWeekStart` onward so each user matches at most this week's
 * rows (not their whole cycle of history); chunked to 99 ids to leave room for the
 * `sinceWeekStart` bind. Used to drop already-sent jobs in one pass.
 */
export async function alreadySentSet(
  env: Env,
  userIds: string[],
  sinceWeekStart: string,
): Promise<Set<string>> {
  const sent = new Set<string>();
  for (const chunk of chunked(userIds, 99)) {
    const { results } = await env.DB.prepare(
      `SELECT user_id, kind, week_start FROM email_log
        WHERE week_start >= ? AND user_id IN (${placeholders(chunk.length)})`,
    )
      .bind(sinceWeekStart, ...chunk)
      .all<{ user_id: string; kind: string; week_start: string }>();
    for (const r of results) sent.add(`${r.user_id}|${r.kind}|${r.week_start}`);
  }
  return sent;
}

/** Blocks per user across their groups, as `userId → Block[]`. Chunked. The batched
 *  mirror of `loadBlocks`. */
export async function loadBlocksFor(
  env: Env,
  userIds: string[],
): Promise<Map<string, Block[]>> {
  const byUser = new Map<string, Block[]>();
  for (const chunk of chunked(userIds)) {
    const { results } = await env.DB.prepare(
      `SELECT m.user_id AS user_id, g.state AS state
         FROM groups g
         JOIN group_members m ON g.id = m.group_id
        WHERE m.user_id IN (${placeholders(chunk.length)})`,
    )
      .bind(...chunk)
      .all<{ user_id: string; state: string }>();
    for (const r of results) {
      const blocks = Group.fromState(structure, idGen, JSON.parse(r.state)).toState()
        .blocks;
      const existing = byUser.get(r.user_id);
      if (existing) existing.push(...blocks);
      else byUser.set(r.user_id, [...blocks]);
    }
  }
  return byUser;
}

/** Completed `refKey`s per user, as `userId → Set<refKey>`. Chunked. The batched
 *  mirror of the completions read in `pendingRefs`. */
export async function loadCompletedFor(
  env: Env,
  userIds: string[],
): Promise<Map<string, Set<string>>> {
  const byUser = new Map<string, Set<string>>();
  for (const chunk of chunked(userIds)) {
    const { results } = await env.DB.prepare(
      `SELECT user_id, mesechta, perek, mishna FROM completions
        WHERE user_id IN (${placeholders(chunk.length)})`,
    )
      .bind(...chunk)
      .all<{ user_id: string } & MishnaRef>();
    for (const r of results) {
      let done = byUser.get(r.user_id);
      if (!done) byUser.set(r.user_id, (done = new Set()));
      done.add(refKey(r));
    }
  }
  return byUser;
}

/** One recipient by id (for admin "send now" jobs), or null if unsendable. */
export async function loadRecipient(
  env: Env,
  userId: string,
): Promise<Recipient | null> {
  const [user, prefs] = await Promise.all([
    env.AUTH_DB.prepare(
      'SELECT id, email, name, "emailVerified" AS emailVerified FROM "user" WHERE id = ?',
    )
      .bind(userId)
      .first<UserRow>(),
    env.DB.prepare(
      `SELECT user_id, timezone, weekly_email_dow, reminder_email_dow,
              weekly_enabled, reminder_enabled FROM user_email_prefs WHERE user_id = ?`,
    )
      .bind(userId)
      .first<PrefsRow>(),
  ]);
  // Verified-only, same as the bulk path: admin "send now" can't mail an
  // unverified address either.
  if (!user?.email || user.emailVerified !== 1) return null;
  return buildRecipient(userId, user, prefs ?? undefined);
}

function buildCandidate(userId: string, prefs: PrefsRow | undefined): Candidate {
  return {
    userId,
    timezone: prefs?.timezone ?? DEFAULTS.timezone,
    weeklyEmailDow: prefs?.weekly_email_dow ?? DEFAULTS.weeklyEmailDow,
    reminderEmailDow: prefs?.reminder_email_dow ?? DEFAULTS.reminderEmailDow,
    weeklyEnabled: prefs ? prefs.weekly_enabled === 1 : DEFAULTS.weeklyEnabled,
    reminderEnabled: prefs ? prefs.reminder_enabled === 1 : DEFAULTS.reminderEnabled,
  };
}

function buildRecipient(
  userId: string,
  user: UserRow,
  prefs: PrefsRow | undefined,
): Recipient {
  return {
    userId,
    email: user.email,
    name: user.name,
    timezone: prefs?.timezone ?? DEFAULTS.timezone,
    weeklyEmailDow: prefs?.weekly_email_dow ?? DEFAULTS.weeklyEmailDow,
    reminderEmailDow: prefs?.reminder_email_dow ?? DEFAULTS.reminderEmailDow,
    weeklyEnabled: prefs ? prefs.weekly_enabled === 1 : DEFAULTS.weeklyEnabled,
    reminderEnabled: prefs
      ? prefs.reminder_enabled === 1
      : DEFAULTS.reminderEnabled,
  };
}

/** All blocks a user holds across their groups, flattened. Read-only mirror of
 *  the server's D1GroupRepository.loadGroupsForUser. */
export async function loadBlocks(env: Env, userId: string): Promise<Block[]> {
  const { results } = await env.DB.prepare(
    `SELECT g.state AS state
       FROM groups g
       JOIN group_members m ON g.id = m.group_id
      WHERE m.user_id = ?`,
  )
    .bind(userId)
    .all<{ state: string }>();
  return results.flatMap(
    (r) => Group.fromState(structure, idGen, JSON.parse(r.state)).toState().blocks,
  );
}

/** `mesechta|perek|mishna` identity, matching the server's completions key. */
export function refKey(ref: MishnaRef): string {
  return `${ref.mesechta}|${ref.perek}|${ref.mishna}`;
}

/** The subset of `refs` the user has NOT yet marked learned (any group/cycle). */
export async function pendingRefs(
  env: Env,
  userId: string,
  refs: MishnaRef[],
): Promise<MishnaRef[]> {
  if (refs.length === 0) return [];
  const { results } = await env.DB.prepare(
    'SELECT DISTINCT mesechta, perek, mishna FROM completions WHERE user_id = ?',
  )
    .bind(userId)
    .all<MishnaRef>();
  const done = new Set(results.map(refKey));
  return refs.filter((ref) => !done.has(refKey(ref)));
}

/** Record a successful send (idempotent upsert on the (user, kind, week) key). */
export async function recordSent(
  env: Env,
  userId: string,
  kind: string,
  weekStart: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO email_log (user_id, kind, week_start, sent_at)
       VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, kind, week_start) DO UPDATE SET sent_at = excluded.sent_at`,
  )
    .bind(userId, kind, weekStart, Date.now())
    .run();
}
