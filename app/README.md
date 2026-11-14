# docsys — Rania Municipality document system

Server-rendered web application, PostgreSQL 16, Node 20. Kurdish Sorani, right to left.

The design authority is `../design/*.dc.html`. The plan is `../BUILD-PLAN.md`. The
running log of what was built and why is `../PROGRESS.md`.

## Run it locally

You need Node 18 or newer and Docker, or a PostgreSQL 16 you can create roles on.

```sh
# 1. a database
docker run -d --name docsys-pg -e POSTGRES_PASSWORD=devpw -p 55432:5432 postgres:16

# 2. roles and the database itself, once, as the superuser
sed 's|<set in /etc/docsys/env>|devpw|g' db/migrations/0000_roles.sql > /tmp/roles.sql
docker cp /tmp/roles.sql docsys-pg:/tmp/roles.sql
docker exec docsys-pg psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/roles.sql

# 3. everything else
npm install
export DATABASE_URL_OWNER=postgres://docsys_owner:devpw@localhost:55432/docsys
node db/migrate.mjs
node db/fixtures.mjs            # nine rooms, fifteen invented staff, password guhare-2026

# 4. the web server
export DATABASE_URL_APP=postgres://docsys_app:devpw@localhost:55432/docsys
export DATABASE_URL_READONLY=postgres://docsys_readonly:devpw@localhost:55432/docsys
export CSRF_SECRET=$(openssl rand -hex 32)
export PORT=3000
node src/server.mjs             # http://localhost:3000

# 5. the jobs process, in another terminal
export DATABASE_URL_JOBS=postgres://docsys_jobs:devpw@localhost:55432/docsys
node src/jobs.mjs               # or: node src/jobs.mjs seal
```

Sign in as `aram` (mayor), `shilan` (registry), `hemin` (legal head), `karwan`
(archive), `bafrin` (administration), `itadmin` (system). Every name is invented.

## Tests

```sh
node test/ku.test.mjs              # Kurdish normalisation, no database needed
node test/ku_sql.test.mjs          # SQL and JavaScript normalisers agree, byte for byte
node test/routing.test.mjs         # the life of a letter against the database
node test/guarantees.test.mjs      # numbering, append-only log, tamper detection (truncates the dev log)
node test/http.test.mjs            # the whole flow over HTTP, row-level security live (server running)
node test/screens.test.mjs         # every screen as every role, uploads, leave, lock (server running)
```

`test/backup.test.mjs` needs `pg_dump` and `pg_restore`, which are deliberately
not in the application image, so it runs in the backup container:

```sh
docker compose run --rm backup test
```

## Layout

| Path | What |
|---|---|
| `db/migrations/` | the schema, in tens, applied in order by `db/migrate.mjs` |
| `db/fixtures.mjs` | development data, refuses to run against anything but localhost |
| `src/lib/ku.mjs` | Kurdish text handling, mirrors the SQL functions exactly |
| `src/lib/routing.mjs` | the state machine: send, sequence, receive, complete, return, recall |
| `src/lib/documents.mjs` | register in, register out, cancel, tiered search |
| `src/lib/log.mjs` | the activity log; refuses to record letter contents |
| `src/lib/files.mjs` | upload intake: byte sniffing, size cap, uuid paths, hashes |
| `src/lib/auth.mjs` | argon2id passwords, hashed session tokens, the maintenance lock |
| `src/lib/db.mjs` | every query runs as a named person; row-level security reads that |
| `src/routes/` | one file per screen |
| `src/views/layout.mjs` | the shell that matches the approved design |
| `src/jobs.mjs` | nightly seal and verify, invariants, session purge |
| `src/lib/invariants.mjs` | what must be true of any healthy copy; asked nightly and after every restore |
| `src/lib/backup-crypt.mjs` | the encrypted container a backup is written into, specified in its own header |
| `src/lib/backup.mjs` | taking a backup, describing it, putting it back. No npm dependencies at all |
| `scripts/backup.mjs` | take one, list them, check them |
| `scripts/rehearse.mjs` | prove the newest backup restores, then throw the copy away |
| `scripts/restore.mjs` | put one back. See `../RESTORE.md` before running it |
| `files/` | uploaded files, never committed, path never derived from a filename |

## Rules that are not negotiable

- No raw SQL from user input, anywhere. Parameters only.
- The log records what happened, never what a letter said. `lib/log.mjs` throws if you try.
- Nobody updates or deletes a log row. The database refuses, including the owner.
- Numbers are never reused. A cancelled letter keeps its number.
- The stored path of a file is a uuid. The user's filename is a column, not a path.
- IT reads the log and manages accounts. IT cannot read a letter. The database enforces it.
- A backup is never written unencrypted, not even for a moment in a temporary file.
- Every function in `public` pins its `search_path`, or the database cannot be
  restored from its own dump. Checked nightly; see migration 0430.
