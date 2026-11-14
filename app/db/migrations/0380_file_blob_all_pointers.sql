-- 0380 The blob policy named two of the four things that point at bytes.
--
-- When file bytes live in the database (FILE_STORAGE=pg), file_blob decides who
-- may read them by asking "can you see the row that points at this". 0190 wrote
-- that rule when there were two kinds of pointer, an attachment and a drawing,
-- and it has been asking about exactly those two ever since.
--
-- There are now four. A scan waiting in the tray has not been claimed onto a
-- letter yet, so no attachment row points at it. A company's licence belongs to
-- the company and not to any letter, so nothing in either named table points at
-- it either.
--
-- The failure is quiet and delayed, which is the worst combination. 0250 and
-- 0260 added a five minute window so an upload can be virus-scanned before the
-- row that owns it exists, and that window is why nobody noticed: a tray scan
-- previews perfectly for five minutes and then becomes a 404, and a company
-- licence uploaded in the morning cannot be opened in the afternoon. Both look
-- like the file is missing rather than like a permission rule.
--
-- The tests did not catch it because the blob backend is only exercised by
-- test/storage.test.mjs, which walks letter attachments, and the tray and
-- company screens are tested on the disk backend where the policy plays no part.
--
-- The fix is to name the other two pointers. Each keeps its own visibility rule,
-- because they are not the same question: the tray is for people who handle
-- paper, and a company file follows the company register.

CREATE OR REPLACE FUNCTION blob_pointer_visible(p_stored_path text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  -- A letter attachment: the letter's own rule decides, through attachment's policy.
  SELECT EXISTS (SELECT 1 FROM attachment a WHERE a.stored_path = p_stored_path)
      -- A drawing in the archive: archive_file's policy decides.
      OR EXISTS (SELECT 1 FROM archive_file f WHERE f.stored_path = p_stored_path)
      -- A scan still in the tray, belonging to no letter yet. Row-level security
      -- is not enabled on scan_tray_item, so the role check is made here and
      -- matches the route's own list. IT is not on it: an unclaimed scan is
      -- still a letter, it just does not know which one yet.
      OR (EXISTS (SELECT 1 FROM scan_tray_item t WHERE t.tray_path = p_stored_path)
          AND app_role() IN ('registry_clerk', 'room_clerk', 'room_head', 'archive_clerk',
                             'mayor', 'deputy_mayor', 'directorate_head'))
      -- A company's own file. company_file has its own policy, so seeing the row
      -- is the whole test.
      OR EXISTS (SELECT 1 FROM company_file c WHERE c.stored_path = p_stored_path);
$$;

COMMENT ON FUNCTION blob_pointer_visible(text) IS
  'Whether the acting user can see any row that points at these bytes. Every kind of pointer must be listed here, or its files become unreadable five minutes after upload.';

-- Deliberately separate from blob_pointer_visible: the in-flight test asks
-- whether anything owns the bytes at all, not whether the caller may see the
-- owner. Folding the two together would reopen the window for a file that exists
-- but is hidden from this particular reader.
CREATE OR REPLACE FUNCTION blob_pointer_visible_to_anyone(p_stored_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM attachment a      WHERE a.stored_path = p_stored_path)
      OR EXISTS (SELECT 1 FROM archive_file f    WHERE f.stored_path = p_stored_path)
      OR EXISTS (SELECT 1 FROM scan_tray_item t  WHERE t.tray_path   = p_stored_path)
      OR EXISTS (SELECT 1 FROM company_file c    WHERE c.stored_path = p_stored_path);
$$;

COMMENT ON FUNCTION blob_pointer_visible_to_anyone(text) IS
  'Whether anything at all owns these bytes yet. Runs as the owner, because during the in-flight window the caller cannot see the tables it asks about.';

REVOKE ALL ON FUNCTION blob_pointer_visible_to_anyone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION blob_pointer_visible_to_anyone(text) TO docsys_app, docsys_jobs, docsys_readonly;
GRANT EXECUTE ON FUNCTION blob_pointer_visible(text) TO docsys_app, docsys_jobs, docsys_readonly;

DROP POLICY IF EXISTS file_blob_read ON file_blob;

CREATE POLICY file_blob_read ON file_blob FOR SELECT
  USING (
    blob_pointer_visible(stored_path)
    -- The in-flight window from 0250 and 0260, unchanged: between storing the
    -- bytes and writing the row that owns them, the uploader alone can read
    -- them, for five minutes, and only while nothing owns them yet. This is what
    -- lets the virus scanner see a file it is about to reject.
    OR (uploaded_by IS NOT NULL
        AND uploaded_by = app_user_id()
        AND created_at > now() - interval '5 minutes'
        AND NOT blob_pointer_visible_to_anyone(stored_path))
  );
