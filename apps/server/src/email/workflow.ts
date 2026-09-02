import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from 'cloudflare:workers';
import { Resend } from 'resend';
import {
  OutgoingEmail,
  PreparedEmail,
  memorizedExpiresAt,
  memorizedUrl,
  mintMemorizedToken,
  mintUnsubscribeToken,
  planSends,
  unsubscribeUrl,
} from '@mishna/email-domain';
import { D1EmailRepository } from '@mishna/email-data';
import { emailContentEngine } from '../domain';
import { httpTextResolver } from './quota';
import { SenderDeps, processJobs } from './sender';

interface Params {
  /** The cron's scheduledTime (epoch ms). Drives the 08:00-local send decision. */
  scheduledTime: number;
}

/** Resend's `/batch` endpoint accepts up to 100 emails per call. */
const BATCH = 100;

/** One durable `send-batch-N` step: which jobs it covers, and what follows it. */
export interface BatchStep {
  /** The batch index, i.e. the `send-batch-<n>` / `throttle-<n>` suffix. */
  n: number;
  start: number;
  end: number;
  /**
   * Whether a `step.sleep` throttle follows this batch. False for the **last** one:
   * the sleep exists to stay under Resend's batch rate limit *between* calls, and one
   * after the final batch would add a pointless second to every run — and to every
   * retry of one — while rate-limiting nothing.
   */
  throttleAfter: boolean;
}

/**
 * How a run of `total` planned emails is chunked into `size`-job batches.
 *
 * Split out of `run()` as a pure function because it is the only *decision* the
 * workflow makes, and it is otherwise reachable only through the durable engine —
 * where a `step.sleep` has no result to introspect and the placement of the throttle
 * could only be inferred from wall-clock timing. `workflow.spec.ts` pins it directly.
 */
export function batchPlan(total: number, size: number = BATCH): BatchStep[] {
  const steps: BatchStep[] = [];
  for (let i = 0; i < total; i += size) {
    const end = Math.min(i + size, total);
    steps.push({ n: i / size, start: i, end, throttleAfter: end < total });
  }
  return steps;
}

/** What one run reports: the workflow's output and its `reminder_run` log line. */
export interface RunMetrics {
  scheduledTime: number;
  durationMs: number;
  /** Emails `planSends` decided to send. */
  planned: number;
  /** Emails actually handed to a completed `send-batch-*` step. */
  sent: number;
  batches: number;
}

/** The D1-backed email repository (the EmailRepository port impl) over this env. */
export function emailRepo(env: Env): D1EmailRepository {
  return new D1EmailRepository({
    db: env.DB,
    authDb: env.AUTH_DB,
  });
}

/**
 * Everything `composeEmail` needs from the environment — i.e. `SenderDeps` minus the
 * two effects that actually leave the process (`send`, `record`).
 *
 * Split out because *rendering* an email needs no Resend client, and `new Resend()`
 * throws without an API key. The local preview route (`email/dev-routes.ts`
 * `/__dev/email/render`) is therefore usable with no key at all, while still going
 * through the exact production wiring — the real `httpTextResolver`, the real
 * `APP_ORIGIN`, the real signed unsubscribe token.
 */
export type ComposeDeps = Omit<SenderDeps, 'send' | 'record'>;

/**
 * The non-transport half of the production wiring.
 *
 * `textOrigin` defaults to `APP_ORIGIN` (which is where mishna-text's tractate JSON
 * is served from — the client copies `mishna-text/data` into its assets). It's a
 * parameter only for the local preview tooling, which may want the Hebrew text from
 * one origin while the *links* in the email still point at the local worker.
 */
