import { SELF, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from './apply-migrations';
import {
  mintUnsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from './email/unsubscribe';
import '.';

// The one-click unsubscribe endpoint. No auth: the token is the authorization, so
// these requests carry no Cookie header on purpose.

const SECRET = env.UNSUBSCRIBE_SECRET;

function tokenFor(userId: string): Promise<string> {
  return mintUnsubscribeToken(SECRET, userId, 'all');
}

/** POST as a mail client's one-click request (RFC 8058). */
function oneClick(token: string): Promise<Response> {
  return SELF.fetch(
    `https://server/api/unsubscribe?t=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    },
  );
}

interface FlagsRow {
  weekly_enabled: number;
  reminder_enabled: number;
  unsubscribed_at: number | null;
  unsubscribed_via: string | null;
}

function flags(userId: string): Promise<FlagsRow | null> {
  return env.DB.prepare(
    `SELECT weekly_enabled, reminder_enabled, unsubscribed_at, unsubscribed_via
       FROM user_email_prefs WHERE user_id = ?`,
  )
    .bind(userId)
    .first<FlagsRow>();
}

async function seedPrefs(userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_email_prefs
       (user_id, timezone, weekly_email_dow, reminder_email_dow, weekly_enabled, reminder_enabled, updated_at)
       VALUES (?, 'Asia/Jerusalem', 2, 5, 1, 1, 0)`,
  )
    .bind(userId)
    .run();
}

describe('one-click unsubscribe', () => {
  beforeAll(() => applyMigrations(env.DB));
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM user_email_prefs');
  });

  describe('token', () => {
    it('round-trips the user and scope', async () => {
      const claims = await verifyUnsubscribeToken(
        SECRET,
        await tokenFor('alice'),
      );
      expect(claims).toMatchObject({ userId: 'alice', scope: 'all' });
      expect(claims?.issuedAt).toBeGreaterThan(0);
    });

    it('verifies against any configured secret but signs with the first', async () => {
      // Rotation: mint under the old secret, verify with [new, old].
      const old = await mintUnsubscribeToken('old-secret', 'alice');
      expect(
        await verifyUnsubscribeToken('new-secret,old-secret', old),
      ).toMatchObject({
        userId: 'alice',
      });
      // ...and a token minted under the rotated list is signed by the *new* one.
      const fresh = await mintUnsubscribeToken(
        'new-secret,old-secret',
        'alice',
      );
      expect(await verifyUnsubscribeToken('new-secret', fresh)).toMatchObject({
        userId: 'alice',
      });
      expect(await verifyUnsubscribeToken('old-secret', fresh)).toBeNull();
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
      ]) {
        expect(await verifyUnsubscribeToken(SECRET, bad)).toBeNull();
      }
      // A payload signed by someone else's key.
      const forged = await mintUnsubscribeToken('not-our-secret', 'alice');
      expect(await verifyUnsubscribeToken(SECRET, forged)).toBeNull();
    });

    it('builds the emailed URL', async () => {
      const url = unsubscribeUrl('https://app.test', 'abc.def');
      expect(url).toBe('https://app.test/api/unsubscribe?t=abc.def');
      expect(unsubscribeUrl('https://app.test/', 'abc.def', 'he')).toBe(
        'https://app.test/api/unsubscribe?t=abc.def&lang=he',
      );
    });
  });

  describe('GET (read-only)', () => {
    it('renders a confirmation form and does NOT mutate state', async () => {
      await seedPrefs('alice');
      const token = await tokenFor('alice');
      const res = await SELF.fetch(
        `https://server/api/unsubscribe?t=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<form method="post"');
      // Still subscribed — a mail scanner following the link must change nothing.
      expect(await flags('alice')).toMatchObject({
        weekly_enabled: 1,
        reminder_enabled: 1,
        unsubscribed_at: null,
      });
    });

    it('renders 200 for a garbage token too (never leaks validity)', async () => {
      const res = await SELF.fetch('https://server/api/unsubscribe?t=garbage');
      expect(res.status).toBe(200);
      const rows = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM user_email_prefs',
      ).first<{ n: number }>();
      expect(rows?.n).toBe(0);
    });

    it('honors ?lang=he and falls back to Accept-Language', async () => {
      const he = await SELF.fetch('https://server/api/unsubscribe?t=x&lang=he');
      expect(await he.text()).toContain('dir="rtl"');
      const accept = await SELF.fetch('https://server/api/unsubscribe?t=x', {
        headers: { 'accept-language': 'he-IL,he;q=0.9' },
      });
      expect(await accept.text()).toContain('dir="rtl"');
      const en = await SELF.fetch('https://server/api/unsubscribe?t=x');
      expect(await en.text()).toContain('dir="ltr"');
    });
  });

  describe('POST (mutating)', () => {
    it('turns both scheduled emails off', async () => {
      await seedPrefs('alice');
      const res = await oneClick(await tokenFor('alice'));
      expect(res.status).toBe(200);
      expect(await flags('alice')).toMatchObject({
        weekly_enabled: 0,
        reminder_enabled: 0,
        unsubscribed_via: 'one-click',
      });
    });

    it('leaves the rest of the row alone', async () => {
      await seedPrefs('alice');
      await oneClick(await tokenFor('alice'));
      const row = await env.DB.prepare(
        'SELECT timezone, weekly_email_dow, reminder_email_dow FROM user_email_prefs WHERE user_id = ?',
      )
        .bind('alice')
        .first();
      expect(row).toMatchObject({
        timezone: 'Asia/Jerusalem',
        weekly_email_dow: 2,
        reminder_email_dow: 5,
      });
    });

    it('works for a user with NO user_email_prefs row (the DEFAULT 1 trap)', async () => {
      // Most users never open Settings, so they have no row at all. If the insert
      // branch didn't name the flags, the table's DEFAULT 1 would win and the
      // unsubscribe would silently no-op for exactly these users.
      expect(await flags('newbie')).toBeNull();
      const res = await oneClick(await tokenFor('newbie'));
      expect(res.status).toBe(200);
      expect(await flags('newbie')).toMatchObject({
        weekly_enabled: 0,
        reminder_enabled: 0,
      });
    });

    it('is idempotent', async () => {
      await seedPrefs('alice');
      const token = await tokenFor('alice');
      expect((await oneClick(token)).status).toBe(200);
      expect((await oneClick(token)).status).toBe(200);
      expect(await flags('alice')).toMatchObject({
        weekly_enabled: 0,
        reminder_enabled: 0,
      });
    });

    it('accepts a POST with no body (clients vary)', async () => {
      const res = await SELF.fetch(
        `https://server/api/unsubscribe?t=${encodeURIComponent(await tokenFor('alice'))}`,
        { method: 'POST' },
      );
      expect(res.status).toBe(200);
      expect(await flags('alice')).toMatchObject({ weekly_enabled: 0 });
    });

    it('400s on a bad signature, and on a truncated or garbage token', async () => {
      const forged = await mintUnsubscribeToken('some-other-secret', 'alice');
      const good = await tokenFor('alice');
      for (const bad of [forged, good.slice(0, 12), 'garbage', '']) {
        const res = await oneClick(bad);
        expect(res.status, `token ${bad.slice(0, 8)}…`).toBe(400);
      }
      const rows = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM user_email_prefs',
      ).first<{ n: number }>();
      expect(rows?.n).toBe(0);
    });

    it('a token minted for A cannot unsubscribe B', async () => {
      await seedPrefs('alice');
      await seedPrefs('bob');
      await oneClick(await tokenFor('alice'));
      expect(await flags('alice')).toMatchObject({ weekly_enabled: 0 });
      expect(await flags('bob')).toMatchObject({
        weekly_enabled: 1,
        reminder_enabled: 1,
      });
    });

    it('never redirects (RFC 8058) and answers 200 for an unknown user', async () => {
      const res = await oneClick(await tokenFor('ghost'));
      expect(res.status).toBe(200);
      expect(res.status).toBeLessThan(300);
      expect(res.headers.get('location')).toBeNull();
    });

    it('returns the HTML success page when it came from the form', async () => {
      const res = await SELF.fetch(
        `https://server/api/unsubscribe?t=${encodeURIComponent(await tokenFor('alice'))}&lang=en`,
        {
          method: 'POST',
          headers: {
            accept: 'text/html,application/xhtml+xml',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'List-Unsubscribe=One-Click',
        },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('/settings');
      expect(await flags('alice')).toMatchObject({ unsubscribed_via: 'link' });
    });
  });

  it('the settings API can re-enable what an unsubscribe turned off', async () => {
    // The unsubscribe writes the same columns Settings edits, so re-subscribing is
    // one save — no parallel opt-out flag to clear.
    await oneClick(await tokenFor('alice'));
    const put = await SELF.fetch('https://server/api/me/preferences', {
      method: 'PUT',
      headers: { cookie: 'alice', 'content-type': 'application/json' },
      body: JSON.stringify({
        timezone: 'America/New_York',
        weeklyEmailDow: 0,
        reminderEmailDow: 4,
        weeklyEnabled: true,
        reminderEnabled: true,
      }),
    });
    expect(put.status).toBe(200);
    expect(await flags('alice')).toMatchObject({
      weekly_enabled: 1,
      reminder_enabled: 1,
    });
  });
});
