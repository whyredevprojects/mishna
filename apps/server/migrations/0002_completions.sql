-- One row = a user marked a mishna learned, within a specific group. `group_id`
-- is resolved server-side from the user's block when the assignment is read, so
-- per-group rollups are a plain GROUP BY (no join, exact under overflow). Because
-- groups are recreated each cycle, it also scopes a row to its cycle: the same
-- ref re-learned next cycle lands under a new group_id instead of colliding.
-- `completed_at` is epoch ms, carried for a FUTURE offline last-write-wins sync.
--
-- IF NOT EXISTS so adopting migrations is safe on databases where this table was
-- already created by hand from the old src/schema.sql.
CREATE TABLE IF NOT EXISTS completions (
  user_id  TEXT    NOT NULL,
  group_id TEXT    NOT NULL,
  mesechta TEXT    NOT NULL,
  perek    INTEGER NOT NULL,
  mishna   INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id, mesechta, perek, mishna)
);

CREATE INDEX IF NOT EXISTS idx_completions_group ON completions (group_id);
