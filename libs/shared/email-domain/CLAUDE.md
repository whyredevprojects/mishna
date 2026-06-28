# @mishna/email-domain

Framework- and storage-free email *business logic*: who gets which email, when, and
with what content. The abstract half of the email seam — the concrete D1 SQL lives in
`@mishna/email-data`, and the Resend send + React-Email templates live in `apps/server`.
Depends only on `@mishna/domain`. Fully unit-tested.

## Public surface (`src/index.ts`)

| Export | What it is |
|--------|------------|
| `EmailRepository` (port) + `InMemoryEmailRepository` | The data contract the decision logic reads through — `loadCandidates`, `alreadySent`, `loadBlocks`, `loadCompleted`, `loadEmails`, `recordSent`. Mirrors `@mishna/domain`'s `GroupRepository` seam: production talks to D1 (`@mishna/email-data`), tests/local use the in-memory impl. |
| `selectDue(candidates, now)` | The pure send-time filter: the candidacies for whom it is currently 08:00 local, weekly on their weekly weekday and reminder on their reminder weekday (when enabled). Returns `Candidacy[]`. |
| `dropAlreadySent(due, sentSet)` | Drops candidacies whose `${userId}\|${kind}\|${weekStart}` is already in the dedup set. |
| `buildPreparedEmails(live, data, engine, now)` | Resolves live candidacies to fully-rendered `PreparedEmail[]` — content is the user's next still-unlearned bucket via the injected `AssignmentSource` (weekly = whole bucket, reminder = still-pending only). Skips no-address and finished (empty-bucket) users. |
| `planSends(repo, engine, now)` | Orchestrates the three steps over an `EmailRepository`, batching the blocks/completions/emails reads. The bulk path's entry point. |
| `refsForKind(kind, next, completed)` | The single source of the content rule: weekly = the whole next-unlearned bucket; reminder = only its still-pending mishnayot. Used by `buildPreparedEmails` (bulk) and `prepareOne` (admin send-now). |
| `SEND_HOUR`, `refKey`, `sentKey` | The 08:00 constant and the `mesechta\|perek\|mishna` / `userId\|kind\|weekStart` key helpers. |
| `DEFAULT_EMAIL_PREFS` | The prefs a participant with no `user_email_prefs` row gets (NY time, weekly=Sun/0, reminder=Thu/4, both on) — shared by `@mishna/email-data`, the admin readers, and `GET /api/me/preferences`. |
| Types | `EmailKind` (re-exported from `@mishna/domain`), `EmailPrefs`, `Candidate` (`EmailPrefs & { userId }`), `Candidacy`, `PreparedEmail`, `ResolvedData`, `AssignmentSource`. |

## Key conventions

- **Pure with respect to the clock and storage.** `now` is always passed in; all data
  comes from the injected `EmailRepository`; the content engine is the injected
  `AssignmentSource` (satisfied structurally by `@mishna/domain`'s `AssignmentEngine`,
  so this lib doesn't depend on the concrete class).
- **Batched reads.** `planSends` resolves the due subset with set-based reads on the
  port (blocks/completions/emails), so a run is O(due/100) subrequests, not O(due).
- **Decision steps are separately testable** (`selectDue` / `dropAlreadySent` /
  `buildPreparedEmails`) and composed by `planSends`.

## Testing

`nx test email-domain`. Tests use `InMemoryEmailRepository` and a real `AssignmentEngine`
over the production corpus with a fixed-cycle calendar stub, so bucket math is
deterministic. Covers multi-timezone 08:00 firing, weekly/reminder day selection, the
enabled flags, dedup, the no-address and finished-user skips, reminder-unlearned-only, and
week anchoring. (Prefs-default behavior lives in the data layer — see `@mishna/email-data`
and `apps/server`'s email integration test.)
