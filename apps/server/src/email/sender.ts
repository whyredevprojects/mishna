import { EmailJob } from '@mishna/domain';
import { loadBlocks, loadRecipient, pendingRefs, recordSent } from './data';
import { TextResolver, weekRefs } from './quota';
import { reminderEmail, weeklyEmail } from './templates';

/** One outgoing email, in Resend's batch shape. */
export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
}

/** Side-effecting dependencies, injected so the consumer is testable offline. */
export interface SenderDeps {
  resolveText: TextResolver;
  /** Sends a batch of emails; throws on failure so the caller can retry. */
  send: (emails: OutgoingEmail[]) => Promise<void>;
  from: string;
  appOrigin: string;
}

/** Build the outgoing email for one job, or null if the user can't be emailed. */
async function buildForJob(
  env: Env,
  job: EmailJob,
  deps: SenderDeps,
): Promise<OutgoingEmail | null> {
  const recipient = await loadRecipient(env, job.userId);
  if (!recipient) return null;

  const refs = weekRefs(await loadBlocks(env, job.userId), job.weekStart);
  const built =
    job.kind === 'weekly'
      ? weeklyEmail(await deps.resolveText(refs), deps.appOrigin)
      : reminderEmail(
          await deps.resolveText(await pendingRefs(env, job.userId, refs)),
          deps.appOrigin,
        );

  return { from: deps.from, to: recipient.email, subject: built.subject, html: built.html };
}

/**
 * Process a batch of jobs: build each email, send them in one Resend batch call,
 * then log the successful sends. Throws if the send fails so the caller can retry
 * the whole batch (at-least-once; the email_log dedups a redelivered batch).
 */
export async function processJobs(
  env: Env,
  jobs: EmailJob[],
  deps: SenderDeps,
): Promise<void> {
  const emails: OutgoingEmail[] = [];
  const sendable: EmailJob[] = [];
  for (const job of jobs) {
    const email = await buildForJob(env, job, deps);
    if (email) {
      emails.push(email);
      sendable.push(job);
    }
  }
  if (emails.length === 0) return;

  await deps.send(emails);

  for (const job of sendable) {
    await recordSent(env, job.userId, job.kind, job.weekStart);
  }
}
