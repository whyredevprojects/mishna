import {
  AssignmentEngine,
  Block,
  Commitment,
  CycleCalendar,
  MishnaRef,
  MishnaStructure,
  createMishnaStructure,
} from '@mishna/domain';
import { prepareSingle } from './content';
import { EmailRepository, InMemoryEmailRepository } from './email-repository';
import {
  buildPreparedEmails,
  dropAlreadySent,
  planSends,
  refKey,
  refsForKind,
  selectDue,
  sentKey,
} from './plan-sends';
import { Candidate } from './types';

// ---------------------------------------------------------------------------
// Test support — replicated from @mishna/domain's test-fixtures (not exported
// from its public barrel). A date-aware CycleCalendar stub and a Block builder
// over the real corpus, so bucket math is deterministic and hand-checkable.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const CYCLE_START = new Date(Date.UTC(2026, 0, 1));

/** A CycleCalendar fixed at `CYCLE_START` with a 28-day cycle (4 weeks left). */
function fakeCalendar(cycleLengthDays = 28): CycleCalendar {
  const end = new Date(CYCLE_START.getTime() + cycleLengthDays * DAY_MS);
  const daysSince = (d: Date) =>
    Math.floor((d.getTime() - CYCLE_START.getTime()) / DAY_MS);
  const daysLeft = (d: Date) =>
    Math.floor((end.getTime() - d.getTime()) / DAY_MS);
  return {
    cycleStart: () => CYCLE_START,
    cycleEnd: () => end,
    daysSinceCycleStart: daysSince,
    daysRemaining: daysLeft,
    weeksSinceCycleStart: (d: Date) => Math.floor(daysSince(d) / 7),
    weeksRemaining: (d: Date) => Math.ceil(daysLeft(d) / 7),
  } as unknown as CycleCalendar;
}

/** A Block over global corpus indices [a..b] pairs, scheduled from `startDate`. */
function makeBlock(
  structure: MishnaStructure,
  userId: string,
  pairs: [number, number][],
  commitment: Commitment = 2,
  startDate = '2026-01-01',
): Block {
  const ranges = pairs.map(([a, b]) => ({
    start: structure.refAt(a),
    end: structure.refAt(b),
  }));
  const totalSize = pairs.reduce((sum, [a, b]) => sum + (b - a + 1), 0);
  return {
    id: `block-${userId}`,
    userId,
    lots: [],
    ranges,
    totalSize,
    commitment,
    startDate,
  };
}

const structure = createMishnaStructure();
// 4 weeks remaining + an 8-mishna block → pace = ceil(8/4) = 2: four buckets of
// two, [0,1] [2,3] [4,5] [6,7].
const engine = new AssignmentEngine(structure, fakeCalendar());
const ref = (i: number): MishnaRef => structure.refAt(i);
const eightMishnaBlock = (userId: string) =>
  makeBlock(structure, userId, [[0, 7]]);

// 08:00 in New York in January is 13:00 UTC (EST = UTC-5).
const SUNDAY_8AM_NY = new Date('2026-01-04T13:00:00Z'); // 2026-01-04 is a Sunday
const THURSDAY_8AM_NY = new Date('2026-01-08T13:00:00Z'); // 2026-01-08 is a Thursday
const SUNDAY_9AM_NY = new Date('2026-01-04T14:00:00Z');

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    userId: 'u1',
    timezone: 'America/New_York',
    weeklyEmailDow: 0, // Sunday
    reminderEmailDow: 4, // Thursday
    weeklyEnabled: true,
    reminderEnabled: true,
    ...over,
  };
}

