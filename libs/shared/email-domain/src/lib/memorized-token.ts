// ---------------------------------------------------------------------------
// The "I've memorized this" click-through — the signed token and the URL it rides in.
//
// Every scheduled email carries a prominent CTA at the top. Clicking it marks exactly
// the mishnayot that email showed as learned, and signs the reader in, without their
// having to find the app and check boxes. That makes this token a **capability**, and
// for a bounded window a **login credential** — so it is a strictly more dangerous
// object than the unsubscribe token next door, and the differences below are all
// deliberate.
//
// Format:
//
//   payload = "m1.<userId>.<bucket>.<expiresAt>"
//   token   = base64url(payload) "." base64url(HMAC-SHA256(secret, payload))
//
// The base64url/HMAC machinery is shared with `unsubscribe-token.ts` via
// `hmac-token.ts`; what lives here is this token's payload and its policy. Pure — no
// clock, no storage, the secret is a plain argument — so it is unit-testable in plain
// node even though it only ever runs inside a Worker.
//
// Notes on the deliberate choices here:
//
// - **`bucket` is the whole "which mishnayot" payload**, and it is pinned at *send*
//   time rather than recomputed at click time. `AssignmentEngine.getBucketAssignment`
//   is a positional slice whose `pace` is anchored to the user's join date, not to
//   "now", so an index reproduces the exact refs the email listed for the rest of the
//   cycle — in ~2 characters instead of a ref list. Recomputing instead would be a
//   real bug: `nextUnlearnedBucket` advances as soon as a bucket is complete, so a
//   user who checked the bucket off in the app first would have the emailed link mark
//   the *next* bucket, which they never saw.
//
// - **`expiresAt` is derived from the job, never from the clock.** It is
//   `weekStart + MARK_TTL_DAYS`, and `weekStart` is already a field of the
//   `PreparedEmail` this token is minted for. That matters beyond tidiness: the token
//   is rendered *into* the email body, while the Resend `Idempotency-Key` is derived
//   from the job (user/kind/week). Resend answers `409 invalid_idempotent_request`
//   when a key comes back with a different body, so any `Date.now()` in this payload
//   would make a retried batch fail the whole workflow instead of collapsing. Deriving
//   the instant from `weekStart` keeps the token a pure function of (secret, job) —
//   byte-identical on re-render — *and* gives it a real, enforceable expiry. The
//   unsubscribe token gave up expiry to keep that determinism; this one gets both.
//   `apps/server`'s email integration test pins it: two `processJobs` runs with the
//   system clock advanced between them must produce identical bytes.
//
// - **Two windows, one signed instant.** `canMark` runs the full 30 days; `canLogin`
//   closes after 7. A month-old link in a forwarded mailbox should still be able to
//   say "yes, I learned these" — that write is idempotent, low-value and reversible —
//   but it should not still be an account-takeover primitive. Both windows are
//   computed from the same signed `expiresAt`, so there is exactly one field to forge
//   and the MAC covers it.
//
// - **Secret rotation, and the retention policy — the mirror image of the
//   unsubscribe one.** `MEMORIZED_SECRET` is a comma-separated list: sign with the
//   first, verify against all, rotate by prepending. But where `UNSUBSCRIBE_SECRET` is
//   **append-only and never pruned** (those tokens never expire, and a dead
//   unsubscribe link earns the spam report the feature exists to prevent), this list
//   is **prunable and revocable**: every token signed with a retired secret is dead
//   within 30 days anyway, so a secret can be dropped 60 days after its last send. And
//   if one is ever suspected of leaking, **remove it immediately** — that is the
//   correct incident response here, not the harm. It revokes every outstanding link in
//   one deploy, and the worst outcome is a dead button.
//
// - Every parse failure is a `null` return, never a throw — a garbled link must render
//   a friendly page, not a 500.
// ---------------------------------------------------------------------------

import { weekStartToDate } from '@mishna/domain';
import { signingSecrets, signToken, verifyToken } from './hmac-token';

export interface MemorizedClaims {
  userId: string;
  /** The positional bucket index the email listed; see the header note on pinning. */
  bucket: number;
  /** Epoch **seconds**. Signed, so it cannot be pushed out. */
  expiresAt: number;
}

/** How long the link can still mark mishnayot learned. */
export const MARK_TTL_DAYS = 30;

/**
 * How long the link can still sign someone in — deliberately shorter than
 * {@link MARK_TTL_DAYS}. A click after this still marks; it just lands on the
 * "marked — open the app" page instead of an authenticated session.
 */
