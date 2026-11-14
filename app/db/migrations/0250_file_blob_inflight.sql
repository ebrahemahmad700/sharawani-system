-- 0250 Let the virus scanner read a file that has just been uploaded.
--
-- The SELECT policy from 0190 allows a blob only when the attachment or
-- archive_file row pointing at it is visible. That is the right rule for reading
-- a stored document, and it broke scanning without saying so.
--
-- The order of an upload is: store the bytes, scan them, and only then insert the
-- row that points at them. If a file were infected there must be no record of it
-- to leave behind. So at the moment the scanner asks for the bytes there is no
-- parent row yet, the policy finds nothing, and scanFile got back "the file is
-- missing" for every upload. It returned 'error', the screen said "not scanned",
-- and everything looked exactly like a host with no scanner installed.
--
-- Nothing would have alerted anyone. Uploads kept working, the label was honest
-- in the wrong way, and virus scanning would simply never have run.
--
-- The fix: a blob with no parent row yet is readable for a short window. That
-- window is the upload itself. It is safe because the path is a version 4 uuid
-- that only the process which just generated it knows, and it closes on its own
-- so an orphan left by a failed upload does not stay readable forever.

DROP POLICY file_blob_read ON file_blob;

CREATE POLICY file_blob_read ON file_blob FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM attachment   a WHERE a.stored_path = file_blob.stored_path)
    OR
    EXISTS (SELECT 1 FROM archive_file f WHERE f.stored_path = file_blob.stored_path)
    OR
    -- In flight: stored, not yet recorded, and recent enough to still be part of
    -- the request that created it.
    (
      created_at > now() - interval '1 hour'
      AND NOT EXISTS (SELECT 1 FROM attachment   a WHERE a.stored_path = file_blob.stored_path)
      AND NOT EXISTS (SELECT 1 FROM archive_file f WHERE f.stored_path = file_blob.stored_path)
    )
  );

COMMENT ON POLICY file_blob_read ON file_blob IS
  'A blob is readable when the row pointing at it is readable, which is what keeps IT out of the letters. A blob with no row pointing at it yet is readable for an hour, because the virus scanner has to read the bytes before the row is written.';
