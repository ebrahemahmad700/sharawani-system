-- 0450 Every room can start a letter.
--
-- Reported from the demo: the legal room and the contracts room could not open a
-- new letter. The form opened, and pressing save produced the generic error page,
-- because the insert policy written in 0120 named three roles only: the mayor,
-- his deputy and the registry. Everything the legal room writes itself, a memo to
-- the mayor, a contract to be signed, an opinion that has to go to three rooms,
-- had no way into the system at all.
--
-- WHAT DOES NOT CHANGE
--
-- The number. It still comes from the one counter, inside the same transaction
-- that writes the row, so a letter started in the legal room takes the next
-- number in the same register as a letter handed in at the counter. No second
-- sequence, no gaps, no reuse. The rule that matters to the auditor is untouched;
-- only the list of hands that may press the button has grown.
--
-- WHAT DOES
--
--   origin_room_id   the room the letter was started in. Set by the application
--                    from the person's own room, and checked here: nobody can
--                    start a letter on behalf of a room they are not in.
--
--   who may insert   anyone with a working role, IT excepted as always, provided
--                    they are writing it as themselves and from their own room.
--
--   who may see it   the room it was started in, as well as everyone who could
--                    already. Without this a clerk who started a letter could see
--                    it and the head of the same room could not, which is not how
--                    a room works.
--
-- Existing letters are not backfilled. Their visibility is exactly what it was
-- yesterday, and nobody gains sight of an old letter from this migration.

ALTER TABLE document ADD COLUMN origin_room_id bigint NULL REFERENCES room(id);

COMMENT ON COLUMN document.origin_room_id IS
  'The room the letter was started in. NULL for letters registered before migration 0450. Grants that room sight of the letter.';

CREATE INDEX ix_doc_origin_room ON document (origin_room_id, status) WHERE origin_room_id IS NOT NULL;

-- Visibility, with the origin room added. Everything else is as 0110 wrote it.
CREATE OR REPLACE FUNCTION document_visible(p_document_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk')
      OR EXISTS (SELECT 1 FROM document d WHERE d.id = p_document_id
                    AND (d.current_room_id = ANY (app_visible_rooms())
                         OR d.incoming_registered_by = app_user_id()
                         OR d.origin_room_id = ANY (app_visible_rooms())))
      OR EXISTS (SELECT 1 FROM routing_step s WHERE s.document_id = p_document_id
                    AND (s.to_room_id = ANY (app_visible_rooms()) OR s.from_room_id = ANY (app_visible_rooms())));
$$;

DROP POLICY IF EXISTS doc_insert ON document;
CREATE POLICY doc_insert ON document FOR INSERT WITH CHECK (
  app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk')
  OR (app_role() IN ('directorate_head', 'room_head', 'room_clerk', 'archive_clerk', 'hr')
      AND incoming_registered_by = app_user_id()
      AND origin_room_id IS NOT NULL
      AND origin_room_id = app_room_id())
);

-- The select policy reads the new row's own columns as well as asking the
-- function. INSERT ... RETURNING is checked against this policy, and the
-- function looks the letter up by id with the statement's snapshot, in which the
-- row being inserted does not exist yet. For the three roles that could always
-- register, the role alone answers; for a room it is the columns that do.
DROP POLICY IF EXISTS doc_select ON document;
CREATE POLICY doc_select ON document FOR SELECT USING (
  app_role() <> 'sysadmin'
  AND (document_visible(id)
       OR incoming_registered_by = app_user_id()
       OR origin_room_id = ANY (app_visible_rooms()))
);
