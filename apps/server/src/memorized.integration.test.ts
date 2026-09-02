import { SELF, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Group,
  MishnaRef,
  createMishnaChalakim,
  createMishnaStructure,
} from '@mishna/domain';
import {
  LOGIN_TTL_DAYS,
  MARK_TTL_DAYS,
  mintMemorizedToken,
  mintUnsubscribeToken,
} from '@mishna/email-domain';
import { applyMigrations } from './apply-migrations';
import { assignmentEngine, idGen } from './domain';
import '.';

// The emailed "I've memorized this" click-through.
//
// No auth: the signed token IS the authorization, so most of these requests carry no
// Cookie header on purpose. The first block is the security surface — what the
// endpoint must *refuse* to do — because those are the cases a refactor can break
// silently, and the blast radius here (a wrongly-marked portion, or a session handed
// to the wrong person) is worse than for its unsubscribe sibling.
//
// This file constructs no Resend client. RESEND_API_KEY stays blank (vitest.config)
// and `fetch` is stubbed default-deny below, so nothing here can reach a real inbox.

const SECRET = env.MEMORIZED_SECRET;
const structure = createMishnaStructure();
const chalakim = createMishnaChalakim();
const CYCLE_START = new Date('2026-05-17T00:00:00.000Z');
const DAY = 86400;

/** An expiry that puts "now" `days` into the token's 30-day life. */
const expiryPutting = (days: number) =>
  Math.floor(Date.now() / 1000) + (MARK_TTL_DAYS - days) * DAY;

const tokenFor = (userId: string, bucket = 0, days = 0) =>
  mintMemorizedToken(SECRET, userId, bucket, expiryPutting(days));

function get(token: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(
    `https://server/api/memorized?t=${encodeURIComponent(token)}`,
    { headers: { accept: 'text/html' }, ...init },
  );
}

function post(
  token: string,
  opts: { cookie?: string; lang?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'text/html',
  };
  if (opts.cookie) headers['cookie'] = opts.cookie;
  return SELF.fetch(
    `https://server/api/memorized${opts.lang ? `?lang=${opts.lang}` : ''}`,
    {
      method: 'POST',
      headers,
      body: `t=${encodeURIComponent(token)}`,
      redirect: 'manual',
    },
  );
}

async function completions(
  userId?: string,
): Promise<
  {
    user_id: string;
    group_id: string;
    mesechta: string;
    perek: number;
    mishna: number;
  }[]
> {
  const q = userId
    ? env.DB.prepare('SELECT * FROM completions WHERE user_id = ?').bind(userId)
    : env.DB.prepare('SELECT * FROM completions');
  const { results } = await q.all<{
    user_id: string;
    group_id: string;
    mesechta: string;
    perek: number;
    mishna: number;
  }>();
  return results;
}

/** Give the user lots covering the corpus head, so their buckets have mishnayot. */
async function seedGroupFor(userId: string): Promise<void> {
  const group = new Group(structure, chalakim, idGen, { id: `g-${userId}` });
  group.addUser(userId, 1, CYCLE_START, 200, [], () => 0, true);
  await env.DB.prepare(
    'INSERT INTO groups (id, state, exhausted, capacity_left, updated_at) VALUES (?, ?, 0, 0, 0)',
  )
    .bind(group.id, JSON.stringify(group.toState()))
    .run();
  await env.DB.prepare(
    'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
  )
    .bind(group.id, userId)
    .run();
}

/** The refs a given bucket holds for a seeded user — what the email listed. */
async function bucketRefsFor(
  userId: string,
  bucket: number,
): Promise<MishnaRef[]> {
  const group = new Group(structure, chalakim, idGen, { id: `g-${userId}` });
  group.addUser(userId, 1, CYCLE_START, 200, [], () => 0, true);
  const blocks = group.toState().blocks.filter((b) => b.userId === userId);
  return assignmentEngine.getBucketAssignment(blocks, bucket, new Date())
    .mishnas;
}

