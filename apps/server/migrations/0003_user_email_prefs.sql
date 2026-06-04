-- Per-user email preferences. One row per user who has visited settings; users
-- without a row fall back to the defaults below (the read endpoints synthesize
-- them, and the email worker treats a missing row as defaults). Kept in mishna-app
-- (not the better-auth mishna-auth DB) so it lives beside participants/completions
-- and the email worker can read prefs + commitment + completions from one binding.
--
--   timezone           IANA name; emails fire at 08:00 in this zone.
--   weekly_email_dow   day-of-week (0=Sun … 6=Sat) for the Hebrew weekly-quota email;
--                      also anchors the 7-day "week" the reminder refers to.
--   reminder_email_dow day-of-week for the reminder, sent only if that week's quota
--                      isn't fully marked learned.
CREATE TABLE IF NOT EXISTS user_email_prefs (
  user_id            TEXT PRIMARY KEY,
  timezone           TEXT    NOT NULL DEFAULT 'America/New_York',
  weekly_email_dow   INTEGER NOT NULL DEFAULT 0,
  reminder_email_dow INTEGER NOT NULL DEFAULT 4,
  weekly_enabled     INTEGER NOT NULL DEFAULT 1,
  reminder_enabled   INTEGER NOT NULL DEFAULT 1,
  updated_at         INTEGER NOT NULL
);
