-- Every function pins its search path, so that this database can be restored
-- from its own backup.
--
-- FOUND BY THE RESTORE REHEARSAL, which is the only reason anybody found it.
-- Everything worked. Every test passed. pg_dump wrote a file of the right size
-- without one complaint. And the file could not be put back:
--
--   pg_restore: error: could not execute query:
--     ERROR: function fold_digits(text) does not exist
--     CONTEXT: SQL function "plot_key" during inlining
--     Command was: CREATE TABLE public.archive_file (
--       plot_key text GENERATED ALWAYS AS (public.plot_key(plot_no)) STORED, ...
--
-- WHY
--
-- pg_dump begins every dump with
--
--     SELECT pg_catalog.set_config('search_path', '', false);
--
-- and it is right to: a restore must not depend on whatever happens to be on the
-- path of whoever is running it. Every object pg_dump writes is schema-qualified
-- to suit, so `public.plot_key(plot_no)` in the generated column is correct.
--
-- What is NOT qualified is the inside of our own functions. plot_key's body
-- calls fold_digits() plainly, the way it was written, and with an empty search
-- path there is no such name. The planner inlines a simple SQL function while
-- creating the table, resolves the body there and then, and stops.
--
-- ku_normalize has the same call inside it and is plpgsql, so its body is not
-- parsed until something runs it. That is worse rather than better: the table
-- would have been created happily and the failure would have come later, while
-- loading the rows, in the middle of a restore somebody was relying on.
--
-- WHAT THIS DOES
--
-- Pins search_path on every function this project owns. pg_dump then writes the
-- setting into each function definition, and the body resolves the same way at
-- restore time as it does at two in the afternoon.
--
-- pg_catalog first, so nothing in public can shadow a built-in for a caller who
-- was expecting the built-in. Extension-owned functions are skipped: they belong
-- to pg_trgm and pgcrypto, they are not ours to alter, and pg_dump does not dump
-- them anyway.
--
-- A side effect worth knowing: a function with a SET clause cannot be inlined by
-- the planner. For these that is nothing. They are called once per written row
-- on generated columns, never in a loop over a large scan.
--
-- Every SECURITY DEFINER function in this database already pinned its path, so
-- none of them was affected. That was not luck; it is written down in the build
-- plan, because a SECURITY DEFINER function with a loose search path is a way to
-- hand somebody else's privileges to a function they control. The lesson here is
-- that the same rule was needed for the ordinary ones for an entirely different
-- reason, and nothing was checking.
--
-- KEEPING IT TRUE: lib/invariants.mjs checks this nightly and the restore
-- rehearsal checks it again on the way back in. A new function without a pinned
-- path is reported the next morning rather than on the day of a restore.

DO $$
DECLARE f record; n int := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND p.proconfig IS NULL
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', f.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'pinned search_path on % function(s)', n;
END $$;
