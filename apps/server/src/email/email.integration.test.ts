import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssignmentEngine,
  CycleCalendar,
  Group,
  MishnaRef,
  createMishnaChalakim,
  createMishnaStructure,
} from '@mishna/domain';
import {
  memorizedExpiresAt,
  memorizedUrl,
  mintMemorizedToken,
  planSends,
  refKey,
  verifyMemorizedToken,
} from '@mishna/email-domain';
import { D1EmailRepository } from '@mishna/email-data';
import { applyMigrations } from '../apply-migrations';
import { loadBlocks, loadRecipient } from './data';
import { OutgoingEmail, PreparedEmail, processJobs } from './sender';
import { senderDeps } from './workflow';
import {
  mintUnsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from './unsubscribe';

const structure = createMishnaStructure();
const chalakim = createMishnaChalakim();
const idGen = () => crypto.randomUUID();
const engine = new AssignmentEngine(structure, new CycleCalendar());
// The D1 EmailRepository over the test bindings — the same adapter production uses.
const repo = new D1EmailRepository({
  db: env.DB,
  authDb: env.AUTH_DB,
});

// NY (EDT, UTC-4) on this instant is Wednesday 2026-06-03 08:00. dow=3 (Wed).
const NOW_NY_WED_8AM = new Date('2026-06-03T12:00:00Z');

// Blocks are scheduled from their start date; anchor the seeded block to the
// cycle start so a test week falls in range exactly as before.
const CYCLE_START = new CycleCalendar()
  .cycleStart(NOW_NY_WED_8AM)
  .toISOString()
  .slice(0, 10);

// A REAL corpus name. It used to read 'Berachos', which is not a mesechta any
// `MishnaRef` in this app can carry (the corpus uses 'Berakhot') and only passed
// because `resolveText` is stubbed here — a fixture that quietly taught the wrong
// spelling. `email/quota.spec.ts` pins the whole 63-name mapping.
const REF: MishnaRef = { mesechta: 'Berakhot', perek: 1, mishna: 1 };

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
    'CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT, "emailVerified" INTEGER NOT NULL DEFAULT 0)',
  );
}

