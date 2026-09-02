# @mishna/email-domain

Framework- and storage-free email *business logic*: who gets which email, when, with
what content — plus the pure rules the send path leans on (prefs defaults, the
one-click-unsubscribe token and landing page, the outgoing-message shape and its
idempotency/header contracts). The abstract half of the email seam: the concrete D1 SQL
lives in `@mishna/email-data`, the React-Email rendering in `@mishna/email-templates`,
and the Resend/D1/HTTP side effects in `apps/server`. Depends only on `@mishna/domain`.
Fully unit-tested, in plain node, in under a second.

## Public surface (`src/index.ts`)

### The send decision

| Export | What it is |
|--------|------------|
| `EmailRepository` (port) + `InMemoryEmailRepository` | The data contract the decision logic reads through — `loadCandidates`, `alreadySent`, `loadBlocks`, `loadCompleted`, `loadEmails`, `recordSent`. Mirrors `@mishna/domain`'s `GroupRepository` seam: production talks to D1 (`@mishna/email-data`), tests/local use the in-memory impl. |
| `selectDue(candidates, now)` | The pure send-time filter: the candidacies for whom it is currently 08:00 local, weekly on their weekly weekday and reminder on their reminder weekday (when enabled). Returns `Candidacy[]`. |
| `dropAlreadySent(due, sentSet)` | Drops candidacies whose `${userId}\|${kind}\|${weekStart}` is already in the dedup set. |
| `buildPreparedEmails(live, data, engine, now)` | Resolves live candidacies to `PreparedEmail[]`, one `prepareSingle` per candidacy with `skipWhenEmpty: true`. |
| `planSends(repo, engine, now)` | Orchestrates the three steps over an `EmailRepository`, batching the blocks/completions/emails reads. The bulk path's entry point. |
| `SEND_HOUR`, `refKey`, `sentKey` | The 08:00 constant and the `mesechta\|perek\|mishna` / `userId\|kind\|weekStart` key helpers. |

### Content — what goes in one email (`lib/content.ts`)

| Export | What it is |
|--------|------------|
| `refsForKind(kind, next, completed)` | The content rule: weekly = the whole next-unlearned bucket; reminder = only its still-pending mishnayot. |
| `resolveOne(kind, blocks, completed, date, engine)` | `getNextAssignment` + `refsForKind` over an **injected** `AssignmentSource` — so nothing on the email path reaches for a module singleton. |
| `prepareSingle(input, engine, opts)` | **The** per-user decision: no address → `null`; nothing left to show → `null` *only when* `opts.skipWhenEmpty`. Used by both callers (see below). |
| `ResolvedMishna`, `TextResolver` | One mishna resolved to its Hebrew text, and the port that resolves a set of refs. `apps/server`'s `httpTextResolver` is the production impl. |
| `SingleSendInput`, `PrepareOptions` | `prepareSingle`'s inputs. |

### The outgoing message (`lib/outgoing.ts`)

| Export | What it is |
|--------|------------|
| `OutgoingEmail` | One email in Resend's batch shape. `text` is **required**, not optional. |
| `EmailTransport` | The send port: `(emails, idempotencyKey) => Promise<void>`, throwing on failure so the caller can retry. |
| `batchIdempotencyKey(jobs)` | `reminder-batch-<sha256>` over the sorted (user, kind, week) tuples — order-independent, so a re-planned retry collapses instead of re-delivering. |
| `listId(appOrigin)` | The RFC 2919 `List-Id`. **Throws** on an unparseable origin rather than stamping someone else's list id. |
| `unsubscribeHeaders(url, appOrigin)` | Exactly the three RFC 8058 headers. |

### Prefs rules (`lib/prefs-rules.ts`)

| Export | What it is |
|--------|------------|
| `DEFAULT_EMAIL_PREFS` | The prefs a participant with no `user_email_prefs` row gets (NY time, weekly=Sun/0, reminder=Thu/4, both on). |
| `mergePrefs(row)` | **The** single implementation of the defaults merge, over the raw snake-case D1 row. Used by `@mishna/email-data`'s `loadCandidates`, `apps/server`'s `loadRecipient`, `rowToPrefs` and the admin users list. |
| `flagsAfterUnsubscribe(scope)` | The exhaustive `switch` over `UnsubscribeScope` → the two resulting flags. The flags→SQL-column translation stays in `apps/server`. |
| `unsubscribeAudit(weekly, reminder, via, now)` | `0006`'s audit columns for a prefs write: both on clears, both off records the channel, one-on-one-off leaves the previous record standing (`null`). |
| `isHardUnsubscribe(via)` | Whether the last off-switch came from the *mail* (`'one-click'`/`'link'`) — the one state admin "send now" refuses to override. |
| `UnsubscribeVia`, `EmailPrefsRow` | The audit channel, and the raw row shape `mergePrefs` reads. |

