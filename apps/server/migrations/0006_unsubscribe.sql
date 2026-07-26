-- One-click unsubscribe (RFC 8058) audit columns on the existing prefs row.
-- The unsubscribe itself flips the SAME weekly_enabled / reminder_enabled columns
-- both settings screens edit and selectDue honors, so there is deliberately no
-- parallel opt-out flag to keep in sync. These two columns only record when and how
-- it happened.
--
--   unsubscribed_at   epoch ms of the last unsubscribe, NULL if never
--   unsubscribed_via  'one-click' | 'link' | 'settings'
ALTER TABLE user_email_prefs ADD COLUMN unsubscribed_at INTEGER;
ALTER TABLE user_email_prefs ADD COLUMN unsubscribed_via TEXT;