async function seedParticipant(opts: {
  userId: string;
  email?: string | null;
  /** 1 (default) = verified; 0 = unverified (the email path must skip them). */
  emailVerified?: number;
  timezone?: string;
  weeklyDow?: number;
  reminderDow?: number;
  weeklyEnabled?: number;
  reminderEnabled?: number;
}): Promise<void> {
  const {
    userId,
    email = `${userId}@example.com`,
    emailVerified = 1,
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
    .bind(
      userId,
      timezone,
      weeklyDow,
      reminderDow,
      weeklyEnabled,
      reminderEnabled,
    )
    .run();
  await env.AUTH_DB.prepare(
    'INSERT INTO "user" (id, email, name, "emailVerified") VALUES (?, ?, ?, ?)',
  )
    .bind(userId, email, `${userId} name`, emailVerified)
    .run();
}

/** Give the user lots covering the corpus head, so a week has mishnayot. */
async function seedGroupFor(userId: string): Promise<void> {
  const group = new Group(structure, chalakim, idGen, { id: `g-${userId}` });
  // `() => 0` takes the lowest-numbered lots first, i.e. the corpus head; a
  // generous budget yields several lots so the week has mishnayot.
  group.addUser(userId, 1, CYCLE_START, 200, [], () => 0, true);
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

/**
 * Seed one group shared by several users (each gets a distinct run of lots from the
 * corpus head outward), and a `group_members` row per user. Models a production
 * multi-member group — the case that exposes per-user block filtering. Returns the
 * `Group` so a test can derive each user's *own* portion.
 */
async function seedSharedGroup(userIds: string[]): Promise<Group> {
  const group = new Group(structure, chalakim, idGen, { id: 'g-shared' });
  const taken: number[] = [];
  for (const userId of userIds) {
    const after = taken.length ? taken[taken.length - 1] : undefined;
    // `() => 0` takes the lowest free lot; `taken`/`after` give each user a distinct run.
    const { lots } = group.addUser(
      userId,
      1,
      CYCLE_START,
      50,
      taken,
      () => 0,
      true,
      after,
    );
    taken.push(...lots);
  }
  await env.DB.prepare(
    'INSERT INTO groups (id, state, exhausted, capacity_left, updated_at) VALUES (?, ?, 0, 0, 0)',
  )
    .bind(group.id, JSON.stringify(group.toState()))
    .run();
  for (const userId of userIds) {
    await env.DB.prepare(
      'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
    )
      .bind(group.id, userId)
      .run();
  }
  return group;
}

const TEST_SECRET = 'test-unsubscribe-secret';

/** The production wiring of `unsubscribeUrlFor`, over a fixed test secret. */
const unsubscribeUrlFor = (userId: string) =>
  mintUnsubscribeToken(TEST_SECRET, userId, 'all').then((t) =>
    unsubscribeUrl('https://app.test', t),
  );

const TEST_MEMORIZED_SECRET = 'test-memorized-secret';

/**
 * The production wiring of `memorizedUrlFor`, over a fixed test secret. Every input
 * comes from the job — no clock — which is what the byte-identity tests below prove.
 */
const memorizedUrlFor = (job: PreparedEmail) =>
  mintMemorizedToken(
    TEST_MEMORIZED_SECRET,
    job.userId,
    job.bucket,
    memorizedExpiresAt(job.weekStart),
  ).then((t) => memorizedUrl('https://app.test', t));

/** A `SenderDeps` whose `send` records the emails + idempotency key it was given. */
function recordingDeps(sink: { emails: OutgoingEmail[][]; keys: string[] }) {
  return {
    resolveText: vi.fn(async (refs: MishnaRef[]) =>
      refs.map((ref) => ({ ref, tractateHebrew: 'ברכות', hebrew: 'טקסט' })),
    ),
    unsubscribeUrlFor,
    memorizedUrlFor,
    send: async (emails: OutgoingEmail[], idempotencyKey: string) => {
      sink.emails.push(emails);
      sink.keys.push(idempotencyKey);
    },
    record: (userId: string, kind: 'weekly' | 'reminder', weekStart: string) =>
      repo.recordSent(userId, kind, weekStart),
    from: 'test@example.com',
    replyTo: 'support@example.com',
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

  describe('planSends (bulk path)', () => {
    it('queues a weekly email when it is 08:00 on the weekly weekday', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3, reminderDow: 5 });
      await seedGroupFor('alice');
      const jobs = await planSends(repo, engine, NOW_NY_WED_8AM);
      expect(jobs).toMatchObject([
        {
          userId: 'alice',
          kind: 'weekly',
          weekStart: '2026-06-03',
          to: 'alice@example.com',
        },
      ]);
      expect(jobs[0].refs.length).toBeGreaterThan(0);
    });

    it('does nothing outside the 08:00 local hour', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3 });
      // NY 09:00.
      const jobs = await planSends(
        repo,
        engine,
        new Date('2026-06-03T13:00:00Z'),
      );
      expect(jobs).toEqual([]);
    });

    it('respects the weekly_enabled flag', async () => {
      await seedParticipant({
        userId: 'alice',
        weeklyDow: 3,
        weeklyEnabled: 0,
      });
      expect(await planSends(repo, engine, NOW_NY_WED_8AM)).toEqual([]);
    });

    // 🔴 The verified-only guarantee (`loadEmails`' `WHERE "emailVerified" = 1`).
    // These three go together and the group seeding is the point: without
    // `seedGroupFor` the user has no blocks, so `prepareSingle` would drop them for
    // having nothing to send and the assertion would pass no matter what the address
    // filter did. The control proves the *only* difference is the address itself.
    it('queues a verified participant with mishnayot (control for the two below)', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3 });
      await seedGroupFor('alice');
      expect(await planSends(repo, engine, NOW_NY_WED_8AM)).toMatchObject([
        { userId: 'alice', kind: 'weekly' },
      ]);
    });

    it('skips a participant with no email address', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3, email: null });
      await seedGroupFor('alice');
      expect(await planSends(repo, engine, NOW_NY_WED_8AM)).toEqual([]);
    });

    it('skips a participant whose email is not verified', async () => {
      // Dropping `WHERE "emailVerified" = 1` from loadEmails means the hourly cron
      // mails every unverified signup — the population most likely to mark it spam.
      await seedParticipant({
        userId: 'alice',
        weeklyDow: 3,
        emailVerified: 0,
      });
      await seedGroupFor('alice');
      expect(await planSends(repo, engine, NOW_NY_WED_8AM)).toEqual([]);
    });

    it('skips a weekly email already logged for the week', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3 });
      await seedGroupFor('alice');
      await env.DB.prepare(
        'INSERT INTO email_log (user_id, kind, week_start, sent_at) VALUES (?, ?, ?, 0)',
      )
        .bind('alice', 'weekly', '2026-06-03')
        .run();
      expect(await planSends(repo, engine, NOW_NY_WED_8AM)).toEqual([]);
    });

    it('queues a reminder only when the week has unlearned mishnayot', async () => {
      // Reminder on Wed (dow 3); week anchored to Sunday weeklyDow=0 -> 2026-05-31.
      await seedParticipant({ userId: 'bob', weeklyDow: 0, reminderDow: 3 });
      await seedGroupFor('bob');
      const jobs = await planSends(repo, engine, NOW_NY_WED_8AM);
      expect(jobs).toMatchObject([
        { userId: 'bob', kind: 'reminder', weekStart: '2026-05-31' },
      ]);
      expect(jobs[0].refs.length).toBeGreaterThan(0);
    });

    it('skips the reminder once the whole portion is learned', async () => {
      await seedParticipant({ userId: 'bob', weeklyDow: 0, reminderDow: 3 });
      await seedGroupFor('bob');
      // Mark the user's entire portion learned, so there is no next unlearned bucket.
      const blocks = await loadBlocks(env, 'bob');
      const allRefs = blocks.flatMap((b) =>
        b.ranges.flatMap((r) => [...structure.iterateRange(r)]),
      );
      expect(allRefs.length).toBeGreaterThan(0);
      for (const r of allRefs) {
        await env.DB.prepare(
          'INSERT INTO completions (user_id, group_id, mesechta, perek, mishna, completed_at) VALUES (?, ?, ?, ?, ?, 0)',
        )
          .bind('bob', `g-bob`, r.mesechta, r.perek, r.mishna)
          .run();
      }
      expect(await planSends(repo, engine, NOW_NY_WED_8AM)).toEqual([]);
    });

    it('plans many due users from batched reads', async () => {
      // Several participants all due the same weekly email this hour: exercises the
      // set-based reads (one IN query each) rather than per-user lookups.
      for (const id of ['u1', 'u2', 'u3']) {
        await seedParticipant({ userId: id, weeklyDow: 3 });
        await seedGroupFor(id);
      }
      const jobs = await planSends(repo, engine, NOW_NY_WED_8AM);
      expect(jobs.map((j) => j.userId).sort()).toEqual(['u1', 'u2', 'u3']);
      expect(jobs.every((j) => j.kind === 'weekly')).toBe(true);
    });
  });

  describe('per-user block filtering (multi-member group)', () => {
    // A group's state carries every member's blocks; the loaders must return only
    // the target user's. (With single-member groups this is invisible — that's why
    // the bug slipped through: the email path was assigning each user the *whole
    // group's* portion, so the weekly email showed ~40 mishnayos, some not theirs.)
    it("repo.loadBlocks returns only each user's own blocks", async () => {
      await seedSharedGroup(['alice', 'bob']);
      const byUser = await repo.loadBlocks(['alice', 'bob']);
      for (const userId of ['alice', 'bob']) {
        const blocks = byUser.get(userId) ?? [];
        expect(blocks.length).toBeGreaterThan(0);
        expect(blocks.every((b) => b.userId === userId)).toBe(true);
      }
    });

    it("loadBlocks returns only the given user's blocks", async () => {
      await seedSharedGroup(['alice', 'bob']);
      const blocks = await loadBlocks(env, 'bob');
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks.every((b) => b.userId === 'bob')).toBe(true);
    });

    it('emails each user only their own mishnayos, not the whole group', async () => {
      await seedParticipant({ userId: 'alice', weeklyDow: 3 });
      await seedParticipant({ userId: 'bob', weeklyDow: 3 });
      const group = await seedSharedGroup(['alice', 'bob']);
      const ownRefs = (userId: string) =>
        new Set(
          group
            .toState()
            .blocks.filter((b) => b.userId === userId)
            .flatMap((b) =>
              b.ranges.flatMap((r) => [...structure.iterateRange(r)]),
            )
            .map(refKey),
        );

      const jobs = await planSends(repo, engine, NOW_NY_WED_8AM);
      for (const userId of ['alice', 'bob']) {
        const job = jobs.find((j) => j.userId === userId);
        expect(job, `expected a weekly job for ${userId}`).toBeDefined();
        const mine = ownRefs(userId);
        expect(job!.refs.length).toBeGreaterThan(0);
        // Every emailed ref is within this user's own portion (not a co-member's).
        expect(job!.refs.every((r) => mine.has(refKey(r)))).toBe(true);
      }
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
        bucket: 0,
      };
      await processJobs([job], deps);

      expect(sink.emails).toHaveLength(1);
      expect(sink.emails[0]).toHaveLength(1);
      expect(sink.emails[0][0].to).toBe('alice@example.com');
      expect(sink.emails[0][0].replyTo).toBe('support@example.com');
      expect(sink.emails[0][0].subject).toContain(
        'mishnayos for the coming week',
      );
      expect(deps.resolveText).toHaveBeenCalledOnce();

      const log = await env.DB.prepare(
        'SELECT kind, week_start FROM email_log WHERE user_id = ?',
      )
        .bind('alice')
        .first();
      expect(log).toMatchObject({ kind: 'weekly', week_start: '2026-06-03' });
    });

    it('sets the RFC 8058 unsubscribe headers + footer link on both kinds', async () => {
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      const base = {
        weekStart: '2026-06-03',
        to: 'alice@example.com',
        refs: [REF],
        bucket: 0,
      };
      await processJobs(
        [
          { ...base, userId: 'alice', kind: 'weekly' },
          { ...base, userId: 'bob', kind: 'reminder', to: 'bob@example.com' },
        ],
        recordingDeps(sink),
      );

      const [weekly, reminder] = sink.emails[0];
      for (const [i, email] of [weekly, reminder].entries()) {
        const headers = email.headers ?? {};
        expect(headers['List-Unsubscribe-Post']).toBe(
          'List-Unsubscribe=One-Click',
        );
        expect(headers['List-Id']).toBe('Mishna study emails <study.app.test>');
        // RFC 5322 angle-bracket form, pointing at this worker's endpoint.
        const wrapped = headers['List-Unsubscribe'] ?? '';
        expect(wrapped).toMatch(
          /^<https:\/\/app\.test\/api\/unsubscribe\?t=.+>$/,
        );
        const url = new URL(wrapped.slice(1, -1));
        // The token round-trips to the right user (and only that user).
        const claims = await verifyUnsubscribeToken(
          TEST_SECRET,
          url.searchParams.get('t'),
        );
        expect(claims).toMatchObject({
          userId: i === 0 ? 'alice' : 'bob',
          scope: 'all',
        });
        // Gmail wants a visible in-body link too, not just the header.
        expect(email.html).toContain(url.toString().replace(/&/g, '&amp;'));
        expect(email.html).toContain('Unsubscribe');
        // ...and it must survive into the text/plain part, un-escaped and unwrapped:
        // html-to-text's default 80-column wrap would break this long base64url URL
        // across lines (toPlainText hard-sets wordwrap: false), and the footer is two
        // paragraphs so the URL lands on a line of its own instead of mid-sentence.
        expect(email.text).toContain(url.toString());
        expect(
          email.text.split('\n').some((l) => l.trim() === `Unsubscribe ${url}`),
        ).toBe(true);
        // A text part with markup in it is a broken text part.
        expect(email.text).not.toContain('<');
        // The <Preview> preheader pads with zero-width spaces/non-joiners to 150
        // chars; react-email's default plainTextSelectors skip it, and a text part
        // opening with 150 invisible characters is exactly what spam filters flag.
        expect(email.text).not.toMatch(/[\u200B\u200C]/);
      }
    });

    it('sends a plain-text alternative carrying the mishna content', async () => {
      // Resend assembles multipart/alternative when it gets html + text. The text
      // part is not a stub: it has to be the same email, readable.
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      await processJobs(
        [
          {
            userId: 'alice',
            kind: 'weekly',
            weekStart: '2026-06-03',
            to: 'alice@example.com',
            refs: [REF],
            bucket: 0,
          },
        ],
        recordingDeps(sink),
      );

      const { text } = sink.emails[0][0];
      // html-to-text upper-cases <h1>/<h2>, hence the shouty title + tractate.
      expect(text).toContain('YOUR MISHNAYOS FOR THE COMING WEEK');
      expect(text).toContain('Here are your mishnayos for the coming week');
      expect(text).toContain('BERAKHOT'); // the tractate heading
      expect(text).toContain('Perek 1, Mishna 1'); // the ref label
      expect(text).toContain('טקסט'); // the Hebrew body survives verbatim
      expect(text).toContain('https://app.test/dashboard'); // the CTA's URL
    });

    it('passes a deterministic idempotency key, stable across retries', async () => {
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      const job: PreparedEmail = {
        userId: 'alice',
        kind: 'weekly',
        weekStart: '2026-06-03',
        to: 'alice@example.com',
        refs: [REF],
        bucket: 0,
      };
      // Same batch twice (a retry) -> same key. A different batch -> different key.
      await processJobs([job], recordingDeps(sink));
      await processJobs([job], recordingDeps(sink));
      await processJobs(
        [{ ...job, userId: 'carol', to: 'c@e.com' }],
        recordingDeps(sink),
      );

      expect(sink.keys[0]).toMatch(/^reminder-batch-/);
      expect(sink.keys[1]).toBe(sink.keys[0]);
      expect(sink.keys[2]).not.toBe(sink.keys[0]);
      // The key is only half the deal: Resend answers a reused key carrying a
      // *different* payload with 409 invalid_idempotent_request, which would fail the
      // retried step and take the rest of the hour's batches down with it. So the
      // re-render must be byte-identical — no clock, no randomness, anywhere in the
      // body or headers (the unsubscribe token used to mint a timestamp here).
      expect(sink.emails[1]).toEqual(sink.emails[0]);
    });

    it('re-renders byte-identically even when the clock has moved', async () => {
      // The sharper version of the test above, and the direct proof of the one design
      // decision the "memorized" token turns on: its expiry is derived from the job's
      // `weekStart`, never from `Date.now()`. If anyone ever "improves" that to a real
      // timestamp, the body changes between a send and its retry, Resend answers the
      // reused Idempotency-Key with 409, and the whole hour's remaining batches die.
      // That failure is invisible in every other test here, because they all render
      // within the same millisecond.
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      const job: PreparedEmail = {
        userId: 'alice',
        kind: 'weekly',
        weekStart: '2026-06-03',
        to: 'alice@example.com',
        refs: [REF],
        bucket: 3,
      };
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-03T08:00:00.000Z'));
        await processJobs([job], recordingDeps(sink));
        vi.setSystemTime(new Date('2026-06-19T15:31:07.000Z'));
        await processJobs([job], recordingDeps(sink));
      } finally {
        vi.useRealTimers();
      }
      expect(sink.keys[1]).toBe(sink.keys[0]);
      expect(sink.emails[1]).toEqual(sink.emails[0]);
    });

    it('hands processJobs a memorized link whose token verifies to the job', async () => {
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      const job: PreparedEmail = {
        userId: 'alice',
        kind: 'weekly',
        weekStart: '2026-06-03',
        to: 'alice@example.com',
        refs: [REF],
        bucket: 5,
      };
      await processJobs([job], recordingDeps(sink));

      const html = sink.emails[0][0].html;
      const token = /\/api\/memorized\?t=([^"'&\s]+)/.exec(html)?.[1] ?? '';
      expect(token).not.toBe('');
      const claims = await verifyMemorizedToken(
        TEST_MEMORIZED_SECRET,
        decodeURIComponent(token),
      );
      // The link marks the bucket the email actually showed, and expires off its week.
      expect(claims).toEqual({
        userId: 'alice',
        bucket: 5,
        expiresAt: memorizedExpiresAt('2026-06-03'),
      });
    });

    it('fails closed when MEMORIZED_SECRET is missing', async () => {
      // Mirrors the UNSUBSCRIBE_SECRET case: a deploy that forgot the secret must
      // throw and retry loudly, not mail a CTA that can never verify.
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      const job: PreparedEmail = {
        userId: 'alice',
        kind: 'weekly',
        weekStart: '2026-06-03',
        to: 'alice@example.com',
        refs: [REF],
        bucket: 0,
      };
      await expect(
        processJobs([job], {
          ...recordingDeps(sink),
          memorizedUrlFor: (j: PreparedEmail) =>
            mintMemorizedToken(
              undefined,
              j.userId,
              j.bucket,
              memorizedExpiresAt(j.weekStart),
            ).then((t) => memorizedUrl('https://app.test', t)),
        }),
      ).rejects.toThrow(/MEMORIZED_SECRET/);
      expect(sink.emails).toEqual([]);
    });

    it('fails closed when UNSUBSCRIBE_SECRET is missing', async () => {
      // A deploy without the secret must throw (and retry loudly), not mail a footer
      // link and a List-Unsubscribe header that can never verify.
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      const job: PreparedEmail = {
        userId: 'alice',
        kind: 'weekly',
        weekStart: '2026-06-03',
        to: 'alice@example.com',
        refs: [REF],
        bucket: 0,
      };
      await expect(
        processJobs([job], {
          ...recordingDeps(sink),
          unsubscribeUrlFor: (userId: string) =>
            mintUnsubscribeToken(undefined, userId, 'all').then((t) =>
              unsubscribeUrl('https://app.test', t),
            ),
        }),
      ).rejects.toThrow(/UNSUBSCRIBE_SECRET/);
      expect(sink.emails).toEqual([]);
    });

    it('does nothing for an empty batch', async () => {
      const sink = { emails: [] as OutgoingEmail[][], keys: [] as string[] };
      await processJobs([], recordingDeps(sink));
      expect(sink.emails).toEqual([]);
      const log = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM email_log',
      ).first<{
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
        bucket: 0,
      };
      await expect(
        processJobs([job], {
          resolveText: async (refs) =>
            refs.map((ref) => ({
              ref,
              tractateHebrew: 'ברכות',
              hebrew: 'טקסט',
            })),
          memorizedUrlFor,
          send: async () => {
            throw new Error('Resend batch failed: boom');
          },
          record: () => Promise.resolve(),
          unsubscribeUrlFor,
          from: 'test@example.com',
          replyTo: 'support@example.com',
          appOrigin: 'https://app.test',
        }),
      ).rejects.toThrow('boom');
      const log = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM email_log',
      ).first<{
        n: number;
      }>();
      expect(log?.n).toBe(0);
    });
  });

  describe('loadRecipient (the send-now half of verified-only)', () => {
    // 🔴 The bulk path's guard is `loadEmails`' `WHERE "emailVerified" = 1`, covered
    // in planSends above. This is the *other* enforcement point — admin "send now",
    // which does its own single-user read and must refuse the same addresses. Two
    // separate predicates in two files mean two separate ways to lose the guarantee.
    it('returns the recipient for a verified address', async () => {
      await seedParticipant({ userId: 'alice' });
      await expect(loadRecipient(env, 'alice')).resolves.toMatchObject({
        userId: 'alice',
        email: 'alice@example.com',
      });
    });

    it('returns null for an unverified address', async () => {
      await seedParticipant({ userId: 'alice', emailVerified: 0 });
      await expect(loadRecipient(env, 'alice')).resolves.toBeNull();
    });

    it('returns null when there is no address at all', async () => {
      await seedParticipant({ userId: 'alice', email: null });
      await expect(loadRecipient(env, 'alice')).resolves.toBeNull();
    });

    it('returns null for a user the auth db has never heard of', async () => {
      await expect(loadRecipient(env, 'nobody')).resolves.toBeNull();
    });
  });

  describe('senderDeps (the production wiring)', () => {
    // Everything above injects its own deps, so a missing wire in senderDeps itself
    // would only ever be caught by the type checker. Resend's constructor throws
    // without an api key, so stub one in; nothing here actually sends.
    const wired = (overrides: Partial<Env> = {}) =>
      senderDeps({
        ...env,
        RESEND_API_KEY: 'test-not-a-real-key',
        ...overrides,
      } as Env);

    it('mints the signed unsubscribe URL for the right user', async () => {
      const url = new URL(await wired().unsubscribeUrlFor('alice'));
      expect(`${url.origin}${url.pathname}`).toBe(
        `${env.APP_ORIGIN}/api/unsubscribe`,
      );
      expect(
        await verifyUnsubscribeToken(
          env.UNSUBSCRIBE_SECRET,
          url.searchParams.get('t'),
        ),
      ).toEqual({ userId: 'alice', scope: 'all' });
    });

    it('throws instead of building a link with no secret to sign it', async () => {
      await expect(
        wired({ UNSUBSCRIBE_SECRET: '' }).unsubscribeUrlFor('alice'),
      ).rejects.toThrow(/UNSUBSCRIBE_SECRET/);
    });
  });
});
