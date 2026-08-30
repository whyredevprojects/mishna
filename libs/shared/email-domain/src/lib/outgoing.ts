// ---------------------------------------------------------------------------
// The wire shape of an outgoing email, the transport port that carries it, and the
// three header/keying rules that ride along with a batch.
//
// Pure (only `crypto.subtle.digest`, present in workerd and node 18+), so the
// idempotency-key and header contracts are testable without a network or a renderer.
// ---------------------------------------------------------------------------

import { PreparedEmail } from './types';

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
   * is unreadable in text-only clients). Built alongside the HTML in
   * `@mishna/email-templates`.
   */
  text: string;
  /**
   * Custom RFC 5322 headers. Resend's batch API takes these per element
   * (`CreateBatchEmailOptions.headers`), so they ride along with the batch send.
   * Used for the RFC 8058 one-click unsubscribe headers (see {@link unsubscribeHeaders}).
   */
  headers?: Record<string, string>;
}

/**
 * The send port: hands a batch to the mail provider, throwing on failure so the
 * caller can retry the whole batch. The `idempotencyKey` is deterministic per batch
 * (see {@link batchIdempotencyKey}), so a retry of the same batch is collapsed by the
 * provider rather than re-delivered.
 *
 * Named rather than inlined on `SenderDeps` so the seam is visible: production wires
 * Resend, tests wire a recorder, and Agent B's local tooling can wire a file writer.
 */
export type EmailTransport = (
  emails: OutgoingEmail[],
  idempotencyKey: string,
) => Promise<void>;

/**
 * A deterministic Idempotency-Key for a batch, derived from its contents (sorted, so
 * order doesn't matter). A retry of the *same* batch yields the same key; a different
 * set of jobs yields a different one. SHA-256 so distinct batches can't collide into
 * one key (which would make Resend drop genuinely-new mail).
 *
 * The other half of the contract is the rendered email: Resend answers a reused key
 * that arrives with a *different* payload with `409 invalid_idempotent_request`, so
 * the email must be a pure function of the same job fields this key covers — no
 * clocks, no randomness (see the note on the unsubscribe token's format).
 */
export async function batchIdempotencyKey(
  jobs: PreparedEmail[],
): Promise<string> {
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
 * the worker as `APP_ORIGIN` (`npm run sync:domains`), so a literal here would be an
 * un-synced second source of truth. An unparseable `APP_ORIGIN` is a deploy bug that
 * has already broken every link in the email — better to throw than to mail a batch
 * stamped with someone else's list id.
 */
export function listId(appOrigin: string): string {
  return `Mishna study emails <study.${new URL(appOrigin).host}>`;
}

/**
 * The three RFC 8058 headers every scheduled email carries.
 *
 * `List-Unsubscribe` must be angle-bracketed (RFC 2369), and the URL must accept a
 * POST that unsubscribes without further interaction — `List-Unsubscribe-Post` is what
 * tells Gmail/Yahoo the one-click button is safe to show. Transactional mail
 * (`apps/login`'s verification/reset) deliberately gets none of these.
 */
export function unsubscribeHeaders(
  unsubscribeUrl: string,
  appOrigin: string,
): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'List-Id': listId(appOrigin),
  };
}
