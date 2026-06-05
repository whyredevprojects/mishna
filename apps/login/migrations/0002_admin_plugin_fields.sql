-- Columns added by the better-auth admin plugin (enabled in src/auth.ts).
-- `role` is written to 'admin' by the plugin's set-role endpoint (the "Make admin"
-- button), and customSession treats role='admin' as isAdmin — alongside the
-- ADMIN_USER_IDS bootstrap list. Types match the regenerated src/schema.sql.
ALTER TABLE "user" ADD COLUMN "role" text;
ALTER TABLE "user" ADD COLUMN "banned" integer;
ALTER TABLE "user" ADD COLUMN "banReason" text;
ALTER TABLE "user" ADD COLUMN "banExpires" date;
ALTER TABLE "session" ADD COLUMN "impersonatedBy" text;
