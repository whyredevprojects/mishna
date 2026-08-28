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
  /**
   * The `text/plain` alternative. **Required**, not optional: Resend sends a
   * `multipart/alternative` when it gets both parts, and a missing text part should be
   * a compile error rather than a silent HTML-only send (which costs deliverability and
   * is unreadable in text-only clients). Built alongside the HTML in `templates/`.
   */
  text: string;
  /**
   * Custom RFC 5322 headers. Resend's batch API takes these per element
   * (`CreateBatchEmailOptions.headers`), so they ride along with the batch send.
   * Used for the RFC 8058 one-click unsubscribe headers (see `buildEmail`).
   */
  headers?: Record<string, string>;
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
  /**
   * The user's signed one-click unsubscribe URL. Injected (like `send`/`record`) so
   * `processJobs` stays offline-testable and the HMAC secret never reaches this module.
   */
  unsubscribeUrlFor: (userId: string) => Promise<string>;
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
 *
 * The other half of the contract is `buildEmail`: Resend answers a reused key that
 * arrives with a *different* payload with `409 invalid_idempotent_request`, so the
 * rendered email must be a pure function of the same job fields this key covers —
 * no clocks, no randomness (see the note on the unsubscribe token's format).
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

/**
 * A human-readable RFC 2919 list id for the scheduled mail. Gmail's bulk-sender
 * rules want *either* a stable `List-Id` per subscription type or a distinct `From:`
 * per type; the reminder already comes from the same sender as the weekly, so the
 * list id is the belt to that braces.
 *
 * No hardcoded host fallback: the domain lives in `config/domains.json` and reaches
 * this worker as `APP_ORIGIN` (`npm run sync:domains`), so a literal here would be an
 * un-synced second source of truth. An unparseable `APP_ORIGIN` is a deploy bug that
 * has already broken every link in the email — better to throw than to mail a batch
 * stamped with someone else's list id.
 */
function listId(appOrigin: string): string {
  return `Mishna study emails <study.${new URL(appOrigin).host}>`;
}

/** Render the email for one prepared job. */
async function buildEmail(
  job: PreparedEmail,
  resolved: Awaited<ReturnType<TextResolver>>,
  deps: SenderDeps,
): Promise<OutgoingEmail> {
  // One URL per email: it goes in the RFC 8058 header *and* in the visible footer
  // link (Gmail requires the in-body link in addition to the header). The token is
  // deterministic per user, so re-rendering this job produces the identical email —
  // which is what the batch idempotency key promises Resend.
  const unsubscribeUrl = await deps.unsubscribeUrlFor(job.userId);
  const built =
    job.kind === 'weekly'
      ? await weeklyEmail(resolved, deps.appOrigin, unsubscribeUrl)
      : await reminderEmail(resolved, deps.appOrigin, unsubscribeUrl);
  return {
    from: deps.from,
    replyTo: deps.replyTo,
    to: job.to,
    subject: built.subject,
    html: built.html,
    text: built.text,
    headers: {
      // RFC 8058: the URL must accept a POST that unsubscribes without further
      // interaction. `List-Unsubscribe-Post` is what tells Gmail/Yahoo the
      // one-click button is safe to show.
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'List-Id': listId(deps.appOrigin),
    },
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
