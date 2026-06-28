import {
  AssignmentEngine,
  Block,
  Commitment,
  CycleCalendar,
  MishnaRef,
  MishnaStructure,
  createMishnaStructure,
} from '@mishna/domain';
import { InMemoryEmailRepository } from './email-repository';
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
  const daysLeft = (d: Date) => Math.floor((end.getTime() - d.getTime()) / DAY_MS);
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
  return { id: `block-${userId}`, userId, lots: [], ranges, totalSize, commitment, startDate };
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
    expect(due).toEqual([{ userId: 'u1', kind: 'weekly', weekStart: '2026-01-04' }]);
  });

  it('fires the reminder at 08:00 local on the reminder weekday, anchored to the weekly week', () => {
    const due = selectDue([candidate()], THURSDAY_8AM_NY);
    // weekStart anchors to the weekly weekday (Sunday) on/before Thursday Jan 8.
    expect(due).toEqual([{ userId: 'u1', kind: 'reminder', weekStart: '2026-01-04' }]);
  });

  it('fires nothing outside the send hour', () => {
    expect(selectDue([candidate()], SUNDAY_9AM_NY)).toEqual([]);
  });

  it('respects the per-kind enabled flags', () => {
    expect(selectDue([candidate({ weeklyEnabled: false })], SUNDAY_8AM_NY)).toEqual([]);
    expect(selectDue([candidate({ reminderEnabled: false })], THURSDAY_8AM_NY)).toEqual([]);
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
      [
        candidate({ userId: 'fresh' }),
        candidate({ userId: 'done' }),
      ],
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
  const live = [{ userId: 'u1', kind: 'weekly' as const, weekStart: '2026-01-04' }];
  const reminderLive = [
    { userId: 'u1', kind: 'reminder' as const, weekStart: '2026-01-04' },
  ];

  function data(over: {
    completed?: MishnaRef[];
    email?: string | null;
    blocks?: Block[];
  } = {}) {
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
    expect(buildPreparedEmails(live, data({ email: null }), engine, SUNDAY_8AM_NY)).toEqual([]);
  });

  it('skips a user who has learned their whole portion (empty bucket)', () => {
    const allDone = [0, 1, 2, 3, 4, 5, 6, 7].map(ref);
    expect(
      buildPreparedEmails(live, data({ completed: allDone }), engine, SUNDAY_8AM_NY),
    ).toEqual([]);
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
    expect(out[0]).toMatchObject({ userId: 'u1', kind: 'weekly', to: 'u1@example.com' });
    expect(out[0].refs.map(refKey)).toEqual([ref(0), ref(1)].map(refKey));
  });

  it('returns nothing when no one is at the send hour', async () => {
    expect(await planSends(repoFor(SUNDAY_9AM_NY), engine, SUNDAY_9AM_NY)).toEqual([]);
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
