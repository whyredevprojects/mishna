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
  // to the queue. Does no sending itself. Fanning out via the queue keeps a large
  // (e.g. 700-recipient) run within per-invocation CPU limits and gives per-batch
  // retry — the orchestrator only identifies + delegates.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const jobs = await planSends(env, new Date(controller.scheduledTime));
    console.log(`email orchestrator: queued ${jobs.length} job(s)`);
    if (jobs.length === 0) return;
    await env.EMAIL_QUEUE.sendBatch(jobs.map((body) => ({ body })));
  },

  // Admin "send now": a single interactive email, sent synchronously so the admin
  // sees the real result (including a Resend error). The server reaches this via the
  // EMAIL service binding — not the queue — because (a) volume is 1, so the queue's
  // decoupling buys nothing, (b) a queued send can't report success/failure back, and
  // (c) cross-process queues aren't delivered in local `wrangler dev` (service bindings
  // are, via the dev registry). No public route is configured (workers_dev = false), so
  // this handler is only reachable through the binding.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/internal/send') {
      return new Response('Not found', { status: 404 });
    }
    let job: EmailJob;
    try {
      job = (await req.json()) as EmailJob;
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (!job?.userId || !job?.kind || !job?.weekStart) {
      return Response.json(
        { error: 'job must have userId, kind, and weekStart' },
        { status: 400 },
      );
    }
    try {
      await processJobs(env, [job], senderDeps(env));
      return Response.json({ sent: 1, job });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('admin send failed', err);
      return Response.json({ error: message }, { status: 500 });
    }
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
