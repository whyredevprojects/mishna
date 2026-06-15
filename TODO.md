# TODO — deferred work

## Decide how to define a "week"

Commitment is now per **week** (1/2/3 mishnayos), so we had to pick what a "week" means
for the assignment math. The current choice:

- A week is a **7-day bucket counted from the cycle start (1 Sivan)**:
  `getAssignment` slices a user's blocks at `weeksSinceCycleStart(date) * commitment`.
  This is stateless and date-only, which keeps `AssignmentEngine` pure (no per-user state).

**Consequence (the open question):** the email path anchors its week to each user's chosen
weekly-email weekday (`weeklyEmailDow`), not to the cycle-start buckets. So the dashboard's
"this week" (the bucket containing *today*) and the weekly email (the bucket containing the
*send day*) can drift by up to a few days at bucket boundaries. They agree on the send day
and re-sync on the next email, so it self-corrects — but it can briefly look inconsistent.

**Alternative, deferred:** anchor weeks to each user's `weeklyEmailDow` everywhere, so the
dashboard and email always agree. This would require threading email prefs into the
(currently stateless, date-only) assignment path — a bigger change. Deferred until we decide
the drift actually matters in practice.

## Big lots can finish after the deadline (pace = commitment)

Allocation hands each user `commitment` random lots and paces them at `commitment`
mishnayos/week. Lots are **15–57 mishnayos** (median 34; the 120 lots tile all 4192). Since
a user's portion is `commitment` lots ≈ `commitment × avg-lot`, the commitment cancels and
**weeks-to-finish ≈ the average size of the lots they happened to draw** — independent of
the commitment number.

**Consequence:** a regular cycle is ~50.5 weeks (354-day year), a leap one ~54.8 (384-day).
A user who draws larger-than-average lots overshoots it. Worst case: a **commitment-1 user
who draws a 57-mishna lot needs 57 weeks** at 1/week, so they finish *after* Rosh Chodesh
Sivan instead of comfortably early. (We chose "fixed n = commitment, ok to finish early,"
which is right for the median ~35-mishna lot — only above-median draws miss the deadline.)

**Fix (sketch):** pace at `n = max(commitment, ceil(totalSize / weeksInCycle))` — fast
enough that everyone finishes by the cycle end, but never slower than the pace they chose.

- Add `weeksInCycle(date)` to `CycleCalendar` (`libs/shared/domain/src/lib/cycle-calendar.ts`):
  `Math.ceil((this.cycleEndAbs(date) - this.cycleStartAbs(date)) / 7)` — the cycle's length
  in 7-day buckets.
- In `AssignmentEngine.getAssignment` (`libs/shared/domain/src/lib/assignment-engine.ts`),
  derive `n` from the summed `blocks[].totalSize` and `weeksInCycle(date)` and use it for
  both the offset (`week * n`) and the take count, instead of `commitment` directly;
  `getWeekAssignment` inherits it. Update `assignment-engine.spec.ts`.
- UI note: "N / week" stays correct as a **minimum** (a user may be paced faster when their
  lots are large). Capping at `commitment` instead would keep the displayed pace exact but
  reintroduce the late finish.

## Offline completion recovery

Today, marking a mishna learned requires the network: `TodayCardComponent` optimistically
checks the box, calls `POST`/`DELETE /api/completions`, and reverts with an error toast if
the request fails. So a user with no connection can't record progress.

**Goal:** let users check mishnayot off while offline and have those changes sync when they
reconnect, resolving conflicts by last-write-wins.

**Sketch:**
- Queue each toggle locally (e.g. IndexedDB/localStorage) with the time it happened.
- On reconnect, replay the queue to the API.
- The API keeps an update only if its timestamp is newer than the stored `completions.completed_at`,
  so a stale offline change never clobbers a newer online one. (`completed_at` already exists
  for exactly this.)
- Unchecks need tombstones (a delete with a timestamp), since a row's absence can't otherwise
  be distinguished from "never set" — design this out before building.

Deferred because it needs a local queue, a sync trigger, and a conflict-resolution endpoint
shape; the online path covers the common case.

## Run e2e tests in CI

The `client-e2e` project (Playwright) is not run by `nx test` — only `nx e2e client-e2e`
triggers it, and nothing currently invokes that automatically. It should run as part of CI
so end-to-end regressions are caught. Today it only has the scaffolded `example.spec.ts`, so
wiring it into CI should go hand-in-hand with adding real specs for the key flows.
