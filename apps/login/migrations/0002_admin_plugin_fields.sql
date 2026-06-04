-- Columns added by the better-auth admin plugin (enabled in src/auth.ts).
-- `role` stays NULL: admin status is granted at runtime via ADMIN_USER_IDS, not
-- the role column. Types match the regenerated src/schema.sql.
ALTER TABLE "user" ADD COLUMN "role" text;
ALTER TABLE "user" ADD COLUMN "banned" integer;
ALTER TABLE "user" ADD COLUMN "banReason" text;
ALTER TABLE "user" ADD COLUMN "banExpires" date;
ALTER TABLE "session" ADD COLUMN "impersonatedBy" text;
