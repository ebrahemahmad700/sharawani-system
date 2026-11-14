-- 0260 Narrow the in-flight window to the person doing the uploading.
--
-- 0250 let anyone read a blob that had no parent row yet, for an hour, so that
-- the virus scanner could read bytes it had just stored. That was too generous
-- and the storage test said so immediately: IT could see ten of eighteen letter
-- attachments, because a blob whose parent insert never happened stayed readable
-- by everybody.
--
-- Measured before this fix: "IT sees 10 of 18".
--
-- The window now needs three things at once. The blob must have no parent row,
-- it must have been uploaded by the person asking, and it must be minutes old.
-- That is exactly the shape of a real upload and nothing else, so a failed
-- upload's leftovers are readable by one person for five minutes rather than by
-- the whole building for an hour.

ALTER TABLE file_blob ADD COLUMN uploaded_by bigint NULL REFERENCES app_user(id);

COMMENT ON COLUMN file_blob.uploaded_by IS
  'Who stored these bytes. Used only by the in-flight read window, so the virus scanner can read a file before the attachment row pointing at it exists.';

DROP POLICY file_blob_read ON file_blob;

CREATE POLICY file_blob_read ON file_blob FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM attachment   a WHERE a.stored_path = file_blob.stored_path)
    OR
    EXISTS (SELECT 1 FROM archive_file f WHERE f.stored_path = file_blob.stored_path)
    OR
    (
      uploaded_by IS NOT NULL
      AND uploaded_by = app_user_id()
      AND created_at > now() - interval '5 minutes'
      AND NOT EXISTS (SELECT 1 FROM attachment   a WHERE a.stored_path = file_blob.stored_path)
      AND NOT EXISTS (SELECT 1 FROM archive_file f WHERE f.stored_path = file_blob.stored_path)
    )
  );

COMMENT ON POLICY file_blob_read ON file_blob IS
  'A blob is readable when the row pointing at it is readable, which is what keeps IT out of the letters. A blob with no such row is readable only by whoever just uploaded it, only for five minutes, so the virus scanner can see the bytes before the row is written.';
