import {
  LOGIN_TTL_DAYS,
  MARK_TTL_DAYS,
  canLogin,
  canMark,
  memorizedExpiresAt,
  memorizedUrl,
  mintMemorizedToken,
  parseMemorizedClaims,
  verifyMemorizedToken,
} from './memorized-token';
import { mintUnsubscribeToken } from './unsubscribe-token';

// The signed "I've memorized this" token, in plain node — it only needs
// `crypto.subtle`/`btoa`/`atob`. This token is a capability on user data and, for a
// bounded window, a login credential, so the escalation cases below (forge a bucket,
// push out the expiry, replay an unsubscribe token) matter more here than they do for
// its unsubscribe sibling. The HTTP-level behavior it backs stays in apps/server's
// `memorized.integration.test.ts`.

const SECRET = 'test-memorized-secret';
const WEEK = '2026-03-01';
const EXP = memorizedExpiresAt(WEEK);
const DAY = 86400_000;

const tokenFor = (userId: string, bucket = 3, exp = EXP) =>
  mintMemorizedToken(SECRET, userId, bucket, exp);

const b64url = (text: string) =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Re-sign nothing: swap the payload half, keep the original signature. */
const withPayload = (token: string, payload: string) =>
  `${b64url(payload)}.${token.split('.')[1]}`;

/** The instant `d` days after the week the token was minted for. */
const at = (days: number) =>
  new Date(new Date(`${WEEK}T00:00:00.000Z`).getTime() + days * DAY);

