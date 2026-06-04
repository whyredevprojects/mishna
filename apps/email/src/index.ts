import { EmailJob } from '@mishna/domain';
import { Resend } from 'resend';
import { planSends } from './orchestrator';
import { httpTextResolver } from './quota';
import { OutgoingEmail, SenderDeps, processJobs } from './sender';

/** Wire the real side effects: Resend for sending, HTTP fetch for Hebrew text. */
function senderDeps(env: Env): SenderDeps {
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

export default {
  // Cron orchestrator: pick who is due an email right now and fan the jobs out
  // to the queue. Does no sending itself.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const jobs = await planSends(env, new Date(controller.scheduledTime));
    if (jobs.length === 0) return;
    await env.EMAIL_QUEUE.sendBatch(jobs.map((body) => ({ body })));
  },

  // Queue consumer: build + send a batch via Resend, logging successful sends.
  // On failure the whole batch is retried (at-least-once); email_log dedups it.
  async queue(batch: MessageBatch<EmailJob>, env: Env): Promise<void> {
    const jobs = batch.messages.map((m) => m.body);
    try {
      await processJobs(env, jobs, senderDeps(env));
      batch.ackAll();
    } catch (err) {
      console.error('email batch failed; retrying', err);
      batch.retryAll();
    }
  },
} satisfies ExportedHandler<Env, EmailJob>;