export const LOGIN_TTL_DAYS = 7;

const DAY_SECONDS = 86400;
const VERSION = 'm1';

/**
 * The token's expiry for a given send: `weekStart + MARK_TTL_DAYS`, in epoch seconds.
 *
 * The single place this derivation lives, and the reason the whole scheme stays
 * deterministic — this function has no clock. See the header note.
 */
export function memorizedExpiresAt(weekStart: string): number {
  return (
    Math.floor(weekStartToDate(weekStart).getTime() / 1000) +
    MARK_TTL_DAYS * DAY_SECONDS
  );
}

/**
 * Mint a token. Signed with the **first** configured secret, and deterministic — the
 * same (secret, userId, bucket, expiresAt) always yields the same bytes, which is what
 * keeps a re-rendered email byte-identical.
 *
 * Throws when `MEMORIZED_SECRET` is missing entirely: a send that quietly mailed
 * unusable CTAs would be worse than a loud failure, and this is the same fail-closed
 * posture `mintUnsubscribeToken` takes.
 */
export async function mintMemorizedToken(
  secret: string | undefined,
  userId: string,
  bucket: number,
  expiresAt: number,
): Promise<string> {
  const secrets = signingSecrets(secret);
  if (secrets.length === 0) {
    throw new Error(
      'MEMORIZED_SECRET is not set — cannot sign memorized links (wrangler secret put MEMORIZED_SECRET)',
    );
  }
  return signToken(secrets[0], `${VERSION}.${userId}.${bucket}.${expiresAt}`);
}

/**
 * The claims a payload encodes, or `null` if it isn't one of ours.
 *
 * Parsed from the ends inward so a userId containing a `.` can't shift `bucket` or
 * `expiresAt`. Both trailing fields must be plain non-negative integers: a `bucket`
 * of `1e3` or `01` or `-1` is not something we ever mint, so accepting it would only
 * widen what a forger gets to try.
 *
 * Exported for its own unit test — the ends-inward parse is deliberate and would
 * otherwise only be reachable through a minted token.
 */
export function parseMemorizedClaims(payload: string): MemorizedClaims | null {
  const parts = payload.split('.');
  if (parts.length < 4 || parts[0] !== VERSION) return null;
  const expiresAtRaw = parts[parts.length - 1];
  const bucketRaw = parts[parts.length - 2];
  const userId = parts.slice(1, -2).join('.');
  if (userId === '') return null;
  if (!/^\d+$/.test(bucketRaw) || !/^\d+$/.test(expiresAtRaw)) return null;
  const bucket = Number(bucketRaw);
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(bucket) || !Number.isSafeInteger(expiresAt)) {
    return null;
  }
  return { userId, bucket, expiresAt };
}

/**
 * Verify a token against every configured secret and return its claims, or `null` if
 * it's malformed, truncated, or not signed by us. Never throws.
 *
 * Deliberately does **not** check expiry: there are two windows over the same token
 * ({@link canMark} and {@link canLogin}) and which one applies is the caller's
 * decision, so folding one of them in here would silently pick for them.
 */
export async function verifyMemorizedToken(
  secret: string | undefined,
  token: string | undefined | null,
): Promise<MemorizedClaims | null> {
  const payload = await verifyToken(signingSecrets(secret), token);
  return payload === null ? null : parseMemorizedClaims(payload);
}

/** Whether the link may still mark mishnayot learned (the full 30-day window). */
export function canMark(claims: MemorizedClaims, now: Date): boolean {
  return Math.floor(now.getTime() / 1000) <= claims.expiresAt;
}

/**
 * Whether the link may still sign someone in — the same signed instant, pulled in to
 * {@link LOGIN_TTL_DAYS} from the send. Always at least as strict as {@link canMark}.
 */
export function canLogin(claims: MemorizedClaims, now: Date): boolean {
  const loginDeadline =
    claims.expiresAt - (MARK_TTL_DAYS - LOGIN_TTL_DAYS) * DAY_SECONDS;
  return Math.floor(now.getTime() / 1000) <= loginDeadline;
}

/**
 * The link that goes in the mail. No `lang`: the email chrome is English, and the
 * landing page negotiates language from `Accept-Language` (same reasoning as
 * `unsubscribeUrl`'s optional one going unused on the send path).
 */
export function memorizedUrl(appOrigin: string, token: string): string {
  return `${appOrigin.replace(/\/+$/, '')}/api/memorized?t=${encodeURIComponent(token)}`;
}
