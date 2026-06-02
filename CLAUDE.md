# Mishna Memorization App

## Project Overview

An app for organizing groups to collectively memorize the entire Mishna by Rosh Chodesh Sivan. Users commit to 1, 2, or 3 mishnayos per day and are auto-assigned a block. Groups are auto-created so the full set of mishnayos is covered by Rosh Chodesh Sivan. The cycle resets each Rosh Chodesh Sivan.

## Monorepo Structure

NX monorepo. All apps are Cloudflare Workers/Pages unless noted.

| Path | Description |
|------|-------------|
| `apps/client/` | Angular frontend — landing page, login/signup, user dashboard, admin pages |
| `apps/email/` | Cloudflare Worker with cron trigger (every 3h) — builds and queues daily reminder emails via Resend; queue handler sends in batches of 50; each user receives at most one email per day |
| `apps/login/` | Cloudflare Worker — authentication via better-auth (Google OAuth, magic links, etc.) |
| `apps/server/` | Cloudflare Worker — main REST API using Hono; serves the Angular app's data needs |
| `libs/shared/domain/` | Core domain models and logic (framework-free) |

## Tech Stack

- **Runtime**: Cloudflare Workers (email, login, server), Cloudflare Pages (client)
- **API framework**: Hono (`apps/server`)
- **Auth**: better-auth (`apps/login`)
- **Email**: Resend (`apps/email`)
- **Frontend**: Angular
- **Language**: TypeScript throughout

## Domain Model (libs/shared/domain)

Framework-free core, fully unit-tested. See `libs/shared/domain/CLAUDE.md` for the
implementation map and `README.md` there for the design narrative.

- **`MishnaStructure`** — static corpus model (4192 mishnayot); owns all corpus traversal (`computeBlock`, `indexOf`/`refAt`, `iterateRange`). Build the default via `createMishnaStructure()`.
- **`CycleCalendar`** — the 1-Sivan-to-1-Sivan learning cycle via `@hebcal/core` (`cycleStart`, `daysSinceCycleStart`, `daysRemaining`).
- **`Group`** — per-group allocation (blocks, gap queue, tail); `addUser` / `removeUser` / `toState` / `fromState`. Each group spans the whole corpus.
- **`AssignmentEngine`** — stateless; `getAssignment(blocks, date)` derives a day's mishnayot on demand.
- **`GroupManager` + `GroupRepository`** — orchestration over a persistence port (`InMemoryGroupRepository` for tests; D1 in production).

Determinism: ids come from an injected `IdGenerator`, dates are always passed in.

## Conventions

- Domain logic lives in `libs/shared/domain` — apps should not duplicate it
- Apps import shared domain via NX path aliases (see `tsconfig.base.json`)
- Each Cloudflare Worker app has its own `wrangler.toml`
- When making significant changes to a sub-project, update or create that project's own `CLAUDE.md`

## Admin Features

Admin page (in `apps/client`) shows:
- Number of active groups
- Progress of each group
- Members of each group
