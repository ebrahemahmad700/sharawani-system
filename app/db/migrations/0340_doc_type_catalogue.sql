-- 0340 A list of transaction types the municipality can edit.
--
-- doc_type is an enum of nine, and an enum is the right shape for the coarse
-- question: is this a citizen's request, a government letter, a contract. Those
-- nine are what the routing rules and the reports are written against and they
-- should not change on a Tuesday because somebody added a category.
--
-- What the clerk at the front desk actually wants to pick is finer than that:
-- "بڕوانامەی پاکتاوی باج", "گواستنەوەی خاوەندارێتی", "مۆڵەتی بیناسازی". There are
-- dozens, the list grows, and it grows without a programmer. Today the only way
-- to add one is to alter an enum, which is a deployment.
--
-- So there are two levels, and they answer different questions:
--
--   doc_type            what kind of thing this is, for rules and reporting. Fixed.
--   doc_type_option     what the clerk ticked on the form. Editable by the office.
--
-- Every catalogue row names its base_kind, so a new option can never escape the
-- nine classes the rules understand. Adding "مۆڵەتی بیناسازی" as a citizen_request
-- changes what the form offers and changes nothing about how the system reasons.
--
-- Each option can also carry a default: which room this normally goes to and how
-- long that room normally gets. The registry clerk is proposed those and can
-- override them. This is the single largest saving in the whole registration
-- screen, because for most letters the answer is always the same.

CREATE TABLE doc_type_option (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9-]{1,23}$'),
  name           text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  name_search    text GENERATED ALWAYS AS (ku_normalize(name)) STORED,
  name_sort      text GENERATED ALWAYS AS (ku_sort_key(name)) STORED,
  base_kind      doc_type NOT NULL,
  category       text NULL CHECK (category IS NULL OR length(category) <= 60),
  description    text NULL CHECK (description IS NULL OR length(description) <= 400),

  default_room_id  bigint NULL REFERENCES room(id),
  default_due_days int NULL CHECK (default_due_days BETWEEN 1 AND 60),
  requires_seal    boolean NOT NULL DEFAULT false,   -- مۆری فەرمی: the paper needs an official stamp before it moves

  sort_order     int NOT NULL DEFAULT 100,
  is_builtin     boolean NOT NULL DEFAULT false,     -- seeded here; the office may deactivate but not delete
  is_active      boolean NOT NULL DEFAULT true,
  created_by     bigint NULL REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE doc_type_option IS
  'The list of transaction types the front desk picks from. Editable by the office. Every row names a base_kind so the fixed doc_type rules still apply.';
COMMENT ON COLUMN doc_type_option.is_builtin IS
  'Seeded with the system. Can be deactivated or renamed but never deleted, because existing letters point at it.';

CREATE INDEX ix_doc_type_option_active ON doc_type_option (is_active, sort_order, name_sort);

-- The letter records which option was ticked, alongside the enum it belongs to.
-- Nullable because every letter registered before today has a doc_type and no
-- option, and inventing one for them would be inventing a fact.
ALTER TABLE document ADD COLUMN doc_type_option_id bigint NULL REFERENCES doc_type_option(id);

COMMENT ON COLUMN document.doc_type_option_id IS
  'Which catalogue row the clerk ticked. NULL for letters registered before the catalogue existed.';

CREATE INDEX ix_doc_option ON document (doc_type_option_id) WHERE doc_type_option_id IS NOT NULL;

-- Seed: the nine that already exist, so nothing on the registration screen changes
-- shape on the day this lands. The office adds finer ones on top.
INSERT INTO doc_type_option (code, name, base_kind, category, sort_order, is_builtin) VALUES
  ('CITIZEN-REQ', 'داواکاری هاووڵاتی', 'citizen_request', 'گشتی',    10, true),
  ('COMPANY-REQ', 'داواکاری کۆمپانیا', 'company_request', 'گشتی',    20, true),
  ('GOV-LETTER',  'نامەی حکومی',       'gov_letter',      'گشتی',    30, true),
  ('INTERNAL',    'نامەی ناوخۆیی',     'internal',        'ناوخۆیی', 40, true),
  ('COMPLAINT',   'سکاڵا',             'complaint',       'گشتی',    50, true),
  ('REPORT',      'ڕاپۆرت',            'report',          'ناوخۆیی', 60, true),
  ('CONTRACT',    'گرێبەست',           'contract',        'گرێبەست', 70, true),
  ('LEAVE-REQ',   'داواکاری مۆڵەت',    'leave_request',   'ناوخۆیی', 80, true),
  ('OTHER',       'جۆری تر',           'other',           'گشتی',    999, true);

ALTER TABLE doc_type_option ENABLE ROW LEVEL SECURITY;

-- The catalogue is a list of category names. It says nothing about any letter, so
-- everyone signed in may read it, IT included: IT maintains it.
CREATE POLICY doc_type_option_select ON doc_type_option FOR SELECT
  USING (app_user_id() IS NOT NULL);

CREATE POLICY doc_type_option_insert ON doc_type_option FOR INSERT
  WITH CHECK (app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk', 'sysadmin'));

CREATE POLICY doc_type_option_update ON doc_type_option FOR UPDATE
  USING (app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk', 'sysadmin'));

GRANT SELECT, INSERT, UPDATE ON doc_type_option TO docsys_app;
GRANT SELECT ON doc_type_option TO docsys_readonly;
GRANT SELECT ON doc_type_option TO docsys_jobs;
