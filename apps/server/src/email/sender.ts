import { EmailKind, MishnaRef } from '@mishna/domain';
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

/**
 * A fully-resolved send: the recipient address and the exact mishnayot to render
 * are already in hand, so the sender does no further DB reads. `planSends` produces
 * these for the bulk path (with batched reads); `prepareOne` produces one for admin
 * "send now". `refs` is the week's quota (weekly) or the still-pending subset
 * (reminder) — whichever the email should show.
 */
export interface PreparedEmail {
  userId: string;
  kind: EmailKind;
  weekStart: string;
  to: string;
  refs: MishnaRef[];
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
  from: string;
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
  const refs = weekRefs(await loadBlocks(env, userId), weekStart);
  const finalRefs = kind === 'weekly' ? refs : await pendingRefs(env, userId, refs);
  return { userId, kind, weekStart, to: recipient.email, refs: finalRefs };
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
function buildEmail(
  job: PreparedEmail,
  resolved: Awaited<ReturnType<TextResolver>>,
  deps: SenderDeps,
): OutgoingEmail {
  const built =
    job.kind === 'weekly'
      ? weeklyEmail(resolved, deps.appOrigin)
      : reminderEmail(resolved, deps.appOrigin);
  return { from: deps.from, to: job.to, subject: built.subject, html: built.html };
}

/**
 * Process a batch of prepared jobs: render each email, send them in one Resend batch
 * call (with a per-batch idempotency key), then log the successful sends. Throws if
 * the send fails so the caller can retry the whole batch — at-least-once, with the
 * idempotency key collapsing the re-delivery and `email_log` deduping across runs.
 */
export async function processJobs(
  env: Env,
  jobs: PreparedEmail[],
  deps: SenderDeps,
): Promise<void> {
  if (jobs.length === 0) return;

  const emails: OutgoingEmail[] = [];
  for (const job of jobs) {
    emails.push(buildEmail(job, await deps.resolveText(job.refs), deps));
  }

  await deps.send(emails, await batchIdempotencyKey(jobs));

  for (const job of jobs) {
    await recordSent(env, job.userId, job.kind, job.weekStart);
  }
}