describe('selectDue', () => {
  it('fires the weekly email at 08:00 local on the weekly weekday', () => {
    const due = selectDue([candidate()], SUNDAY_8AM_NY);
    expect(due).toEqual([
      { userId: 'u1', kind: 'weekly', weekStart: '2026-01-04' },
    ]);
  });

  it('fires the reminder at 08:00 local on the reminder weekday, anchored to the weekly week', () => {
    const due = selectDue([candidate()], THURSDAY_8AM_NY);
    // weekStart anchors to the weekly weekday (Sunday) on/before Thursday Jan 8.
    expect(due).toEqual([
      { userId: 'u1', kind: 'reminder', weekStart: '2026-01-04' },
    ]);
  });

  it('fires nothing outside the send hour', () => {
    expect(selectDue([candidate()], SUNDAY_9AM_NY)).toEqual([]);
  });

  it('respects the per-kind enabled flags', () => {
    expect(
      selectDue([candidate({ weeklyEnabled: false })], SUNDAY_8AM_NY),
    ).toEqual([]);
    expect(
      selectDue([candidate({ reminderEnabled: false })], THURSDAY_8AM_NY),
    ).toEqual([]);
  });

  it('only fires for the timezone that is at 08:00 right now', () => {
    // At 13:00 UTC, NY is 08:00 (fires) but Los Angeles is 05:00 (does not).
    const due = selectDue(
      [
        candidate({ userId: 'ny', timezone: 'America/New_York' }),
        candidate({ userId: 'la', timezone: 'America/Los_Angeles' }),
      ],
      SUNDAY_8AM_NY,
    );
    expect(due.map((d) => d.userId)).toEqual(['ny']);
  });

  it('emits both kinds when the weekly and reminder weekdays coincide', () => {
    const due = selectDue([candidate({ reminderEmailDow: 0 })], SUNDAY_8AM_NY);
    expect(due.map((d) => d.kind).sort()).toEqual(['reminder', 'weekly']);
  });
});

describe('dropAlreadySent', () => {
  it('drops candidacies whose (user, kind, week) is in the sent set', () => {
    const due = selectDue(
      [candidate({ userId: 'fresh' }), candidate({ userId: 'done' })],
      SUNDAY_8AM_NY,
    );
    const sent = new Set([sentKey('done', 'weekly', '2026-01-04')]);
    expect(dropAlreadySent(due, sent).map((d) => d.userId)).toEqual(['fresh']);
  });
});

describe('refsForKind', () => {
  const next = [ref(0), ref(1), ref(2)];

  it('weekly returns the whole bucket unfiltered', () => {
    expect(refsForKind('weekly', next, [ref(0)])).toEqual(next);
  });

  it('reminder drops the already-completed mishnayot', () => {
    expect(refsForKind('reminder', next, [ref(1)]).map(refKey)).toEqual(
      [ref(0), ref(2)].map(refKey),
    );
  });

  it('reminder with nothing completed keeps the whole bucket', () => {
    expect(refsForKind('reminder', next, [])).toEqual(next);
  });
});

