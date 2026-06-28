# @mishna/email-data

The "actual" / SQL half of the email seam: `D1EmailRepository`, the production D1-backed
implementation of `@mishna/email-domain`'s `EmailRepository` port. Depends on
`@mishna/domain` (for `blocksForUser` + the `Block`/`GroupState` types),
`@mishna/email-domain` (the port + types), and `@cloudflare/workers-types` (the
`D1Database` type, dev-only).

## Public surface (`src/index.ts`)

| Export | What it is |
|--------|------------|
| `D1EmailRepository` | Implements `EmailRepository` over two D1 databases: `db` (mishna-app: `participants`, `user_email_prefs`, `completions`, `groups`, `group_members`, `email_log`) and `authDb` (mishna-auth: the better-auth `user` table, read-only). The bulk send path's batched readers — `loadCandidates`, `alreadySent`, `loadBlocks`, `loadCompleted`, `loadEmails` — plus `recordSent`. |
| `D1EmailRepositoryDeps` | The constructor injection: `{ db, authDb }` — just the two D1 handles. (No domain singletons: `loadBlocks` only `JSON.parse`s the raw group state and hands it to `@mishna/domain`'s `blocksForUser`, so it never reconstructs a `Group`.) |
| `chunked` / `placeholders` | Generic D1 paging helpers — `chunked` splits id lists into runs of ≤ `size` (under D1's 100-bind-param ceiling), `placeholders(n)` builds the `?,?,…` list. Reused by `apps/server`'s admin readers (`email/data.ts`). |

## Key conventions

- **Decoupled from the worker `Env`.** The constructor takes the two `D1Database` handles
  explicitly, so the lib carries no Cloudflare binding and is testable with any D1.
  `apps/server` wires `env.DB` / `env.AUTH_DB`.
- **I/O only — the per-user filter lives in the domain.** `loadBlocks` loads the raw group
  state and `JSON.parse`s it, then `@mishna/domain`'s `blocksForUser` keeps only the
  queried user's blocks. The "which blocks are this user's" rule is *not* re-implemented
  here (it used to be, and a divergent copy was the bug that motivated this seam).
- **Self-contained queries; shared helpers.** The adapter owns its *SQL* rather than
  sharing it with the app's admin readers, the same way `D1GroupRepository` owns the
  group SQL — the small duplication keeps the port impl independent and the dependency
  direction clean. The generic, query-agnostic paging helpers (`chunked`/`placeholders`)
  *are* exported and reused by `apps/server`'s admin readers (app → lib, so the direction
  stays clean).
- **Verified-only.** `loadEmails` filters `WHERE "emailVerified" = 1` — the email path
  never mails an unverified address.
- **Defaults for missing prefs.** A participant with no `user_email_prefs` row gets
  `@mishna/email-domain`'s shared `DEFAULT_EMAIL_PREFS` (`America/New_York`, weekly=Sun,
  reminder=Thu, both on) in `loadCandidates` — not a local copy.

## Testing

The D1 query behavior is exercised against a **real** D1 binding in `apps/server`'s
`email/email.integration.test.ts` (via `@cloudflare/vitest-pool-workers`), the same way
`D1GroupRepository` is covered by `repository.test.ts`. The lib's own `nx test email-data`
is a storage-free smoke test (the `chunked` helper + the port-conformance type check).
