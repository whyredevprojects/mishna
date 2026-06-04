import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, MishnaRef, createMishnaStructure } from '@mishna/domain';
import { applyMigrations } from '../apply-migrations';
import { loadBlocks } from './data';
import { planSends } from './orchestrator';
import { weekRefs } from './quota';
import { OutgoingEmail, PreparedEmail, processJobs } from './sender';

const structure = createMishnaStructure();
const idGen = () => crypto.randomUUID();

// NY (EDT, UTC-4) on this instant is Wednesday 2026-06-03 08:00. dow=3 (Wed).
const NOW_NY_WED_8AM = new Date('2026-06-03T12:00:00Z');

const REF: MishnaRef = { mesechta: 'Berachos', perek: 1, mishna: 1 };

const APP_TABLES = [
  'participants',
  'user_email_prefs',
  'completions',
  'groups',
  'group_members',
  'email_log',
];

async function createTables(): Promise<void> {
  // The real mishna-app schema (server owns the migrations). AUTH_DB holds only the
  // better-auth `user` table (email + name); its schema isn't in this worker's
  // migrations, so it's created here.
  await applyMigrations(env.DB);
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

/** A `SenderDeps` whose `send` records the emails + idempotency key it was given. */
function recordingDeps(sink: { emails: OutgoingEmail[][]; keys: string[] }) {
  return {
    resolveText: vi.fn(async (refs: MishnaRef[]) =>
      refs.map((ref) => ({ ref, tractateHebrew: 'ברכות', hebrew: 'טקסט' })),
    ),
    send: async (emails: OutgoingEmail[], idempotencyKey: string) => {
      sink.emails.push(emails);
      sink.keys.push(idempotencyKey);
    },
    from: 'test@example.com',
    appOrigin: 'https://app.test',
  };
}

describe('email path', () => {
  beforeAll(createTables);
  beforeEach(async () => {
    for (const t of APP_TABLES) {
      await env.DB.exec(`DELETE FROM ${t}`);
    }
    await env.AUTH_DB.exec('DELETE FROM "user"');
  });

  describe('planSends (orchestrator)', () => {
    it('queues a weekly email when it is 08:00 on the weekly weekday', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3, reminderDow: 5 });
      const jobs = await planSends(env, NOW_NY_WED_8AM);
      expect(jobs).toMatchObject([
        { userId: 'alice', kind: 'weekly', weekStart: '2026-06-03', to: 'alice@example.com' },
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

    it('skips a participant with no email address', async () => {
      await seedParticipant({ userId: 'ghost', weeklyDow: 3, email: null });
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
      expect(jobs).toMatchObject([
        { userId: 'bob', kind: 'reminder', weekStart: '2026-05-31' },
      ]);
      expect(jobs[0].refs.length).toBeGreaterThan(0);
    });

    it('skips the reminder when nothing is pending', async () => {
      await seedParticipant({ userId: 'bob', weeklyDow: 0, reminderDow: 3 });
      await seedGroupFor('bob');
      // Mark every mishna of the week learned.
      const refs = await loadBlocks(env, 'bob');
      expect(refs.length).toBeGreaterThan(0);
      const weekRefsList = weekRefs(refs, '2026-05-31');
      for (const r of weekRefsList) {
        await env.DB.prepare(
          'INSERT INTO completions (user_id, group_id, mesechta, perek, mishna, completed_at) VALUES (?, ?, ?, ?, ?, 0)',
        )
          .bind('bob', `g-bob`, r.mesechta, r.perek, r.mishna)
          .run();
      }
      expect(await planSends(env, NOW_NY_WED_8AM)).toEqual([]);
    });

    it('plans many due users from batched reads', async () => {
      // Several participants all due the same weekly email this hour: exercises the
      // set-based reads (one IN query each) rather than per-user lookups.
      for (const id of ['u1', 'u2', 'u3']) {
        await seedParticipant({ userId: id, weeklyDow: 3 });
      }
      const jobs = await planSends(env, NOW_NY_WED_8AM);
      expect(jobs.map((j) => j.userId).sort()).toEqual(['u1', 'u2', 'u3']);
      expect(jobs.every((j) => j.kind === 'weekly')).toBe(true);
    });
  });

  describe('processJobs (sender)', () => {
    it('builds, sends, and logs a weekly email', async () => {
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      const deps = recordingDeps(sink);
      const job: PreparedEmail = {
        userId: 'alice',
        kind: 'weekly',
        weekStart: '2026-06-03',
        to: 'alice@example.com',
        refs: [REF],
      };
      await processJobs(env, [job], deps);

      expect(sink.emails).toHaveLength(1);
      expect(sink.emails[0]).toHaveLength(1);
      expect(sink.emails[0][0].to).toBe('alice@example.com');
      expect(sink.emails[0][0].subject).toContain('המשניות');
      expect(deps.resolveText).toHaveBeenCalledOnce();

      const log = await env.DB.prepare(
        'SELECT kind, week_start FROM email_log WHERE user_id = ?',
      )
        .bind('alice')
        .first();
      expect(log).toMatchObject({ kind: 'weekly', week_start: '2026-06-03' });
    });

    it('passes a deterministic idempotency key, stable across retries', async () => {
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      const job: PreparedEmail = {
        userId: 'alice',
        kind: 'weekly',
        weekStart: '2026-06-03',
        to: 'alice@example.com',
        refs: [REF],
      };
      // Same batch twice (a retry) -> same key. A different batch -> different key.
      await processJobs(env, [job], recordingDeps(sink));
      await processJobs(env, [job], recordingDeps(sink));
      await processJobs(env, [{ ...job, userId: 'carol', to: 'c@e.com' }], recordingDeps(sink));

      expect(sink.keys[0]).toMatch(/^reminder-batch-/);
      expect(sink.keys[1]).toBe(sink.keys[0]);
      expect(sink.keys[2]).not.toBe(sink.keys[0]);
    });

    it('does nothing for an empty batch', async () => {
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      await processJobs(env, [], recordingDeps(sink));
      expect(sink.emails).toEqual([]);
      const log = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_log').first<{
        n: number;
      }>();
      expect(log?.n).toBe(0);
    });

    it('propagates a send failure and does not log (so the caller can retry / 502)', async () => {
      const job: PreparedEmail = {
        userId: 'alice',
        kind: 'weekly',
        weekStart: '2026-06-03',
        to: 'alice@example.com',
        refs: [REF],
      };
      await expect(
        processJobs(env, [job], {
          resolveText: async (refs) =>
            refs.map((ref) => ({ ref, tractateHebrew: 'ברכות', hebrew: 'טקסט' })),
          send: async () => {
            throw new Error('Resend batch failed: boom');
          },
          from: 'test@example.com',
          appOrigin: 'https://app.test',
        }),
      ).rejects.toThrow('boom');
      const log = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_log').first<{
        n: number;
      }>();
      expect(log?.n).toBe(0);
    });
  });
});
