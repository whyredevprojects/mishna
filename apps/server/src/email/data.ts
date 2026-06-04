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
}

/**
 * Every joined participant who has a usable email, merged with their preferences
 * (defaults where no prefs row exists). One query per table, joined in memory.
 */
export async function loadRecipients(env: Env): Promise<Recipient[]> {
  const [participants, prefs, users] = await Promise.all([
    env.DB.prepare('SELECT user_id FROM participants').all<ParticipantRow>(),
    env.DB
      .prepare(
        `SELECT user_id, timezone, weekly_email_dow, reminder_email_dow,
                weekly_enabled, reminder_enabled FROM user_email_prefs`,
      )
      .all<PrefsRow>(),
    env.AUTH_DB.prepare('SELECT id, email, name FROM "user"').all<UserRow>(),
  ]);

  const prefsByUser = new Map(prefs.results.map((p) => [p.user_id, p]));
  const userById = new Map(users.results.map((u) => [u.id, u]));

  const recipients: Recipient[] = [];
  for (const { user_id } of participants.results) {
    const user = userById.get(user_id);
    if (!user?.email) continue; // no address to send to
    recipients.push(buildRecipient(user_id, user, prefsByUser.get(user_id)));
  }
  return recipients;
}

/** One recipient by id (for admin "send now" jobs), or null if unsendable. */
export async function loadRecipient(
  env: Env,
  userId: string,
): Promise<Recipient | null> {
  const [user, prefs] = await Promise.all([
    env.AUTH_DB.prepare('SELECT id, email, name FROM "user" WHERE id = ?')
      .bind(userId)
      .first<UserRow>(),
    env.DB.prepare(
      `SELECT user_id, timezone, weekly_email_dow, reminder_email_dow,
              weekly_enabled, reminder_enabled FROM user_email_prefs WHERE user_id = ?`,
    )
      .bind(userId)
      .first<PrefsRow>(),
  ]);
  if (!user?.email) return null;
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
  return results.flatMap(
    (r) => Group.fromState(structure, idGen, JSON.parse(r.state)).toState().blocks,
  );
}

/** `mesechta|perek|mishna` identity, matching the server's completions key. */
function refKey(ref: MishnaRef): string {
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

/** Whether an email of this kind for this week was already sent to the user. */
export async function alreadySent(
  env: Env,
  userId: string,
  kind: string,
  weekStart: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 FROM email_log WHERE user_id = ? AND kind = ? AND week_start = ?',
  )
    .bind(userId, kind, weekStart)
    .first();
  return row !== null;
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
