-- 0420 What the scan actually says.
--
-- Until now a scan was a file with a name. You could find it if somebody had
-- typed the right words into the subject field, and otherwise you opened folders
-- one at a time until you found it. Most of what this municipality holds is
-- inside images, and none of it was searchable.
--
-- This table holds the text read out of each attachment by tesseract, running on
-- the municipality's own machine. See lib/ocr.mjs for why it is never sent
-- anywhere to be read.
--
-- Three things worth knowing about the shape.
--
-- 1. It is a separate table rather than columns on attachment, because reading a
--    scan is slow and fallible and must not make the attachment row wait for it.
--    An attachment exists the moment it is uploaded; its text arrives later, or
--    never, and nothing depends on it.
--
-- 2. Its row-level security is exactly the attachment's. If you cannot see the
--    scan you cannot search what is written in it, which matters more here than
--    anywhere: search results are how somebody learns that a document exists.
--
-- 3. The confidence is stored and shown. Typed Kurdish and Arabic read well;
--    handwriting does not. A system that presented a confident-looking search
--    result built on a fifteen percent reading would be worse than one that
--    never read anything, so the screen says which it is.

CREATE TABLE attachment_text (
  attachment_id bigint PRIMARY KEY REFERENCES attachment(id) ON DELETE CASCADE,

  -- 'done'        text was read
  -- 'empty'       it read cleanly and found nothing, which is a photograph or a
  --               drawing with no writing on it
  -- 'low'         it read something, but with too little confidence to show as
  --               fact. Still searchable, and labelled.
  -- 'unsupported' not a kind of file that can be read at all
  -- 'failed'      the reader errored or ran out of time
  status        text NOT NULL CHECK (status IN ('done', 'empty', 'low', 'unsupported', 'failed')),

  text          text NULL,
  -- Same normalisation as every other searchable column in this schema, so that
  -- ي and ی, ك and ک, and Arabic-Indic and Latin digits all match each other.
  text_search   text GENERATED ALWAYS AS (ku_normalize(text)) STORED,

  pages         integer NOT NULL DEFAULT 0,
  chars         integer NOT NULL DEFAULT 0,
  -- Mean word confidence from the reader, 0 to 100. NULL when nothing was read.
  confidence    numeric(5,2) NULL,
  engine        text NULL,                       -- e.g. 'tesseract 5.3.0 ara+eng'
  ms            integer NULL,
  read_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE attachment_text IS
  'Text read out of a scan on this server. Visible to exactly the people who may see the scan itself.';

CREATE INDEX ix_attachment_text_search ON attachment_text USING gin (text_search gin_trgm_ops);

ALTER TABLE attachment_text ENABLE ROW LEVEL SECURITY;

-- The attachment's own rule, reached through the attachment. Spelling it as an
-- EXISTS against attachment rather than copying attachment's policy means the
-- two cannot drift apart: if the letter's visibility rule changes, this changes
-- with it.
CREATE POLICY attachment_text_select ON attachment_text FOR SELECT
  USING (EXISTS (SELECT 1 FROM attachment a WHERE a.id = attachment_id));

GRANT SELECT ON attachment_text TO docsys_app;
GRANT SELECT ON attachment_text TO docsys_readonly;
-- The reader itself. The jobs role bypasses row-level security, which is what
-- lets it read every scan in the building; it is also the role that can write
-- here and the only one.
GRANT SELECT, INSERT, UPDATE, DELETE ON attachment_text TO docsys_jobs;

-- --------------------------------------------------------------------------
-- Finding the work
-- --------------------------------------------------------------------------
--
-- Attachments that have never been looked at, oldest first. A view rather than a
-- query inside the job, so that the definition of "not yet read" is in one place
-- and the job stays about running the reader.

-- --------------------------------------------------------------------------
-- Reading one now
-- --------------------------------------------------------------------------
--
-- The reader normally runs as a job, on the jobs role, which may write here.
-- But a clerk at a counter who has just scanned something wants it searchable
-- now rather than in two minutes, so the application can ask for one scan to be
-- read immediately.
--
-- Through a function rather than by granting the application INSERT on the
-- table. The grant would let any bug in any route write text against any
-- attachment id; the function writes only for an attachment the caller can
-- already see, which is the same rule that governs the scan itself.

CREATE OR REPLACE FUNCTION store_attachment_text(
  p_attachment_id bigint,
  p_status        text,
  p_text          text,
  p_pages         integer,
  p_chars         integer,
  p_confidence    numeric,
  p_engine        text,
  p_ms            integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- The visibility check, done as the caller rather than as the owner. Inside a
  -- SECURITY DEFINER function the policies do not apply, so this asks the
  -- question explicitly instead of relying on a SELECT that would always succeed.
  IF NOT EXISTS (
    SELECT 1 FROM attachment a
     WHERE a.id = p_attachment_id AND document_visible(a.document_id)
  ) THEN
    RETURN;
  END IF;

  INSERT INTO attachment_text
    (attachment_id, status, text, pages, chars, confidence, engine, ms)
  VALUES
    (p_attachment_id, p_status, p_text, coalesce(p_pages, 0), coalesce(p_chars, 0),
     p_confidence, p_engine, p_ms)
  ON CONFLICT (attachment_id) DO UPDATE
    SET status = excluded.status, text = excluded.text, pages = excluded.pages,
        chars = excluded.chars, confidence = excluded.confidence,
        engine = excluded.engine, ms = excluded.ms, read_at = now();
END;
$fn$;

GRANT EXECUTE ON FUNCTION store_attachment_text(bigint, text, text, integer, integer, numeric, text, integer)
  TO docsys_app;

CREATE OR REPLACE VIEW attachment_unread AS
  SELECT a.id, a.document_id, a.stored_path, a.mime_type, a.size_bytes, a.uploaded_at
    FROM attachment a
    LEFT JOIN attachment_text t ON t.attachment_id = a.id
   WHERE t.attachment_id IS NULL
   ORDER BY a.uploaded_at;

GRANT SELECT ON attachment_unread TO docsys_jobs;
