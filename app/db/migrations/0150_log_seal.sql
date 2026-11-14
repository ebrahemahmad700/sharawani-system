-- ADDITION beyond BUILD-PLAN.md. Not in the original plan.
--
-- Why: the log is append-only against the application and against the database
-- owner, enforced by a trigger and by absent grants. That stops every route the
-- system itself offers. It does not stop someone with root on the machine, who
-- can disable a trigger, edit the data files, or restore an edited backup.
--
-- This makes tampering DETECTABLE rather than trying to make it impossible.
-- Every log row gets a hash of its own contents. A nightly job seals the day: it
-- folds that day's row hashes together with the previous seal, producing a chain.
-- Change or remove any row and every seal from that point on stops verifying.
--
-- Why seals rather than chaining each row to the one before it at insert time:
-- per-row chaining needs the inserts serialised, which means a lock held for the
-- length of the surrounding business transaction. Registering a document would
-- then block every other log write until it committed. Sealing nightly costs
-- nothing at write time and still detects tampering within a day.
--
-- The operational half of this lives in the runbook: print the weekly seal hash
-- and file it in the mayor's office. Once a hash exists on paper outside the
-- building, deleting the rows and the seals together no longer hides anything.

-- ---------------------------------------------------------------------------
-- Per-row content hash
-- ---------------------------------------------------------------------------

ALTER TABLE activity_log ADD COLUMN row_hash bytea;

CREATE OR REPLACE FUNCTION activity_log_hash() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- Every column that carries meaning, separated so that values cannot run
  -- together. Nulls become the empty string, so a null and an empty value
  -- still hash differently by position.
  NEW.row_hash := digest(
      coalesce(NEW.id::text, '')              || '|' ||
      coalesce(NEW.occurred_at::text, '')     || '|' ||
      coalesce(NEW.user_id::text, '')         || '|' ||
      coalesce(NEW.room_id::text, '')         || '|' ||
      coalesce(NEW.document_id::text, '')     || '|' ||
      coalesce(NEW.archive_file_id::text, '') || '|' ||
      coalesce(NEW.action, '')                || '|' ||
      coalesce(NEW.detail::text, '')          || '|' ||
      coalesce(NEW.ip_address::text, '')      || '|' ||
      coalesce(NEW.session_id::text, ''),
    'sha256');
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_log_hash BEFORE INSERT ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_hash();
ALTER TABLE activity_log ENABLE ALWAYS TRIGGER trg_log_hash;

-- ---------------------------------------------------------------------------
-- The seal chain
-- ---------------------------------------------------------------------------

CREATE TABLE log_seal (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sealed_at      timestamptz NOT NULL DEFAULT now(),
  from_log_id    bigint NOT NULL,
  to_log_id      bigint NOT NULL,
  row_count      bigint NOT NULL,
  prev_seal_hash bytea NULL,             -- null only for the very first seal
  seal_hash      bytea NOT NULL,
  CONSTRAINT seal_range_sane CHECK (to_log_id >= from_log_id)
);
COMMENT ON TABLE log_seal IS 'مۆری تۆماری چالاکی. Nightly tamper-evidence over activity_log. Append-only. The weekly hash is printed and filed on paper.';

CREATE INDEX ix_seal_range ON log_seal (from_log_id, to_log_id);

-- Append-only, exactly as the log itself. Reuses the log's block function.
CREATE TRIGGER trg_seal_no_update   BEFORE UPDATE OR DELETE ON log_seal FOR EACH STATEMENT EXECUTE FUNCTION activity_log_block();
CREATE TRIGGER trg_seal_no_truncate BEFORE TRUNCATE          ON log_seal FOR EACH STATEMENT EXECUTE FUNCTION activity_log_block();
ALTER TABLE log_seal ENABLE ALWAYS TRIGGER trg_seal_no_update;
ALTER TABLE log_seal ENABLE ALWAYS TRIGGER trg_seal_no_truncate;

-- ---------------------------------------------------------------------------
-- Sealing. Run nightly by docsys_jobs, after the backup.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seal_log() RETURNS log_seal
LANGUAGE plpgsql AS $fn$
DECLARE
  last_seal  log_seal;
  lo         bigint;
  hi         bigint;
  n          bigint;
  combined   bytea;
  result     log_seal;
BEGIN
  SELECT * INTO last_seal FROM log_seal ORDER BY id DESC LIMIT 1;
  lo := coalesce(last_seal.to_log_id + 1, 1);

  SELECT max(id), count(*) INTO hi, n FROM activity_log WHERE id >= lo;
  IF hi IS NULL THEN
    RAISE NOTICE 'seal_log: nothing new since log id %', lo - 1;
    RETURN NULL;
  END IF;

  -- Fold the row hashes in id order, starting from the previous seal hash.
  SELECT digest(coalesce(last_seal.seal_hash, ''::bytea) || string_agg(row_hash, ''::bytea ORDER BY id), 'sha256')
    INTO combined
    FROM activity_log WHERE id BETWEEN lo AND hi;

  INSERT INTO log_seal (from_log_id, to_log_id, row_count, prev_seal_hash, seal_hash)
  VALUES (lo, hi, n, last_seal.seal_hash, combined)
  RETURNING * INTO result;

  RETURN result;
END $fn$;

-- ---------------------------------------------------------------------------
-- Verification. Recomputes every seal from the rows still present.
-- One row per seal. ok = false means those rows changed, went missing, or had
-- rows inserted into their range after the fact.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION verify_log()
RETURNS TABLE (seal_id bigint, sealed_at timestamptz, from_log_id bigint, to_log_id bigint,
               expected_rows bigint, found_rows bigint, ok boolean, note text)
LANGUAGE plpgsql AS $fn$
DECLARE
  s          log_seal;
  prev       bytea := NULL;
  recomputed bigint;
  calc       bytea;
BEGIN
  FOR s IN SELECT * FROM log_seal ORDER BY id LOOP
    SELECT count(*),
           digest(coalesce(prev, ''::bytea) || coalesce(string_agg(row_hash, ''::bytea ORDER BY id), ''::bytea), 'sha256')
      INTO recomputed, calc
      FROM activity_log WHERE id BETWEEN s.from_log_id AND s.to_log_id;

    seal_id       := s.id;
    sealed_at     := s.sealed_at;
    from_log_id   := s.from_log_id;
    to_log_id     := s.to_log_id;
    expected_rows := s.row_count;
    found_rows    := recomputed;
    ok            := (calc = s.seal_hash)
                     AND (recomputed = s.row_count)
                     AND (s.prev_seal_hash IS NOT DISTINCT FROM prev);
    note          := CASE
                       WHEN recomputed < s.row_count THEN 'rows are missing from this range'
                       WHEN recomputed > s.row_count THEN 'rows were inserted into this range after sealing'
                       WHEN calc <> s.seal_hash      THEN 'a row in this range was altered'
                       WHEN s.prev_seal_hash IS DISTINCT FROM prev THEN 'the chain is broken before this seal'
                       ELSE 'ok'
                     END;
    prev := s.seal_hash;
    RETURN NEXT;
  END LOOP;
END $fn$;

-- The job role seals. Nobody updates or deletes, including the job role.
GRANT SELECT, INSERT ON log_seal TO docsys_jobs;
GRANT SELECT ON log_seal TO docsys_app, docsys_readonly;
REVOKE UPDATE, DELETE, TRUNCATE ON log_seal FROM docsys_jobs, docsys_app, docsys_readonly;
