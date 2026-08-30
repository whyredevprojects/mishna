import {
  OutgoingEmail,
  PreparedEmail,
  ResolvedMishna,
  unsubscribeHeaders,
} from '@mishna/email-domain';
import { reminderEmail, weeklyEmail } from './render';

/** Everything a rendered email needs that isn't the job or its text. */
export interface ComposeOptions {
  from: string;
  replyTo: string;
  appOrigin: string;
  /**
   * The recipient's signed one-click unsubscribe URL. One URL per email: it goes in
   * the RFC 8058 headers *and* in the visible footer link (Gmail requires the in-body
   * link in addition to the header). The token is deterministic per user, so
   * re-composing this job produces the identical email — which is what the batch
   * idempotency key promises Resend.
   */
  unsubscribeUrl: string;
}

/**
 * Render one prepared job into the wire-shaped email the transport sends.
 *
 * Pure with respect to the clock and randomness — deliberately, and load-bearing:
 * `batchIdempotencyKey` covers only (user, kind, week), and Resend answers a reused
 * key carrying a *different* payload with `409 invalid_idempotent_request`, which
 * would fail a retried batch and take the rest of the hour's batches with it.
 */
export async function composeEmail(
  job: PreparedEmail,
  resolved: ResolvedMishna[],
  opts: ComposeOptions,
): Promise<OutgoingEmail> {
  const built =
    job.kind === 'weekly'
      ? await weeklyEmail(resolved, opts.appOrigin, opts.unsubscribeUrl)
      : await reminderEmail(resolved, opts.appOrigin, opts.unsubscribeUrl);
  return {
    from: opts.from,
    replyTo: opts.replyTo,
    to: job.to,
    subject: built.subject,
    html: built.html,
    text: built.text,
    headers: unsubscribeHeaders(opts.unsubscribeUrl, opts.appOrigin),
  };
}
