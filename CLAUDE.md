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

Key concepts:
- **MishnaStructure** — the full structure of all mishnayos, sedarim, mesachtos and perakim, and how they are allocated for memorization by a group for a particular cycle. Knows names of the sedarim and mesachtos, how many perakim, how many mishnas in each perek. Not the actual mishnayos text content ; has `assign(user, commitment, todaysDate)` method which returns a `block`.
- **Block** — a range of mishnayos which a user is assigned to for the year. A range, identified by a start and end mesechta,perek,mishna. The length of the block is determined by the user's commitment and how many days are remaining in the cycle.
- **Assignment** — what a specific user must do on a specific date (includes a `date` property)
- **Commitment** — enum: 1, 2, or 3 mishnayos per day
- **Group** — a set of users whose blocks together cover all sedarim; new groups are auto-created when a group fills up

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
