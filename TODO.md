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
