import {
  createExecutionContext,
  createScheduledController,
  env,
  introspectWorkflow,
  introspectWorkflowInstance,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreparedEmail } from '@mishna/email-domain';
import { applyMigrations } from '../apply-migrations';
import worker from '../index';

// ---------------------------------------------------------------------------
// The ReminderWorkflow itself — the piece that decides *how* the hour's mail is
// chunked, throttled and retried, and the only piece where a bug means "everyone
// got the weekly twice" rather than "one email looked wrong".
//
// Driven through `introspectWorkflowInstance` (@cloudflare/vitest-pool-workers), so
// the real durable engine runs: real `step.do` checkpointing, real retries, real
// replay — with sleeps and retry backoff disabled so a test costs milliseconds.
//
// Two things are stubbed, both at the network edge:
//   - `https://api.resend.com/...`   the transport (also our send counter)
//   - `${APP_ORIGIN}/*.json`         mishna-text's tractate files
// Nothing else is mocked; `processJobs`, the templates and the `email_log` writes
// are the production code paths.
// ---------------------------------------------------------------------------

const SCHEDULED_TIME = Date.parse('2026-06-03T12:00:00Z');

/** Every URL the worker fetched, in order. Reset per test. */
let fetched: string[] = [];
/** The parsed body of every Resend batch POST, in order. Reset per test. */
let sentBatches: { to: string; subject: string }[][] = [];

const FAKE_TRACTATE = {
  name: 'Berakhot',
  hebrewName: 'ברכות',
  sefariaId: 'Berakhot',
  seder: 'Zeraim',
  sederHebrewName: 'זרעים',
  perakim: [
    {
      perek: 1,
      mishnayot: [{ mishna: 1, hebrew: 'טקסט', english: 'text' }],
    },
  ],
};

/** `n` synthetic prepared jobs — what `plan-sends` would have returned. */
function jobs(n: number, offset = 0): PreparedEmail[] {
  return Array.from({ length: n }, (_, i) => ({
    userId: `u${offset + i}`,
    kind: (i % 2 === 0 ? 'weekly' : 'reminder') as PreparedEmail['kind'],
    weekStart: '2026-06-03',
    to: `u${offset + i}@example.com`,
    refs: [{ mesechta: 'Berakhot', perek: 1, mishna: 1 }],
  }));
}

