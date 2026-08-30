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
 * Pure and runtime-agnostic: only `crypto.subtle`, `btoa`/`atob` and
 * `TextEncoder`/`TextDecoder`, all present in workerd and node 18+. No clock, no
 * storage — the secret is a plain argument, so this is unit-testable in plain node.
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
 * - Verification uses `crypto.subtle.verify` (constant-time inside the runtime), never
 *   a string comparison of hex digests.
 * - Every parse failure (missing dot, bad base64, wrong version, unknown scope) is a
 *   `null` return, never a throw — a malformed link must render a friendly page, not a
 *   500.
 */

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

// -- base64url --------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode base64url, or `null` for anything that isn't valid base64url.
 *
 * The `Uint8Array<ArrayBuffer>` return type is load-bearing, not decoration: the
 * bytes are handed to `crypto.subtle.verify`, whose `BufferSource` parameter excludes
 * views over a `SharedArrayBuffer`. Widening to a bare `Uint8Array` makes this file
 * fail to compile against the DOM lib.
 */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (text === '' || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// -- signing ----------------------------------------------------------------

/** The configured secrets, newest first. Empty when unconfigured. */
function signingSecrets(secret: string | undefined): string[] {
  return (secret ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

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
  const payload = `${VERSION}.${userId}.${scope}`;
  const bytes = new TextEncoder().encode(payload);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await importKey(secrets[0]), bytes),
  );
  return `${toBase64Url(bytes)}.${toBase64Url(signature)}`;
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
  const secrets = signingSecrets(secret);
  if (secrets.length === 0 || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payloadBytes = fromBase64Url(parts[0]);
  const signature = fromBase64Url(parts[1]);
  if (!payloadBytes || !signature) return null;

  let valid = false;
  for (const s of secrets) {
    if (
      await crypto.subtle.verify(
        'HMAC',
        await importKey(s),
        signature,
        payloadBytes,
      )
    ) {
      valid = true;
      break;
    }
  }
  if (!valid) return null;
  return parseClaims(new TextDecoder().decode(payloadBytes));
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
