import { SELF, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from './apply-migrations';
import {
  mintUnsubscribeToken,
  pickLang,
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
      expect(claims).toEqual({ userId: 'alice', scope: 'all' });
    });

    it('is deterministic: the same user always gets the same token', async () => {
      // The token rides in the email body, and the batch's Resend Idempotency-Key
      // covers only (user, kind, week) — so a clock in the payload would make a
      // retried batch a *different* payload under the same key (409). See
      // email.integration.test.ts for the end-to-end guard.
      expect(await tokenFor('alice')).toBe(await tokenFor('alice'));
      expect(await tokenFor('alice')).not.toBe(await tokenFor('bob'));
      expect(await mintUnsubscribeToken(SECRET, 'alice', 'weekly')).not.toBe(
        await tokenFor('alice'),
      );
    });

    it('fails closed when UNSUBSCRIBE_SECRET is unset', async () => {
      // A misconfigured deploy must not mail links that can never verify.
      for (const missing of [undefined, '', ' , ']) {
        await expect(mintUnsubscribeToken(missing, 'alice')).rejects.toThrow(
          /UNSUBSCRIBE_SECRET/,
        );
      }
      // ...and nothing verifies against no secret either.
      expect(
        await verifyUnsubscribeToken(undefined, await tokenFor('alice')),
      ).toBeNull();
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

  describe('pickLang', () => {
    it('honors ?lang over anything the browser asks for', () => {
      expect(pickLang('he', 'en-US,en;q=0.9')).toBe('he');
      expect(pickLang('en', 'he-IL')).toBe('en');
      expect(pickLang('fr', 'he-IL')).toBe('he'); // unknown ?lang falls through
    });

    it('ranks Accept-Language by q rather than scanning for "he"', () => {
      // The whole point: `he` appears, but ranked *below* English.
      expect(pickLang(undefined, 'en-US,en;q=0.9,he;q=0.5')).toBe('en');
      expect(pickLang(undefined, 'he-IL,he;q=0.9')).toBe('he');
      expect(pickLang(undefined, 'en;q=0.5,he;q=0.8')).toBe('he');
      // q=0 means "not acceptable", so the next tag wins.
      expect(pickLang(undefined, 'he;q=0,en')).toBe('en');
    });

    it('treats the legacy `iw` tag as Hebrew', () => {
      expect(pickLang(undefined, 'iw-IL')).toBe('he');
      expect(pickLang(undefined, 'iw')).toBe('he');
    });

    it('falls back to English with no (or a useless) header', () => {
      expect(pickLang(undefined, undefined)).toBe('en');
      expect(pickLang(undefined, '')).toBe('en');
      expect(pickLang(undefined, '*')).toBe('en');
      // "hebrew-ish" prefixes must not count.
      expect(pickLang(undefined, 'hen,heb')).toBe('en');
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

    it("the rendered form's action actually unsubscribes when posted", async () => {
      // The token survives Hono's query decode -> encodeURIComponent -> escapeHtml
      // -> the browser's HTML decode -> back through the POST's query decode. Post
      // the exact action attribute the page ships rather than a hand-built URL, so a
      // break anywhere in that chain shows up here.
      await seedPrefs('alice');
      const page = await SELF.fetch(
        `https://server/api/unsubscribe?t=${encodeURIComponent(await tokenFor('alice'))}`,
      );
      const html = await page.text();
      const action = /<form method="post" action="([^"]+)"/
        .exec(html)?.[1]
        // What a browser does with the attribute before submitting it.
        .replace(/&amp;/g, '&');
      expect(action).toBeDefined();

      const res = await SELF.fetch(`https://server${action}`, {
        method: 'POST',
        headers: {
          accept: 'text/html',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'List-Unsubscribe=One-Click',
      });
      expect(res.status).toBe(200);
      expect(await flags('alice')).toMatchObject({
        weekly_enabled: 0,
        reminder_enabled: 0,
        unsubscribed_via: 'link',
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

  it('keeps the token out of caches and out of the Referer', async () => {
    // The URL is a never-expiring bearer token and the pages link to the app's own
    // /settings, so the default referrer policy would leak `?t=` on that click.
    const token = await tokenFor('alice');
    const get = await SELF.fetch(
      `https://server/api/unsubscribe?t=${encodeURIComponent(token)}`,
    );
    const post = await oneClick(token);
    const bad = await oneClick('garbage');
    for (const res of [get, post, bad]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
    // Belt-and-braces for a renderer that ignores the header.
    expect(await get.text()).toContain('<meta name="referrer" content="no-referrer"');
  });

  /** Save Settings as `alice`, with the flags under test. */
  function savePrefs(weeklyEnabled: boolean, reminderEnabled: boolean) {
    return SELF.fetch('https://server/api/me/preferences', {
      method: 'PUT',
      headers: { cookie: 'alice', 'content-type': 'application/json' },
      body: JSON.stringify({
        timezone: 'America/New_York',
        weeklyEmailDow: 0,
        reminderEmailDow: 4,
        weeklyEnabled,
        reminderEnabled,
      }),
    });
  }

  describe('the audit trail (0006)', () => {
    it('the settings API can re-enable what an unsubscribe turned off', async () => {
      // The unsubscribe writes the same columns Settings edits, so re-subscribing is
      // one save — no parallel opt-out flag to clear.
      await oneClick(await tokenFor('alice'));
      expect((await savePrefs(true, true)).status).toBe(200);
      expect(await flags('alice')).toMatchObject({
        weekly_enabled: 1,
        reminder_enabled: 1,
        // ...and the row no longer claims to be unsubscribed. Left set, it would say
        // "unsubscribed via one-click" while both emails are on, and any later
        // suppression keyed on unsubscribed_at would skip a re-subscribed user.
        unsubscribed_at: null,
        unsubscribed_via: null,
      });
    });

    it('records an unsubscribe made from Settings', async () => {
      await savePrefs(false, false);
      const row = await flags('alice');
      expect(row).toMatchObject({
        weekly_enabled: 0,
        reminder_enabled: 0,
        unsubscribed_via: 'settings',
      });
      expect(row?.unsubscribed_at).toBeGreaterThan(0);
    });

    it('leaves the record alone while one email is still off', async () => {
      await oneClick(await tokenFor('alice'));
      const before = await flags('alice');
      // Weekly back on, reminder still off: not a re-subscribe, so the one-click
      // record stands.
      await savePrefs(true, false);
      expect(await flags('alice')).toMatchObject({
        weekly_enabled: 1,
        reminder_enabled: 0,
        unsubscribed_at: before?.unsubscribed_at,
        unsubscribed_via: 'one-click',
      });
    });

    it('tracks the same states when an admin flips the flags', async () => {
      const setByAdmin = (body: Record<string, boolean>) =>
        SELF.fetch('https://server/api/admin/users/alice/set-email-prefs', {
          method: 'POST',
          headers: { cookie: 'admin', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

      // Partial updates compose: the second call sees the first's flag, so the row
      // reaches "both off" and is recorded as such.
      await seedPrefs('alice');
      await setByAdmin({ weeklyEnabled: false });
      expect(await flags('alice')).toMatchObject({
        reminder_enabled: 1,
        unsubscribed_via: null,
      });
      await setByAdmin({ reminderEnabled: false });
      expect(await flags('alice')).toMatchObject({
        weekly_enabled: 0,
        reminder_enabled: 0,
        unsubscribed_via: 'admin',
      });
      // ...and turning one back on isn't yet a re-subscribe; both is.
      await setByAdmin({ weeklyEnabled: true });
      expect(await flags('alice')).toMatchObject({ unsubscribed_via: 'admin' });
      await setByAdmin({ reminderEnabled: true });
      expect(await flags('alice')).toMatchObject({
        weekly_enabled: 1,
        reminder_enabled: 1,
        unsubscribed_at: null,
        unsubscribed_via: null,
      });
      // The rest of the row survived every partial write.
      const row = await env.DB.prepare(
        'SELECT timezone, weekly_email_dow FROM user_email_prefs WHERE user_id = ?',
      )
        .bind('alice')
        .first();
      expect(row).toMatchObject({ timezone: 'Asia/Jerusalem', weekly_email_dow: 2 });
    });
  });
});