describe('memorized token', () => {
  // -- round-trip and rotation ------------------------------------------------

  it('round-trips the user, bucket and expiry', async () => {
    expect(await verifyMemorizedToken(SECRET, await tokenFor('alice'))).toEqual(
      {
        userId: 'alice',
        bucket: 3,
        expiresAt: EXP,
      },
    );
  });

  it('round-trips bucket 0 (a falsy value that must survive the parse)', async () => {
    const claims = await verifyMemorizedToken(SECRET, await tokenFor('a', 0));
    expect(claims?.bucket).toBe(0);
  });

  it('round-trips a userId containing dots (the ends-inward parse)', async () => {
    const claims = await verifyMemorizedToken(
      SECRET,
      await tokenFor('a.b.c', 7),
    );
    expect(claims).toEqual({ userId: 'a.b.c', bucket: 7, expiresAt: EXP });
  });

  it('signs with the first secret and verifies against every one', async () => {
    const old = await tokenFor('alice');
    const rotated = 'new-secret,test-memorized-secret';
    // Old links keep working after a rotation...
    expect(await verifyMemorizedToken(rotated, old)).toEqual({
      userId: 'alice',
      bucket: 3,
      expiresAt: EXP,
    });
    // ...and new ones are signed with the newest secret.
    const fresh = await mintMemorizedToken(rotated, 'alice', 3, EXP);
    expect(fresh).toBe(await mintMemorizedToken('new-secret', 'alice', 3, EXP));
    // Pruning a retired secret is *allowed* here (unlike UNSUBSCRIBE_SECRET) and
    // revokes its links — that is the documented incident response.
    expect(await verifyMemorizedToken('new-secret', old)).toBeNull();
  });

  // -- determinism: the Resend idempotency contract ---------------------------

  it('is deterministic across 100 mints', async () => {
    const first = await tokenFor('alice');
    for (let i = 0; i < 100; i++) {
      expect(await tokenFor('alice')).toBe(first);
    }
  });

  it('derives the expiry from weekStart, with no clock', () => {
    // The whole determinism argument reduces to this: same week in, same instant out,
    // no matter when it is called. A Date.now() here would make a retried batch a
    // different body under the same Resend Idempotency-Key (409).
    expect(memorizedExpiresAt(WEEK)).toBe(memorizedExpiresAt(WEEK));
    expect(memorizedExpiresAt(WEEK)).toBe(
      Math.floor(new Date(`${WEEK}T00:00:00.000Z`).getTime() / 1000) +
        MARK_TTL_DAYS * 86400,
    );
    expect(memorizedExpiresAt('2026-03-08')).not.toBe(memorizedExpiresAt(WEEK));
  });

  // -- forgery ----------------------------------------------------------------

  it('rejects a tampered signature', async () => {
    const [payload, sig] = (await tokenFor('alice')).split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(
      await verifyMemorizedToken(SECRET, `${payload}.${flipped}`),
    ).toBeNull();
  });

  it('rejects a bucket escalated under a stolen signature', async () => {
    // The attack this exists to stop: take your own valid link for bucket 3 and
    // re-point it at bucket 4 to mark mishnayos you never saw.
    const token = await tokenFor('alice', 3);
    expect(
      await verifyMemorizedToken(
        SECRET,
        withPayload(token, `m1.alice.4.${EXP}`),
      ),
    ).toBeNull();
  });

  it('rejects an expiry pushed out under a stolen signature', async () => {
    const token = await tokenFor('alice');
    expect(
      await verifyMemorizedToken(
        SECRET,
        withPayload(token, `m1.alice.3.${EXP + 365 * 86400}`),
      ),
    ).toBeNull();
  });

  it('rejects a swapped userId under a stolen signature', async () => {
    const token = await tokenFor('alice');
    expect(
      await verifyMemorizedToken(SECRET, withPayload(token, `m1.bob.3.${EXP}`)),
    ).toBeNull();
  });

  it('rejects a token signed with a foreign secret', async () => {
    const foreign = await mintMemorizedToken('other-secret', 'alice', 3, EXP);
    expect(await verifyMemorizedToken(SECRET, foreign)).toBeNull();
  });

  it('does not accept an unsubscribe token, even under the same secret', async () => {
    // Domain separation: the `v1` vs `m1` version tags mean one token can never be
    // replayed as the other. (In production they also use different secrets.)
    const unsub = await mintUnsubscribeToken(SECRET, 'alice', 'all');
    expect(await verifyMemorizedToken(SECRET, unsub)).toBeNull();
  });

  // -- malformed input: null, never a throw -----------------------------------

  it.each([
    ['empty', ''],
    ['no dot', 'abcdef'],
    ['three parts', 'a.b.c'],
    ['non-base64url', 'not base64!.also-not!'],
    ['truncated', 'aGVsbG8'],
  ])('returns null for %s rather than throwing', async (_label, token) => {
    expect(await verifyMemorizedToken(SECRET, token)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('returns null for a %s token', async (_label, token) => {
    expect(await verifyMemorizedToken(SECRET, token)).toBeNull();
  });

  it.each([
    ['wrong version', 'v1.alice.3.100'],
    ['too few fields', 'm1.alice.3'],
    ['empty userId', 'm1..3.100'],
    ['negative bucket', 'm1.alice.-1.100'],
    ['non-numeric bucket', 'm1.alice.x.100'],
    ['exponential bucket', 'm1.alice.1e3.100'],
    ['signed expiry', 'm1.alice.3.+100'],
    ['padded expiry', 'm1.alice.3. 100'],
    ['non-numeric expiry', 'm1.alice.3.later'],
    ['out-of-range expiry', `m1.alice.3.${'9'.repeat(20)}`],
  ])('parseMemorizedClaims rejects %s', (_label, payload) => {
    expect(parseMemorizedClaims(payload)).toBeNull();
  });

  // -- misconfiguration -------------------------------------------------------

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace-only list', ' , '],
  ])('throws when the secret is %s (fails closed)', async (_label, secret) => {
    await expect(mintMemorizedToken(secret, 'alice', 3, EXP)).rejects.toThrow(
      /MEMORIZED_SECRET/,
    );
  });

  it('verifies nothing when the secret is unset', async () => {
    expect(
      await verifyMemorizedToken(undefined, await tokenFor('alice')),
    ).toBeNull();
  });

  // -- the two windows --------------------------------------------------------

  describe('canMark / canLogin', () => {
    const claims = { userId: 'alice', bucket: 3, expiresAt: EXP };

    it('both allow a click on the send day', () => {
      expect(canMark(claims, at(0))).toBe(true);
      expect(canLogin(claims, at(0))).toBe(true);
    });

    it('canLogin closes at exactly LOGIN_TTL_DAYS', () => {
      expect(canLogin(claims, at(LOGIN_TTL_DAYS))).toBe(true);
      expect(
        canLogin(claims, new Date(at(LOGIN_TTL_DAYS).getTime() + 1000)),
      ).toBe(false);
    });

    it('canMark closes at exactly MARK_TTL_DAYS', () => {
      expect(canMark(claims, at(MARK_TTL_DAYS))).toBe(true);
      expect(
        canMark(claims, new Date(at(MARK_TTL_DAYS).getTime() + 1000)),
      ).toBe(false);
    });

    it('has a window where the link still marks but no longer signs in', () => {
      // The whole point of the two tiers: a month-old forwarded email can still say
      // "I learned these" without still being an account-takeover primitive.
      const late = at(LOGIN_TTL_DAYS + 1);
      expect(canMark(claims, late)).toBe(true);
      expect(canLogin(claims, late)).toBe(false);
    });

    it('canLogin is never more permissive than canMark', () => {
      for (let d = 0; d <= MARK_TTL_DAYS + 2; d++) {
        const now = at(d);
        if (canLogin(claims, now)) expect(canMark(claims, now)).toBe(true);
      }
    });
  });

  // -- the URL ----------------------------------------------------------------

  it('builds the emailed link, encoding the token and trimming the origin', async () => {
    const token = await tokenFor('alice');
    expect(memorizedUrl('https://app.example.com', token)).toBe(
      `https://app.example.com/api/memorized?t=${encodeURIComponent(token)}`,
    );
    expect(memorizedUrl('https://app.example.com///', token)).toBe(
      `https://app.example.com/api/memorized?t=${encodeURIComponent(token)}`,
    );
  });
});
