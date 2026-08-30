import { EmailKind, weekStartToDate } from '@mishna/domain';
import {
  AssignmentSource,
  EmailTransport,
  OutgoingEmail,
  PreparedEmail,
  TextResolver,
  batchIdempotencyKey,
  prepareSingle,
} from '@mishna/email-domain';
import { composeEmail } from '@mishna/email-templates';
import { loadBlocks, loadCompleted, loadRecipient } from './data';

export type { PreparedEmail } from '@mishna/email-domain';
export type { OutgoingEmail } from '@mishna/email-domain';

/**
 * Side-effecting dependencies, injected so `processJobs` is testable offline. The
 * pure halves it used to own — the outgoing shape, the idempotency key, the RFC 8058
 * headers, and the rendering — now live in `@mishna/email-domain` /
 * `@mishna/email-templates`; what's left here is the wiring.
 */
export interface SenderDeps {
  resolveText: TextResolver;
  /**
   * Sends a batch of emails; throws on failure so the caller can retry. The
   * `idempotencyKey` is deterministic per batch, so a retry of the same batch is
   * collapsed by Resend rather than re-delivered.
   */
  send: EmailTransport;
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
 *
 * The *decision* is `prepareSingle` (`@mishna/email-domain`), the same function the
 * bulk path runs — with `skipWhenEmpty: false`, the one deliberate difference: an
 * admin who presses "Send weekly" on a user who has finished their whole portion
 * gets the empty-state email rather than a silent no-op that looks like a broken
 * button. `GET /api/admin/users/:id` reports the counts so the admin sees it coming.
 *
 * The content engine is a **parameter**, not the `../domain` module singleton: this
 * module is I/O wiring, and reaching for a singleton here is what forced the whole
 * email path to be tested inside workerd.
 */
export async function prepareOne(
  env: Env,
  userId: string,
  kind: EmailKind,
  weekStart: string,
  engine: AssignmentSource,
): Promise<PreparedEmail | null> {
  const recipient = await loadRecipient(env, userId);
  if (!recipient) return null;
  const [blocks, completed] = await Promise.all([
    loadBlocks(env, userId),
    loadCompleted(env, userId),
  ]);
  return prepareSingle(
    {
      userId,
      kind,
      weekStart,
      to: recipient.email,
      blocks,
      completed,
      date: weekStartToDate(weekStart),
    },
    engine,
    { skipWhenEmpty: false },
  );
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
    emails.push(
      await composeEmail(job, await deps.resolveText(job.refs), {
        from: deps.from,
        replyTo: deps.replyTo,
        appOrigin: deps.appOrigin,
        unsubscribeUrl: await deps.unsubscribeUrlFor(job.userId),
      }),
    );
  }

  await deps.send(emails, await batchIdempotencyKey(jobs));

  for (const job of jobs) {
    await deps.record(job.userId, job.kind, job.weekStart);
  }
}
