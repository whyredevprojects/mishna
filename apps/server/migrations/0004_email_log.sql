-- One row per email actually sent, keyed by (user, kind, week). The email worker
-- writes a row after a successful send and consults it before queueing, so each
-- user gets at most one of each kind per week even though the cron fires hourly.
-- `week_start` is the user-local YYYY-MM-DD anchor of the week (the most recent
-- weekly_email_dow on/before the send day), so weekly and reminder rows for the
-- same week share it. Admin "send now" bypasses this guard.
CREATE TABLE IF NOT EXISTS email_log (
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,   -- 'weekly' | 'reminder'
  week_start TEXT NOT NULL,   -- YYYY-MM-DD, user-local
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, week_start)
);
