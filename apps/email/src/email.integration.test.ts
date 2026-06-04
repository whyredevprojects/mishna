import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, createMishnaStructure } from '@mishna/domain';
import { loadBlocks } from './data';
import { planSends } from './orchestrator';
import { OutgoingEmail, processJobs } from './sender';

const structure = createMishnaStructure();
const idGen = () => crypto.randomUUID();

// NY (EDT, UTC-4) on this instant is Wednesday 2026-06-03 08:00. dow=3 (Wed).
const NOW_NY_WED_8AM = new Date('2026-06-03T12:00:00Z');

async function createTables(): Promise<void> {
  // Subset of the mishna-app schema the email worker reads (server owns the real
  // migrations; recreated here so the test DB stands alone).
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS participants (user_id TEXT PRIMARY KEY, commitment INTEGER NOT NULL, joined_at INTEGER NOT NULL)',
  );
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS user_email_prefs (user_id TEXT PRIMARY KEY, timezone TEXT NOT NULL, weekly_email_dow INTEGER NOT NULL, reminder_email_dow INTEGER NOT NULL, weekly_enabled INTEGER NOT NULL, reminder_enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  );
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS completions (user_id TEXT NOT NULL, group_id TEXT NOT NULL, mesechta TEXT NOT NULL, perek INTEGER NOT NULL, mishna INTEGER NOT NULL, completed_at INTEGER NOT NULL, PRIMARY KEY (user_id, group_id, mesechta, perek, mishna))',
  );
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, state TEXT NOT NULL, exhausted INTEGER NOT NULL DEFAULT 0, capacity_left INTEGER NOT NULL, updated_at INTEGER)',
  );
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS group_members (group_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (group_id, user_id))',
  );
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS email_log (user_id TEXT NOT NULL, kind TEXT NOT NULL, week_start TEXT NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (user_id, kind, week_start))',
  );
  await env.AUTH_DB.exec(
    'CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT)',
  );
}

async function seedParticipant(opts: {
  userId: string;
  email?: string | null;
  timezone?: string;
  weeklyDow?: number;
  reminderDow?: number;
  weeklyEnabled?: number;
  reminderEnabled?: number;
}): Promise<void> {
  const {
    userId,
    email = `${userId}@example.com`,
    timezone = 'America/New_York',
    weeklyDow = 0,
    reminderDow = 4,
    weeklyEnabled = 1,
    reminderEnabled = 1,
  } = opts;
  await env.DB.prepare(
    'INSERT INTO participants (user_id, commitment, joined_at) VALUES (?, 1, 0)',
  )
    .bind(userId)
    .run();
  await env.DB.prepare(
    'INSERT INTO user_email_prefs (user_id, timezone, weekly_email_dow, reminder_email_dow, weekly_enabled, reminder_enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0)',
  )
    .bind(userId, timezone, weeklyDow, reminderDow, weeklyEnabled, reminderEnabled)
    .run();
  await env.AUTH_DB.prepare('INSERT INTO "user" (id, email, name) VALUES (?, ?, ?)')
    .bind(userId, email, `${userId} name`)
    .run();
}

/** Give the user a block covering the corpus head, so a week has mishnayot. */
async function seedGroupFor(userId: string): Promise<void> {
  const group = new Group(structure, idGen, { id: `g-${userId}` });
  group.addUser(userId, 100, 1);
  const state = group.toState();
  await env.DB.prepare(
    'INSERT INTO groups (id, state, exhausted, capacity_left, updated_at) VALUES (?, ?, 0, 0, 0)',
  )
    .bind(group.id, JSON.stringify(state))
    .run();
  await env.DB.prepare(
    'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
  )
    .bind(group.id, userId)
    .run();
}

