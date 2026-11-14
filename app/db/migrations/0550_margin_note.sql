-- 0550 The handwritten instruction on the letter (هامش).
--
-- On paper, the mayor takes a pen to the letter itself: «بۆ یاسا، بە پەلە», a
-- signature, the date. That is the instruction, and the paper carries it from
-- room to room. The system asked for the same thing as a dropdown and a text box,
-- which is not how anybody in the building gives an instruction.
--
-- Now the pen goes on the letter again, on a tablet or a phone. The ink is laid
-- onto the page of the scan and kept as a new PDF on the letter (attachment kind
-- margin_note), with a stamp saying who wrote it and when, and the letter is sent
-- to the rooms the writer named.
--
-- This table is the record of that act: which scan and which page, which file
-- came out, the rooms, and who. The attachment is the evidence; this is the
-- index to it. Rows are never changed or removed: a new instruction is a new row.
--
-- WHO. The mayor, the deputy, a directorate head and a room head: the people who
-- write هامش on paper today. The route also requires that they may send the
-- letter (lib/routing.mjs maySend), so a head cannot annotate a letter that is
-- sitting in another room.

CREATE TABLE margin_note (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id           bigint NOT NULL REFERENCES document(id),
  attachment_id         bigint NOT NULL UNIQUE REFERENCES attachment(id),   -- the page with the ink on it
  source_attachment_id  bigint NULL REFERENCES attachment(id),              -- the scan it was written on; NULL for a blank sheet
  page_no               int NOT NULL DEFAULT 1 CHECK (page_no BETWEEN 1 AND 500),
  instruction           text NULL CHECK (instruction IS NULL OR length(instruction) <= 300),
  room_ids              bigint[] NOT NULL CHECK (cardinality(room_ids) BETWEEN 1 AND 4),
  author_id             bigint NOT NULL REFERENCES app_user(id),
  author_role           user_role NOT NULL CHECK (author_role IN ('mayor', 'deputy_mayor', 'directorate_head', 'room_head')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE margin_note IS
  'A handwritten instruction laid onto a letter page, and where it sent the letter. Append-only; the stamped PDF is attachment_id.';

CREATE INDEX ix_margin_note_document ON margin_note (document_id, created_at);

ALTER TABLE margin_note ENABLE ROW LEVEL SECURITY;

CREATE POLICY margin_note_select ON margin_note FOR SELECT
  USING ((SELECT app_role()) <> 'sysadmin'
         AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[]));

CREATE POLICY margin_note_insert ON margin_note FOR INSERT
  WITH CHECK ((SELECT app_role()) IN ('mayor', 'deputy_mayor', 'directorate_head', 'room_head')
              AND author_id = (SELECT app_user_id())
              AND author_role = (SELECT app_role())
              AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[]));

GRANT SELECT, INSERT ON margin_note TO docsys_app;
GRANT SELECT ON margin_note TO docsys_readonly, docsys_jobs;
