-- Switch to lot-based (chaluka) allocation: a user is now assigned `commitment`
-- random pre-set lots instead of an arbitrary gap/tail-carved block. The new
-- Group.toState() shape (blocks carry `lots`, no gap queue/tail) can't hydrate the
-- old block-shaped `groups.state` JSON, so wipe the assignment data and have
-- everyone re-join under the new model. This is a clean reset, not a data
-- migration — safe here because it's pre-beta (a couple of accounts) and the
-- cycle resets each Rosh Chodesh Sivan anyway.
--
-- The table shapes are unchanged; only their rows are cleared. Participants drop
-- so a re-join isn't rejected as a duplicate; completions drop because their
-- group_id refers to groups that no longer exist.
DELETE FROM completions;
DELETE FROM group_members;
DELETE FROM groups;
DELETE FROM participants;
