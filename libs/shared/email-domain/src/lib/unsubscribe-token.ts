/**
 * RFC 8058 one-click unsubscribe — the signed token and the URL it rides in.
 *
 * The token is a stateless, HMAC-signed claim about *who* is unsubscribing (and
 * from what), so the endpoint needs no session: mail clients POST it from a
 * datacenter with no cookies. It rides in the `List-Unsubscribe` header of every
 * scheduled email (see `outgoing.ts`) **and** in the visible footer link (Gmail wants
 * both).
 *
 * Format:
 *
 *   payload = "v1.<userId>.<scope>"
 *   token   = base64url(payload) "." base64url(HMAC-SHA256(secret, payload))
 *
 * The base64url/HMAC machinery lives in `hmac-token.ts`, shared with the "memorized"
 * click-through token; what stays here is this token's payload and its policy. Pure
 * and runtime-agnostic, with no clock and no storage — the secret is a plain
 * argument — so this is unit-testable in plain node.
 *
 * Notes on the deliberate choices here:
 *
 * - **No timestamp, and therefore no expiry.** A year-old email is still a legitimate
 *   place to unsubscribe from; an expired link there earns a spam report, which is
 *   the exact outcome this feature exists to prevent. Since nothing is ever enforced
 *   against it, minting one would only cost determinism — and that cost is real: the
 *   token rides in the `List-Unsubscribe` header *and* the HTML footer, so a clock in
 *   the payload makes the rendered email differ on every render, while the Resend
 *   `Idempotency-Key` is derived from the job (user/kind/week). Resend answers
 *   `409 invalid_idempotent_request` when a key comes back with a different body, so a
 *   retried batch would fail the whole workflow instead of collapsing. The token is a
 *   pure function of (secret, userId, scope) on purpose.
 * - **`scope` is carried but currently always `all`.** The product decision is that
 *   unsubscribing turns off *both* scheduled emails. Keeping the field means granular
 *   links can ship later without a token-format change (old links keep verifying).
 * - **Secret rotation, and the retention policy that goes with it.**
 *   `UNSUBSCRIBE_SECRET` is a comma-separated list: new tokens are signed with the
 *   first, verification accepts any of them. Rotate by **prepending** the new secret and
 *   deploying — nothing else is required, and no link ever breaks.
 *
 *   The policy is that the list is **append-only: never prune by default.** These
 *   tokens have no expiry and ride in mail recipients keep forever, so dropping a secret
 *   permanently kills the unsubscribe link in every message signed with it — and a dead
 *   unsubscribe link is precisely what earns the spam report this feature exists to
 *   prevent. The cost of keeping one is a single extra `crypto.subtle.verify` per
 *   retired secret, only on the (rare) requests whose token doesn't match a newer one.
 *
 *   If a secret ever genuinely *must* go (compromise, say), the floor is **24 months**
 *   after the last send that used it, and removal is a deliberate, documented act —
 *   accepting that any older mail still in an inbox loses its one-click link.
 *   (`apps/server/CLAUDE.md` "One-time setup" carries the same policy.)
 * - Every parse failure (missing dot, bad base64, wrong version, unknown scope) is a
 *   `null` return, never a throw — a malformed link must render a friendly page, not a
 *   500.
 */

import { signingSecrets, signToken, verifyToken } from './hmac-token';

export type UnsubscribeScope = 'all' | 'weekly' | 'reminder';

export interface UnsubscribeClaims {
  userId: string;
  scope: UnsubscribeScope;
}

/**
 * The two languages the unsubscribe landing page speaks. Declared here (rather than
 * in `unsubscribe-page.ts`) because `unsubscribeUrl` can pin one into the emailed
 * link, and this module must not depend on the page.
 */
export type UnsubscribeLang = 'en' | 'he';

// The payload's version tag: the lever for changing the format later (verify can then
// accept both while old mail ages out). It stays `v1` here because the four-field
// `v1.<userId>.<scope>.<issuedAt>` shape it briefly had never shipped — no token of
// that form exists outside an unpushed branch, so there is nothing to stay
// compatible with.
const VERSION = 'v1';
const SCOPES: readonly string[] = ['all', 'weekly', 'reminder'];

/**
 * Mint a token for a user. Signed with the **first** configured secret, and
 * **deterministic** — the same (secret, userId, scope) always yields the same token,
 * which is what keeps a re-rendered email byte-identical (see the header note).
 * Throws only when `UNSUBSCRIBE_SECRET` is missing entirely — a misconfiguration
 * the send path should fail loudly on rather than mail unusable links.
 */
export async function mintUnsubscribeToken(
  secret: string | undefined,
  userId: string,
  scope: UnsubscribeScope = 'all',
): Promise<string> {
  const secrets = signingSecrets(secret);
  if (secrets.length === 0) {
    throw new Error(
      'UNSUBSCRIBE_SECRET is not set — cannot sign unsubscribe links (wrangler secret put UNSUBSCRIBE_SECRET)',
    );
  }
  return signToken(secrets[0], `${VERSION}.${userId}.${scope}`);
}

/**
 * The claims a payload encodes, or `null` if it isn't one of ours. Parsed from the
 * ends inward so a userId containing a `.` can't shift the fields.
 *
 * Exported for its own unit test: the ends-inward parse is deliberate and would
 * otherwise only be reachable through a minted token.
 */
export function parseClaims(payload: string): UnsubscribeClaims | null {
  const parts = payload.split('.');
  if (parts.length < 3 || parts[0] !== VERSION) return null;
  const scope = parts[parts.length - 1];
  const userId = parts.slice(1, -1).join('.');
  if (!SCOPES.includes(scope)) return null;
  if (userId === '') return null;
  return { userId, scope: scope as UnsubscribeScope };
}

/**
 * Verify a token against every configured secret and return its claims, or `null`
 * if it's malformed, truncated, or not signed by us. Never throws.
 */
export async function verifyUnsubscribeToken(
  secret: string | undefined,
  token: string | undefined | null,
): Promise<UnsubscribeClaims | null> {
  const payload = await verifyToken(signingSecrets(secret), token);
  return payload === null ? null : parseClaims(payload);
}

/** The link that goes in the mail: header + visible footer. */
export function unsubscribeUrl(
  appOrigin: string,
  token: string,
  lang?: UnsubscribeLang,
): string {
  const base = `${appOrigin.replace(/\/+$/, '')}/api/unsubscribe?t=${encodeURIComponent(token)}`;
  return lang ? `${base}&lang=${lang}` : base;
}
