import { Block, Group, MishnaRef } from '@mishna/domain';
import { refKey } from '@mishna/email-domain';
import { chalakim, idGen, structure } from '../domain';

// ---------------------------------------------------------------------------
// Data access for the admin views and the admin "send now" path. Reads from two
// D1 databases:
//   DB       — mishna-app: participants, user_email_prefs, completions, groups,
//              group_members, email_log (the server owns the schema/migrations).
//   AUTH_DB  — mishna-auth: the better-auth `user` table (email + name only).
// They're separate databases, so user identity is merged in memory.
//
// The *bulk* email path's batched readers (the EmailRepository port + its D1
// implementation) live in `@mishna/email-data`; this file keeps the single-user
// send-now loaders and the admin-only batched readers that aren't part of the port.
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
 * Split `items` into runs of at most `size`, so `IN (?, ?, …)` lookups stay under
 * D1's 100-bind-parameter ceiling. `size` defaults to 100; callers that bind extra
 * params alongside the chunk pass a smaller size.
 */
export function chunked<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
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

/** One user's identity for the admin views, regardless of join/verification. */
export interface Identity {
  email: string | null;
  name: string | null;
  emailVerified: boolean;
}

/**
 * Identities (name/email/verified) for the given user ids, from `AUTH_DB`, as
 * `userId → Identity`. Keeps unverified users (the admin needs to *see* who's
 * unverified) and carries the flag through. Chunked.
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
 * Keeps each block's group so callers can resolve the `groupId` a given mishna
 * belongs to (needed when acting on a completion). Chunked.
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
      const blocks = Group.fromState(
        structure,
        chalakim,
        idGen,
        JSON.parse(r.state),
      ).toState().blocks;
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
 * rows; chunked to 99 ids to leave room for the `sinceWeekStart` bind. Used by the
 * admin assignments view's per-user `emailSent` flag.
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

/** Completed refs per user, as `userId → MishnaRef[]`. Chunked. */
export async function loadCompletedRefsFor(
  env: Env,
  userIds: string[],
): Promise<Map<string, MishnaRef[]>> {
  const byUser = new Map<string, MishnaRef[]>();
  for (const chunk of chunked(userIds)) {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT user_id, mesechta, perek, mishna FROM completions
        WHERE user_id IN (${placeholders(chunk.length)})`,
    )
      .bind(...chunk)
      .all<{ user_id: string } & MishnaRef>();
    for (const r of results) {
      const ref = { mesechta: r.mesechta, perek: r.perek, mishna: r.mishna };
      const list = byUser.get(r.user_id);
      if (list) list.push(ref);
      else byUser.set(r.user_id, [ref]);
    }
  }
  return byUser;
}

/** Completed `refKey`s per user, as `userId → Set<refKey>`. Derived from
 *  `loadCompletedRefsFor`; the admin assignments view's per-mishna done flags. */
export async function loadCompletedFor(
  env: Env,
  userIds: string[],
): Promise<Map<string, Set<string>>> {
  const byUser = await loadCompletedRefsFor(env, userIds);
  return new Map(
    [...byUser].map(([uid, refs]) => [uid, new Set(refs.map(refKey))]),
  );
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
  return results.flatMap((r) =>
    // The group state holds every member's blocks; keep only this user's.
    Group.fromState(structure, chalakim, idGen, JSON.parse(r.state))
      .toState()
      .blocks.filter((b) => b.userId === userId),
  );
}

/** Every mishna the user has marked learned (distinct, any group/cycle). The
 *  single-user mirror of `loadCompletedRefsFor`, for the admin "send now" path. */
export async function loadCompleted(
  env: Env,
  userId: string,
): Promise<MishnaRef[]> {
  const { results } = await env.DB.prepare(
    'SELECT DISTINCT mesechta, perek, mishna FROM completions WHERE user_id = ?',
  )
    .bind(userId)
    .all<MishnaRef>();
  return results;
}
