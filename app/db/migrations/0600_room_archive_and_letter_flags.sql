-- 0600 Every room keeps its own archive; files lent out of it are recorded;
--      a letter can be confidential; a letter can carry the date the applicant
--      was promised an answer.
--
-- 1. ONE ARCHIVE PER ROOM
--
-- The drawing archive was one shelf for the whole building, filled by rooms 8
-- and 9 and readable by every room head and clerk. The building does not work
-- like that: Legal keeps Legal's folders, Accounts keeps Accounts', and the base
-- map rooms keep the drawings. So every archive record now belongs to one room.
--
-- Reading: the people of that room (and anyone the database already lets look
-- into it: a directorate head over their rooms, a delegate covering it), plus
-- the mayor and the deputy, who see every room's archive. IT sees nothing, as
-- before.
-- Writing: the same people, for the rooms they may look into. The mayor and the
-- deputy may correct any room's record.
--
-- Existing records go to the room of the archive clerk who entered them, and
-- anything entered by somebody else goes to the first archive room, which is
-- where the shared archive physically was. Nobody who could find a drawing on
-- the shelf yesterday is pointed at a different shelf today.

ALTER TABLE archive_file ADD COLUMN room_id bigint REFERENCES room(id);

UPDATE archive_file a
   SET room_id = coalesce(
         (SELECT u.room_id FROM app_user u JOIN room r ON r.id = u.room_id
           WHERE u.id = a.uploaded_by AND r.kind = 'archive'),
         (SELECT id FROM room WHERE kind = 'archive' ORDER BY sort_order, id LIMIT 1),
         (SELECT id FROM room ORDER BY sort_order, id LIMIT 1));

ALTER TABLE archive_file ALTER COLUMN room_id SET NOT NULL;
CREATE INDEX ix_archive_room ON archive_file (room_id, uploaded_at DESC) WHERE is_active;
COMMENT ON COLUMN archive_file.room_id IS 'The room whose archive this record is in (migration 0600). Decides who may read and change it.';

ALTER POLICY archive_select ON archive_file
  USING ((SELECT app_role()) <> 'sysadmin'
         AND ((SELECT app_role()) IN ('mayor', 'deputy_mayor')
              OR room_id = ANY ((SELECT app_visible_rooms())::bigint[])));

ALTER POLICY archive_insert ON archive_file
  WITH CHECK ((SELECT app_role()) <> 'sysadmin'
              AND uploaded_by = (SELECT app_user_id())
              AND ((SELECT app_role()) IN ('mayor', 'deputy_mayor')
                   OR room_id = ANY ((SELECT app_visible_rooms())::bigint[])));

-- USING decides which rows may be touched; WITH CHECK stops a record being moved
-- into a room the person cannot see.
ALTER POLICY archive_update ON archive_file
  USING ((SELECT app_role()) <> 'sysadmin'
         AND ((SELECT app_role()) IN ('mayor', 'deputy_mayor')
              OR room_id = ANY ((SELECT app_visible_rooms())::bigint[])))
  WITH CHECK ((SELECT app_role()) <> 'sysadmin'
              AND ((SELECT app_role()) IN ('mayor', 'deputy_mayor')
                   OR room_id = ANY ((SELECT app_visible_rooms())::bigint[])));


-- 2. LENDING A FILE OUT OF THE ARCHIVE
--
-- The folder leaves the shelf: somebody from another room needs it for a day, or
-- the mayor's office asks for it. On paper this is a line in a notebook, and the
-- notebook is where folders go missing. One row per time a file leaves, closed
-- when it comes back. A file can be out to one person at a time.
--
-- Rows are never deleted, and once written only the return may be filled in, so
-- the history of who had a folder cannot be rewritten afterwards.

CREATE TABLE archive_loan (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  archive_file_id  bigint NOT NULL REFERENCES archive_file(id),
  borrower_name    text NOT NULL CHECK (length(btrim(borrower_name)) BETWEEN 2 AND 120),
  borrower_room_id bigint NULL REFERENCES room(id),
  purpose          text NULL CHECK (purpose IS NULL OR length(purpose) <= 300),
  due_on           date NOT NULL,
  lent_by          bigint NOT NULL REFERENCES app_user(id),
  lent_at          timestamptz NOT NULL DEFAULT now(),
  returned_at      timestamptz NULL,
  returned_by      bigint NULL REFERENCES app_user(id),
  CONSTRAINT loan_returned_pair CHECK ((returned_at IS NULL) = (returned_by IS NULL)),
  CONSTRAINT loan_return_after_lend CHECK (returned_at IS NULL OR returned_at >= lent_at)
);
COMMENT ON TABLE archive_loan IS 'One row per time an archive file leaves its shelf (migration 0600). Never deleted; only the return is ever filled in afterwards.';

