-- 0330 Notes on a letter that are not tied to a hop.
--
-- There were two places to write something about a letter and both belong to a
-- routing step: note, the instruction the sender attaches, and reply_note, what
-- the room writes back. Both are right, and both are locked to a hand-off.
--
-- The thing missing is the remark that belongs to the letter rather than to a
-- hop. "The applicant phoned, he is out of the country until October." "This is
-- the third copy of the same request." Nobody wants to invent a routing step to
-- say that, so today it goes on a sticky note on the folder and is lost.
--
-- Append-only, deliberately. A note is a record of what somebody knew at a time,
-- and a record that can be tidied afterwards is not one. The grants below give
-- the application INSERT and SELECT and nothing else, so there is no edit button
-- to build and no delete to argue about. This is the same reasoning as the
-- activity log, applied to something people will actually read.

CREATE TABLE document_note (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id  bigint NOT NULL REFERENCES document(id),
  room_id      bigint NULL REFERENCES room(id),        -- the room the author was in, NULL for the mayor's office
  author_id    bigint NOT NULL REFERENCES app_user(id),
  body         text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  body_search  text GENERATED ALWAYS AS (ku_normalize(body)) STORED,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE document_note IS
  'Remarks about a letter that belong to the letter rather than to one hand-off. Append-only: the application is granted INSERT and SELECT, never UPDATE or DELETE.';

CREATE INDEX ix_note_document ON document_note (document_id, created_at DESC);
CREATE INDEX ix_note_search   ON document_note USING gin (body_search gin_trgm_ops);

ALTER TABLE document_note ENABLE ROW LEVEL SECURITY;

-- Exactly the letter's own rule. If you cannot read the letter you cannot read
-- what was said about it, and that includes IT.
CREATE POLICY note_select ON document_note FOR SELECT
  USING (app_role() <> 'sysadmin' AND document_visible(document_id));

CREATE POLICY note_insert ON document_note FOR INSERT
  WITH CHECK (app_role() <> 'sysadmin' AND document_visible(document_id) AND author_id = app_user_id());

GRANT SELECT, INSERT ON document_note TO docsys_app;
GRANT SELECT ON document_note TO docsys_readonly;
GRANT SELECT ON document_note TO docsys_jobs;
