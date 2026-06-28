// ---------------------------------------------------------------------------
// D1EmailRepository — the production adapter for @mishna/email-domain's
// EmailRepository port. The "actual" side: the batched D1 SQL that feeds the
// pure send decision. Reads from two D1 databases:
//   db      — mishna-app: participants, user_email_prefs, completions, groups,
//             group_members, email_log.
//   authDb  — mishna-auth: the better-auth `user` table (email only here).
// They're separate databases, so user identity is merged in memory.
//
// Decoupled from the worker `Env`: the constructor takes just the two D1 handles,
// so the lib carries no Cloudflare binding and is unit-testable with any D1 (the app
// wires `env.DB`/`env.AUTH_DB`). No domain singletons — `loadBlocks` only `JSON.parse`s
// the raw group state and hands it to `@mishna/domain`'s `blocksForUser`.
// ---------------------------------------------------------------------------

import { Block, GroupState, MishnaRef, blocksForUser } from '@mishna/domain';
import { Candidate, EmailKind, EmailRepository } from '@mishna/email-domain';

/** The collaborators a {@link D1EmailRepository} needs, injected explicitly. */
export interface D1EmailRepositoryDeps {
  /** mishna-app: the schema this server owns. */
  db: D1Database;
  /** mishna-auth: the better-auth user table (read-only). */
  authDb: D1Database;
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

/**
 * Split `items` into runs of at most `size`, so `IN (?, ?, …)` lookups stay under
 * D1's 100-bind-parameter ceiling. Callers that bind extra params alongside the
 * chunk pass a smaller size.
 */
export function chunked<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function placeholders(n: number): string {
  return new Array(n).fill('?').join(',');
}

function buildCandidate(userId: string, prefs: PrefsRow | undefined): Candidate {
  return {
    userId,
    timezone: prefs?.timezone ?? DEFAULTS.timezone,
    weeklyEmailDow: prefs?.weekly_email_dow ?? DEFAULTS.weeklyEmailDow,
    reminderEmailDow: prefs?.reminder_email_dow ?? DEFAULTS.reminderEmailDow,
    weeklyEnabled: prefs ? prefs.weekly_enabled === 1 : DEFAULTS.weeklyEnabled,
    reminderEnabled: prefs
      ? prefs.reminder_enabled === 1
      : DEFAULTS.reminderEnabled,
  };
}

export class D1EmailRepository implements EmailRepository {
  constructor(private readonly deps: D1EmailRepositoryDeps) {}

  /**
   * Every joined participant with their email preferences (defaults where no prefs
   * row exists), but *without* addresses. Two full-table queries, merged in memory —
   * cheap regardless of headcount. The planner filters these to those due at 08:00
   * local and only then resolves emails for that subset.
   */
  async loadCandidates(): Promise<Candidate[]> {
    const { db } = this.deps;
    const [participants, prefs] = await Promise.all([
      db.prepare('SELECT user_id FROM participants').all<ParticipantRow>(),
      db
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
   * The set of `${userId}|${kind}|${weekStart}` already in `email_log`, for the
   * given users, bounded to `sinceWeekStart` onward so each user matches at most
   * this week's rows; chunked to 99 ids to leave room for the `sinceWeekStart` bind.
   */
  async alreadySent(
    userIds: string[],
    sinceWeekStart: string,
  ): Promise<Set<string>> {
    const sent = new Set<string>();
    for (const chunk of chunked(userIds, 99)) {
      const { results } = await this.deps.db
        .prepare(
          `SELECT user_id, kind, week_start FROM email_log
            WHERE week_start >= ? AND user_id IN (${placeholders(chunk.length)})`,
        )
        .bind(sinceWeekStart, ...chunk)
        .all<{ user_id: string; kind: string; week_start: string }>();
      for (const r of results) sent.add(`${r.user_id}|${r.kind}|${r.week_start}`);
    }
    return sent;
  }

  /** Blocks per user across their groups, as `userId → Block[]`. Chunked. */
  async loadBlocks(userIds: string[]): Promise<Map<string, Block[]>> {
    const byUser = new Map<string, Block[]>();
    for (const chunk of chunked(userIds)) {
      const { results } = await this.deps.db
        .prepare(
          `SELECT m.user_id AS user_id, g.state AS state
             FROM groups g
             JOIN group_members m ON g.id = m.group_id
            WHERE m.user_id IN (${placeholders(chunk.length)})`,
        )
        .bind(...chunk)
        .all<{ user_id: string; state: string }>();
      for (const r of results) {
        // The group state holds every member's blocks; `blocksForUser` keeps this user's.
        const blocks = blocksForUser(
          [JSON.parse(r.state) as GroupState],
          r.user_id,
        );
        const existing = byUser.get(r.user_id);
        if (existing) existing.push(...blocks);
        else byUser.set(r.user_id, [...blocks]);
      }
    }
    return byUser;
  }

  /** Completed refs per user (distinct), as `userId → MishnaRef[]`. Chunked. */
  async loadCompleted(userIds: string[]): Promise<Map<string, MishnaRef[]>> {
    const byUser = new Map<string, MishnaRef[]>();
    for (const chunk of chunked(userIds)) {
      const { results } = await this.deps.db
        .prepare(
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

  /**
   * Verified addresses for the given users, as `userId → email` (unverified or
   * address-less users omitted). Chunked, read from `authDb`. The `emailVerified = 1`
   * filter is the email path's verified-only guard.
   */
  async loadEmails(userIds: string[]): Promise<Map<string, string>> {
    const byId = new Map<string, string>();
    for (const chunk of chunked(userIds)) {
      const { results } = await this.deps.authDb
        .prepare(
          `SELECT id, email FROM "user"
            WHERE "emailVerified" = 1 AND id IN (${placeholders(chunk.length)})`,
        )
        .bind(...chunk)
        .all<{ id: string; email: string | null }>();
      for (const r of results) if (r.email) byId.set(r.id, r.email);
    }
    return byId;
  }

  /** Record a successful send (idempotent upsert on the (user, kind, week) key). */
  async recordSent(
    userId: string,
    kind: EmailKind,
    weekStart: string,
  ): Promise<void> {
    await this.deps.db
      .prepare(
        `INSERT INTO email_log (user_id, kind, week_start, sent_at)
           VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, kind, week_start) DO UPDATE SET sent_at = excluded.sent_at`,
      )
      .bind(userId, kind, weekStart, Date.now())
      .run();
  }
}
