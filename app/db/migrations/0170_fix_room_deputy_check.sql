-- Fixes a real bug in the room table, caught while loading fixtures.
--
-- The constraint was:
--   CHECK (deputy_user_id IS DISTINCT FROM head_user_id)
--
-- The intent is right: a room's deputy must not be the same person as its head,
-- or the cover arrangement covers nothing. But IS DISTINCT FROM treats two nulls
-- as NOT distinct, so the check evaluates to false when both columns are null,
-- and a room with neither a head nor a deputy is rejected.
--
-- That makes a new room impossible to create. app_user.room_id points at the
-- room, so the room must exist before anyone can be assigned to it, which means
-- it must be creatable with head_user_id still null. The admin screen would have
-- failed on its first use.
--
-- It also blocks the legitimate case of a room that genuinely has no deputy. The
-- plan handles that case explicitly elsewhere: when a head goes on leave and the
-- room has no deputy, the leave is approved, a warning appears on the mayor's
-- dashboard, and the room shows as at risk. So a null deputy is expected.
--
-- The replacement allows both null and head-only, and still forbids the one
-- thing the constraint was written to forbid.

ALTER TABLE room DROP CONSTRAINT room_deputy_not_head;

ALTER TABLE room ADD CONSTRAINT room_deputy_not_head
  CHECK (deputy_user_id IS NULL OR deputy_user_id <> head_user_id);

COMMENT ON COLUMN room.deputy_user_id IS
  'Receives the room''s letters while the head is on leave. May be null: a room with no deputy is allowed, and shows as at risk on the mayor''s dashboard when its head is away. Must never be the head.';
