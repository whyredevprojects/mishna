-- One-click unsubscribe (RFC 8058) audit columns on the existing prefs row.
-- The unsubscribe itself flips the SAME weekly_enabled / reminder_enabled columns
-- both settings screens edit and selectDue honors, so there is deliberately no
-- parallel opt-out flag to keep in sync. These two columns only record when and how
-- it happened.
--
--   unsubscribed_at   epoch ms of the last unsubscribe, NULL if never *or* if the
--                     user has since re-subscribed (both flags back on clears both
--                     columns, so a live row never reads "unsubscribed" while the
--                     emails are on)
--   unsubscribed_via  'one-click' | 'link' | 'settings' | 'admin' — the channel it
--                     came through: the RFC 8058 POST, the confirm page's form, the
--                     user's own Settings save, or an admin toggling it for them
ALTER TABLE user_email_prefs ADD COLUMN unsubscribed_at INTEGER;
ALTER TABLE user_email_prefs ADD COLUMN unsubscribed_via TEXT;
