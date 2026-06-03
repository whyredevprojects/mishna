# TODO — deferred work

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
