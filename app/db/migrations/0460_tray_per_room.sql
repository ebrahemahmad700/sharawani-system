-- 0460 The scan tray belongs to a room, not to the building.
--
-- Reported from the demo: opening the scan tray in room 9 showed a document that
-- had been scanned in another room. That is not a display glitch, it is a letter
-- being shown to a room that never received it, which in this building is the
-- one thing the system exists to prevent.
--
-- How it happened. The tray was designed around one scanner at the registry, and
-- "anyone who handles paper" could see it. Once every room could add scans from
-- a phone or a feeder, one shared list became a noticeboard: every room's scans in
-- front of every other room, each one a click away from being previewed.
--
-- There was a second, quieter hole behind the first. Claiming a scan onto a letter
-- leaves the tray row in place with status 'claimed', and the blob policy in 0380
-- let any paper-handling role read bytes that a tray row pointed at, whatever its
-- status. So a scan filed onto a confidential letter stayed readable through its
-- old tray address by every room in the building, long after the letter's own
-- rules should have taken over.
--
-- WHAT THIS DOES
--
--   room_id, uploaded_by   who put it there, and for which room. Existing rows are
--                          filled from the activity log, which recorded both.
--
--   row-level security     a tray item is seen by its own room, by whoever can look
--                          into that room (the mayor, the deputy, a directorate
--                          head, a delegate), and by the person who added it. An
--                          item with no room came from the building scanner's
--                          watched folder, and that is the registry's.
--
--   the blob policy        a tray row opens its bytes only while it is still
--                          waiting. Once claimed, the attachment's rules decide,
--                          which is what "claimed onto a letter" should have meant.

ALTER TABLE scan_tray_item ADD COLUMN room_id     bigint NULL REFERENCES room(id);
ALTER TABLE scan_tray_item ADD COLUMN uploaded_by bigint NULL REFERENCES app_user(id);

COMMENT ON COLUMN scan_tray_item.room_id IS
  'The room whose tray this is. NULL only for scans picked up from the building scanner folder, which belong to the registry.';

-- Backfill from the log. tray.detected has carried the tray id, the user and the
-- room since the tray was written, so no guessing is involved.
UPDATE scan_tray_item t
   SET room_id = l.room_id, uploaded_by = l.user_id
  FROM activity_log l
 WHERE l.action = 'tray.detected'
   AND l.detail ? 'tray_id'
   AND (l.detail ->> 'tray_id') ~ '^\d+$'
   AND (l.detail ->> 'tray_id')::bigint = t.id
   AND t.room_id IS NULL;

CREATE INDEX ix_tray_room_new ON scan_tray_item (room_id, detected_at DESC) WHERE status = 'new';

-- Whether the acting user may see a tray item for this room.
CREATE OR REPLACE FUNCTION tray_room_visible(p_room_id bigint, p_uploaded_by bigint)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT app_role() IN ('registry_clerk', 'room_clerk', 'room_head', 'archive_clerk',
                        'mayor', 'deputy_mayor', 'directorate_head')
     AND (
           (p_room_id IS NOT NULL AND p_room_id = ANY (app_visible_rooms()))
        OR (p_room_id IS NULL AND app_role() IN ('registry_clerk', 'mayor', 'deputy_mayor'))
        OR (p_uploaded_by IS NOT NULL AND p_uploaded_by = app_user_id())
     );
$$;

COMMENT ON FUNCTION tray_room_visible(bigint, bigint) IS
  'The scan tray rule: your room''s tray, the rooms you can look into, and what you added yourself. IT never.';

GRANT EXECUTE ON FUNCTION tray_room_visible(bigint, bigint) TO docsys_app, docsys_jobs, docsys_readonly;

ALTER TABLE scan_tray_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY tray_select ON scan_tray_item FOR SELECT
  USING (tray_room_visible(room_id, uploaded_by) OR claimed_by = app_user_id());

-- Added as yourself, into your own room's tray.
CREATE POLICY tray_insert ON scan_tray_item FOR INSERT
  WITH CHECK (
    app_role() IN ('registry_clerk', 'room_clerk', 'room_head', 'archive_clerk',
                   'mayor', 'deputy_mayor', 'directorate_head')
    AND uploaded_by = app_user_id()
    AND (room_id IS NOT DISTINCT FROM app_room_id())
  );

CREATE POLICY tray_update ON scan_tray_item FOR UPDATE
  USING (tray_room_visible(room_id, uploaded_by));

-- The blob policy, with the tray branch narrowed to waiting items. The table's
-- own policy now does the room check, because this function is not a security
-- definer and reads scan_tray_item as the caller.
CREATE OR REPLACE FUNCTION blob_pointer_visible(p_stored_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM attachment a WHERE a.stored_path = p_stored_path)
      OR EXISTS (SELECT 1 FROM archive_file f WHERE f.stored_path = p_stored_path)
      OR EXISTS (SELECT 1 FROM scan_tray_item t
                  WHERE t.tray_path = p_stored_path AND t.status = 'new')
      OR EXISTS (SELECT 1 FROM company_file c WHERE c.stored_path = p_stored_path);
$$;
