-- 0190 File bytes in the database, for hosts with no durable filesystem.
--
-- The disk backend remains the default and the right answer for a municipal
-- server on its own hardware. This table exists so the same application can run
-- where the filesystem is wiped between requests, which is every serverless
-- platform. See src/lib/storage.mjs.
--
-- stored_path is the same uuid path the metadata rows carry, so switching
-- backends leaves attachment and archive_file untouched.

CREATE TABLE file_blob (
  stored_path  text PRIMARY KEY
    CHECK (stored_path ~ '^(files|archive)/\d{4}/\d{2}/[0-9a-f-]{36}\.[a-z0-9]{2,4}$'),
  bytes        bytea NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  file_blob IS 'Uploaded bytes, when FILE_STORAGE=pg. Addressed by the same uuid path as the disk backend.';
COMMENT ON COLUMN file_blob.stored_path IS 'Never derived from a user-supplied filename. The pattern check mirrors attachment.stored_path and archive_file.stored_path.';

-- Row-level security.
--
-- A blob is readable only if the row that points at it is readable. attachment
-- and archive_file already carry their own policies, so this EXISTS sees exactly
-- what the current user is allowed to see and nothing else. That is what keeps
-- IT out of the letters: IT cannot read an attachment row, so IT cannot read the
-- bytes behind it either, even though both go through the same database role.
ALTER TABLE file_blob ENABLE ROW LEVEL SECURITY;

CREATE POLICY file_blob_read ON file_blob FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM attachment   a WHERE a.stored_path = file_blob.stored_path)
    OR
    EXISTS (SELECT 1 FROM archive_file f WHERE f.stored_path = file_blob.stored_path)
  );

-- The bytes are written before the row that points at them exists, so the insert
-- cannot be checked against a parent. The uuid is the protection here: a caller
-- can only ever write a path it just generated.
CREATE POLICY file_blob_write ON file_blob FOR INSERT WITH CHECK (true);

-- Deletion happens when one file in a multi-file upload is refused and the
-- others have to be rolled back.
CREATE POLICY file_blob_delete ON file_blob FOR DELETE USING (true);

-- 0120 granted on ALL TABLES, which covered only the tables existing then.
GRANT SELECT, INSERT, DELETE ON file_blob TO docsys_app;
GRANT SELECT ON file_blob TO docsys_jobs;

-- Deliberately NOT granted to docsys_readonly. The assistant answers questions
-- about where a letter is; it has no business reading the scan of one.