### One-click unsubscribe (`lib/unsubscribe-token.ts`, `lib/unsubscribe-page.ts`)

| Export | What it is |
|--------|------------|
| `mintUnsubscribeToken(secret, userId, scope)` | `base64url("v1.<userId>.<scope>") "." base64url(HMAC-SHA256)`. Deterministic, no expiry, no clock. Throws when the secret is unset. |
| `verifyUnsubscribeToken(secret, token)` | Verifies against **every** comma-separated secret (the rotation story). Never throws; every malformed input is `null`. |
| `parseClaims(payload)` | The payload parser — reads the fields from the ends inward, so a userId containing `.` can't shift `scope`. |
| `unsubscribeUrl(appOrigin, token, lang?)` | The link that goes in the mail (header + visible footer). |
| `pickLang(queryLang, acceptLanguage)` | `?lang`, else the best **q-ranked** `Accept-Language` tag (legacy `iw` counts as Hebrew), else English. |
| `confirmPageHtml` / `donePageHtml` / `errorPageHtml` / `plainDone` / `plainError` | The self-contained bilingual landing page and its plain-text bodies. |
| `escapeHtml`, `settingsUrl`, `page`, `COPY` | The page's building blocks, exported so each is directly testable. |
| `UnsubscribeScope`, `UnsubscribeClaims`, `UnsubscribeLang` | Types. |

### One-click "I've memorized this" (`lib/memorized-token.ts`, `lib/memorized-page.ts`)

| Export | What it is |
|--------|------------|
| `mintMemorizedToken(secret, userId, bucket, expiresAt)` | `base64url("m1.<userId>.<bucket>.<expiresAt>") "." base64url(HMAC-SHA256)`. Deterministic, **no clock**. Throws when the secret is unset. |
| `memorizedExpiresAt(weekStart)` | `weekStart + MARK_TTL_DAYS`, epoch seconds. The single place the derivation lives — and the reason the scheme keeps expiry *and* byte-identical re-renders (see below). |
| `verifyMemorizedToken(secret, token)` | Verifies against every comma-separated secret. Never throws. Deliberately does **not** check expiry: there are two windows and picking one is the caller's call. |
| `parseMemorizedClaims(payload)` | Ends-inward parse, so a userId containing `.` can't shift `bucket`/`expiresAt`; both trailing fields must be plain non-negative integers. |
| `canMark(claims, now)` / `canLogin(claims, now)` | The 30-day marking window and the 7-day login window, both off the same signed instant. `canLogin` is never more permissive. |
| `memorizedUrl(appOrigin, token)` | The link that goes in the mail's top CTA. |
| `MARK_TTL_DAYS` / `LOGIN_TTL_DAYS` | 30 and 7. |
| `memorizedConfirmPageHtml` / `memorizedDonePageHtml` / `memorizedErrorPageHtml` / `plainMemorizedDone` / `plainMemorizedError` / `MEMORIZED_COPY` / `dashboardUrl` | The bilingual landing page. **Three states, not five**: invalid and expired collapse into one error page (nothing distinguishes them for the reader, and merging avoids telling a probe whether a token was real); "a different user holds this browser" and "the login window closed" collapse into one done page (the mishnayot were marked either way). |

Two things here are load-bearing and easy to undo by accident:

- **The expiry is derived from the job, never from `Date.now()`.** `weekStart` is
  already a field of `PreparedEmail`, so the token stays a pure function of
  (secret, job) and a re-rendered email is byte-identical — which the Resend
  `Idempotency-Key` requires. This is the constraint the unsubscribe token gave up
  expiry for; this one gets both.
- **`bucket` is pinned at plan time, not recomputed at click time.**
  `nextUnlearnedBucket` advances as soon as a bucket is complete, so recomputing would
  make the link mark the *next* bucket for anyone who checked off in the app first.

The shared HMAC/base64url primitives both tokens use live in `lib/hmac-token.ts`
(`signToken` / `verifyToken` / `signingSecrets`); the two token modules keep only their
payload shape and their policy — which are genuinely opposite (append-only-forever vs.
prunable-and-revocable).

### Types

`EmailKind` (re-exported from `@mishna/domain`), `EmailPrefs`, `Candidate`
(`EmailPrefs & { userId }`), `Candidacy`, `PreparedEmail`, `ResolvedData`,
`AssignmentSource`.

## Key conventions