describe('email worker', () => {
  beforeAll(createTables);
  beforeEach(async () => {
    for (const t of ['participants', 'user_email_prefs', 'completions', 'groups', 'group_members', 'email_log']) {
      await env.DB.exec(`DELETE FROM ${t}`);
    }
    await env.AUTH_DB.exec('DELETE FROM "user"');
  });

  describe('planSends (orchestrator)', () => {
    it('queues a weekly email when it is 08:00 on the weekly weekday', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3, reminderDow: 5 });
      const jobs = await planSends(env, NOW_NY_WED_8AM);
      expect(jobs).toEqual([
        { userId: 'alice', kind: 'weekly', weekStart: '2026-06-03' },
      ]);
    });

    it('does nothing outside the 08:00 local hour', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3 });
      // NY 09:00.
      const jobs = await planSends(env, new Date('2026-06-03T13:00:00Z'));
      expect(jobs).toEqual([]);
    });

    it('respects the weekly_enabled flag', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3, weeklyEnabled: 0 });
      expect(await planSends(env, NOW_NY_WED_8AM)).toEqual([]);
    });

    it('skips a weekly email already logged for the week', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3 });
      await env.DB.prepare(
        'INSERT INTO email_log (user_id, kind, week_start, sent_at) VALUES (?, ?, ?, 0)',
      )
        .bind('alice', 'weekly', '2026-06-03')
        .run();
      expect(await planSends(env, NOW_NY_WED_8AM)).toEqual([]);
    });

    it('queues a reminder only when the week has unlearned mishnayot', async () => {
      // Reminder on Wed (dow 3); week anchored to Sunday weeklyDow=0 -> 2026-05-31.
      await seedParticipant({ userId: 'bob', weeklyDow: 0, reminderDow: 3 });
      await seedGroupFor('bob');
      const jobs = await planSends(env, NOW_NY_WED_8AM);
      expect(jobs).toEqual([
        { userId: 'bob', kind: 'reminder', weekStart: '2026-05-31' },
      ]);
    });

    it('skips the reminder when nothing is pending', async () => {
      await seedParticipant({ userId: 'bob', weeklyDow: 0, reminderDow: 3 });
      await seedGroupFor('bob');
      // Mark every mishna of the week learned.
      const refs = await loadBlocks(env, 'bob');
      expect(refs.length).toBeGreaterThan(0);
      const weekRefsList = (await import('./quota')).weekRefs(refs, '2026-05-31');
      for (const r of weekRefsList) {
        await env.DB.prepare(
          'INSERT INTO completions (user_id, group_id, mesechta, perek, mishna, completed_at) VALUES (?, ?, ?, ?, ?, 0)',
        )
          .bind('bob', `g-bob`, r.mesechta, r.perek, r.mishna)
          .run();
      }
      expect(await planSends(env, NOW_NY_WED_8AM)).toEqual([]);
    });
  });

  describe('processJobs (sender)', () => {
    it('builds, sends, and logs a weekly email', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3 });
      await seedGroupFor('alice');

      const sent: OutgoingEmail[][] = [];
      const resolveText = vi.fn(async (refs) =>
        refs.map((ref) => ({ ref, tractateHebrew: 'ברכות', hebrew: 'טקסט' })),
      );
      await processJobs(
        env,
        [{ userId: 'alice', kind: 'weekly', weekStart: '2026-06-03' }],
        {
          resolveText,
          send: async (emails) => {
            sent.push(emails);
          },
          from: 'test@example.com',
          appOrigin: 'https://app.test',
        },
      );

      expect(sent).toHaveLength(1);
      expect(sent[0]).toHaveLength(1);
      expect(sent[0][0].to).toBe('alice@example.com');
      expect(sent[0][0].subject).toContain('המשניות');
      expect(resolveText).toHaveBeenCalledOnce();

      const log = await env.DB.prepare(
        'SELECT kind, week_start FROM email_log WHERE user_id = ?',
      )
        .bind('alice')
        .first();
      expect(log).toMatchObject({ kind: 'weekly', week_start: '2026-06-03' });
    });

    it('does not log when there is no sendable recipient', async () => {
      // No auth user row -> unsendable.
      await processJobs(
        env,
        [{ userId: 'ghost', kind: 'weekly', weekStart: '2026-06-03' }],
        {
          resolveText: async () => [],
          send: async () => {
            throw new Error('should not send');
          },
          from: 'test@example.com',
          appOrigin: 'https://app.test',
        },
      );
      const log = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_log').first<{
        n: number;
      }>();
      expect(log?.n).toBe(0);
    });
  });
});
