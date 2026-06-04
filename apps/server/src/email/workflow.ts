import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from 'cloudflare:workers';
import { Resend } from 'resend';
import { planSends } from './orchestrator';
import { httpTextResolver } from './quota';
import { OutgoingEmail, SenderDeps, processJobs } from './sender';

interface Params {
  /** The cron's scheduledTime (epoch ms). Drives the 08:00-local send decision. */
  scheduledTime: number;
}

/** Resend's `/batch` endpoint accepts up to 100 emails per call. */
const BATCH = 100;

/** Wire the real side effects: Resend for sending, HTTP fetch for Hebrew text. */
export function senderDeps(env: Env): SenderDeps {
  const resend = new Resend(env.RESEND_API_KEY);
  return {
    resolveText: httpTextResolver(env.APP_ORIGIN),
    from: env.RESEND_FROM_EMAIL,
    appOrigin: env.APP_ORIGIN,
    send: async (emails: OutgoingEmail[]) => {
      const { error } = await resend.batch.send(emails);
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

    const jobs = await step.do('plan-sends', () => planSends(this.env, now));

    for (let i = 0; i < jobs.length; i += BATCH) {
      const chunk = jobs.slice(i, i + BATCH);
      const n = i / BATCH;
      await step.do(`send-batch-${n}`, () =>
        processJobs(this.env, chunk, senderDeps(this.env)),
      );
      if (i + BATCH < jobs.length) {
        await step.sleep(`throttle-${n}`, '1 second');
      }
    }
  }
}
