-- 2.1 Roles and extensions
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

-- Run once as the postgres superuser, before 0001_initial.sql.
CREATE ROLE docsys_owner    LOGIN PASSWORD '<set in /etc/docsys/env>';   -- owns all objects, runs migrations
CREATE ROLE docsys_app      LOGIN PASSWORD '<set in /etc/docsys/env>';   -- the web application
CREATE ROLE docsys_readonly LOGIN PASSWORD '<set in /etc/docsys/env>';   -- the assistant, and reports if desired
CREATE ROLE docsys_jobs     LOGIN PASSWORD '<set in /etc/docsys/env>' BYPASSRLS;  -- tray watcher, leave-rollover, nightly checks (§5.2)

-- docsys_backup is created because the plan named it, and it is NOT USED. Left
-- here so that nobody wonders where it went and quietly reinvents it.
--
-- pg_read_all_data grants SELECT on everything but does not set BYPASSRLS, and
-- this database puts row-level security on document, attachment, activity_log
-- and sixteen more. Connected as this role with no app.user_id set, the policies
-- match nothing at all:
--
--     docsys_owner  -> SELECT count(*) FROM document  ->  286
--     docsys_backup -> SELECT count(*) FROM document  ->    0
--
-- pg_dump through it stops with "query would be affected by row-level security
-- policy", which is survivable because it is loud. The danger is the flag that
-- silences it: --enable-row-security makes pg_dump succeed and write a backup
-- containing no letters, which restores without one error and is empty.
--
-- So backups are taken as docsys_owner, which owns the tables and therefore is
-- not subject to their policies. src/lib/backup.mjs refuses to start through a
-- connection that cannot see the rows, so this cannot be rediscovered the hard
-- way. Granting this role BYPASSRLS would also work and is deliberately not
-- done: a second role able to read every letter is a second thing to protect.
CREATE ROLE docsys_backup   LOGIN PASSWORD '<set in /etc/docsys/env>' IN ROLE pg_read_all_data;

CREATE DATABASE docsys OWNER docsys_owner
  ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und-u-ks-level1' TEMPLATE template0;
-- 'und' = root collation. Kurdish alphabetical order is an open item (PLAN.md §6.4); see §15 D-12.

\connect docsys
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS btree_gin;    -- lets one GIN index cover trgm + a scalar column

-- The application role is subject to row-level security. It must NOT own tables and must NOT have BYPASSRLS.
ALTER ROLE docsys_app      NOBYPASSRLS;
ALTER ROLE docsys_readonly NOBYPASSRLS;
ALTER ROLE docsys_readonly SET default_transaction_read_only = on;
ALTER ROLE docsys_readonly SET statement_timeout = '8s';          -- an assistant tool call must never hang the DB
ALTER ROLE docsys_app      SET statement_timeout = '30s';
ALTER DATABASE docsys SET timezone = 'Asia/Baghdad';
ALTER DATABASE docsys SET pg_trgm.similarity_threshold = 0.25;    -- see §6.3 for why not the default 0.3

-- The owner may set the trigram threshold on a database.
--
-- Needed to RESTORE this database, which is not obvious and is fatal when it is
-- missing. pg_dump --create writes the per-database settings into the archive:
--
--     ALTER DATABASE docsys SET "pg_trgm.similarity_threshold" TO '0.25';
--
-- A setting belonging to an extension is an unrecognised name to any session
-- that has not loaded that extension, and PostgreSQL lets only a superuser set
-- an unrecognised name on a database. So pg_restore running as docsys_owner
-- stops there with "permission denied to set parameter", and because a restore
-- is run with --exit-on-error, the whole thing stops with it. The alternative is
-- to restore as the postgres superuser, which is a much larger thing to hand to
-- whoever is on duty at three in the morning.
--
-- TimeZone needs no grant: it is an ordinary setting and a database's owner may
-- always set those. Existing installations:
--
--     docker compose exec db psql -U postgres \
--       -c 'GRANT SET ON PARAMETER "pg_trgm.similarity_threshold" TO docsys_owner'
GRANT SET ON PARAMETER "pg_trgm.similarity_threshold" TO docsys_owner;

-- The owner may create databases, which it needs for one thing only: the weekly
-- restore rehearsal builds a scratch database, restores the newest backup into
-- it, checks that what came back is the register, and drops it again. Doing that
-- under a different name is what makes the rehearsal safe to run automatically
-- against a live system, because it can never be pointed at the real database by
-- a typo. Existing installations can be brought up to date with:
--
--     docker compose exec db psql -U postgres -c 'ALTER ROLE docsys_owner CREATEDB'
ALTER ROLE docsys_owner CREATEDB;