describe('memorized click-through', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    // Default-deny: this suite must never reach the network.
    globalThis.fetch = (async () => {
      throw new Error('unexpected outbound fetch in memorized tests');
    }) as typeof fetch;
  });

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM completions');
    await env.DB.exec('DELETE FROM group_members');
    await env.DB.exec('DELETE FROM groups');
  });

  // ==========================================================================
  // Security surface
  // ==========================================================================

  describe('what it refuses to do', () => {
    it('GET with a VALID token writes nothing and mints no session', async () => {
      // The single most important test in this file. Mail scanners and link-preview
      // bots fetch every URL in a message; if GET ever mutates, people who never
      // clicked get their portion marked learned with no signal, and their next
      // email's content silently advances.
      await seedGroupFor('alice');
      const res = await get(await tokenFor('alice', 0));

      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await completions()).toEqual([]);
      // A form, not a redirect.
      expect(res.headers.get('location')).toBeNull();
      expect(await res.text()).toContain('method="post"');
    });

    it('is inert against a scanner-style prefetch', async () => {
      await seedGroupFor('alice');
      const token = await tokenFor('alice', 0);
      for (const init of [
        { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Bot/1.0)' } },
        { headers: { accept: '*/*' } },
        { method: 'HEAD' },
      ] as RequestInit[]) {
        const res = await get(token, init);
        expect(res.status).toBeLessThan(400);
        expect(res.headers.get('set-cookie')).toBeNull();
      }
      expect(await completions()).toEqual([]);
    });

    it('an expired token marks nothing and signs nobody in', async () => {
      await seedGroupFor('alice');
      const res = await post(await tokenFor('alice', 0, MARK_TTL_DAYS + 1));

      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(res.headers.get('location')).toBeNull();
      expect(await completions()).toEqual([]);
    });

    it('a bucket escalated under a stolen signature is rejected', async () => {
      // Take your own valid link for bucket 0 and re-point it at bucket 4.
      await seedGroupFor('alice');
      const exp = expiryPutting(0);
      const token = await mintMemorizedToken(SECRET, 'alice', 0, exp);
      const forgedPayload = btoa(`m1.alice.4.${exp}`)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const res = await post(`${forgedPayload}.${token.split('.')[1]}`);

      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await completions()).toEqual([]);
    });

    it('a different user already signed in is neither swapped nor contaminated', async () => {
      // Shared family device. The marking still happens — scoped entirely to the
      // token's user — but bob must not be signed out, and must never be shown
      // alice's dashboard.
      await seedGroupFor('alice');
      await seedGroupFor('bob');
      const res = await post(await tokenFor('alice', 0), { cookie: 'bob' });

      expect(res.status).toBe(200); // a page, NOT a 3xx into the app
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('set-cookie')).toBeNull();

      const rows = await completions();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.user_id === 'alice')).toBe(true);
      expect(await completions('bob')).toEqual([]);

      // ...and bob still holds the browser.
      const me = await SELF.fetch('https://server/api/me', {
        headers: { cookie: 'bob' },
      });
      expect(((await me.json()) as { user?: { id: string } }).user?.id).toBe(
        'bob',
      );
    });

    it.each([
      ['a forged token', 'bTEuYWxpY2UuMC45OTk5OTk5OTk5.Zm9yZ2Vk'],
      ['garbage', 'not-a-token'],
      ['an empty token', ''],
      ['a truncated token', 'bTEuYWxpY2UuMC45OTk'],
    ])('%s writes nothing', async (_label, token) => {
      await seedGroupFor('alice');
      const res = await post(token);
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await completions()).toEqual([]);
    });

    it('an unsubscribe token cannot be replayed here', async () => {
      // Domain separation: `v1` vs `m1`. (They also use different secrets in prod.)
      await seedGroupFor('alice');
      const unsub = await mintUnsubscribeToken(SECRET, 'alice', 'all');
      const res = await post(unsub);
      expect(res.status).toBe(200);
      expect(await completions()).toEqual([]);
    });

    it('a token signed with a foreign secret writes nothing', async () => {
      await seedGroupFor('alice');
      const foreign = await mintMemorizedToken(
        'not-our-secret',
        'alice',
        0,
        expiryPutting(0),
      );
      expect((await post(foreign)).status).toBe(200);
      expect(await completions()).toEqual([]);
    });
  });

  // ==========================================================================
  // What it does
  // ==========================================================================

  describe('marking', () => {
    it('marks exactly the bucket the email showed, with the right group', async () => {
      await seedGroupFor('alice');
      const expected = await bucketRefsFor('alice', 0);
      expect(expected.length).toBeGreaterThan(0);

      const res = await post(await tokenFor('alice', 0));
      expect(res.status).toBe(303);

      const rows = await completions('alice');
      expect(rows).toHaveLength(expected.length);
      expect(rows.every((r) => r.group_id === 'g-alice')).toBe(true);
      expect(
        rows.map((r) => `${r.mesechta}|${r.perek}|${r.mishna}`).sort(),
      ).toEqual(
        expected.map((r) => `${r.mesechta}|${r.perek}|${r.mishna}`).sort(),
      );
    });

    it('marks a later bucket when that is what the token pinned', async () => {
      await seedGroupFor('alice');
      const expected = await bucketRefsFor('alice', 3);
      await post(await tokenFor('alice', 3));

      const rows = await completions('alice');
      expect(
        rows.map((r) => `${r.mesechta}|${r.perek}|${r.mishna}`).sort(),
      ).toEqual(
        expected.map((r) => `${r.mesechta}|${r.perek}|${r.mishna}`).sort(),
      );
    });

    it('does not drift when the user checked the bucket off in the app first', async () => {
      // The regression this whole "pin the bucket at send time" design exists for. If
      // the index were recomputed at click time, `nextUnlearnedBucket` would have
      // advanced past the completed bucket and this link would mark bucket 1 —
      // mishnayos the email never showed.
      await seedGroupFor('alice');
      const bucket0 = await bucketRefsFor('alice', 0);
      const bucket1 = await bucketRefsFor('alice', 1);
      for (const ref of bucket0) {
        await env.DB.prepare(
          `INSERT INTO completions (user_id, group_id, mesechta, perek, mishna, completed_at)
             VALUES ('alice', 'g-alice', ?, ?, ?, 0)`,
        )
          .bind(ref.mesechta, ref.perek, ref.mishna)
          .run();
      }

      await post(await tokenFor('alice', 0));

      const rows = await completions('alice');
      expect(rows).toHaveLength(bucket0.length);
      const keys = new Set(
        rows.map((r) => `${r.mesechta}|${r.perek}|${r.mishna}`),
      );
      for (const ref of bucket1) {
        expect(keys.has(`${ref.mesechta}|${ref.perek}|${ref.mishna}`)).toBe(
          false,
        );
      }
    });

    it('is idempotent: a second click adds no rows', async () => {
      await seedGroupFor('alice');
      const token = await tokenFor('alice', 0);
      await post(token);
      const first = await completions('alice');
      const res = await post(token);
      expect(res.status).toBe(303);
      expect(await completions('alice')).toHaveLength(first.length);
    });

    it('still marks after the login window closes (the two-tier window)', async () => {
      await seedGroupFor('alice');
      const res = await post(await tokenFor('alice', 0, LOGIN_TTL_DAYS + 1));

      // Marked...
      expect((await completions('alice')).length).toBeGreaterThan(0);
      // ...but not signed in: a page, no cookie, no redirect.
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(res.headers.get('location')).toBeNull();
    });

    it.each([
      ['a user with no group', 'nobody', 0],
      ['an out-of-range bucket', 'alice', 9999],
    ])('%s is a safe no-op', async (_label, userId, bucket) => {
      await seedGroupFor('alice');
      const res = await post(await tokenFor(userId, bucket));
      expect(res.status).toBe(303);
      expect(await completions(userId)).toEqual([]);
    });
  });

  // ==========================================================================
  // Signing in and landing
  // ==========================================================================

  describe('the landing', () => {
    it('signs a signed-out reader in and redirects to the dashboard', async () => {
      await seedGroupFor('alice');
      const res = await post(await tokenFor('alice', 0));

      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(
        `${env.APP_ORIGIN}/dashboard?memorized=1`,
      );
      const cookie = res.headers.get('set-cookie') ?? '';
      expect(cookie).toContain('alice');

      // The cookie really is a session.
      const me = await SELF.fetch('https://server/api/me', {
        headers: { cookie: cookie.split(';')[0] },
      });
      expect(((await me.json()) as { user?: { id: string } }).user?.id).toBe(
        'alice',
      );
    });

    it('does not re-mint when the right user is already signed in', async () => {
      await seedGroupFor('alice');
      const res = await post(await tokenFor('alice', 0), { cookie: 'alice' });
      expect(res.status).toBe(303);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(res.headers.get('location')).toBe(
        `${env.APP_ORIGIN}/dashboard?memorized=1`,
      );
    });

    it('sends a Hebrew reader to the /he build', async () => {
      await seedGroupFor('alice');
      const res = await post(await tokenFor('alice', 0), { lang: 'he' });
      expect(res.headers.get('location')).toBe(
        `${env.APP_ORIGIN}/he/dashboard?memorized=1`,
      );
    });

    it('never leaks the token through Referer, caches or sniffing', async () => {
      await seedGroupFor('alice');
      const token = await tokenFor('alice', 0);
      for (const res of [await get(token), await post(token)]) {
        expect(res.headers.get('referrer-policy')).toBe('no-referrer');
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      }
    });

    it("the GET form's own action really marks when posted", async () => {
      // Ties the two halves together: whatever the confirm page renders must be a
      // working POST, not a form pointing somewhere stale.
      await seedGroupFor('alice');
      const token = await tokenFor('alice', 0);
      const html = await (await get(token)).text();
      const action = /action="([^"]+)"/.exec(html)?.[1] ?? '';
      const hidden = /name="t" value="([^"]*)"/.exec(html)?.[1] ?? '';
      expect(action).toContain('/api/memorized');
      expect(hidden).toBe(token);

      const res = await SELF.fetch(`https://server${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'text/html',
        },
        body: `t=${encodeURIComponent(hidden)}`,
        redirect: 'manual',
      });
      expect(res.status).toBe(303);
      expect((await completions('alice')).length).toBeGreaterThan(0);
    });
  });
});
