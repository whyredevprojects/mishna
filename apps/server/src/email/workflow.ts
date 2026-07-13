import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from 'cloudflare:workers';
import { Resend } from 'resend';
import { planSends } from '@mishna/email-domain';
import { D1EmailRepository } from '@mishna/email-data';
import { assignmentEngine } from '../domain';
import { httpTextResolver } from './quota';
import { OutgoingEmail, SenderDeps, processJobs } from './sender';

interface Params {
  /** The cron's scheduledTime (epoch ms). Drives the 08:00-local send decision. */
  scheduledTime: number;
}

/** Resend's `/batch` endpoint accepts up to 100 emails per call. */
const BATCH = 100;

/** The D1-backed email repository (the EmailRepository port impl) over this env. */
function emailRepo(env: Env): D1EmailRepository {
  return new D1EmailRepository({
    db: env.DB,
    authDb: env.AUTH_DB,
  });
}

/** Wire the real side effects: Resend for sending, HTTP fetch for Hebrew text. */
export function senderDeps(env: Env): SenderDeps {
  const resend = new Resend(env.RESEND_API_KEY);
  const repo = emailRepo(env);
  return {
    resolveText: httpTextResolver(env.APP_ORIGIN),
    from: env.RESEND_FROM_EMAIL,
    replyTo: env.RESEND_REPLY_TO_EMAIL,
    appOrigin: env.APP_ORIGIN,
    record: (userId, kind, weekStart) => repo.recordSent(userId, kind, weekStart),
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
      planSends(emailRepo(this.env), assignmentEngine, now),
    );

    let sent = 0;
    for (let i = 0; i < jobs.length; i += BATCH) {
      const chunk = jobs.slice(i, i + BATCH);
      const n = i / BATCH;
      await step.do(`send-batch-${n}`, () =>
        processJobs(chunk, senderDeps(this.env)),
      );
      sent += chunk.length;
      if (i + BATCH < jobs.length) {
        await step.sleep(`throttle-${n}`, '1 second');
      }
    }

    // One structured line per run — the early-warning for the per-invocation
    // subrequest/wall-clock ceiling. Watch `durationMs` and `planned` over time.
    await step.do('run-metrics', async () => {
      console.log(
        JSON.stringify({
          evt: 'reminder_run',
          scheduledTime: event.payload.scheduledTime,
          durationMs: Date.now() - startedAt,
          planned: jobs.length,
          sent,
          batches: Math.ceil(jobs.length / BATCH),
        }),
      );
      return null;
    });
  }
}