describe('buildPreparedEmails', () => {
  const live = [
    { userId: 'u1', kind: 'weekly' as const, weekStart: '2026-01-04' },
  ];
  const reminderLive = [
    { userId: 'u1', kind: 'reminder' as const, weekStart: '2026-01-04' },
  ];

  function data(
    over: {
      completed?: MishnaRef[];
      email?: string | null;
      blocks?: Block[];
    } = {},
  ) {
    return {
      blocksByUser: new Map([['u1', over.blocks ?? [eightMishnaBlock('u1')]]]),
      completedByUser: new Map([['u1', over.completed ?? []]]),
      emailByUser:
        over.email === null
          ? new Map<string, string>()
          : new Map([['u1', over.email ?? 'u1@example.com']]),
    };
  }

  it('weekly shows the whole next-unlearned bucket', () => {
    const [email] = buildPreparedEmails(live, data(), engine, SUNDAY_8AM_NY);
    expect(email.refs.map(refKey)).toEqual([ref(0), ref(1)].map(refKey));
    expect(email.to).toBe('u1@example.com');
  });

  it('reminder shows only the still-unlearned mishnayot of the bucket', () => {
    const out = buildPreparedEmails(
      reminderLive,
      data({ completed: [ref(0)] }),
      engine,
      SUNDAY_8AM_NY,
    );
    expect(out[0].refs.map(refKey)).toEqual([ref(1)].map(refKey));
  });

  it('advances to the next bucket once the current one is fully learned', () => {
    const [email] = buildPreparedEmails(
      live,
      data({ completed: [ref(0), ref(1)] }),
      engine,
      SUNDAY_8AM_NY,
    );
    expect(email.refs.map(refKey)).toEqual([ref(2), ref(3)].map(refKey));
  });

  it('skips a user with no resolved address', () => {
    expect(
      buildPreparedEmails(live, data({ email: null }), engine, SUNDAY_8AM_NY),
    ).toEqual([]);
  });

  it('skips a user who has learned their whole portion (empty bucket)', () => {
    const allDone = [0, 1, 2, 3, 4, 5, 6, 7].map(ref);
    expect(
      buildPreparedEmails(
        live,
        data({ completed: allDone }),
        engine,
        SUNDAY_8AM_NY,
      ),
    ).toEqual([]);
  });

  // -- the pinned bucket ------------------------------------------------------
  //
  // Every scheduled email carries a signed link that marks "these mishnayos" learned,
  // and what it carries is this index — not a ref list. Three things have to hold for
  // that to be safe, and each has a test below.

  describe('the bucket pinned onto the job', () => {
    it('records the index the refs were sliced from', () => {
      const [email] = buildPreparedEmails(live, data(), engine, SUNDAY_8AM_NY);
      expect(email.bucket).toBe(0);
      const later = buildPreparedEmails(
        live,
        data({ completed: [ref(0), ref(1)] }),
        engine,
        SUNDAY_8AM_NY,
      );
      expect(later[0].bucket).toBe(1);
    });

    it('re-deriving from the index reproduces exactly the refs the email showed', () => {
      // The click-through does exactly this, days later: getBucketAssignment(bucket).
      // If the engine ever stops defining getNextAssignment as
      // getBucketAssignment(nextUnlearnedBucket(...)), this fails here rather than
      // silently marking the wrong mishnayot in production.
      const blocks = [eightMishnaBlock('u1')];
      const completed = [ref(0)];
      const [email] = buildPreparedEmails(
        live,
        data({ completed }),
        engine,
        SUNDAY_8AM_NY,
      );
      const rederived = engine.getBucketAssignment(
        blocks,
        email.bucket,
        SUNDAY_8AM_NY,
      ).mishnas;
      expect(rederived.map(refKey)).toEqual(
        engine
          .getNextAssignment(blocks, completed, SUNDAY_8AM_NY)
          .mishnas.map(refKey),
      );
    });

    it('is why the index must be pinned, not recomputed at click time', () => {
      // A *partly* learned bucket still reports itself...
      const partial = buildPreparedEmails(
        reminderLive,
        data({ completed: [ref(0)] }),
        engine,
        SUNDAY_8AM_NY,
      );
      expect(partial[0].bucket).toBe(0);
      // ...but a *fully* learned one advances. So a user who checked this bucket off
      // in the app before clicking the email would, on a recomputed index, mark the
      // next bucket — mishnayot the email never showed them.
      const complete = buildPreparedEmails(
        live,
        data({ completed: [ref(0), ref(1)] }),
        engine,
        SUNDAY_8AM_NY,
      );
      expect(complete[0].bucket).toBe(1);
    });

    it('weekly and reminder for the same week pin the same bucket', () => {
      const completed = [ref(0)];
      const [weekly] = buildPreparedEmails(
        live,
        data({ completed }),
        engine,
        SUNDAY_8AM_NY,
      );
      const [reminder] = buildPreparedEmails(
        reminderLive,
        data({ completed }),
        engine,
        SUNDAY_8AM_NY,
      );
      // Their *refs* differ (a reminder shows only what is still pending), but both
      // links mark the same slice — which is the correct, idempotent semantic for
      // both, since a reminder's omitted refs are already completions rows.
      expect(reminder.refs.length).toBeLessThan(weekly.refs.length);
      expect(reminder.bucket).toBe(weekly.bucket);
    });
  });
});

