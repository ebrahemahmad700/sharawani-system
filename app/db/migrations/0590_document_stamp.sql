-- 0590 The arrival and dispatch marks on the scan (مۆری هاتوو · مۆری دەرچوو).
--
-- On paper the front desk takes a rubber stamp to the letter the moment it comes
-- in: a small box in a corner saying هاتوو and the number it was just given. When
-- the answer leaves, the same thing happens again with دەرچوو and the outgoing
-- number. Anyone holding the paper can then read, off the paper itself, which
-- letter of which year they are holding.
--
-- The scan now carries the same mark. The clerk opens the scan, drags the mark to
-- the corner they want, and presses the button; the mark is drawn onto that page
-- and kept as a new file on the letter. The scan that arrived is never altered —
-- a stamped copy is added beside it, exactly as the handwritten instruction works
-- (migration 0550).
--
-- This table is the record of the act and the index to the file it produced. The
-- comparison screen reads it to decide which two scans to put side by side: a
-- stamped scan is the one a person means by "what came in" and "what went out".
--
-- WHO. Everybody who may attach a file to a letter they can see. The dispatch
-- mark additionally needs the letter to have an outgoing number, because the mark
-- carries that number: there is nothing to stamp before the answer has one. That
-- rule lives in the route, where the number can be read.

CREATE TABLE document_stamp (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id           bigint NOT NULL REFERENCES document(id),
  attachment_id         bigint NOT NULL UNIQUE REFERENCES attachment(id),  -- the stamped copy
  source_attachment_id  bigint NOT NULL REFERENCES attachment(id),         -- the scan it was stamped from
  kind                  text NOT NULL CHECK (kind IN ('incoming', 'outgoing')),
  page_no               int NOT NULL DEFAULT 1 CHECK (page_no BETWEEN 1 AND 500),
  -- What the mark says, kept so the record can be read without opening the PDF.
  -- A number already on the document row; no new fact about anybody is stored here.
  code                  text NOT NULL CHECK (length(code) BETWEEN 1 AND 60),
  placed_by             bigint NOT NULL REFERENCES app_user(id),
  placed_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE document_stamp IS
  'One arrival or dispatch mark drawn onto a scan. Append-only: stamping again makes another row and another file, and the scan underneath is never touched.';
COMMENT ON COLUMN document_stamp.code IS
  'The number printed in the mark: the incoming number for an arrival, the outgoing number for a dispatch.';

CREATE INDEX ix_document_stamp_document ON document_stamp (document_id, kind, placed_at DESC);

ALTER TABLE document_stamp ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_stamp_select ON document_stamp FOR SELECT
  USING ((SELECT app_role()) <> 'sysadmin'
         AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[]));

CREATE POLICY document_stamp_insert ON document_stamp FOR INSERT
  WITH CHECK ((SELECT app_role()) IN ('mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                                      'room_clerk', 'registry_clerk', 'archive_clerk')
              AND placed_by = (SELECT app_user_id())
              AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[]));

GRANT SELECT, INSERT ON document_stamp TO docsys_app;
GRANT SELECT ON document_stamp TO docsys_readonly, docsys_jobs;
