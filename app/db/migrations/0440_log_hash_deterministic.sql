-- The activity log's tamper-evidence hash must not depend on who is inserting
-- the row or on what their session settings happen to be.
--
-- ALSO FOUND BY THE RESTORE REHEARSAL. The restored copy of the database
-- reported that the activity log had been tampered with. Nothing had been
-- tampered with.
--
-- WHY
--
-- activity_log_hash() hashes, among other columns,
--
--     coalesce(NEW.occurred_at::text, '')
--
-- and casting a timestamptz to text renders it in the SESSION's time zone and
-- date style. The same row, the same instant, hashed under three settings:
--
--     TimeZone Asia/Baghdad   a929f99b3dfe601c70d388d66d3813dec09c38c21dd15…
--     TimeZone UTC            8a95683d31030224bc1c78cee6210cecc3e928cc6b39…
--     DateStyle SQL, DMY      91231792966c76cf3a7409c93ca21279fdd68cbcc3fc…
--
-- The trigger is BEFORE INSERT and ENABLE ALWAYS, so it fires again for every
-- row pg_restore loads, recomputing each hash from the restored values. Restore
-- into a database whose time zone is not the original's and every hash comes out
-- different, every seal fails, and the system announces that the log has been
-- altered.
--
-- That is the worst possible failure for this feature. The seal chain exists to
-- be believed on the one day somebody claims a letter was never registered. A
-- chain that cries wolf after an ordinary restore is a chain nobody will trust
-- when it matters, which is exactly what migration 0150 says about false alarms.
--
-- WHY NOT SIMPLY KEEP THE HASH THAT WAS DUMPED
--
-- The obvious fix is to have the trigger leave row_hash alone when the inserter
-- supplied one. It is also wrong. The application role may INSERT into this
-- table, so a row could arrive carrying a hash of its choosing, and forging a log
-- entry would become a matter of computing the hash you want. Recomputing on
-- every insert, always, is the property that makes the chain worth having.
--
-- WHY THE CONSTANT IS READ FROM THE DATABASE RATHER THAN WRITTEN HERE
--
-- The first version of this migration pinned Asia/Baghdad, because that is what
-- the municipal server is set to. It then failed on the hosted demonstration
-- database, which renders in GMT, and it failed in exactly the right way: on its
-- own check, before changing anything, saying that the seal chain would break.
--
--     the municipal server     Asia/Baghdad / ISO, MDY
--     the hosted demonstration GMT          / ISO, MDY
--
-- Rows already in a log were hashed under whatever their own database renders
-- with. Pinning anything else, however sensible, rewrites the recipe and
-- invalidates every seal ever taken there. So each database pins what it is
-- already using. The value is baked into the function definition, travels inside
-- the dump, and therefore keeps a restored copy verifying wherever it lands.
--
-- The consequence, stated plainly: after this migration the time zone is no
-- longer a display preference. It is an ingredient of the hash. Changing the
-- database's time zone afterwards is safe, because the function no longer reads
-- it; changing THIS setting on the function is not, and nothing should.

DO $pin$
DECLARE
  tz text := current_setting('TimeZone');
  ds text := current_setting('DateStyle');
BEGIN
  -- The recipe, lifted out of the trigger so that it can be CALLED. That is what
  -- makes the check below a test rather than a comment claiming something. The
  -- body is unchanged from migration 0150.
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION activity_log_hash_of(r activity_log) RETURNS bytea
    LANGUAGE sql STABLE
    SET search_path = pg_catalog, public
    SET "TimeZone" = %L
    SET "DateStyle" = %L
    AS $fn$
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
    $fn$
  $sql$, tz, ds);

  RAISE NOTICE '0440: the log hash is pinned to % / %, which is what this database already renders with', tz, ds;
END $pin$;

COMMENT ON FUNCTION activity_log_hash_of(activity_log) IS
  'ڕەچەتەی هاش. The row hash recipe. Time zone and date style are pinned into the definition: see migration 0440.';

CREATE OR REPLACE FUNCTION activity_log_hash() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  NEW.row_hash := activity_log_hash_of(NEW);
  RETURN NEW;
END $fn$;

-- ---------------------------------------------------------------------------
-- Proof
-- ---------------------------------------------------------------------------
--
-- Recompute a real row's hash under a deliberately wrong time zone and date
-- style, and insist it still matches the hash already stored for that row. If it
-- does not, this migration is about to break the seal chain, so it fails here,
-- loudly, and rolls itself back. That is not a hypothetical: it is how the GMT
-- difference above was found, on the second database it was run against.

DO $check$
DECLARE stored bytea; again bytea;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM activity_log) THEN
    RAISE NOTICE '0440: no log rows yet, so there is nothing to compare against';
    RETURN;
  END IF;

  SET LOCAL TimeZone = 'UTC';
  SET LOCAL DateStyle = 'SQL, DMY';

  SELECT l.row_hash, activity_log_hash_of(l) INTO stored, again
    FROM activity_log l ORDER BY l.id LIMIT 1;

  IF stored IS DISTINCT FROM again THEN
    RAISE EXCEPTION
      '0440: recomputing a log row hash under different session settings gave a different answer (% vs %). The seal chain would break on restore.',
      encode(stored, 'hex'), encode(again, 'hex');
  END IF;

  RAISE NOTICE '0440: a log row hashes the same under UTC and SQL,DMY as it does natively';
END $check$;
