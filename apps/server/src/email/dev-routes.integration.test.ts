import { SELF, env } from 'cloudflare:test';
import { Hono } from 'hono';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  CycleCalendar,
  Group,
  createMishnaChalakim,
  createMishnaStructure,
} from '@mishna/domain';
import { verifyUnsubscribeToken } from '@mishna/email-domain';
import { applyMigrations } from '../apply-migrations';
import { AuthVariables } from '../auth-middleware';
import { mountDevEmailRoutes } from './dev-routes';

// ---------------------------------------------------------------------------
// The local email workbench (`/__dev/email/*`).
//
// Two jobs, and the first is the important one:
//
//   1. 🔴 The **production** entry point does not serve these routes. `POST
//      /__dev/email/send` mails any address as any user with no auth; the only thing
//      standing between that and production is that `wrangler.toml`'s
//      `main = "src/index.ts"` never imports `dev-entry.ts`. This test is the
//      executable half of that claim (the other half is the deploy-bundle grep in
//      apps/server/CLAUDE.md). If someone ever "helpfully" mounts these on the
//      production app, this test fails.
//   2. The routes themselves work against real D1 + the real templates.
//
// 🔴 A developer's `apps/server/.dev.vars` may hold a REAL `RESEND_API_KEY`, and
// vitest-pool-workers loads it into the test env. So, like
// `workflow.integration.test.ts`: pin a fake key for this file and stub global
// `fetch` for both `api.resend.com` and the tractate JSON. Nothing here can reach
// the network.
// ---------------------------------------------------------------------------

const structure = createMishnaStructure();
const chalakim = createMishnaChalakim();
const idGen = () => crypto.randomUUID();

/** NY (EDT) on this instant is Sunday 2026-06-07 08:00 — a weekly send slot. */
const NOW_NY_SUN_8AM = new Date('2026-06-07T12:00:00Z');
const CYCLE_START = new CycleCalendar()
  .cycleStart(NOW_NY_SUN_8AM)
  .toISOString()
  .slice(0, 10);

const FAKE_TRACTATE = {
  name: 'Berakhot',
  hebrewName: 'ברכות',
  sefariaId: 'Berakhot',
  seder: 'Zeraim',
  sederHebrewName: 'זרעים',
  perakim: [
    {
      perek: 1,
      mishnayot: Array.from({ length: 6 }, (_, i) => ({
        mishna: i + 1,
        hebrew: `טקסט משנה ${i + 1}`,
        english: `text ${i + 1}`,
      })),
    },
  ],
};

const APP_TABLES = [
  'participants',
  'user_email_prefs',
  'completions',
  'groups',
  'group_members',
  'email_log',
];

/** The dev routes on their own Hono app — exactly how `dev-entry.ts` mounts them. */
function devApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  mountDevEmailRoutes(app);
  return app;
}

/** Call a dev route with this file's env (the real D1 bindings). */
function dev(path: string, init?: RequestInit): Promise<Response> {
  return devApp().fetch(
    new Request(`http://dev.local${path}`, init),
    env as unknown as Env,
  );
}

async function seed(userId: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO participants (user_id, commitment, joined_at) VALUES (?, 1, 0)',
  )
    .bind(userId)
    .run();
  await env.DB.prepare(
    `INSERT INTO user_email_prefs (user_id, timezone, weekly_email_dow,
       reminder_email_dow, weekly_enabled, reminder_enabled, updated_at)
     VALUES (?, 'America/New_York', 0, 4, 1, 1, 0)`,
  )
    .bind(userId)
    .run();
  await env.AUTH_DB.prepare(
    'INSERT INTO "user" (id, email, name, "emailVerified") VALUES (?, ?, ?, 1)',
  )
    .bind(userId, `${userId}@example.com`, `${userId} name`)
    .run();

  // Lots from the corpus head, so the week has real mishnayot to render.
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