export function composeDeps(
  env: Env,
  textOrigin: string = env.APP_ORIGIN,
): ComposeDeps {
  return {
    resolveText: httpTextResolver(textOrigin),
    from: env.RESEND_FROM_EMAIL,
    replyTo: env.RESEND_REPLY_TO_EMAIL,
    appOrigin: env.APP_ORIGIN,
    // The RFC 8058 one-click unsubscribe link, signed with UNSUBSCRIBE_SECRET.
    // No `lang` is appended: the emails themselves are English-chrome only, so the
    // landing page picks the language from the browser's Accept-Language instead
    // (and the user can still force it with ?lang=he).
    unsubscribeUrlFor: async (userId: string) =>
      unsubscribeUrl(
        env.APP_ORIGIN,
        await mintUnsubscribeToken(env.UNSUBSCRIBE_SECRET, userId, 'all'),
      ),
    // The top CTA's signed link, signed with MEMORIZED_SECRET. Every input comes from
    // the job — `bucket` was pinned at plan time and the expiry is derived from
    // `weekStart`, never from the clock — so re-rendering a retried batch produces
    // identical bytes. A `Date.now()` anywhere in here would make Resend answer the
    // reused Idempotency-Key with 409 and fail the whole workflow.
    // No `lang`, for the same reason as the unsubscribe link above.
    memorizedUrlFor: async (job: PreparedEmail) =>
      memorizedUrl(
        env.APP_ORIGIN,
        await mintMemorizedToken(
          env.MEMORIZED_SECRET,
          job.userId,
          job.bucket,
          memorizedExpiresAt(job.weekStart),
        ),
      ),
  };
}

/** Wire the real side effects: Resend for sending, HTTP fetch for Hebrew text. */
export function senderDeps(env: Env, textOrigin?: string): SenderDeps {
  const resend = new Resend(env.RESEND_API_KEY);
  const repo = emailRepo(env);
  return {
    ...composeDeps(env, textOrigin),
    record: (userId, kind, weekStart) =>
      repo.recordSent(userId, kind, weekStart),
    send: async (emails: OutgoingEmail[], idempotencyKey: string) => {
      const { error } = await resend.batch.send(emails, { idempotencyKey });
      if (error) {
        throw new Error(`Resend batch failed: ${error.message}`);
      }
    },
  };
}

/**
 * The bulk reminder/weekly send, run as a durable Cloudflare Workflow. The cron
 * creates one instance per fire; this decides who is due an email right now and
 * sends them in Resend-batch-sized chunks.
 *
 * Each `send-batch-*` step is a durable checkpoint: if a batch fails and the step
 * retries, earlier batches aren't re-sent, and `processJobs` records each send in
 * `email_log` (so even a redelivered batch dedups). `step.sleep()` between batches
 * keeps under Resend's batch rate limit and is free — the instance hibernates.
 */
export class ReminderWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const now = new Date(event.payload.scheduledTime);

    // Capture the start in a step so the duration survives workflow replays.
    const startedAt = await step.do('started-at', async () => Date.now());
    const jobs = await step.do('plan-sends', () =>
      planSends(emailRepo(this.env), emailContentEngine, now),
    );

    const plan = batchPlan(jobs.length);
    let sent = 0;
    for (const { n, start, end, throttleAfter } of plan) {
      const chunk = jobs.slice(start, end);
      await step.do(`send-batch-${n}`, () =>
        processJobs(chunk, senderDeps(this.env)),
      );
      sent += chunk.length;
      if (throttleAfter) {
        await step.sleep(`throttle-${n}`, '1 second');
      }
    }

    // One structured line per run — the early-warning for the per-invocation
    // subrequest/wall-clock ceiling. Watch `durationMs` and `planned` over time.
    // The step also *returns* the metrics (rather than `null`) so a run is
    // observable without scraping logs: the workflow's output is this object, and
    // `workflow.integration.test.ts` asserts on it.
    return await step.do('run-metrics', async (): Promise<RunMetrics> => {
      const metrics: RunMetrics = {
        scheduledTime: event.payload.scheduledTime,
        durationMs: Date.now() - startedAt,
        planned: jobs.length,
        sent,
        batches: plan.length,
      };
      console.log(JSON.stringify({ evt: 'reminder_run', ...metrics }));
      return metrics;
    });
  }
}