-- One open loan per file: the folder cannot be in two places at once.
CREATE UNIQUE INDEX ux_archive_loan_open ON archive_loan (archive_file_id) WHERE returned_at IS NULL;
CREATE INDEX ix_archive_loan_file ON archive_loan (archive_file_id, lent_at DESC);
CREATE INDEX ix_archive_loan_due  ON archive_loan (due_on) WHERE returned_at IS NULL;

ALTER TABLE archive_loan ENABLE ROW LEVEL SECURITY;

-- The loan follows the file: if you can see the record, you can see who has it.
-- The sub-select runs under archive_file's own policy, so this is exactly the
-- room rule above and not a second copy of it.
CREATE POLICY archive_loan_select ON archive_loan FOR SELECT
  USING ((SELECT app_role()) <> 'sysadmin'
         AND EXISTS (SELECT 1 FROM archive_file f WHERE f.id = archive_file_id));

CREATE POLICY archive_loan_insert ON archive_loan FOR INSERT
  WITH CHECK ((SELECT app_role()) <> 'sysadmin'
              AND lent_by = (SELECT app_user_id())
              AND returned_at IS NULL
              AND EXISTS (SELECT 1 FROM archive_file f WHERE f.id = archive_file_id AND f.is_active));

CREATE POLICY archive_loan_update ON archive_loan FOR UPDATE
  USING ((SELECT app_role()) <> 'sysadmin'
         AND returned_at IS NULL
         AND EXISTS (SELECT 1 FROM archive_file f WHERE f.id = archive_file_id))
  WITH CHECK (returned_by = (SELECT app_user_id()));

GRANT SELECT, INSERT ON archive_loan TO docsys_app;
-- Only the return. Nothing else on a loan can be changed once written.
GRANT UPDATE (returned_at, returned_by) ON archive_loan TO docsys_app;
GRANT SELECT ON archive_loan TO docsys_readonly, docsys_jobs;


-- 3. CONFIDENTIAL LETTERS (نهێنی)
--
-- The front desk sees every letter in the building, because it registers and
-- closes them all. For most letters that is right. For a few it is not: a
-- legal matter, or anything the mayor's office decides should stay with the
-- rooms working on it. Those may be marked confidential, and then the front
-- desk's blanket view no longer covers them.
--
-- A confidential letter is still seen by: the mayor and the deputy; the person
-- who registered it; the room that holds it now; the room it started in; and
-- every room it has actually been sent to or from.
--
-- With one exception: the front desk room. Almost every letter starts there and
-- is sent on from there, so "the room it started in" and "a room it was sent
-- from" would hand a confidential letter straight back to everyone at the front
-- desk. For a confidential letter those two do not count for the registry room.
-- The registry can still close it, because a finished letter comes back to the
-- registry room (current_room_id) before it is closed. What changes is only that
-- the rest of the front desk cannot open it while it is elsewhere.

ALTER TABLE document ADD COLUMN is_confidential boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN document.is_confidential IS 'Migration 0600. When true, the front desk''s view of every letter, and its having started or sent the letter, do not cover this one; see doc_visible_for().';

-- The rooms whose history with a letter grants sight of it: all of them for an
-- ordinary letter, all but the registry room for a confidential one.
CREATE OR REPLACE FUNCTION doc_history_rooms(p_rooms bigint[], p_confidential boolean)
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN p_confidential
              THEN array_remove(p_rooms, (SELECT id FROM room WHERE kind = 'registry' AND is_active LIMIT 1))
              ELSE p_rooms END;
$$;

