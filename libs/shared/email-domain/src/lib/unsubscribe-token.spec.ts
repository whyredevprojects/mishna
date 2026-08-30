import {
  mintUnsubscribeToken,
  parseClaims,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from './unsubscribe-token';

// The signed one-click-unsubscribe token, in plain node. It only needs
// `crypto.subtle`/`btoa`/`atob`, so none of this requires workerd — the cases that
// used to live in apps/server's `unsubscribe.integration.test.ts` are ported here and
// extended. The HTTP-level behavior (always-200, read-only GET, the D1 upsert) stays
// in that integration test, where it belongs.

const SECRET = 'test-unsubscribe-secret';

const tokenFor = (userId: string) => mintUnsubscribeToken(SECRET, userId, 'all');

/** Flip one character of a base64url segment, keeping it valid base64url. */
function flipChar(segment: string, at = 0): string {
  const c = segment[at];
  const other = c === 'A' ? 'B' : 'A';
  return segment.slice(0, at) + other + segment.slice(at + 1);
}

function b64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('unsubscribe token', () => {
  // -- ported from apps/server/src/unsubscribe.integration.test.ts ------------

  it('round-trips the user and scope', async () => {
    expect(await verifyUnsubscribeToken(SECRET, await tokenFor('alice'))).toEqual(
      { userId: 'alice', scope: 'all' },
    );
  });

  it('is deterministic: the same user always gets the same token', async () => {
    // The token rides in the email body, and the batch's Resend Idempotency-Key
    // covers only (user, kind, week) — so a clock in the payload would make a
    // retried batch a *different* payload under the same key (409).
    expect(await tokenFor('alice')).toBe(await tokenFor('alice'));
    expect(await tokenFor('alice')).not.toBe(await tokenFor('bob'));
    expect(await mintUnsubscribeToken(SECRET, 'alice', 'weekly')).not.toBe(
      await tokenFor('alice'),
    );
  });

  it('stays byte-identical over 100 mints', async () => {
    // The determinism above is the contract; this is the "no hidden entropy anywhere"
    // version of it. A single sampled equality would miss a 1-in-N nonce.
    const first = await tokenFor('alice');
    for (let i = 0; i < 100; i++) {
      expect(await tokenFor('alice')).toBe(first);
    }
  });

  it('fails closed when UNSUBSCRIBE_SECRET is unset', async () => {
    // A misconfigured deploy must not mail links that can never verify.
    for (const missing of [undefined, '', ' , ', '   ', ',,,']) {
      await expect(mintUnsubscribeToken(missing, 'alice')).rejects.toThrow(
        /UNSUBSCRIBE_SECRET/,
      );
    }
    // ...and nothing verifies against no secret either.
    for (const missing of [undefined, '', ' , ']) {
      expect(
        await verifyUnsubscribeToken(missing, await tokenFor('alice')),
      ).toBeNull();
    }
  });

  it('verifies against any configured secret but signs with the first', async () => {
    // Rotation: mint under the old secret, verify with [new, old].
    const old = await mintUnsubscribeToken('old-secret', 'alice');
    expect(
      await verifyUnsubscribeToken('new-secret,old-secret', old),
    ).toMatchObject({ userId: 'alice' });
    // ...and a token minted under the rotated list is signed by the *new* one.
    const fresh = await mintUnsubscribeToken('new-secret,old-secret', 'alice');
    expect(await verifyUnsubscribeToken('new-secret', fresh)).toMatchObject({
      userId: 'alice',
    });
    expect(await verifyUnsubscribeToken('old-secret', fresh)).toBeNull();
    // Dropping a secret from the list kills every link signed with it — which is
    // exactly why the documented policy is that the list is append-only.
    expect(await verifyUnsubscribeToken('new-secret', old)).toBeNull();
    // Whitespace around entries is trimmed, so a list can be formatted readably.
    expect(
      await verifyUnsubscribeToken(' new-secret , old-secret ', old),
    ).toMatchObject({ userId: 'alice' });
  });

  it('rejects malformed input without throwing', async () => {
    const good = await tokenFor('alice');
    for (const bad of [
      '',
      'nodot',
      'a.b.c',
      '!!!.!!!',
      good.slice(0, -4),
      `${good}x`,
      undefined,
      null,
    ]) {
      expect(await verifyUnsubscribeToken(SECRET, bad)).toBeNull();
    }
    // A payload signed by someone else's key.
    const forged = await mintUnsubscribeToken('not-our-secret', 'alice');
    expect(await verifyUnsubscribeToken(SECRET, forged)).toBeNull();
  });

  it('builds the emailed URL', async () => {
    expect(unsubscribeUrl('https://app.test', 'abc.def')).toBe(
      'https://app.test/api/unsubscribe?t=abc.def',
    );
    expect(unsubscribeUrl('https://app.test/', 'abc.def', 'he')).toBe(
      'https://app.test/api/unsubscribe?t=abc.def&lang=he',
    );
    // The token is percent-encoded, so a `+`/`/`-bearing token can't corrupt the query.
    expect(unsubscribeUrl('https://app.test', 'a+b/c=')).toBe(
      'https://app.test/api/unsubscribe?t=a%2Bb%2Fc%3D',
    );
  });

  // -- forgery -----------------------------------------------------------------

  it('rejects a token whose signature has been altered by one character', async () => {
    const [payload, sig] = (await tokenFor('alice')).split('.');
    const tampered = `${payload}.${flipChar(sig)}`;
    expect(tampered).not.toBe(`${payload}.${sig}`);
    expect(await verifyUnsubscribeToken(SECRET, tampered)).toBeNull();
  });

  it('rejects a re-encoded payload naming a different user under the original signature', async () => {
    // The attack the HMAC exists to stop: keep the signature, swap the claim.
    const [, sig] = (await tokenFor('alice')).split('.');
    const forgedPayload = b64url('v1.mallory.all');
    expect(await verifyUnsubscribeToken(SECRET, `${forgedPayload}.${sig}`)).toBeNull();
  });

  it('does not let a narrower scope escalate to `all`', async () => {
    // `scope` is inside the signed payload, so a weekly-only link can never be
    // replayed as the "turn everything off" one (nor the reverse).
    const weekly = await mintUnsubscribeToken(SECRET, 'alice', 'weekly');
    expect(await verifyUnsubscribeToken(SECRET, weekly)).toEqual({
      userId: 'alice',
      scope: 'weekly',
    });
    const [, allSig] = (await tokenFor('alice')).split('.');
    const [weeklyPayload] = weekly.split('.');
    // Splicing the `all` token's signature onto the weekly payload (or vice versa)
    // verifies as neither.
    expect(
      await verifyUnsubscribeToken(SECRET, `${weeklyPayload}.${allSig}`),
    ).toBeNull();
  });

  it("a token minted for A never yields B's id", async () => {
    const claims = await verifyUnsubscribeToken(SECRET, await tokenFor('alice'));
    expect(claims?.userId).toBe('alice');
    expect(claims?.userId).not.toBe('bob');
    // ...and bob's token is a different string entirely, so they can't be confused.
    expect(await tokenFor('bob')).not.toBe(await tokenFor('alice'));
  });

  // -- the payload parser ------------------------------------------------------

  it('round-trips a userId containing dots', async () => {
    // better-auth ids are opaque; `parseClaims` reads the fields from the ends inward
    // precisely so an id with a `.` in it can't shift `scope` out of position.
    const id = 'usr.with.dots';
    expect(await verifyUnsubscribeToken(SECRET, await tokenFor(id))).toEqual({
      userId: id,
      scope: 'all',
    });
  });

  it('parses claims from the ends inward, and rejects anything else', () => {
    expect(parseClaims('v1.usr.with.dots.all')).toEqual({
      userId: 'usr.with.dots',
      scope: 'all',
    });
    expect(parseClaims('v1.alice.reminder')).toEqual({
      userId: 'alice',
      scope: 'reminder',
    });
    for (const bad of [
      '', // empty
      'v1.alice', // no scope
      'v2.alice.all', // future version
      'v1.alice.everything', // unknown scope
      'v1..all', // empty userId
      'alice.all', // no version
    ]) {
      expect(parseClaims(bad), bad).toBeNull();
    }
  });
});