- **Pure with respect to the clock and storage.** `now` is always passed in; all data
  comes from the injected `EmailRepository`; the content engine is the injected
  `AssignmentSource` (satisfied structurally by `@mishna/domain`'s `AssignmentEngine`,
  so this lib doesn't depend on the concrete class). The unsubscribe secret is a plain
  argument. Nothing here reads a binding or a global.
- **Runtime-agnostic.** The only platform APIs used are `crypto.subtle`, `btoa`/`atob`
  and `TextEncoder` — present in workerd and in node 18+ — so every one of these rules
  is testable without spinning up a Worker.
- **Batched reads.** `planSends` resolves the due subset with set-based reads on the
  port (blocks/completions/emails), so a run is O(reads), not O(due). Keeping each list
  under D1's 100-bind ceiling is the *adapter's* job (`@mishna/email-data`).
- **One rule, one function — with the difference as a parameter.** `prepareSingle` is
  used by *both* callers, and the only thing that differs is spelled out:

  | Caller | `skipWhenEmpty` | Why |
  |---|---|---|
  | `buildPreparedEmails` (bulk/cron) | `true` | A user who has finished their whole portion must stop receiving scheduled mail. |
  | `apps/server`'s `prepareOne` (admin send-now) | `false` | The admin pressed the button; a silent no-op reads as broken. They get the templates' empty state, and `GET /api/admin/users/:id` reports `weeklyRefCount`/`reminderPendingCount` so it is never a surprise. |

  The same instinct applies to `mergePrefs`: it replaced two byte-identical copies of
  the defaults merge. A divergent copy of a shared rule is the bug shape that already
  shipped once here (`blocksForUser`).
- **Decision steps are separately testable** (`selectDue` / `dropAlreadySent` /
  `buildPreparedEmails`) and composed by `planSends`.

## Testing

`nx test email-domain` — plain node, ~1s, ~90 tests.

- `plan-sends.spec.ts` — the send decision over `InMemoryEmailRepository` and a real
  `AssignmentEngine` on the production corpus with a fixed-cycle calendar stub, so
  bucket math is deterministic. Covers multi-timezone 08:00 firing, weekday selection,
  the enabled flags, dedup, the no-address and finished-user skips, week anchoring,
  **DST** (08:00 fires exactly once per local day across 23- and 25-hour days and a
  half-hour zone), the batching contract at 250 due users, and `prepareSingle` under
  both `skipWhenEmpty` settings.
  It also contains **one deliberately-documented defect**: changing
  `weeklyEmailDow` mid-week yields a *second* weekly that week, because `email_log` is
  keyed on the anchor that moved with the weekday. That test is named and commented as
  accepted behavior — rare, self-healing, and the content is progress-based. If it
  fails, the dedup key changed; decide deliberately, don't "fix" the test.
- `unsubscribe-token.spec.ts` — round-trip, rotation, determinism over 100 mints,
  signature tamper, payload tamper under a stolen signature, scope escalation,
  cross-user, dot-in-userId, and the no-secret/whitespace-list failures.
- `unsubscribe-page.spec.ts` — `pickLang`'s q-ranking, HTML escaping of a hostile
  token, the confirm form's action, `settingsUrl`'s locale + trailing-slash handling.
- `memorized-token.spec.ts` — round-trip, rotation, determinism over 100 mints, and the
  escalation cases that matter more here than for the unsubscribe token: a forged
  bucket, an expiry pushed out, a swapped userId (all under a *stolen* signature), a
  foreign secret, and an unsubscribe token replayed as a memorized one. Plus the
  `canMark`/`canLogin` boundary table, including the window where a link still marks but
  no longer signs in.
- `memorized-page.spec.ts` — the confirm form POSTs, carries the token in a **hidden
  field** rather than the action's query string, escapes a hostile token, and every page
  is `noindex` + `no-referrer`.
- `prefs-rules.spec.ts` — the `mergePrefs` matrix (no row / partial row / each flag off
  / both off / `dow: 0`), `flagsAfterUnsubscribe` for all three scopes, and the
  `unsubscribeAudit` / `isHardUnsubscribe` truth tables.
- `outgoing.spec.ts` — the idempotency key's order-independence and sensitivity, and
  the `List-Id` / RFC 8058 header contracts.

The HTTP-level behavior these back (always-200, read-only GET, the D1 `DEFAULT 1`
insert-branch trap, the audit lifecycle) stays in `apps/server`'s
`unsubscribe.integration.test.ts` against a real D1. Prefs-default behavior *through
D1* is in `@mishna/email-data` and `apps/server`'s email integration test.
