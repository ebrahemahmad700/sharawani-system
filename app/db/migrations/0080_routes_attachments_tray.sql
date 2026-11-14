-- 2.7 Saved routes, attachments, tray
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

CREATE TABLE route_template (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL UNIQUE,                 -- ڕێڕەوی مۆڵەتی بیناسازی
  description   text NULL,
  return_to_assigner boolean NOT NULL DEFAULT false,
  created_by    bigint NOT NULL REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  is_active     boolean NOT NULL DEFAULT true
);
CREATE TABLE route_template_step (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_template_id bigint NOT NULL REFERENCES route_template(id) ON DELETE CASCADE,
  seq_no            int NOT NULL CHECK (seq_no >= 1),
  room_id           bigint NOT NULL REFERENCES room(id),
  due_days          int NOT NULL CHECK (due_days BETWEEN 1 AND 60),
  UNIQUE (route_template_id, seq_no)
);
COMMENT ON TABLE route_template IS 'PLAN.md §4.4. Templates are copied into routing_step rows at send time; later edits to a template never touch letters already in flight.';

CREATE TABLE attachment (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id     bigint NOT NULL REFERENCES document(id),
  routing_step_id bigint NULL REFERENCES routing_step(id),     -- which hop produced it
  kind            attachment_kind NOT NULL,
  original_name   text NOT NULL,                                -- for display only; never used to build a path
  stored_path     text NOT NULL UNIQUE CHECK (stored_path ~ '^files/\d{4}/\d{2}/[0-9a-f-]{36}\.[a-z0-9]{2,4}$'),
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),   -- 50 MB cap (design screen 3)
  page_count      int NULL,
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  virus_scanned_at timestamptz NULL,
  uploaded_by     bigint NOT NULL REFERENCES app_user(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  is_outgoing     boolean NOT NULL DEFAULT false                -- ticked on the outgoing form: "هاوپێچەکانی دەرچوو"
);
CREATE INDEX ix_attachment_document ON attachment (document_id, uploaded_at);
CREATE INDEX ix_attachment_sha      ON attachment (sha256);
COMMENT ON COLUMN attachment.stored_path IS 'Relative to the files root (§12.2). The pattern check makes it impossible to store a path derived from a user filename (PLAN.md §8).';

CREATE TABLE scan_tray_item (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scanner_code  text NOT NULL,                                  -- 'FLOOR1', 'FLOOR2', 'ARCHIVE_A0'
  tray_path     text NOT NULL UNIQUE,                           -- scan-tray/FLOOR1/2026-09-09/scan-4521.pdf
  original_name text NOT NULL,
  size_bytes    bigint NOT NULL,
  sha256        text NOT NULL,
  detected_at   timestamptz NOT NULL DEFAULT now(),
  status        tray_status NOT NULL DEFAULT 'new',
  claimed_by    bigint NULL REFERENCES app_user(id),
  claimed_at    timestamptz NULL,
  attachment_id bigint NULL REFERENCES attachment(id),
  archive_file_id bigint NULL,                                  -- FK added after archive_file exists
  archived_at   timestamptz NULL
);
CREATE INDEX ix_tray_new ON scan_tray_item (scanner_code, detected_at DESC) WHERE status = 'new';
COMMENT ON TABLE scan_tray_item IS 'PLAN.md §7.4. One row per file the watcher finds in a scanner''s SMB folder. Claiming moves the file into files/ and creates an attachment or archive_file. Items older than 7 days are archived, never deleted.';
