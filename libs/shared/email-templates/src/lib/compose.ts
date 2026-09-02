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
  /**
   * The recipient's signed "I've memorized this" URL — the top CTA. Required, not
   * optional: a job that forgets it should be a compile error, not an email that
   * silently ships without the one action it is asking for.
   *
   * Like `unsubscribeUrl` it must be **deterministic per job**. Its token binds
   * (userId, bucket, weekStart-derived expiry), all of which come from the job, so
   * re-composing produces identical bytes — which is what the batch idempotency key
   * promises Resend.
   */
  memorizedUrl: string;
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
  const render = job.kind === 'weekly' ? weeklyEmail : reminderEmail;
  const built = await render(resolved, {
    appOrigin: opts.appOrigin,
    unsubscribeUrl: opts.unsubscribeUrl,
    memorizedUrl: opts.memorizedUrl,
  });
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