describe('planSends', () => {
  function repoFor(now: Date, over: { sent?: string[] } = {}) {
    return new InMemoryEmailRepository({
      candidates: [candidate()],
      blocks: new Map([['u1', [eightMishnaBlock('u1')]]]),
      completed: new Map([['u1', []]]),
      emails: new Map([['u1', 'u1@example.com']]),
      sent: over.sent,
    });
  }

  it('resolves a due user end-to-end into a prepared weekly email', async () => {
    const out = await planSends(repoFor(SUNDAY_8AM_NY), engine, SUNDAY_8AM_NY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      userId: 'u1',
      kind: 'weekly',
      to: 'u1@example.com',
    });
    expect(out[0].refs.map(refKey)).toEqual([ref(0), ref(1)].map(refKey));
  });

  it('returns nothing when no one is at the send hour', async () => {
    expect(
      await planSends(repoFor(SUNDAY_9AM_NY), engine, SUNDAY_9AM_NY),
    ).toEqual([]);
  });

  it('drops a user already sent this (kind, week)', async () => {
    const repo = repoFor(SUNDAY_8AM_NY, {
      sent: [sentKey('u1', 'weekly', '2026-01-04')],
    });
    expect(await planSends(repo, engine, SUNDAY_8AM_NY)).toEqual([]);
  });

  it('records a send through the repository', async () => {
    const repo = repoFor(SUNDAY_8AM_NY);
    await repo.recordSent('u1', 'weekly', '2026-01-04');
    expect(repo.recorded.has(sentKey('u1', 'weekly', '2026-01-04'))).toBe(true);
    // …and a subsequent plan run now treats that user as already sent.
    expect(await planSends(repo, engine, SUNDAY_8AM_NY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Accepted behavior, pinned
// ---------------------------------------------------------------------------

describe('changing the weekly weekday mid-week (ACCEPTED duplicate)', () => {
  it('DELIBERATELY sends a second weekly that week — this is not a bug report', () => {
    // `email_log` is keyed on (user, kind, weekStart), and `weekStart` is anchored to
    // the user's *current* weekly weekday. So a user who receives Sunday's weekly and
    // then moves their weekly to Wednesday gets a second one three days later: the
    // Wednesday run computes weekStart = the Wednesday, which no log row matches.
    //
    // This is knowingly accepted rather than fixed:
    //   - it is rare (it needs a settings change in the window between the old day and
    //     the new one) and self-healing (from the next week on there is one anchor),
    //   - the content is progress-based, so the second email is not a stale duplicate;
    //     it shows whatever the user still has left,
    //   - the alternatives (anchoring the log to a fixed weekday, or writing extra
    //     suppression rows on a prefs save) add a second source of truth to the dedup
    //     for a once-per-user-per-lifetime edge.
    // If this test ever fails, the *dedup key* changed — decide deliberately, don't
    // "fix" the test.
    const sunday = candidate({ weeklyEmailDow: 0, reminderEnabled: false });
    const [sundaySend] = selectDue([sunday], SUNDAY_8AM_NY);
    expect(sundaySend).toEqual({
      userId: 'u1',
      kind: 'weekly',
      weekStart: '2026-01-04',
    });

    // The user now moves their weekly email to Wednesday. 2026-01-07 is that Wednesday.
    const WEDNESDAY_8AM_NY = new Date('2026-01-07T13:00:00Z');
    const moved = candidate({ weeklyEmailDow: 3, reminderEnabled: false });
    const sent = new Set([sentKey('u1', 'weekly', sundaySend.weekStart)]);
    const due = selectDue([moved], WEDNESDAY_8AM_NY);

    expect(due).toEqual([
      { userId: 'u1', kind: 'weekly', weekStart: '2026-01-07' },
    ]);
    // ...and the Sunday log row does not suppress it, because the anchor moved with
    // the weekday.
    expect(dropAlreadySent(due, sent)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Daylight-saving: the cron fires hourly, so 08:00 local must occur exactly once
// per local day even on a 23- or 25-hour one. A transition that skipped or repeated
// the send hour would silently drop a week's mail or double it.
// ---------------------------------------------------------------------------

describe('selectDue across a DST transition', () => {
  /** Every hourly cron tick in `[from, to)`, as the cron would fire them. */
  function hourlyTicks(from: string, to: string): Date[] {
    const out: Date[] = [];
    for (let t = Date.parse(from); t < Date.parse(to); t += 60 * 60 * 1000) {
      out.push(new Date(t));
    }
    return out;
  }

  const cases: { zone: string; label: string; from: string; to: string }[] = [
    // US spring forward: 2026-03-08 is 23 hours long in New York (02:00 is skipped).
    {
      zone: 'America/New_York',
      label: 'spring forward (23-hour day)',
      from: '2026-03-07T00:00:00Z',
      to: '2026-03-10T00:00:00Z',
    },
    // US fall back: 2026-11-01 is 25 hours long (01:00 happens twice).
    {
      zone: 'America/New_York',
      label: 'fall back (25-hour day)',
      from: '2026-10-31T00:00:00Z',
      to: '2026-11-03T00:00:00Z',
    },
    // A half-hour DST shift, and a half-hour base offset — the case an
    // hour-equality test is most likely to get wrong.
    {
      zone: 'Australia/Lord_Howe',
      label: 'half-hour DST shift',
      from: '2026-04-04T00:00:00Z',
      to: '2026-04-07T00:00:00Z',
    },
    {
      zone: 'Australia/Lord_Howe',
      label: 'half-hour DST shift (start)',
      from: '2026-10-03T00:00:00Z',
      to: '2026-10-06T00:00:00Z',
    },
  ];

  for (const { zone, label, from, to } of cases) {
    it(`fires each user at most once per local day — ${zone}, ${label}`, () => {
      // One candidate per weekday, so whichever local days fall in the window, each
      // is covered by exactly one user's weekly.
      const candidates = [0, 1, 2, 3, 4, 5, 6].map((dow) =>
        candidate({
          userId: `dow-${dow}`,
          timezone: zone,
          weeklyEmailDow: dow,
          reminderEnabled: false,
        }),
      );
      const fired: string[] = [];
      for (const tick of hourlyTicks(from, to)) {
        for (const d of selectDue(candidates, tick)) {
          fired.push(`${d.userId}|${d.weekStart}`);
        }
      }
      // No user fires twice for the same local week anchor...
      expect(new Set(fired).size).toBe(fired.length);
      // ...and every local day in the window did fire (nothing was skipped): the
      // window spans 3 local days, hence 3 sends across the 7 candidates.
      expect(fired).toHaveLength(3);
    });
  }
});

// ---------------------------------------------------------------------------
// planSends: the batching contract and a couple of interaction cases
// ---------------------------------------------------------------------------

describe('planSends read batching', () => {
  /** An EmailRepository that records the id lists each read was called with. */
  function spyRepo(inner: EmailRepository) {
    const calls: Record<string, string[][]> = {
      alreadySent: [],
      loadBlocks: [],
      loadCompleted: [],
      loadEmails: [],
    };
    const repo: EmailRepository = {
      loadCandidates: () => inner.loadCandidates(),
      alreadySent: (ids, since) => {
        calls['alreadySent'].push(ids);
        return inner.alreadySent(ids, since);
      },
      loadBlocks: (ids) => {
        calls['loadBlocks'].push(ids);
        return inner.loadBlocks(ids);
      },
      loadCompleted: (ids) => {
        calls['loadCompleted'].push(ids);
        return inner.loadCompleted(ids);
      },
      loadEmails: (ids) => {
        calls['loadEmails'].push(ids);
        return inner.loadEmails(ids);
      },
      recordSent: (u, k, w) => inner.recordSent(u, k, w),
    };
    return { repo, calls };
  }

  it('resolves 250 due users with one set-based read each, not 250 lookups', async () => {
    // The scalability contract: a run is O(reads), not O(due). Chunking the id list
    // under D1's 100-bind ceiling is the *adapter's* job (covered against a fake D1
    // in @mishna/email-data's spec); what the planner owes is a single, deduplicated
    // call per read.
    const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const inner = new InMemoryEmailRepository({
      candidates: ids.map((userId) => candidate({ userId })),
      blocks: new Map(ids.map((id) => [id, [eightMishnaBlock(id)]])),
      completed: new Map(ids.map((id) => [id, []])),
      emails: new Map(ids.map((id) => [id, `${id}@example.com`])),
    });
    const { repo, calls } = spyRepo(inner);

    const jobs = await planSends(repo, engine, SUNDAY_8AM_NY);

    expect(jobs).toHaveLength(250);
    for (const name of [
      'alreadySent',
      'loadBlocks',
      'loadCompleted',
      'loadEmails',
    ]) {
      expect(calls[name], name).toHaveLength(1);
      expect(calls[name][0], name).toHaveLength(250);
      // Deduplicated: a user due both kinds must not be looked up twice.
      expect(new Set(calls[name][0]).size, name).toBe(250);
    }
  });

  it('deduplicates the id lists when a user is due both kinds the same day', async () => {
    const inner = new InMemoryEmailRepository({
      candidates: [candidate({ reminderEmailDow: 0 })],
      blocks: new Map([['u1', [eightMishnaBlock('u1')]]]),
      completed: new Map([['u1', []]]),
      emails: new Map([['u1', 'u1@example.com']]),
    });
    const { repo, calls } = spyRepo(inner);
    const jobs = await planSends(repo, engine, SUNDAY_8AM_NY);
    expect(jobs.map((j) => j.kind).sort()).toEqual(['reminder', 'weekly']);
    expect(calls['loadBlocks'][0]).toEqual(['u1']);
  });
});

describe('planSends interactions', () => {
  function repoWith(over: {
    candidates?: Candidate[];
    completed?: MishnaRef[];
    sent?: string[];
  }) {
    return new InMemoryEmailRepository({
      candidates: over.candidates ?? [candidate()],
      blocks: new Map([['u1', [eightMishnaBlock('u1')]]]),
      completed: new Map([['u1', over.completed ?? []]]),
      emails: new Map([['u1', 'u1@example.com']]),
      sent: over.sent,
    });
  }

  it('sends only the kind that is still outstanding when both are due', async () => {
    // Weekly and reminder land on the same weekday and share a week anchor, so the
    // dedup set has to distinguish them by kind — not just by (user, week).
    const repo = repoWith({
      candidates: [candidate({ reminderEmailDow: 0 })],
      sent: [sentKey('u1', 'weekly', '2026-01-04')],
    });
    const jobs = await planSends(repo, engine, SUNDAY_8AM_NY);
    expect(jobs.map((j) => j.kind)).toEqual(['reminder']);
  });

  it('an opted-out user is dropped before the dedup read, stale log row or not', async () => {
    // A leftover `email_log` row from before they opted out must not be what is
    // keeping them quiet — the flag is.
    const repo = repoWith({
      candidates: [candidate({ weeklyEnabled: false, reminderEnabled: false })],
      sent: [sentKey('u1', 'weekly', '2025-12-28')],
    });
    expect(await planSends(repo, engine, SUNDAY_8AM_NY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// prepareSingle — the one function behind both callers (see content.ts)
// ---------------------------------------------------------------------------

describe('prepareSingle', () => {
  const wholePortion = [0, 1, 2, 3, 4, 5, 6, 7].map(ref);
  const base = {
    userId: 'u1',
    kind: 'weekly' as const,
    weekStart: '2026-01-04',
    to: 'u1@example.com',
    blocks: [eightMishnaBlock('u1')],
    completed: [] as MishnaRef[],
    date: SUNDAY_8AM_NY,
  };

  it('resolves the next unlearned bucket for a live user', () => {
    const out = prepareSingle(base, engine, { skipWhenEmpty: true });
    expect(out?.refs.map(refKey)).toEqual([ref(0), ref(1)].map(refKey));
  });

  it('returns null with no address, under either setting', () => {
    for (const skipWhenEmpty of [true, false]) {
      expect(
        prepareSingle({ ...base, to: null }, engine, { skipWhenEmpty }),
      ).toBeNull();
      expect(
        prepareSingle({ ...base, to: '' }, engine, { skipWhenEmpty }),
      ).toBeNull();
    }
  });

  describe('a user who has learned their whole portion', () => {
    const finished = { ...base, completed: wholePortion };

    it('skipWhenEmpty: true (the bulk path) — no email at all', () => {
      // A finished user must stop receiving scheduled mail.
      expect(
        prepareSingle(finished, engine, { skipWhenEmpty: true }),
      ).toBeNull();
      expect(
        prepareSingle({ ...finished, kind: 'reminder' }, engine, {
          skipWhenEmpty: true,
        }),
      ).toBeNull();
    });

    it('skipWhenEmpty: false (admin send-now) — the empty-state email, deliberately', () => {
      // The admin pressed the button; a silent no-op reads as a broken button. They
      // get the templates' "no mishnayos scheduled" state, and the admin user-detail
      // page shows the count beforehand so it is never a surprise.
      const weekly = prepareSingle(finished, engine, { skipWhenEmpty: false });
      expect(weekly).toMatchObject({
        userId: 'u1',
        kind: 'weekly',
        weekStart: '2026-01-04',
        to: 'u1@example.com',
      });
      expect(weekly?.refs).toEqual([]);

      const reminder = prepareSingle(
        { ...finished, kind: 'reminder' },
        engine,
        {
          skipWhenEmpty: false,
        },
      );
      expect(reminder?.refs).toEqual([]);
    });
  });

  it('reminder carries only the still-pending part of the bucket', () => {
    const out = prepareSingle(
      { ...base, kind: 'reminder', completed: [ref(0)] },
      engine,
      { skipWhenEmpty: true },
    );
    expect(out?.refs.map(refKey)).toEqual([ref(1)].map(refKey));
  });

  it('a user with no blocks at all is treated as empty', () => {
    expect(
      prepareSingle({ ...base, blocks: [] }, engine, { skipWhenEmpty: true }),
    ).toBeNull();
    expect(
      prepareSingle({ ...base, blocks: [] }, engine, { skipWhenEmpty: false })
        ?.refs,
    ).toEqual([]);
  });
});
