-- Mishna app data layer (D1 binding `DB`, database `mishna-app`).
-- Separate from the better-auth `mishna-auth` DB owned by apps/login.
--
-- IF NOT EXISTS so this migration is safe to adopt on databases that were
-- provisioned from the old src/schema.sql before migrations existed.

-- One row per group. `state` is the JSON GroupState from Group.toState().
-- `exhausted` and `capacity_left` are denormalized from the state so the
-- repository can query for capacity and admin progress without parsing JSON.
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  exhausted INTEGER NOT NULL DEFAULT 0,
  capacity_left INTEGER NOT NULL,
  updated_at INTEGER
);

-- Denormalized membership, rebuilt from state.blocks[].userId on every save,
-- so loadGroupsForUser is an indexed join instead of a full-table JSON scan.
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);

-- Who has joined and their per-day commitment. Drives /api/me and rejects
-- double-joins.
CREATE TABLE IF NOT EXISTS participants (
  user_id TEXT PRIMARY KEY,
  commitment INTEGER NOT NULL,
  joined_at INTEGER NOT NULL
);
