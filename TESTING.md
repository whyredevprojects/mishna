# Testing

Most of this repo is tested the boring way, and the boring way is the whole suite:

```sh
npx nx run-many -t lint test build      # what CI runs; ~1 minute
```

This document is about the parts that are **not** obvious — where a test has to go to
be worth writing, which things can't be unit-tested at all and what covers them
instead, and how to exercise the one subsystem that reaches real people. That
subsystem is **email**, and most of this file is about it.

If you only read one section, read [Email](#email).

---

## The map

| Project | Runtime | Tests | Speed | What lives here |
|---|---|---|---|---|
| `domain` | plain node | 85 | ~0.9 s | Corpus, lots, cycle calendar, groups, assignments |
| `email-domain` | plain node | 90 | ~1.4 s | Who gets which email, when, with what content; the unsubscribe token |
| `email-templates` | plain node | 22 | ~1.7 s | The React Email components + `composeEmail` |
| `email-data` | plain node | 6 | ~0.6 s | `D1EmailRepository` — chunking + port conformance |
| `server` | **workerd** | 153 | ~26 s | Routes, real D1, the Durable Object, the Workflow |
| `login` | **workerd** | 17 | ~10 s | better-auth wiring, transactional mail bodies |
| `client` | jsdom | 10 | ~5 s | A few Angular components/services |
| `client-e2e` | Playwright | 1 | — | A landing-page smoke test |
| `mobile` | Flutter | 5 files | — | **Not in CI** — see below |
| `www` | — | none | — | Static Eleventy site |

Counts are current as of this file's last edit; they drift, and that's fine — the
shape is the point.

### The rule that decides where a test goes

**Pure logic lives in a lib and is tested in plain node. Effects live in the app and
are tested in workerd.**

A workerd test costs ~20 s of suite time and can only be run through an HTTP request
or a binding. A plain-node lib test costs milliseconds and can be called directly with
whatever arguments you like. So the question for a new test is never "unit or
integration" — it's **"is the thing I'm testing a decision or an effect?"**

- A *decision* (which users are due, what a token means, what a prefs row implies,
  how a batch is chunked) belongs in a lib. If it currently needs a worker to reach,
  that's a design smell: give it a parameter and move it.
- An *effect* (SQL against real D1, `step.do` durability, the service-binding hop to
  `apps/login`, the actual bytes a template renders under workerd) belongs in the app
  and genuinely needs the pool.

The email path was refactored along exactly this line; `apps/server/CLAUDE.md` has the
"Where the email code lives" table if you need to find something.

### Determinism in `domain` and `email-domain`

Nothing in these libs reads `Date.now()`, `Math.random()` or `crypto` internally. Ids
come from an injected `IdGenerator`, randomness from an injected `RandomSource`, and
"today" is **always a parameter**. Tests pass `() => 0` as the `RandomSource` to take
lots in corpus order, and `InMemoryGroupRepository` stands in for D1.

If you find yourself wanting to freeze a clock in one of these libs, you've found a
function that should have taken a date argument.

---

## Email

Email is the scariest thing in this repo to change. It is the one path that leaves the
building; it fires from an hourly cron nobody is watching; and a mistake arrives in
real inboxes and **cannot be taken back**. A duplicate send or an unsubscribe that
silently no-ops is not a bug report, it's a spam complaint against the sending domain.

So it gets more machinery than anything else here: fast tests for every decision, the
real durable engine for the retry semantics, and a local workbench for looking at —
and deliberately sending — a real email before it goes anywhere near production.

### 🔴 Rule zero: no test may reach Resend

`@cloudflare/vitest-pool-workers` **loads `apps/server/.dev.vars` into the test
environment.** That file is where your real `RESEND_API_KEY` lives, and
`mishna2go.com` is a verified Resend sender — so a test that constructs a client and
calls it will send real mail to real people. This is not hypothetical: it was one
plausible test improvement away from happening.

Two independent defenses, and both must stay:

1. **`apps/server/vitest.config.mts` binds `RESEND_API_KEY: ''`** (so does
   `apps/login`'s config). An explicit empty binding beats `.dev.vars`, and *empty*
   beats *fake*: Resend's constructor throws on a falsy key, so the default state is
   "no client can exist" rather than "a client exists and its requests 401" — the
   latter still has the worker calling out from a test run.
2. **Per-file `fetch` stubs.** The files that need a working client
   (`email/workflow.integration.test.ts`, `email/dev-routes.integration.test.ts`) opt
   in with a fake key *and* stub global `fetch` with a **default-deny** branch — one
   that throws on any URL it doesn't recognize, so a new outbound call is a failure,
   not a surprise. `preferences.integration.test.ts` and
   `memorized.integration.test.ts` keep the empty binding and add the stub anyway —
   neither needs a Resend client, and the stub makes "this file cannot reach the
   network" an assertion rather than an assumption.

Writing a new email test? Copy the header of `workflow.integration.test.ts`. Do not
"just this once" use the real key.

### The local workbench: `/__dev/email`

Look at, and send, a real email built by the real code against your real local D1.

```sh
npm run db:init:local        # once — seeds local mishna-auth + mishna-app
npm run email:dev:server     # the DEV entry point, :8787
npm run dev                  # another terminal — Angular on :4200 (see APP_ORIGIN below)
# open http://localhost:8787/__dev/email
```

| Route | What it does |
|---|---|
| `GET /__dev/email` | The page: user dropdown, weekly/reminder, Preview into an iframe, "send to" box |
| `GET /__dev/email/plan?at=<ISO>` | **Dry run, sends nothing.** The real `planSends` at an arbitrary instant: *"who would get mail at 08:00 Sunday?"* |
| `GET /__dev/email/render?userId=&kind=` | `prepareOne` → `composeEmail`. Renders in the browser; `?part=text` for the plain-text half, `?part=json` for the RFC 8058 headers |
| `POST /__dev/email/send` | 🔴 Sends **one real email**. `to` overrides the recipient. Writes `email_log`, like admin send-now |
| `GET /__dev/email/cron?at=<ISO>` | Creates a real `ReminderWorkflow` instance. **This really sends** to everyone due — run `/plan` first |

Two things to know when a route says "nobody":

- **`?at=` is UTC**, and the send window is 08:00 in the *user's* zone. An
  `America/New_York` user is due at `12:00Z` in summer, `13:00Z` in winter.
- **`planSends` honors `email_log`**, so a (user, kind, week) you already sent this
  week — including from the workbench — comes back empty. Correct, not a bug.

Send to Resend's sandbox addresses (`delivered@resend.dev`, `bounced@resend.dev`,
`complained@resend.dev`) to exercise the real API — auth, rate limits, the batch
endpoint, the idempotency key — without touching a mailbox. The page defaults to the
first. Sending to your own inbox works too; make that the deliberate choice.

Full detail, including how to seed a user: **"Testing email locally" in
`apps/server/CLAUDE.md`**.

### 🔴 The `APP_ORIGIN` gotcha

`wrangler.toml` pins `APP_ORIGIN = "https://app.mishna2go.com"`, and `.dev.vars` is
what overrides it — so **the default local state is the dangerous one.** Leave it and
every email you preview points at production three ways over: the unsubscribe link
(footer *and* the `List-Unsubscribe` header) is a production URL signed with your
*local* secret; the **"I've memorized this" CTA** is too — and that one is a check-off
on a real user's portion *and*, for its first week, a sign-in credential; and the
Hebrew text is fetched from production. (The local secrets won't verify against
production's, so those links fail closed rather than firing — but don't lean on that;
you'd still have mailed a credential-shaped URL naming a real user id.)

```
# apps/server/.dev.vars
APP_ORIGIN=http://localhost:4200
```

That fixes all three: `nx serve client` really serves `http://localhost:4200/berakhot.json`
(mishna-text's data is in its assets), and `apps/client/proxy.conf.json` proxies
`/api/*` to `:8787`, so both emailed links land on your local worker. Not running
Angular? Keep `APP_ORIGIN` local and pass `?textOrigin=https://app.mishna2go.com` to
borrow production's text while every link stays local. **Never the reverse.**

The dev entry prints a warning on the first request if `APP_ORIGIN` isn't loopback,
because this one is invisible until it has already gone out.

### Previewing templates alone

```sh
npm run email:dev     # react-email's own preview server, :3030
```

Entries in `libs/shared/email-templates/src/lib/preview/`, one per email *state*:
`weekly`, `weekly-single-tractate`, `weekly-empty`, `weekly-large` (~40 mishnayot —
where you'd see Gmail's ~102 KB clipping bury the unsubscribe footer),
`weekly-no-unsubscribe`, `reminder`, `reminder-empty`. No D1, no user, no worker.

Use this for layout. Use `/__dev/email` for *"what would this user actually receive"*.

### Testing the Workflow

`ReminderWorkflow`'s retry semantics are the most expensive thing in the codebase to
get wrong, and they can't be reasoned about from the source — you need the durable
engine. `email/workflow.integration.test.ts` drives it through
`introspectWorkflowInstance` from `cloudflare:test`, with `disableSleeps()` and
`disableRetryDelays()` so a run costs milliseconds:

- `mockStepResult({ name })` / `mockStepError({ name }, err, times)` — inject a step
  result or a failure
- `waitForStepResult({ name })` / `waitForStatus(...)` / `getOutput()` / `getError()`

The flagship case is **"a retry does not re-send earlier batches"**: workflows
re-enter `run()` on a retry, and only `step.do`'s durable memoization stops batch 0
from being mailed twice. `email_log` cannot catch that — it's written *after* a send.

⚠️ **Injection hooks on the step name.** `mockStepError({ name: 'send-batch-1' }, …)`
silently does nothing if no step by that name exists — which is exactly what happens
if someone removes the `step.do`. That would make the test pass on a run that never
retried. So the test **waits on the step result by name first**, turning a missing hook
into a failure. Any new mock-driven workflow test needs the same guard.

### What is deliberately *not* unit-tested, and what covers it instead

| Thing | Why | Covered by |
|---|---|---|
| Resend's HTTP API | Network, credentials, money | Injected transport in tests; the workbench for real sends |
| Workflow step/retry/hibernation semantics | Runtime-owned | `introspectWorkflowInstance` (above) |
| D1 SQL — the `DEFAULT 1` trap, chunked `IN`, upserts | Storage-engine behavior | Real-D1 workerd tests in `apps/server` |
| Cron delivery reliability | Cloudflare-owned | Ops: the `run-metrics` log line |
| Inbox placement, DKIM/SPF, Outlook rendering | External | A real send from the workbench; Gmail's "Show original" |
| Bytes rendered under workerd | node renders via `renderToPipeableStream`, workerd via `renderToReadableStream`; identical output is not contractually guaranteed | The byte-identical-re-render assertions in `email/email.integration.test.ts` — **keep them there** even though `email-templates` has its own semantic tests |

**One risk no test can reach:** creating a Resend *Audience* or sending a *Broadcast*
from the Resend dashboard. Unsubscribes live only in D1, so a Broadcast would mail
everyone who unsubscribed — invisible to this repo. See the ops guardrail in
`apps/server/CLAUDE.md`.

### Mutation-test the scary ones

A test that doesn't fail when the code is broken is worse than no test, because it
manufactures confidence. On this path, spot-check by hand:

```sh
# break it, run the suite, expect red, then revert
npx nx test server --skip-nx-cache
git checkout -- <the file you broke>
```

Breaks worth trying: make `verifyUnsubscribeToken` skip the signature check; make
`mergePrefs` ignore its row; make `batchIdempotencyKey` order-dependent; drop
`WHERE "emailVerified" = 1` from `loadEmails`; remove the `step.do` around a batch
send; make a batch re-send everything before it.

The same drill on the "memorized" click-through, where the blast radius is a wrongly
marked portion or a session handed to the wrong person — try: make
`verifyMemorizedToken` skip the signature check; make `canLogin` always return `true`;
let `GET /api/memorized` mark instead of just rendering the form; have
`POST /api/memorized` mint a session when a *different* user already holds the browser;
recompute the bucket from `nextUnlearnedBucket` at click time instead of reading the
token's pinned one; put a `Date.now()` in `memorizedExpiresAt`. That last one should be
caught by the byte-identity test in `email.integration.test.ts` that advances the system
clock between two `processJobs` runs — the rest by `memorized.integration.test.ts` and
`apps/login`'s `memorized-session.integration.test.ts`.

Every one of those is currently caught. Three of them weren't until someone checked —
including two where the existing test was **vacuous**: `skips a participant whose
email is not verified` seeded no group, so the user had nothing to send and would have
been skipped no matter what the address filter did. That's why the verified-only tests
now seed a group *and* sit next to a positive control. Watch for that shape.

---

## Other non-obvious things

### workerd tests (`server`, `login`)

Real D1 and DO bindings, not mocks.

- **Migrations apply themselves.** `apply-migrations.ts` eager-loads every
  `apps/server/migrations/*.sql` and runs them in `beforeAll`, so the test schema
  can't drift from what ships. Adding a migration file is all the wiring there is.
- **Tables are cleared in `beforeEach`**, not recreated.
- **`AUTH` is a stub, configured in `vitest.config.mts`.** `get-session` treats the
  forwarded `cookie` *value* as the user id — so a test authenticates as whoever its
  `Cookie:` header names — and cookie `'admin'` is flagged `isAdmin`. Only
  `as('admin')` clears `requireAdmin`. The better-auth admin endpoints are stubbed
  with a fixed user directory.
- **`AUTH_DB` is a real but empty local D1.** The email tests create its `user` table
  and seed it themselves. A test that forgets this gets `no such table: user` — which
  surfaces as an opaque `502`, so check for it before believing a failure message.
- `apps/login`'s config force-blanks `TURNSTILE_SECRET_KEY` too, so a developer's
  local Turnstile test secret can't switch the captcha plugin on and 400 the
  token-less sign-in tests.

### The deploy-bundle gates

Two properties are true only of the **built** bundle, so no unit test can assert them.
Run these after touching templates or the dev entry:

```sh
cd apps/server && npx wrangler deploy --dry-run --outdir /tmp/wf
grep -c 'React.createElement' /tmp/wf/index.js   # must be 0
grep -c '__dev'               /tmp/wf/index.js   # must be 0
```

- **`React.createElement` must be 0.** esbuild resolves a tsconfig *per source file*,
  so `jsx: "react-jsx"` has to be in **both** of `email-templates`' tsconfigs or the
  classic runtime leaks into the worker bundle.
- **`__dev` must be 0.** `POST /__dev/email/send` mails any address as any user with
  no auth. It is safe only because `wrangler.toml` pins `main = "src/index.ts"` and
  `index.ts` never imports `dev-entry.ts` — a *structural* guarantee, not a flag.
  `email/dev-routes.integration.test.ts` asserts the production entry 404s every
  `/__dev/*` route; this grep is the other half. **Never mount `mountDevEmailRoutes`
  from `index.ts`.**

### Domain drift

```sh
node tools/sync-domains.mjs --check     # CI runs this
```

Fails if the generated files have drifted from `config/domains.json`. It only checks
files the generator owns — **prose in `CLAUDE.md`s, comments, and dev fixtures are
outside its reach.** Grep for the old apex by hand when rebranding. (`apps/login/CLAUDE.md`
currently still names the old one.)

### i18n

CI runs `npx nx build client --configuration=production-he` as a separate step: the
Hebrew build sets `i18nMissingTranslation: error`, so a missing `<target>` fails on the
PR rather than during a deploy. Adding user-facing English text to `apps/client`
without a Hebrew translation will fail there, not in `nx test`.

### Mobile (Flutter) is deliberately outside CI

`apps/mobile` is not in the NX TypeScript graph, and its targets are named *off* NX's
conventions on purpose so the Flutter toolchain never enters
`nx run-many -t lint test build`:

```sh
npx nx analyze mobile          # dart analyze
npx nx test-flutter mobile     # flutter test
npx nx build-apk mobile        # manual release build
```

Run them by hand. Note the standing rule in the root `CLAUDE.md`: web and mobile are
two front-ends over the same APIs and must stay behaviorally in sync — a user-facing
change in one needs the matching change (and test) in the other. Admin is web-only and
on-device reminders are mobile-only; those are the only intended gaps.

### e2e

```sh
npm run e2e     # nx e2e client-e2e
```

Playwright against `http://localhost:4200`, starting the dev server if one isn't
already up. In CI it serves the prebuilt static SPA — **no backend Workers, no D1** —
so e2e covers rendering and routing, not API behavior. Today it is a single
landing-page smoke test; don't mistake a green e2e for end-to-end coverage.

---

## Before you push

```sh
npx nx run-many -t lint test build     # the CI gate
node tools/sync-domains.mjs --check
```

Plus, if you touched email: the two deploy-bundle greps above, and — for anything that
changes what a recipient sees — one real send from `/__dev/email` to
`delivered@resend.dev` or your own inbox. Nothing in this repo can tell you an email
*looks* right.

**Known flake:** `login:test` fails rarely and doesn't reproduce (most likely the
better-auth/D1 setup in `index.integration.test.ts`). Re-run before investigating.
