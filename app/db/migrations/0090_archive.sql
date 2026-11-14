-- 2.8 The drawing archive
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

CREATE TABLE archive_file (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title           text NOT NULL CHECK (length(title) BETWEEN 3 AND 300),   -- پارچە ٢٤٧/٥ — نەخشەی ڕێکخستنی زەوی
  plot_no         text NULL,                                   -- as typed: '247/5', '٢٤٧/٥'
  plot_key        text GENERATED ALWAYS AS (plot_key(plot_no)) STORED,
  block           text NULL,                                   -- 'B'
  neighbourhood   text NULL,                                   -- سەرچنار
  owner_names     text NULL,                                   -- historic owners, free text, searchable
  year            int NULL CHECK (year BETWEEN 1900 AND 2100),
  file_type       archive_file_type NOT NULL,
  original_name   text NOT NULL,                               -- naxsha-247-5-tanzimi.dwg (§10.4 convention)
  stored_path     text NOT NULL UNIQUE CHECK (stored_path ~ '^archive/\d{4}/\d{2}/[0-9a-f-]{36}\.[a-z0-9]{2,4}$'),
  preview_path    text NULL CHECK (preview_path IS NULL OR preview_path ~ '^archive/\d{4}/\d{2}/[0-9a-f-]{36}\.(pdf|png|jpg)$'),
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),

  -- physical location: the reason the archive exists. All three required.
  shelf           text NOT NULL,                               -- ڕەفە 'C-12'
  folder_no       text NOT NULL,                               -- فۆڵدەر '47'
  section         text NOT NULL,                               -- بەش '2'
  box_no          text NULL,

  -- one normalised blob for free-text search, plus per-field columns for filters
  -- NOTE: concat_ws() is STABLE, not IMMUTABLE, so PostgreSQL rejects it in a
  -- generated column. Plain || is immutable. Step 8 of ku_normalize collapses the
  -- runs of spaces the coalesce leaves behind, so the result matches concat_ws.
  search_blob     text GENERATED ALWAYS AS (
                    ku_normalize(
                      coalesce(title, '')         || ' ' || coalesce(owner_names, '')   || ' ' ||
                      coalesce(neighbourhood, '') || ' ' || coalesce(plot_no, '')       || ' ' ||
                      coalesce(block, '')         || ' ' || coalesce(folder_no, '')     || ' ' ||
                      coalesce(original_name, ''))
                  ) STORED,
  neighbourhood_search text GENERATED ALWAYS AS (ku_normalize(neighbourhood)) STORED,
  owner_search    text GENERATED ALWAYS AS (ku_normalize(owner_names)) STORED,

  digitisation_batch_id bigint NULL,                           -- FK added below
  uploaded_by     bigint NOT NULL REFERENCES app_user(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  verified_by     bigint NULL REFERENCES app_user(id),
  verified_at     timestamptz NULL,
  is_active       boolean NOT NULL DEFAULT true,               -- false = superseded or withdrawn, still findable by IT
  CONSTRAINT archive_verified_pair CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
  CONSTRAINT archive_verifier_differs CHECK (verified_by IS NULL OR verified_by <> uploaded_by),
  CONSTRAINT archive_dwg_needs_preview CHECK (file_type NOT IN ('dwg', 'dxf') OR preview_path IS NOT NULL OR verified_at IS NULL)
);
COMMENT ON TABLE archive_file IS 'PLAN.md §4.6. One row per drawing or file in rooms 8 and 9. Separate from attachment because one drawing is referenced by many letters across years.';
COMMENT ON CONSTRAINT archive_dwg_needs_preview ON archive_file IS 'PLAN.md §7.3 option 2: a DWG/DXF cannot be verified until a PDF or image preview is attached. Upload without preview is allowed so scanning and preview generation can be separate steps.';
CREATE INDEX ix_archive_blob_trgm  ON archive_file USING gin (search_blob gin_trgm_ops);
CREATE INDEX ix_archive_owner_trgm ON archive_file USING gin (owner_search gin_trgm_ops);
CREATE INDEX ix_archive_nbhd_trgm  ON archive_file USING gin (neighbourhood_search gin_trgm_ops);
CREATE INDEX ix_archive_plot       ON archive_file (plot_key) WHERE plot_key IS NOT NULL;
CREATE INDEX ix_archive_location   ON archive_file (shelf, folder_no, section);
CREATE INDEX ix_archive_year       ON archive_file (year);
CREATE INDEX ix_archive_unverified ON archive_file (uploaded_at) WHERE verified_at IS NULL AND is_active;
CREATE INDEX ix_archive_sha        ON archive_file (sha256);

CREATE TABLE document_archive_file (
  document_id     bigint NOT NULL REFERENCES document(id),
  archive_file_id bigint NOT NULL REFERENCES archive_file(id),
  linked_by       bigint NOT NULL REFERENCES app_user(id),
  linked_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, archive_file_id)
);
CREATE INDEX ix_daf_file ON document_archive_file (archive_file_id);

CREATE TABLE digitisation_batch (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shelf           text NOT NULL,
  folder_no       text NOT NULL,
  section         text NULL,
  operator_id     bigint NOT NULL REFERENCES app_user(id),
  files_expected  int NULL,                                    -- counted when the folder is opened
  files_done      int NOT NULL DEFAULT 0,
  status          batch_status NOT NULL DEFAULT 'open',
  opened_at       timestamptz NOT NULL DEFAULT now(),
  scanned_at      timestamptz NULL,
  indexed_at      timestamptz NULL,
  qc_by           bigint NULL REFERENCES app_user(id),
  qc_at           timestamptz NULL,
  qc_sample_size  int NULL,
  qc_errors       int NULL,
  qc_note         text NULL,
  closed_at       timestamptz NULL,
  UNIQUE (shelf, folder_no, section, opened_at)
);
COMMENT ON TABLE digitisation_batch IS '§10. One row per physical folder taken off a shelf. Drives the progress board and the QC sampling.';
ALTER TABLE archive_file ADD CONSTRAINT fk_archive_batch FOREIGN KEY (digitisation_batch_id) REFERENCES digitisation_batch(id);
ALTER TABLE scan_tray_item ADD CONSTRAINT fk_tray_archive_file FOREIGN KEY (archive_file_id) REFERENCES archive_file(id);