async function emailLogCount(): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM email_log',
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('ReminderWorkflow', () => {
  const originalKey = (env as unknown as Record<string, unknown>)['RESEND_API_KEY'];

  beforeAll(async () => {
    await applyMigrations(env.DB);
    // Pin a fake key: a developer's `.dev.vars` may hold a REAL one, and these tests
    // must never be one stubbed-fetch bug away from mailing 250 people.
    (env as unknown as Record<string, unknown>)['RESEND_API_KEY'] = 're_fake_test_key';
  });

  afterAll(() => {
    (env as unknown as Record<string, unknown>)['RESEND_API_KEY'] = originalKey;
  });

  beforeEach(async () => {
    fetched = [];
    sentBatches = [];
    await env.DB.exec('DELETE FROM email_log');
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        fetched.push(url);
        if (url.includes('api.resend.com')) {
          const body = JSON.parse(String(init?.body ?? '[]')) as {
            to: string;
            subject: string;
          }[];
          sentBatches.push(body.map((e) => ({ to: e.to, subject: e.subject })));
          return Response.json({ data: { data: [] } });
        }
        if (url.startsWith(env.APP_ORIGIN)) {
          return Response.json(FAKE_TRACTATE);
        }
        throw new Error(`unexpected fetch in test: ${url}`);
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Start an instance with `plan` as the `plan-sends` result, sleeps disabled. */
  async function startWith(
    id: string,
    plan: PreparedEmail[],
    extra?: (m: {
      disableSleeps(steps?: { name: string; index?: number }[]): Promise<void>;
      disableRetryDelays(steps?: { name: string; index?: number }[]): Promise<void>;
      mockStepResult(
        step: { name: string; index?: number },
        result: unknown,
      ): Promise<void>;
      mockStepError(
        step: { name: string; index?: number },
        error: Error,
        times?: number,
      ): Promise<void>;
    }) => Promise<void>,
  ) {
    const instance = await introspectWorkflowInstance(env.REMINDER_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.disableRetryDelays();
      await m.mockStepResult({ name: 'plan-sends' }, plan);
      await extra?.(m);
    });
    await env.REMINDER_WORKFLOW.create({
      id,
      params: { scheduledTime: SCHEDULED_TIME },
    });
    return instance;
  }

  describe('batching', () => {
    it('splits 250 planned emails into three Resend batches and reports the run', async () => {
      // Resend's /batch endpoint takes 100 per call, so the chunking is not an
      // optimization — a 101-email call is a hard failure.
      await using instance = await startWith('wf-batching', jobs(250));
      await instance.waitForStatus('complete');

      // Three durable checkpoints, one per batch.
      for (const n of [0, 1, 2]) {
        await instance.waitForStepResult({ name: `send-batch-${n}` });
      }
      expect(await instance.getOutput()).toMatchObject({
        planned: 250,
        sent: 250,
        batches: 3,
        scheduledTime: SCHEDULED_TIME,
      });

      // ...and three actual sends, of 100 / 100 / 50.
      expect(sentBatches.map((b) => b.length)).toEqual([100, 100, 50]);
      expect(await emailLogCount()).toBe(250);
    });

    it('sends nothing and does no work when nobody is due', async () => {
      await using instance = await startWith('wf-empty', []);
      await instance.waitForStatus('complete');

      expect(await instance.getOutput()).toMatchObject({
        planned: 0,
        sent: 0,
        batches: 0,
      });
      // No `send-batch-*` step ran at all: no transport call, no tractate fetch.
      expect(fetched).toEqual([]);
      expect(sentBatches).toEqual([]);
      expect(await emailLogCount()).toBe(0);
    });
  });

  describe('retries', () => {
    it('🔴 does NOT re-send earlier batches when a later one retries', async () => {
      // The single most expensive bug this codebase could have. Workflows re-enter
      // `run()` on a retry; only `step.do`'s durable memoization stops batch 0 from
      // being mailed a second time. If that ever breaks, 100 people get the same
      // email twice — and `email_log` won't save them, because it is written *after*
      // a successful send and the re-send happens before the next log read.
      await using instance = await startWith(
        'wf-retry',
        jobs(250),
        async (m) => {
          // Fail batch 1 exactly once; the retry then runs it for real.
          await m.mockStepError(
            { name: 'send-batch-1' },
            new Error('Resend batch failed: transient'),
            1,
          );
        },
      );
      await instance.waitForStatus('complete');

      // Exactly three transport calls, of 100 / 100 / 50 — batch 0 was NOT re-sent
      // when the workflow replayed after batch 1's failure.
      expect(sentBatches.map((b) => b.length)).toEqual([100, 100, 50]);
      const firstRecipients = sentBatches.map((b) => b[0].to);
      expect(new Set(firstRecipients).size).toBe(3);
      expect(firstRecipients[0]).toBe('u0@example.com');
      // Every recipient logged exactly once.
      expect(await emailLogCount()).toBe(250);
      expect(await instance.getOutput()).toMatchObject({ sent: 250, batches: 3 });
    });

    it('errors the run — and stops — when a batch fails permanently', async () => {
      await using instance = await startWith(
        'wf-fatal',
        jobs(250),
        async (m) => {
          await m.mockStepError(
            { name: 'send-batch-1' },
            new Error('Resend batch failed: rate_limit_exceeded'),
          );
        },
      );
      await instance.waitForStatus('errored');

      const error = await instance.getError();
      expect(error.message).toContain('rate_limit_exceeded');

      // Batch 0 went out and is logged; batch 2 was never reached. The hour's mail
      // is *partially* delivered, which is exactly why `email_log` exists — the next
      // hourly run re-plans and picks up only who is still unsent.
      expect(sentBatches.map((b) => b.length)).toEqual([100]);
      expect(await emailLogCount()).toBe(100);
      const logged = await env.DB.prepare(
        'SELECT user_id FROM email_log ORDER BY user_id',
      ).all<{ user_id: string }>();
      expect(logged.results.some((r) => r.user_id === 'u0')).toBe(true);
      expect(logged.results.some((r) => r.user_id === 'u150')).toBe(false);
    });
  });

  describe('throttling', () => {
    /**
     * Run two batches with the send steps mocked, and return the workflow's own
     * `durationMs`. With `sleeps: false` every `step.sleep` resolves instantly, so
     * the difference between the two runs is exactly the time spent sleeping.
     */
    async function twoBatchDuration(id: string, sleeps: boolean) {
      const instance = await introspectWorkflowInstance(
        env.REMINDER_WORKFLOW,
        id,
      );
      await instance.modify(async (m) => {
        if (!sleeps) await m.disableSleeps();
        await m.mockStepResult({ name: 'plan-sends' }, jobs(200));
        await m.mockStepResult({ name: 'send-batch-0' }, null);
        await m.mockStepResult({ name: 'send-batch-1' }, null);
      });
      await env.REMINDER_WORKFLOW.create({
        id,
        params: { scheduledTime: SCHEDULED_TIME },
      });
      await instance.waitForStatus('complete');
      const output = (await instance.getOutput()) as {
        durationMs: number;
        batches: number;
      };
      await instance.dispose();
      return output;
    }

    it('really does sleep between batches (the rate-limit throttle is live)', async () => {
      // A `step.sleep` is not a `step.do`: it has no result to introspect, so all
      // this level can show is that the throttle costs real time when it isn't
      // disabled. *Where* the sleeps sit — between every pair of batches and never
      // after the last — is `batchPlan`'s contract and is pinned exhaustively in
      // `workflow.spec.ts`, which is deterministic rather than wall-clock.
      const withSleeps = await twoBatchDuration('wf-throttle-sleep', true);
      const without = await twoBatchDuration('wf-throttle-nosleep', false);
      expect(withSleeps.batches).toBe(2);
      expect(without.batches).toBe(2);
      expect(withSleeps.durationMs).toBeGreaterThan(without.durationMs);
    }, 30_000);
  });

  describe('the hourly cron handler', () => {
    it('dedupes a double cron fire to one campaign, and keeps distinct hours apart', async () => {
      // Cron delivery is at-least-once. The instance id is derived from
      // `controller.scheduledTime`, so a redelivery lands on the run already in
      // flight instead of starting a second campaign.
      //
      // Asserted on the *transport*, not on instance bookkeeping: what must never
      // happen is a second batch going out. `email_log` cannot save us here — the
      // duplicate would be planned and sent within the same second, before any log
      // read could see the first.
      await using all = await introspectWorkflow(env.REMINDER_WORKFLOW);
      await all.modifyAll(async (m) => {
        await m.disableSleeps();
        await m.mockStepResult({ name: 'plan-sends' }, jobs(1));
      });

      const fire = async (scheduledTime: number) => {
        const ctx = createExecutionContext();
        // A duplicate id may make `create` reject; that rejection *is* the dedup
        // working, not a second campaign, so it is swallowed here and the assertion
        // is on what actually went out.
        await worker
          .scheduled(
            createScheduledController({ scheduledTime, cron: '0 * * * *' }),
            env,
            ctx,
          )
          .catch(() => undefined);
        await waitOnExecutionContext(ctx);
      };

      const hour = Date.parse('2026-06-03T13:00:00Z');
      await fire(hour);
      await fire(hour); // the redelivery
      for (const instance of all.get()) await instance.waitForStatus('complete');
      expect(sentBatches).toHaveLength(1);
      expect(await emailLogCount()).toBe(1);

      // The id really is derived from the scheduled time — that is the dedup key.
      const created = await env.REMINDER_WORKFLOW.get(`reminder-${hour}`);
      expect(created.id).toBe(`reminder-${hour}`);

      // A genuinely different hour is a genuinely different run, and does send.
      const nextHour = Date.parse('2026-06-03T14:00:00Z');
      await fire(nextHour);
      for (const instance of all.get()) await instance.waitForStatus('complete');
      expect(sentBatches).toHaveLength(2);
      expect((await env.REMINDER_WORKFLOW.get(`reminder-${nextHour}`)).id).toBe(
        `reminder-${nextHour}`,
      );
    }, 20_000);
  });

  describe('step-result headroom', () => {
    it('round-trips a whole hour of ~2000 prepared emails through one step result', async () => {
      // `plan-sends` serializes the *entire* hour's `PreparedEmail[]` as one durable
      // step result. Cloudflare caps a step's persisted state, so this is a real
      // ceiling on how many users can be due in a single hour — and the failure mode
      // is the whole run erroring, i.e. nobody gets mail. Find the limit here, not at
      // 08:00 on a Sunday.
      const plan = jobs(2000);
      const bytes = new TextEncoder().encode(JSON.stringify(plan)).length;
      console.log(
        JSON.stringify({
          evt: 'headroom_probe',
          jobs: plan.length,
          planSendsResultBytes: bytes,
          bytesPerJob: Math.round(bytes / plan.length),
        }),
      );

      await using instance = await introspectWorkflowInstance(
        env.REMINDER_WORKFLOW,
        'wf-headroom',
      );
      await instance.modify(async (m) => {
        await m.disableSleeps();
        await m.disableRetryDelays();
        await m.mockStepResult({ name: 'plan-sends' }, plan);
        // Fail the first batch on every attempt. That forces the engine to replay
        // `run()` once per retry, and every replay re-reads the 2000-job step result
        // — which is the round-trip under test. It also keeps the run to a couple of
        // seconds: actually mailing 20 batches would render 2000 emails to prove
        // nothing this test is about.
        await m.mockStepError(
          { name: 'send-batch-0' },
          new Error('headroom probe: stop here'),
        );
      });
      await env.REMINDER_WORKFLOW.create({
        id: 'wf-headroom',
        params: { scheduledTime: SCHEDULED_TIME },
      });
      await instance.waitForStatus('errored');

      // The whole hour's plan persisted and came back intact, repeatedly.
      const planned = (await instance.waitForStepResult({
        name: 'plan-sends',
      })) as PreparedEmail[];
      expect(planned).toHaveLength(2000);
      expect(planned[0]).toMatchObject({ userId: 'u0', to: 'u0@example.com' });
      expect(planned[1999]).toMatchObject({ userId: 'u1999' });
      expect(planned[1999].refs).toHaveLength(1);
      // The run got as far as the first batch, i.e. nothing choked on the payload.
      expect((await instance.getError()).message).toContain('headroom probe');
    }, 60_000);
  });
});
