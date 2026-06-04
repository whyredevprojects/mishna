# TODO — deferred work

## Scaling the reminder email send (if we ever need to)

The reminder/weekly send lives in `apps/server` (the cron-triggered `ReminderWorkflow`),
but it leans on this worker for recipient addresses (`AUTH_DB`, the `mishna-auth` `user`
table), so the cross-worker boundary matters to any scaling move — noting the ideas here.

**Where it stands.** A daily run is now a handful of batched `IN (...)` reads, not a
per-user query loop, so cost is O(due/100) subrequests, not O(due). At the <5K forecast
this is comfortable. The real ceiling is Cloudflare's **per-invocation budget** (subrequests:
50 free / 1,000 paid; CPU/wall-clock), and the canary is the `reminder_run` metric line
(`durationMs`, `planned`) the Workflow logs each run — watch those, not a headcount number.

**Trigger to act:** `durationMs` or `planned`/subrequest counts consistently within ~60–70%
of their per-invocation limits — likely driven by users-due-in-one-hour (a big timezone, or
one org signing up thousands), not total signups.

**Additive scaling path (no rewrite of what's there):**
- Split the single Workflow into a **planner** (load → filter → resolve → write the due set
  to KV, keyed `batch:{date}_{n}`, ≤1,000 rows/key) and an **executor** (drain KV batches:
  render → Resend batch w/ idempotency key → `email_log`). `email_log` already serves as the
  idempotency ledger both halves assume; the current send/log half becomes the executor and
  the gather/resolve half becomes the planner.
- If addresses become the bottleneck, the boundary-clean alternative to the read-only
  `AUTH_DB` bind is an internal `POST /internal/emails-by-ids` on this worker (service-binding
  only, chunked ≤100), mirroring how `apps/server` already reaches auth via the `AUTH` binding.

**Honest caveat:** by the time we're fighting the per-invocation subrequest/CPU budget and
sharding work across KV just to stay under Workers limits, it may be **simpler to run the
send from a long-lived container or small VM** (e.g. a scheduled job on a box with no
per-invocation caps) than to keep contorting the Workflow around them. The Workers design is
right for the forecast; past it, "move this one job off Workers" is a real option to weigh
against the planner/executor split — possibly cheaper in complexity than in dollars.