describe('/__dev/email (the local email workbench)', () => {
  const originalKey = (env as unknown as Record<string, unknown>)[
    'RESEND_API_KEY'
  ];
  /** Every Resend batch POST the stub saw. */
  let resendPosts: unknown[] = [];

  beforeAll(async () => {
    await applyMigrations(env.DB);
    await env.AUTH_DB.exec(
      'CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT, "emailVerified" INTEGER NOT NULL DEFAULT 0)',
    );
    // A developer's .dev.vars may hold a real key. Never let this file use it.
    (env as unknown as Record<string, unknown>)['RESEND_API_KEY'] =
      're_fake_test_key';
  });

  afterAll(() => {
    (env as unknown as Record<string, unknown>)['RESEND_API_KEY'] = originalKey;
  });

  beforeEach(async () => {
    resendPosts = [];
    for (const t of APP_TABLES) await env.DB.exec(`DELETE FROM ${t}`);
    await env.AUTH_DB.exec('DELETE FROM "user"');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://api.resend.com')) {
        resendPosts.push(JSON.parse(String(init?.body ?? 'null')));
        return new Response(JSON.stringify({ data: { id: 'batch_fake' } }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('.json')) {
        return new Response(JSON.stringify(FAKE_TRACTATE), {
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  // -- the gate ------------------------------------------------------------
  describe('🔴 not reachable on the production entry point', () => {
    it.each([
      ['GET', '/__dev/email'],
      ['GET', '/__dev/email/plan'],
      ['GET', '/__dev/email/users'],
      ['GET', '/__dev/email/render?userId=alice&kind=weekly'],
      ['GET', '/__dev/email/cron'],
      ['POST', '/__dev/email/send'],
    ])('%s %s is a 404', async (method, path) => {
      const res = await SELF.fetch(`https://example.com${path}`, {
        method,
        ...(method === 'POST'
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ userId: 'alice', to: 'anyone@example.com' }),
            }
          : {}),
      });
      expect(res.status).toBe(404);
    });

    it('sent nothing while proving it', () => {
      expect(resendPosts).toEqual([]);
    });
  });

  // -- the routes ----------------------------------------------------------
  it('GET /__dev/email serves the workbench page', async () => {
    const res = await dev('/__dev/email');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    // The send box must default to the sandbox sink, never a real mailbox.
    expect(html).toContain('delivered@resend.dev');
  });

  it('GET /__dev/email/users lists local users with their prefs', async () => {
    await seed('alice');
    const body = await (await dev('/__dev/email/users')).json<{
      users: { id: string; emailVerified: boolean; timezone: string }[];
    }>();
    expect(body.users).toEqual([
      expect.objectContaining({
        id: 'alice',
        email: 'alice@example.com',
        emailVerified: true,
        timezone: 'America/New_York',
        commitment: 1,
      }),
    ]);
  });

  it('GET /__dev/email/plan is a dry run over the real planSends', async () => {
    await seed('alice');
    const res = await dev(
      `/__dev/email/plan?at=${NOW_NY_SUN_8AM.toISOString()}`,
    );
    const body = await res.json<{ count: number; jobs: { kind: string }[] }>();
    expect(body.count).toBe(1);
    expect(body.jobs[0]).toMatchObject({ userId: 'alice', kind: 'weekly' });
    // Dry run: no send, and no email_log row.
    expect(resendPosts).toEqual([]);
    const log = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM email_log',
    ).first<{ n: number }>();
    expect(log?.n).toBe(0);
  });

  it('GET /__dev/email/plan rejects a garbage ?at=', async () => {
    const res = await dev('/__dev/email/plan?at=not-a-date');
    expect(res.status).toBe(400);
  });

  it('GET /__dev/email/render returns the real HTML with a verifiable unsubscribe link', async () => {
    await seed('alice');
    const res = await dev('/__dev/email/render?userId=alice&kind=weekly');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    // Real Hebrew from the (stubbed) tractate file, rendered RTL.
    expect(html).toContain('טקסט משנה 1');
    expect(html).toContain('dir="rtl"');

    // The footer's unsubscribe link is a genuinely signed token for this user.
    const href = /href="([^"]*\/api\/unsubscribe\?t=[^"]*)"/.exec(html)?.[1];
    expect(href).toBeTruthy();
    const t = new URL(String(href).replaceAll('&amp;', '&')).searchParams.get(
      't',
    );
    expect(
      await verifyUnsubscribeToken(env.UNSUBSCRIBE_SECRET, t),
    ).toEqual({ userId: 'alice', scope: 'all' });

    // Rendering sends nothing.
    expect(resendPosts).toEqual([]);
  });

  it('GET /__dev/email/render?part=text|json exposes the other halves', async () => {
    await seed('alice');
    const text = await (
      await dev('/__dev/email/render?userId=alice&kind=weekly&part=text')
    ).text();
    expect(text).toContain('Perek 1, Mishna 1');

    const { email } = await (
      await dev('/__dev/email/render?userId=alice&kind=weekly&part=json')
    ).json<{ email: { headers: Record<string, string>; to: string } }>();
    expect(email.to).toBe('alice@example.com');
    expect(email.headers['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
  });

  it('GET /__dev/email/render explains an unsendable user instead of 500ing', async () => {
    const res = await dev('/__dev/email/render?userId=nobody&kind=weekly');
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toContain(
      'no sendable recipient',
    );
  });

  it('POST /__dev/email/send overrides the recipient and records the send', async () => {
    await seed('alice');
    const res = await dev('/__dev/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'alice',
        kind: 'weekly',
        to: 'delivered@resend.dev',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ sent: boolean; to: string }>();
    expect(body).toMatchObject({ sent: true, to: 'delivered@resend.dev' });

    // One real Resend batch, addressed to the override, not to alice.
    expect(resendPosts).toHaveLength(1);
    expect((resendPosts[0] as { to: string }[])[0].to).toBe(
      'delivered@resend.dev',
    );

    // Same dedup bookkeeping as admin send-now.
    const log = await env.DB.prepare(
      'SELECT user_id, kind FROM email_log',
    ).all<{ user_id: string; kind: string }>();
    expect(log.results).toEqual([{ user_id: 'alice', kind: 'weekly' }]);
  });
});
