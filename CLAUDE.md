# Mishna Memorization App

## Project Overview

An app for organizing groups to collectively memorize the entire Mishna by Rosh Chodesh Sivan. The corpus is divided into 120 pre-set **lots (chalakim)**. Users commit to 1, 2, or 3 (= mishnayos per week, and the number of random lots they're assigned for the cycle). Groups are auto-created, each a full covering of all 120 lots, so the whole Mishna is covered. The cycle resets each Rosh Chodesh Sivan.

## Monorepo Structure

NX monorepo. All apps are Cloudflare Workers/Pages unless noted.

| Path | Description |
|------|-------------|
| `apps/client/` | Angular frontend — landing page, login/signup, user dashboard, admin pages |
| `apps/login/` | Cloudflare Worker — authentication via better-auth (Google OAuth, magic links, etc.) |
| `apps/server/` | Cloudflare Worker — main REST API using Hono; serves the Angular app's data needs. Also owns email: an hourly cron triggers the `ReminderWorkflow` (a Cloudflare Workflow) that sends weekly/reminder emails via Resend, and admin "send now" sends one inline. |
| `apps/mobile/` | Flutter app (Android/iOS) — the user-facing functionality (no admin) against the same APIs, plus on-device study reminders. Mishna text ships as bundled assets from the `mishna_text` pub package. Not part of the NX TS graph; `project.json` wraps Flutter commands under targets deliberately named off NX's CI conventions so the whole Flutter toolchain stays out of CI's `nx run-many -t lint test build`: `analyze`, `test-flutter` (`flutter test`), and `build-apk` (`flutter build apk --release`). Run them by hand (e.g. `nx test-flutter mobile`); the apk build is a separate, manual process. |
| `libs/shared/domain/` | Core domain models and logic (framework-free) |

## Tech Stack

- **Runtime**: Cloudflare Workers (login, server), Cloudflare Pages (client)
- **API framework**: Hono (`apps/server`)
- **Auth**: better-auth (`apps/login`)
- **Email**: Resend, sent from a Cloudflare Workflow in `apps/server`
- **Frontend**: Angular (web), Flutter (`apps/mobile`)
- **Language**: TypeScript throughout the web stack; Dart in `apps/mobile`

## Domain Model (libs/shared/domain)

Framework-free core, fully unit-tested. See `libs/shared/domain/CLAUDE.md` for the
implementation map and `README.md` there for the design narrative.

- **`MishnaStructure`** — static corpus model (4192 mishnayot); owns all corpus traversal (`computeBlock`, `indexOf`/`refAt`, `iterateRange`). Build the default via `createMishnaStructure()`.
- **`MishnaChalakim`** — the 120 pre-set lots (`chaluka.json`); `getLotByNumber`, `lotsForMesechta`, `allLots`/`allLotNumbers`. Build via `createMishnaChalakim()`.
- **`CycleCalendar`** — the 1-Sivan-to-1-Sivan learning cycle via `@hebcal/core` (`cycleStart`, `daysSinceCycleStart`, `daysRemaining`, `weeksSinceCycleStart`, `weeksRemaining`).
- **`Group`** — one full covering of the corpus, allocated as lots; `addUser` claims random free lots, `removeUser` frees them; `toState` / `fromState`. A user's `Block` carries its lot numbers plus derived ranges.
- **`AssignmentEngine`** — stateless; `getAssignment(blocks, date)` derives a week's mishnayot on demand (offset = `weeksSinceCycleStart * commitment`). The user's portion is finite (their lots), so it empties out once they finish.
- **`GroupManager` + `GroupRepository`** — orchestration over a persistence port (`InMemoryGroupRepository` for tests; D1 in production).

Determinism: ids come from an injected `IdGenerator`, randomness (lot picks) from an injected `RandomSource`, dates are always passed in.

## Conventions

- Domain logic lives in `libs/shared/domain` — apps should not duplicate it
- Apps import shared domain via NX path aliases (see `tsconfig.base.json`)
- Each Cloudflare Worker app has its own `wrangler.toml`
- When making significant changes to a sub-project, update or create that project's own `CLAUDE.md`
- **Keep the web (`apps/client`) and mobile (`apps/mobile`) user-facing experiences in
  sync.** They are two front-ends over the same APIs and should offer the same
  functionality and behavior (sign-in/up, join, the weekly assignment + week pager,
  learned check-off, My Mishnayos, Review, settings). When you add or change a
  user-facing feature in one, make the matching change in the other in the same effort
  (Material 3 vs. Web Awesome means the *look* differs — the *behavior* shouldn't).
  Admin is web-only and on-device reminders are mobile-only, by design — those are the
  only intentional gaps.

## Changing the domain

`config/domains.json` is the **single source of truth** for the app's domain. To
repoint or rebrand, edit it and run `npm run sync:domains` — a small generator
(`tools/sync-domains.mjs`) propagates the derived values into the files that can't
read that JSON at build time (`apps/{login,server}/wrangler.toml` routes + vars,
`apps/mobile/lib/core/config.dart`, `apps/www/src/_data/site.json`, and the Angular
Turnstile key). The Angular client needs nothing (relative `/api/*` URLs), and
`apps/login` derives its trusted origin from `BETTER_AUTH_URL` at runtime. CI runs
`node tools/sync-domains.mjs --check`, which fails if anything has drifted from the
config.

A genuinely **new** domain also needs these one-time external steps (no repo file
can automate them):

- **Cloudflare**: add the new zone to the account; set `app.<newapex>` as a custom
  domain on the client Pages project (worker `routes` only bind to zones on the
  account); DNS for `app.` + `images.`.
- **Resend**: verify the new sender domain (SPF/DKIM) for `<newapex>`.
- **Google OAuth**: add the redirect URI
  `https://app.<newapex>/api/auth/callback/google` in the Google Cloud console.
- **Cloudflare Turnstile**: the site key is hostname-bound — create/extend the widget
  for the new host and put its **site key** in `config/domains.json`
  (`turnstileSiteKey`) so the sync propagates it to web + mobile.

## Admin Features

Admin page (in `apps/client`) shows:
- Number of active groups
- Progress of each group
- Members of each group