CREATE OR REPLACE FUNCTION doc_is_confidential(p_document_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce((SELECT is_confidential FROM document WHERE id = p_document_id), false);
$$;

GRANT EXECUTE ON FUNCTION doc_history_rooms(bigint[], boolean) TO docsys_app, docsys_jobs, docsys_readonly;
GRANT EXECUTE ON FUNCTION doc_is_confidential(bigint) TO docsys_app, docsys_jobs, docsys_readonly;

CREATE OR REPLACE FUNCTION doc_visible_for(p_document_id bigint, p_role user_role, p_user_id bigint, p_rooms bigint[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_role IN ('mayor', 'deputy_mayor')
      OR EXISTS (SELECT 1 FROM document d WHERE d.id = p_document_id
                    AND ((p_role = 'registry_clerk' AND NOT d.is_confidential)
                         OR d.current_room_id = ANY (p_rooms)
                         OR d.incoming_registered_by = p_user_id
                         OR d.origin_room_id = ANY (doc_history_rooms(p_rooms, d.is_confidential))
                         OR EXISTS (SELECT 1 FROM routing_step s WHERE s.document_id = d.id
                                       AND s.status <> 'waiting'
                                       AND (s.to_room_id = ANY (doc_history_rooms(p_rooms, d.is_confidential))
                                            OR s.from_room_id = ANY (doc_history_rooms(p_rooms, d.is_confidential))))));
$$;

ALTER POLICY doc_select ON document
  USING ((SELECT app_role()) <> 'sysadmin'
         AND ((SELECT app_role()) IN ('mayor', 'deputy_mayor')
              OR ((SELECT app_role()) = 'registry_clerk' AND NOT is_confidential)
              OR current_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
              OR incoming_registered_by = (SELECT app_user_id())
              OR (NOT is_confidential
                  AND (origin_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
                       OR doc_routed_through(id, (SELECT app_visible_rooms())::bigint[])))
              OR (is_confidential
                  AND (origin_room_id = ANY (doc_history_rooms((SELECT app_visible_rooms())::bigint[], true))
                       OR doc_routed_through(id, doc_history_rooms((SELECT app_visible_rooms())::bigint[], true))))));

ALTER POLICY doc_update ON document
  USING ((SELECT app_role()) <> 'sysadmin'
         AND ((SELECT app_role()) IN ('mayor', 'deputy_mayor')
              OR ((SELECT app_role()) = 'registry_clerk' AND NOT is_confidential)
              OR current_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
              OR incoming_registered_by = (SELECT app_user_id())
              OR (NOT is_confidential
                  AND (origin_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
                       OR doc_routed_through(id, (SELECT app_visible_rooms())::bigint[])))
              OR (is_confidential
                  AND (origin_room_id = ANY (doc_history_rooms((SELECT app_visible_rooms())::bigint[], true))
                       OR doc_routed_through(id, doc_history_rooms((SELECT app_visible_rooms())::bigint[], true))))));

-- The hand-offs carry notes, so they follow the same rule. A hand-off that
-- touches my room is still visible without a lookup, unless the letter is
-- confidential, in which case it is visible exactly when the letter is.
ALTER POLICY step_select ON routing_step
  USING ((SELECT app_role()) <> 'sysadmin'
         AND ((status <> 'waiting'
               AND (to_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
                    OR from_room_id = ANY ((SELECT app_visible_rooms())::bigint[]))
               AND NOT doc_is_confidential(document_id))
              OR doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));

ALTER POLICY step_update ON routing_step
  USING ((SELECT app_role()) <> 'sysadmin'
         AND ((status <> 'waiting'
               AND (to_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
                    OR from_room_id = ANY ((SELECT app_visible_rooms())::bigint[]))
               AND NOT doc_is_confidential(document_id))
              OR doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));


-- 4. THE DATE THE APPLICANT WAS PROMISED AN ANSWER
--
-- The escalation ladder (0520) measures how long each room holds a letter. The
-- citizen at the counter asks a different question: when will I hear back? The
-- clerk tells them a date. That date is now written down, printed on their
-- receipt, and shown to everyone working on the letter, so the promise made at
-- the counter is visible at the desk that has to keep it.

ALTER TABLE document ADD COLUMN reply_by date NULL;
ALTER TABLE document ADD CONSTRAINT doc_reply_by_sane
  CHECK (reply_by IS NULL OR reply_by >= incoming_date);
COMMENT ON COLUMN document.reply_by IS 'Migration 0600. The date the applicant was told to expect an answer. Printed on the receipt.';
CREATE INDEX ix_doc_reply_by ON document (reply_by) WHERE reply_by IS NOT NULL AND status IN ('registered', 'in_flow', 'ready_to_close');


-- 5. WHO MAY CHANGE THOSE TWO
--
-- Every room that holds a letter may update its row (doc_update), because the
-- routing functions write through it. That is far wider than the people who may
-- decide a letter is confidential or move the date an applicant was promised.
-- The route checks the role; this checks it again underneath, for the web
-- server's own connection. Migrations, fixtures and the nightly jobs connect as
-- other roles and are not stopped.

CREATE OR REPLACE FUNCTION guard_document_flags() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user = 'docsys_app'
     AND (NEW.is_confidential IS DISTINCT FROM OLD.is_confidential
          OR NEW.reply_by IS DISTINCT FROM OLD.reply_by)
     AND coalesce(app_role()::text, '') NOT IN ('mayor', 'deputy_mayor', 'registry_clerk') THEN
    RAISE EXCEPTION 'only the front desk and the mayor''s office may change confidentiality or the reply-by date'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_document_flags_guard
  BEFORE UPDATE OF is_confidential, reply_by ON document
  FOR EACH ROW EXECUTE FUNCTION guard_document_flags();
