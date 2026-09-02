// ---------------------------------------------------------------------------
// The HMAC-signed-token primitives, shared by every stateless link we mail.
//
// Two modules build on these: `unsubscribe-token.ts` (RFC 8058 one-click) and
// `memorized-token.ts` (the "I've memorized this" click-through). Both mint the
// same shape —
//
//   token = base64url(payload) "." base64url(HMAC-SHA256(secret, payload))
//
// — so the crypto lives here once rather than being pasted twice. What differs
// between them is only the payload's fields and the policy around expiry, which is
// exactly what stays in the two callers.
//
// Runtime-agnostic: only `crypto.subtle`, `btoa`/`atob` and `TextEncoder`/
// `TextDecoder`, all present in workerd and node 18+. No clock, no storage — secrets
// are plain arguments — so everything here is unit-testable in plain node.
// ---------------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
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
 * views over a `SharedArrayBuffer`. Widening to a bare `Uint8Array` makes the callers
 * fail to compile against the DOM lib.
 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
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

/**
 * The configured secrets, newest first. Empty when unconfigured.
 *
 * Every secret this backs is a **comma-separated list**: new tokens are signed with
 * the first, verification accepts any. Rotate by prepending and deploying. The
 * retention policy differs per secret and is documented at each call site — they are
 * genuinely opposite (see `unsubscribe-token.ts` vs `memorized-token.ts`).
 */
export function signingSecrets(secret: string | undefined): string[] {
  return (secret ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Sign a payload with `secret` and return the two-part token. Deterministic: the
 * same (secret, payload) always yields the same bytes, which is what keeps a
 * re-rendered email byte-identical (both callers depend on this — see the Resend
 * idempotency note in `memorized-token.ts`).
 */
export async function signToken(
  secret: string,
  payload: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await importKey(secret), bytes),
  );
  return `${toBase64Url(bytes)}.${toBase64Url(signature)}`;
}

/**
 * Verify a token against every configured secret and return its **payload string**,
 * or `null` if it's malformed, truncated, or not signed by us. Never throws — a
 * garbled link must render a friendly page, not a 500. Parsing the payload into
 * claims is the caller's job.
 *
 * Uses `crypto.subtle.verify` (constant-time inside the runtime), never a string
 * comparison of hex digests.
 */
export async function verifyToken(
  secrets: string[],
  token: string | undefined | null,
): Promise<string | null> {
  if (secrets.length === 0 || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payloadBytes = fromBase64Url(parts[0]);
  const signature = fromBase64Url(parts[1]);
  if (!payloadBytes || !signature) return null;

  for (const s of secrets) {
    if (
      await crypto.subtle.verify(
        'HMAC',
        await importKey(s),
        signature,
        payloadBytes,
      )
    ) {
      return new TextDecoder().decode(payloadBytes);
    }
  }
  return null;
}
