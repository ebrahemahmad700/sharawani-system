-- Fixes a real flaw in 0150_log_seal.sql, caught by test/guarantees.test.mjs.
--
-- The bug: row_hash was written by a BEFORE INSERT trigger and verify_log() then
-- folded those STORED hashes together. An UPDATE does not fire an insert trigger,
-- so editing a row left its row_hash untouched, the fold produced the same seal,
-- and verification passed. Someone with database access could alter the contents
-- of a log row and the tamper-evidence would say everything was fine.
--
-- Deleting a row was caught, because the row count changed. Editing was not.
--
-- The fix: hashing moves into one function that takes the row itself. The trigger
-- calls it on insert, and verify_log() calls it again at verification time on the
-- content that is actually there now. Verification no longer trusts anything
-- stored alongside the data it is checking.
--
-- The stored row_hash is kept, because comparing it against the recomputed value
-- pinpoints exactly which rows were altered, rather than only which seal broke.

-- ---------------------------------------------------------------------------
-- One hashing rule, used by both the trigger and the verifier
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION activity_log_row_hash(r activity_log) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT digest(
      coalesce(r.id::text, '')              || '|' ||
      coalesce(r.occurred_at::text, '')     || '|' ||
      coalesce(r.user_id::text, '')         || '|' ||
      coalesce(r.room_id::text, '')         || '|' ||
      coalesce(r.document_id::text, '')     || '|' ||
      coalesce(r.archive_file_id::text, '') || '|' ||
      coalesce(r.action, '')                || '|' ||
      coalesce(r.detail::text, '')          || '|' ||
      coalesce(r.ip_address::text, '')      || '|' ||
      coalesce(r.session_id::text, ''),
    'sha256');
$fn$;

CREATE OR REPLACE FUNCTION activity_log_hash() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.row_hash := activity_log_row_hash(NEW);
  RETURN NEW;
END $fn$;

-- ---------------------------------------------------------------------------
-- Sealing now folds recomputed hashes, so a seal always describes the content
-- that was present when it was taken.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seal_log() RETURNS log_seal
LANGUAGE plpgsql AS $fn$
DECLARE
  last_seal log_seal;
  lo        bigint;
  hi        bigint;
  n         bigint;
  combined  bytea;
  result    log_seal;
BEGIN
  SELECT * INTO last_seal FROM log_seal ORDER BY id DESC LIMIT 1;
  lo := coalesce(last_seal.to_log_id + 1, 1);

  SELECT max(id), count(*) INTO hi, n FROM activity_log WHERE id >= lo;
  IF hi IS NULL THEN
    RAISE NOTICE 'seal_log: nothing new since log id %', lo - 1;
    RETURN NULL;
  END IF;

  SELECT digest(coalesce(last_seal.seal_hash, ''::bytea)
                || string_agg(activity_log_row_hash(l), ''::bytea ORDER BY l.id), 'sha256')
    INTO combined
    FROM activity_log l WHERE l.id BETWEEN lo AND hi;

  INSERT INTO log_seal (from_log_id, to_log_id, row_count, prev_seal_hash, seal_hash)
  VALUES (lo, hi, n, last_seal.seal_hash, combined)
  RETURNING * INTO result;

  RETURN result;
END $fn$;

-- ---------------------------------------------------------------------------
-- Verification recomputes from live content and trusts nothing stored beside it
-- ---------------------------------------------------------------------------

-- The return type gains altered_rows, and CREATE OR REPLACE cannot change a
-- return type, so the old function is dropped first.
DROP FUNCTION IF EXISTS verify_log();

CREATE FUNCTION verify_log()
RETURNS TABLE (seal_id bigint, sealed_at timestamptz, from_log_id bigint, to_log_id bigint,
               expected_rows bigint, found_rows bigint, altered_rows bigint, ok boolean, note text)
LANGUAGE plpgsql AS $fn$
DECLARE
  s          log_seal;
  prev       bytea := NULL;
  recomputed bigint;
  altered    bigint;
  calc       bytea;
BEGIN
  FOR s IN SELECT * FROM log_seal ORDER BY id LOOP
    SELECT count(*),
           count(*) FILTER (WHERE l.row_hash IS DISTINCT FROM activity_log_row_hash(l)),
           digest(coalesce(prev, ''::bytea)
                  || coalesce(string_agg(activity_log_row_hash(l), ''::bytea ORDER BY l.id), ''::bytea), 'sha256')
      INTO recomputed, altered, calc
      FROM activity_log l WHERE l.id BETWEEN s.from_log_id AND s.to_log_id;

    seal_id       := s.id;
    sealed_at     := s.sealed_at;
    from_log_id   := s.from_log_id;
    to_log_id     := s.to_log_id;
    expected_rows := s.row_count;
    found_rows    := recomputed;
    altered_rows  := altered;
    ok            := (calc = s.seal_hash)
                     AND (recomputed = s.row_count)
                     AND (altered = 0)
                     AND (s.prev_seal_hash IS NOT DISTINCT FROM prev);
    note          := CASE
                       WHEN altered > 0             THEN altered || ' row(s) in this range were altered'
                       WHEN recomputed < s.row_count THEN (s.row_count - recomputed) || ' row(s) are missing from this range'
                       WHEN recomputed > s.row_count THEN (recomputed - s.row_count) || ' row(s) were inserted into this range after sealing'
                       WHEN calc <> s.seal_hash      THEN 'the contents of this range no longer match the seal'
                       WHEN s.prev_seal_hash IS DISTINCT FROM prev THEN 'the chain is broken before this seal'
                       ELSE 'ok'
                     END;
    prev := s.seal_hash;
    RETURN NEXT;
  END LOOP;
END $fn$;

-- ---------------------------------------------------------------------------
-- Pinpointing. Lists the individual rows whose content no longer matches the
-- hash written when they were inserted. This is what an investigation reads.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION verify_log_rows()
RETURNS TABLE (log_id bigint, occurred_at timestamptz, action text, stored_hash bytea, actual_hash bytea)
LANGUAGE sql STABLE AS $fn$
  SELECT l.id, l.occurred_at, l.action, l.row_hash, activity_log_row_hash(l)
    FROM activity_log l
   WHERE l.row_hash IS DISTINCT FROM activity_log_row_hash(l)
   ORDER BY l.id;
$fn$;

GRANT EXECUTE ON FUNCTION verify_log() TO docsys_app, docsys_jobs;
GRANT EXECUTE ON FUNCTION verify_log_rows() TO docsys_app, docsys_jobs;
