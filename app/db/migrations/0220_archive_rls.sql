-- 0220 Row-level security on the drawing archive.
--
-- Letters have been protected at two levels since the beginning: the route
-- refuses the wrong role, and the database refuses again underneath. The archive
-- had only the first. Every role the route allows could read every drawing, and
-- so could every role it does not, had anything ever queried the table directly.
--
-- That gap mattered more once the file bytes moved into the database, because
-- file_blob's own policy is written in terms of "can you see the row that points
-- at this", and for a drawing that question had no real answer.
--
-- The rule matches ARCHIVE_ROLES in src/routes/archive.mjs, which is the rule the
-- building already works to. Writing is narrower still, matching EDIT_ROLES: an
-- archive clerk catalogues drawings, and the mayor and deputy may correct them.
-- IT is excluded from both, the same as it is excluded from letters.

ALTER TABLE archive_file ENABLE ROW LEVEL SECURITY;

CREATE POLICY archive_select ON archive_file FOR SELECT
  USING (app_role() IN ('mayor', 'deputy_mayor', 'directorate_head',
                        'room_head', 'room_clerk', 'archive_clerk'));

CREATE POLICY archive_insert ON archive_file FOR INSERT
  WITH CHECK (app_role() IN ('archive_clerk', 'mayor', 'deputy_mayor'));

CREATE POLICY archive_update ON archive_file FOR UPDATE
  USING (app_role() IN ('archive_clerk', 'mayor', 'deputy_mayor'));

-- The join table between a letter and a drawing follows the letter's rule, not
-- the drawing's: if you cannot see the letter you have no business knowing which
-- plot it concerns.
ALTER TABLE document_archive_file ENABLE ROW LEVEL SECURITY;

CREATE POLICY daf_select ON document_archive_file FOR SELECT
  USING (app_role() <> 'sysadmin' AND document_visible(document_id));

CREATE POLICY daf_insert ON document_archive_file FOR INSERT
  WITH CHECK (app_role() <> 'sysadmin' AND document_visible(document_id));

CREATE POLICY daf_delete ON document_archive_file FOR DELETE
  USING (app_role() <> 'sysadmin' AND document_visible(document_id));

-- The jobs role bypasses all of this, which is how the nightly checks still see
-- every row. The digitisation batch table is deliberately left open: it records
-- how many drawings were scanned on a given day and by whom, which is workload
-- information, not the content of anything.
