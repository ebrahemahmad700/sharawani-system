-- 0350 The companies the municipality deals with, and their folders.
--
-- sender_kind has had 'company' in it from the beginning, and sender_name has
-- been free text. That is enough to register a letter and not enough to answer
-- the question the contracts room asks every day: what else have we had from
-- this company, and is their licence still valid.
--
-- Free text cannot answer it. "کۆمپانیای ئاسۆ", "شرکة آسو", "Aso Company" and
-- "ئاسۆ" are one company and four strings, and a search finds whichever the
-- clerk happened to type. A registration number does not have that problem,
-- which is why it is the column with the unique constraint on it.
--
-- Three tables, and the middle one is the point:
--
--   company           who they are, and whether their papers are in order
--   company_document  every letter that concerns them
--   company_file      the licence, the tax clearance, the articles: files that
--                     belong to the company and not to any one letter
--
-- A letter can be linked to a company at registration or later, and linking is
-- reversible because misfiling happens, and pretending it does not is how a
-- company ends up permanently associated with another firm's dispute.

CREATE TYPE company_status AS ENUM ('active', 'under_review', 'suspended', 'closed');
  -- چالاک · لە ژێر پێداچوونەوە · ڕاگیراو · داخراو

CREATE TABLE company (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  name_search      text GENERATED ALWAYS AS (ku_normalize(name)) STORED,
  name_sort        text GENERATED ALWAYS AS (ku_sort_key(name)) STORED,
  legal_name       text NULL CHECK (legal_name IS NULL OR length(legal_name) <= 200),
  legal_search     text GENERATED ALWAYS AS (ku_normalize(legal_name)) STORED,

  -- The identity that survives a rename. Digits and dashes only, and unique.
  registration_no  text NOT NULL UNIQUE CHECK (registration_no ~ '^[0-9A-Za-z/-]{2,40}$'),
  tax_no           text NULL CHECK (tax_no IS NULL OR tax_no ~ '^[0-9A-Za-z/-]{2,40}$'),

  status           company_status NOT NULL DEFAULT 'active',
  capital          text NULL CHECK (capital IS NULL OR length(capital) <= 60),
  established_on   date NULL,
  representative   text NULL CHECK (representative IS NULL OR length(representative) <= 160),
  rep_search       text GENERATED ALWAYS AS (ku_normalize(representative)) STORED,
  phone            text NULL CHECK (phone IS NULL OR length(phone) <= 60),
  email            text NULL CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][a-z]{2,}$'),
  address          text NULL CHECK (address IS NULL OR length(address) <= 300),
  note             text NULL CHECK (note IS NULL OR length(note) <= 1000),

  licence_expires_on date NULL,        -- the date the contracts room actually cares about

  created_by       bigint NOT NULL REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       bigint NULL REFERENCES app_user(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  is_active        boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE company IS
  'Companies the municipality has dealings with. registration_no is the identity: names are typed four different ways and a number is not.';
COMMENT ON COLUMN company.licence_expires_on IS
  'Why the contracts room opens this screen. Drives the expiring-soon list.';

CREATE INDEX ix_company_name    ON company USING gin (name_search gin_trgm_ops);
CREATE INDEX ix_company_sort    ON company (name_sort) WHERE is_active;
CREATE INDEX ix_company_expiry  ON company (licence_expires_on) WHERE is_active AND licence_expires_on IS NOT NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE company_document (
  company_id   bigint NOT NULL REFERENCES company(id),
  document_id  bigint NOT NULL REFERENCES document(id),
  linked_by    bigint NOT NULL REFERENCES app_user(id),
  linked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, document_id)
);

COMMENT ON TABLE company_document IS
  'Which letters concern which company. A letter may touch more than one company, so this is a join table and not a column on document.';

CREATE INDEX ix_company_document_doc ON company_document (document_id);

-- ---------------------------------------------------------------------------

CREATE TABLE company_file (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id     bigint NOT NULL REFERENCES company(id),
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  title_search   text GENERATED ALWAYS AS (ku_normalize(title)) STORED,
  category       text NULL CHECK (category IS NULL OR length(category) <= 60),
  -- مۆڵەت · پاکتاوی باج · پەیماننامە · بەڵگەی خاوەندارێتی
  valid_until    date NULL,

  original_name  text NOT NULL,
  stored_path    text NOT NULL UNIQUE CHECK (stored_path ~ '^files/\d{4}/\d{2}/[0-9a-f-]{36}[.][a-z0-9]{2,4}$'),
  mime_type      text NOT NULL,
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  virus_scanned_at timestamptz NULL,

  uploaded_by    bigint NOT NULL REFERENCES app_user(id),
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  is_active      boolean NOT NULL DEFAULT true      -- false = superseded by a newer copy, still on the record
);

COMMENT ON TABLE company_file IS
  'A file belonging to a company rather than to a letter: the licence, the tax clearance, the articles of association.';

CREATE INDEX ix_company_file ON company_file (company_id, uploaded_at DESC) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- A company record is a register of a business the municipality deals with. Any
-- room may need to look one up, so reading is open to everyone with a room.
-- Maintaining it is not: an out-of-date licence date on this screen is worse
-- than no date at all, so writing is the registry, the contracts side and the
-- executive office.
--
-- IT is excluded from all of it, on the same footing as letters. A list of every
-- company the municipality deals with, with licence dates and representatives, is
-- exactly the kind of thing the confidentiality rule is about.

ALTER TABLE company ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_select ON company FOR SELECT
  USING (app_role() IN ('mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                        'room_clerk', 'registry_clerk', 'archive_clerk'));

CREATE POLICY company_insert ON company FOR INSERT
  WITH CHECK (app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk', 'room_head', 'room_clerk'));

CREATE POLICY company_update ON company FOR UPDATE
  USING (app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk', 'room_head', 'room_clerk'));

-- The link names a letter, so it follows the letter's rule, not the company's.
ALTER TABLE company_document ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_document_select ON company_document FOR SELECT
  USING (app_role() <> 'sysadmin' AND document_visible(document_id));

CREATE POLICY company_document_insert ON company_document FOR INSERT
  WITH CHECK (app_role() <> 'sysadmin' AND document_visible(document_id));

CREATE POLICY company_document_delete ON company_document FOR DELETE
  USING (app_role() <> 'sysadmin' AND document_visible(document_id));

ALTER TABLE company_file ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_file_select ON company_file FOR SELECT
  USING (app_role() IN ('mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                        'room_clerk', 'registry_clerk', 'archive_clerk'));

CREATE POLICY company_file_insert ON company_file FOR INSERT
  WITH CHECK (app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk', 'room_head', 'room_clerk'));

CREATE POLICY company_file_update ON company_file FOR UPDATE
  USING (app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk', 'room_head', 'room_clerk'));

GRANT SELECT, INSERT, UPDATE ON company           TO docsys_app;
GRANT SELECT, INSERT, DELETE ON company_document  TO docsys_app;
GRANT SELECT, INSERT, UPDATE ON company_file      TO docsys_app;
GRANT SELECT ON company, company_document, company_file TO docsys_readonly;
GRANT SELECT ON company, company_document, company_file TO docsys_jobs;
