import { SELF, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from './apply-migrations';
import '.';

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

  it('admin can send a weekly/reminder now; non-admins get 403', async () => {
    const weekly = await SELF.fetch(
      'https://server/api/admin/users/bob/send-weekly',
      { method: 'POST', headers: as('admin') },
    );
    expect(weekly.status).toBe(200);
    expect(await weekly.json()).toMatchObject({ sent: true, kind: 'weekly' });

    const reminder = await SELF.fetch(
      'https://server/api/admin/users/bob/send-reminder',
      { method: 'POST', headers: as('admin') },
    );
    expect(reminder.status).toBe(200);
    expect(await reminder.json()).toMatchObject({ sent: true, kind: 'reminder' });

    const forbidden = await SELF.fetch(
      'https://server/api/admin/users/bob/send-weekly',
      { method: 'POST', headers: as('alice') },
    );
    expect(forbidden.status).toBe(403);
  });

  it('surfaces a failing email send as a 502', async () => {
    // The stubbed EMAIL binding (vitest.config.mts) returns 500 for user 'sendfail'.
    const res = await SELF.fetch(
      'https://server/api/admin/users/sendfail/send-weekly',
      { method: 'POST', headers: as('admin') },
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'email send failed' });
  });
});
