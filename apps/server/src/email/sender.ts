import { EmailKind, weekStartToDate } from '@mishna/domain';
import { PreparedEmail, refsForKind } from '@mishna/email-domain';
import { loadBlocks, loadCompleted, loadRecipient } from './data';
import { TextResolver, nextRefs } from './quota';
import { reminderEmail, weeklyEmail } from './templates';

export type { PreparedEmail } from '@mishna/email-domain';

/** One outgoing email, in Resend's batch shape. */
export interface OutgoingEmail {
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  html: string;
}

/** Side-effecting dependencies, injected so the consumer is testable offline. */
export interface SenderDeps {
  resolveText: TextResolver;
  /**
   * Sends a batch of emails; throws on failure so the caller can retry. The
   * `idempotencyKey` is deterministic per batch, so a retry of the same batch is
   * collapsed by Resend rather than re-delivered.
   */
  send: (emails: OutgoingEmail[], idempotencyKey: string) => Promise<void>;
  /**
   * Persist a successful send (the `email_log` dedup write), so the same
   * (user, kind, week) isn't re-sent on a later run. Wired to the
   * `D1EmailRepository.recordSent` of `@mishna/email-data` in production.
   */
  record: (userId: string, kind: EmailKind, weekStart: string) => Promise<void>;
  from: string;
  replyTo: string;
  appOrigin: string;
}

/**
 * Resolve one user's send for the admin "send now" path, or null if they can't be
 * emailed. Per-user DB reads — fine at volume 1. The bulk path does NOT use this; it
 * prepares many at once with batched reads in `planSends`.
 */
export async function prepareOne(
  env: Env,
  userId: string,
  kind: EmailKind,
  weekStart: string,
): Promise<PreparedEmail | null> {
  const recipient = await loadRecipient(env, userId);
  if (!recipient) return null;
  const completed = await loadCompleted(env, userId);
  const next = nextRefs(
    await loadBlocks(env, userId),
    completed,
    weekStartToDate(weekStart),
  );
  const refs = refsForKind(kind, next, completed);
  return { userId, kind, weekStart, to: recipient.email, refs };
}

/**
 * A deterministic Idempotency-Key for a batch, derived from its contents (sorted, so
 * order doesn't matter). A retry of the *same* batch yields the same key; a different
 * set of jobs yields a different one. SHA-256 so distinct batches can't collide into
 * one key (which would make Resend drop genuinely-new mail).
 */
async function batchIdempotencyKey(jobs: PreparedEmail[]): Promise<string> {
  const canonical = jobs
    .map((j) => `${j.userId}:${j.kind}:${j.weekStart}`)
    .sort()
    .join(';');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `reminder-batch-${hex.slice(0, 32)}`;
}

/** Render the email for one prepared job. */
async function buildEmail(
  job: PreparedEmail,
  resolved: Awaited<ReturnType<TextResolver>>,
  deps: SenderDeps,
): Promise<OutgoingEmail> {
  const built =
    job.kind === 'weekly'
      ? await weeklyEmail(resolved, deps.appOrigin)
      : await reminderEmail(resolved, deps.appOrigin);
  return {
    from: deps.from,
    replyTo: deps.replyTo,
    to: job.to,
    subject: built.subject,
    html: built.html,
  };
}

/**
 * Process a batch of prepared jobs: render each email, send them in one Resend batch
 * call (with a per-batch idempotency key), then log the successful sends. Throws if
 * the send fails so the caller can retry the whole batch — at-least-once, with the
 * idempotency key collapsing the re-delivery and `email_log` deduping across runs.
 */
export async function processJobs(
  jobs: PreparedEmail[],
  deps: SenderDeps,
): Promise<void> {
  if (jobs.length === 0) return;

  const emails: OutgoingEmail[] = [];
  for (const job of jobs) {
    emails.push(await buildEmail(job, await deps.resolveText(job.refs), deps));
  }

  await deps.send(emails, await batchIdempotencyKey(jobs));

  for (const job of jobs) {
    await deps.record(job.userId, job.kind, job.weekStart);
  }
}
