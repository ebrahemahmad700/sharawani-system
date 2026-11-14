-- 2.4 Number issuing
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

CREATE TABLE number_counter (
  kind        counter_kind NOT NULL,
  year        int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  next_value  int NOT NULL CHECK (next_value >= 1),
  PRIMARY KEY (kind, year)
);
COMMENT ON TABLE number_counter IS 'PLAN.md §4.8. Never decremented. Never reset. Seeded per year on first use, or by docsys import-legacy with max(paper number) + 1 (§11).';

-- Atomic issue. The row lock taken by UPDATE serialises concurrent callers; the caller''s
-- transaction holds the number until commit, so two clerks can never receive the same value.
CREATE OR REPLACE FUNCTION issue_number(p_kind counter_kind, p_year int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v int;
BEGIN
  INSERT INTO number_counter (kind, year, next_value) VALUES (p_kind, p_year, 1)
  ON CONFLICT (kind, year) DO NOTHING;
  UPDATE number_counter SET next_value = next_value + 1
   WHERE kind = p_kind AND year = p_year
  RETURNING next_value - 1 INTO v;
  RETURN v;
END $$;

-- Read-only preview for the form ("ژمارەی هاتوو" shown greyed). May be stale by the time the clerk saves; the form
-- must show the issued number after save, and §8.2 has an acceptance criterion for exactly that.
CREATE OR REPLACE FUNCTION peek_number(p_kind counter_kind, p_year int)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT next_value FROM number_counter WHERE kind = p_kind AND year = p_year), 1);
$$;

-- Canonical stored form. Prefixes are settings (Q4). Digits are Western in the database, always.
CREATE OR REPLACE FUNCTION format_doc_number(p_kind counter_kind, p_year int, p_seq int)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT (SELECT value ->> 'prefix' FROM system_setting
           WHERE key = CASE p_kind WHEN 'incoming' THEN 'incoming_no_format' ELSE 'outgoing_no_format' END)
         || '/' || p_year::text || '/' || p_seq::text;
$$;

-- ---------------------------------------------------------------------------
-- Worked example from BUILD-PLAN.md section 2.4: what one registration does.
-- Illustration only, not executable. It is kept here because the ordering of
-- these statements is the contract: issue_number holds a row lock until COMMIT,
-- so two clerks registering at the same moment cannot receive the same number.
-- ---------------------------------------------------------------------------
-- -- 2.4 Number issuing (cont)
-- 
-- BEGIN;
-- SET LOCAL app.user_id = '17';                         -- the registry clerk; see §5.2
-- SELECT issue_number('incoming', 2026) AS seq;         -- e.g. 4521. Row lock held until COMMIT.
-- INSERT INTO document (incoming_seq, incoming_year, incoming_no, incoming_date, incoming_registered_by,
--                       subject, doc_type, sender_kind, sender_name, sender_contact, priority, status,
--                       plot_no, neighbourhood, physical_shelf, physical_folder, physical_section)
-- VALUES (4521, 2026, format_doc_number('incoming', 2026, 4521), '2026-09-09', 17,
--         'داواکاری مۆڵەتی بیناسازی بۆ پارچە ٢٤٧/٥ لە گەڕەکی سەرچنار', 'citizen_request', 'citizen',
--         'کەریم ساڵح عەبدوڵا', 'دانیشتووی گەڕەکی سەرچنار', 'normal', 'registered',
--         '247/5', 'سەرچنار', NULL, NULL, NULL)
-- RETURNING id;
-- INSERT INTO attachment (...) VALUES (...);            -- the scan claimed from the tray, kind = original_scan
-- INSERT INTO activity_log (user_id, room_id, document_id, action, detail)
-- VALUES (17, 1, <id>, 'document.registered', '{"incoming_no":"ه/2026/4521"}');
-- COMMIT;
