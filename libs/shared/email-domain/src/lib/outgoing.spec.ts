import {
  batchIdempotencyKey,
  listId,
  unsubscribeHeaders,
} from './outgoing';
import { PreparedEmail } from './types';

const job = (over: Partial<PreparedEmail> = {}): PreparedEmail => ({
  userId: 'u1',
  kind: 'weekly',
  weekStart: '2026-01-04',
  to: 'u1@example.com',
  refs: [],
  bucket: 0,
  ...over,
});

describe('batchIdempotencyKey', () => {
  const batch = [
    job({ userId: 'a' }),
    job({ userId: 'b', kind: 'reminder' }),
    job({ userId: 'c' }),
  ];

  it('is stable across a retry of the same batch', async () => {
    expect(await batchIdempotencyKey(batch)).toBe(
      await batchIdempotencyKey(batch),
    );
  });

  it('ignores job order', async () => {
    // The workflow re-plans on a retry; nothing guarantees the same slice order, and
    // a re-ordered batch is the *same* mail — it must collapse, not re-deliver.
    const shuffled = [batch[2], batch[0], batch[1]];
    expect(await batchIdempotencyKey(shuffled)).toBe(
      await batchIdempotencyKey(batch),
    );
  });

  it('changes when a single job changes', async () => {
    // The other direction matters just as much: colliding two *different* batches
    // onto one key would make Resend silently drop genuinely-new mail.
    const key = await batchIdempotencyKey(batch);
    for (const changed of [
      [...batch.slice(0, 2), job({ userId: 'd' })],
      [...batch.slice(0, 2), job({ userId: 'c', kind: 'reminder' })],
      [...batch.slice(0, 2), job({ userId: 'c', weekStart: '2026-01-11' })],
      batch.slice(0, 2), // one fewer job
      [...batch, job({ userId: 'e' })], // one more
    ]) {
      expect(await batchIdempotencyKey(changed)).not.toBe(key);
    }
  });

  it('does not depend on the recipient address or the refs', async () => {
    // The key covers (user, kind, week) — deliberately, because that is exactly what
    // `email_log` dedups on. A changed address is the same logical send.
    expect(
      await batchIdempotencyKey([job({ to: 'moved@example.com' })]),
    ).toBe(await batchIdempotencyKey([job()]));
  });

  it('is a `reminder-batch-` prefixed 32-hex-char key', async () => {
    expect(await batchIdempotencyKey(batch)).toMatch(
      /^reminder-batch-[0-9a-f]{32}$/,
    );
  });

  it('has a key for the empty batch too', async () => {
    expect(await batchIdempotencyKey([])).toMatch(/^reminder-batch-[0-9a-f]{32}$/);
  });
});

describe('listId', () => {
  it('derives the list id from APP_ORIGIN', () => {
    expect(listId('https://app.mishna2go.com')).toBe(
      'Mishna study emails <study.app.mishna2go.com>',
    );
    // The port is part of the host, so a dev origin is still distinct.
    expect(listId('http://localhost:8787')).toBe(
      'Mishna study emails <study.localhost:8787>',
    );
  });

  it('throws rather than stamping a batch with someone else\'s list id', () => {
    // No hardcoded fallback host: the domain is generated from config/domains.json,
    // and an unparseable APP_ORIGIN is a deploy bug that has already broken every
    // link in the email.
    expect(() => listId('not-a-url')).toThrow();
    expect(() => listId('')).toThrow();
  });
});

describe('unsubscribeHeaders', () => {
  const url = 'https://app.test/api/unsubscribe?t=abc.def';
  const headers = unsubscribeHeaders(url, 'https://app.test');

  it('is exactly the three RFC 8058 headers', () => {
    expect(Object.keys(headers).sort()).toEqual([
      'List-Id',
      'List-Unsubscribe',
      'List-Unsubscribe-Post',
    ]);
  });

  it('angle-brackets the URL (RFC 2369)', () => {
    expect(headers['List-Unsubscribe']).toBe(`<${url}>`);
  });

  it('advertises one-click, which is what shows Gmail the button', () => {
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('carries the List-Id for the origin', () => {
    expect(headers['List-Id']).toBe('Mishna study emails <study.app.test>');
  });
});
