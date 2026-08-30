import { SELF, env } from 'cloudflare:test';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { applyMigrations } from './apply-migrations';
import '.';

// 🔴 This file drives `POST /api/admin/users/:id/send-{weekly,reminder}`, i.e. the
// real inline send path. Two independent things keep it off the network, and both
// are load-bearing:
//
//   1. `vitest.config.mts` pins a fake `RESEND_API_KEY`, so `.dev.vars` — where a
//      developer plausibly has a REAL key on a verified sender domain — can't win.
//   2. The default-deny `fetch` stub below, which throws on anything outbound.
//
// The send-now tests below assert `502`. Do NOT read that as "there is no Resend
// key" (there is one — a fake). It means the send genuinely failed before leaving
// the worker; today it fails in `prepareOne`, because this file never creates the
// `AUTH_DB` "user" table, so the recipient lookup throws. What the assertion is
// actually for is the discriminator against `409`: `502` proves the
// hard-unsubscribe gate did *not* fire and a send was attempted. If you ever seed
// `AUTH_DB` here, these become `502`-from-a-refused-fetch instead, which is fine —
// but keep the stub, or the suite starts mailing people.
const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    throw new Error(
      `refused outbound fetch in tests: ${typeof input === 'string' ? input : String(input)}`,
    );
  });
});
afterAll(() => {
  vi.stubGlobal('fetch', realFetch);
});

// AUTH is stubbed in vitest.config.mts: the `cookie` value is the user id, and
// cookie 'admin' is flagged isAdmin.
function as(userId: string): HeadersInit {
  return { cookie: userId };
}

describe('email preferences + admin send-now', () => {
  beforeAll(() => applyMigrations(env.DB));
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM user_email_prefs');
    await env.DB.exec('DELETE FROM participants');
  });

  it('returns defaults before anything is saved', async () => {
    const res = await SELF.fetch('https://server/api/me/preferences', {
      headers: as('alice'),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      timezone: 'America/New_York',
      weeklyEmailDow: 0,
      reminderEmailDow: 4,
      weeklyEnabled: true,
      reminderEnabled: true,
    });
  });

  it('upserts and reads back preferences', async () => {
    const put = await SELF.fetch('https://server/api/me/preferences', {
      method: 'PUT',
      headers: { ...as('alice'), 'content-type': 'application/json' },
      body: JSON.stringify({
        timezone: 'Asia/Jerusalem',
        weeklyEmailDow: 1,
        reminderEmailDow: 5,
        weeklyEnabled: true,
        reminderEnabled: false,
      }),
    });
    expect(put.status).toBe(200);

    const get = await SELF.fetch('https://server/api/me/preferences', {
      headers: as('alice'),
    });
    expect(await get.json()).toEqual({
      timezone: 'Asia/Jerusalem',
      weeklyEmailDow: 1,
      reminderEmailDow: 5,
      weeklyEnabled: true,
      reminderEnabled: false,
    });
  });

  it('rejects an invalid timezone', async () => {
    const res = await SELF.fetch('https://server/api/me/preferences', {
      method: 'PUT',
      headers: { ...as('alice'), 'content-type': 'application/json' },
      body: JSON.stringify({
        timezone: 'Mars/Olympus',
        weeklyEmailDow: 0,
        reminderEmailDow: 4,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range weekday', async () => {
    const res = await SELF.fetch('https://server/api/me/preferences', {
      method: 'PUT',
      headers: { ...as('alice'), 'content-type': 'application/json' },
      body: JSON.stringify({
        timezone: 'America/New_York',
        weeklyEmailDow: 7,
        reminderEmailDow: 4,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const res = await SELF.fetch('https://server/api/me/preferences');
    expect(res.status).toBe(401);
  });

  it('only admins reach send-now; non-admins get 403', async () => {
    // The inline send can't succeed here (see the file header), so send-now
    // surfaces its 502 path. The actual build/send is covered offline in
    // email.integration.test.ts via processJobs with an injected sender.
    const weekly = await SELF.fetch(
      'https://server/api/admin/users/bob/send-weekly',
      { method: 'POST', headers: as('admin') },
    );
    expect(weekly.status).toBe(502);
    expect(await weekly.json()).toMatchObject({ error: 'email send failed' });

    const reminder = await SELF.fetch(
      'https://server/api/admin/users/bob/send-reminder',
      { method: 'POST', headers: as('admin') },
    );
    expect(reminder.status).toBe(502);

    const forbidden = await SELF.fetch(
      'https://server/api/admin/users/bob/send-weekly',
      { method: 'POST', headers: as('alice') },
    );
    expect(forbidden.status).toBe(403);
  });

  describe('send-now vs. a hard (mail-side) unsubscribe', () => {
    /** Seed bob's prefs row with the flags + audit channel under test. */
    function seedPrefs(
      weeklyEnabled: number,
      reminderEnabled: number,
      via: string | null,
    ): Promise<unknown> {
      return env.DB.prepare(
        `INSERT INTO user_email_prefs
           (user_id, timezone, weekly_email_dow, reminder_email_dow, weekly_enabled,
            reminder_enabled, updated_at, unsubscribed_at, unsubscribed_via)
           VALUES ('bob', 'America/New_York', 0, 4, ?, ?, 0, ?, ?)`,
      )
        .bind(weeklyEnabled, reminderEnabled, via ? 0 : null, via)
        .run();
    }

    function sendNow(kind: 'weekly' | 'reminder'): Promise<Response> {
      return SELF.fetch(`https://server/api/admin/users/bob/send-${kind}`, {
        method: 'POST',
        headers: as('admin'),
      });
    }

    it('409s instead of re-mailing a user who used the one-click link', async () => {
      await seedPrefs(0, 0, 'one-click');
      const res = await sendNow('weekly');
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; detail?: unknown };
      expect(body).toMatchObject({ error: 'user unsubscribed' });
      // The client concatenates `detail` into a toast, so it must be real prose.
      expect(typeof body.detail).toBe('string');
      expect(body.detail).toContain('one-click');
    });

    it('409s for the confirm-page form channel too', async () => {
      await seedPrefs(0, 0, 'link');
      const res = await sendNow('weekly');
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'user unsubscribed' });
    });

    it('still overrides an admin- or settings-driven off switch', async () => {
      // Those are ours to undo; only a mail-side unsubscribe is off limits. 502 =
      // the gate didn't fire and the send was attempted (and then failed — the
      // discriminator against 409, which would mean no attempt at all).
      for (const via of ['settings', 'admin']) {
        await env.DB.exec('DELETE FROM user_email_prefs');
        await seedPrefs(0, 0, via);
        expect((await sendNow('weekly')).status, via).toBe(502);
      }
    });

    it('only gates the kind that is still off', async () => {
      // Admin re-enabled weekly after the one-click; `unsubscribed_via` survives a
      // partial re-enable, so the flag is what decides per kind.
      await seedPrefs(1, 0, 'one-click');
      expect((await sendNow('weekly')).status).toBe(502);
      expect((await sendNow('reminder')).status).toBe(409);
    });

    it('does not gate a user with no prefs row', async () => {
      expect((await sendNow('weekly')).status).toBe(502);
    });
  });
});
