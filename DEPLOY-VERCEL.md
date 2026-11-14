# Deploying docsys to Vercel

The port is done. The application runs on a serverless host without losing
uploads, without losing the nightly seal, and without losing the row-level
security that keeps IT out of the letters.

**What is proven and what is not.** Every change below was built and tested
against PostgreSQL 16 in Docker: 219 checks pass on the ordinary disk backend and
219 pass on the database backend, including a new test that confirms IT cannot
read the bytes of a single letter attachment. What has *not* been exercised is a
real managed Postgres. Neon, Vercel Postgres and Supabase each refuse a slightly
different set of `ALTER ROLE` statements, and `db/setup-hosted.mjs` reports
exactly which ones your provider refused rather than guessing. Run its `--verify`
pass and read the output before any real record goes in.

---

## What changed, and why

| Problem on Vercel | What it does now |
|---|---|
| The filesystem is wiped between requests, so uploads vanish | `FILE_STORAGE=pg` puts the bytes in a `file_blob` table, addressed by the same uuid path. Stored paths are unchanged, so existing metadata rows stay valid |
| No process to run the nightly seal | `/api/cron/*` runs the identical job code over HTTP, guarded by a bearer secret |
| No superuser, so no `BYPASSRLS` role | The jobs connect as the table owner, which bypasses row-level security for the same reason. The application connects as a non-owner role, so the policies still apply to it |
| Importing the app would bind a port | `src/server.mjs` skips `listen()` when `VERCEL` is set |

The bytes going into the database is the one real tradeoff. A whole file sits in
memory while it is written and while it is read, capped at 60 MiB by
`MAX_UPLOAD_BYTES`. On disk the bytes stream and memory stays flat. If drawings
grow much past that cap, the answer is object storage, not a bigger cap.

---

## Steps

### 1. A database

Create a Postgres and get its connection string. Neon is the usual choice
alongside Vercel. Whatever you use, you need a role that can create other roles.

### 2. The roles

This is the step that decides whether the security model survives. Run it once,
from the `app` directory:

```
DATABASE_URL_OWNER="postgres://OWNER:PASS@HOST/DB?sslmode=require" \
APP_PASSWORD="$(openssl rand -hex 24)" \
READONLY_PASSWORD="$(openssl rand -hex 24)" \
node db/setup-hosted.mjs
```

Keep the two passwords it used. Read its output: anything it says was REFUSED
needs to go on the connection string instead, and it prints the exact form.

### 3. Schema and data

```
DATABASE_URL_OWNER="postgres://OWNER:PASS@HOST/DB?sslmode=require" node db/migrate.mjs
DATABASE_URL_OWNER="..." node db/fixtures.mjs      # invented test staff only
DATABASE_URL_OWNER="..." node db/setup-hosted.mjs --verify
```

Do not skip the verify. It checks that the application role owns no tables, has
no `BYPASSRLS`, and that row-level security is still switched on where it
matters. If any line says FAIL, stop.

### 4. Environment variables on Vercel

Set these on the project, for Production:

| Name | Value |
|---|---|
| `DATABASE_URL_APP` | the connection string **as `docsys_app`**, not as the owner |
| `DATABASE_URL_READONLY` | as `docsys_readonly` |
| `DATABASE_URL_JOBS` | as the owner. The nightly seal has to see every row |
| `FILE_STORAGE` | `pg` |
| `SECURE_COOKIES` | `true` |
| `CSRF_SECRET` | `openssl rand -hex 32`, and never change it afterwards |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `VAPID_PUBLIC_KEY` | from `node scripts/vapid-keys.mjs`, run once |
| `VAPID_PRIVATE_KEY` | the other line it prints |
| `VAPID_SUBJECT` | a `mailto:` for whoever runs the server |
| `BOARD_TOKEN` | `openssl rand -hex 24`, for the corridor wall board |
| `PUBLIC_BASE_URL` | the address printed in QR codes on receipts |

The three VAPID values are what let a browser be told something arrived while it
is shut. Leave them out and everything still works; what is missing is the
notification on a phone with the application closed. Generate them once and keep
them: changing the private key invalidates every browser already registered, and
every member of staff has to press the button again.

`BOARD_TOKEN` is what lets the machine driving the corridor television open the
board without anybody signing in. Open `https://YOUR-APP/board?key=<token>` once
on that machine and it keeps a cookie. Leave it unset and the board still works
for the mayor, his deputy and IT.

`PUBLIC_BASE_URL` is printed into the QR code on every applicant's receipt, so
it must be the address a citizen's phone can actually reach. Behind a proxy the
request host is the proxy rather than the name on the sign, which is why this is
set rather than guessed.

**One thing does not work on serverless hosting.** Reading the text inside scans
needs tesseract and poppler, which are installed in the Docker image and cannot
be installed in a serverless function. There, every scan is honestly labelled as
not read, search falls back to what was typed, and the camera screen files the
photograph without filling the form in. This is the same arrangement as virus
scanning, and it is one more reason the real deployment is the municipality's own
server.

`DATABASE_URL_APP` is the one to get right. Point it at the owner instead of
`docsys_app` and row-level security silently stops applying to every web request.
Nothing on any screen will look different.

### 5. Deploy

From the `app` directory:

```
vercel --prod
```

You need to run this yourself. The token you sent had to be treated as burned the
moment it appeared in a chat log, and the tooling here blocks deployment
commands anyway.

### 6. Check it

```
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-APP.vercel.app/login          # expect 200
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-APP.vercel.app/api/cron/seal  # expect 404, no secret
curl -s -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP.vercel.app/api/cron/verify
```

Then sign in, upload a scan, wait a few minutes so the function goes cold, and
open the scan again. If it is still there, the storage change is working.

Two further checks worth making on a serverless host:

```
node test/pwa.test.mjs      BASE=https://YOUR-APP.vercel.app
node test/notify.test.mjs   BASE=https://YOUR-APP.vercel.app FIXTURE_PASSWORD=...
```

The second one opens the live event stream and times how long a notification
takes to arrive. On a server of our own that is well under a second, because
Postgres LISTEN wakes the waiting request. On serverless nothing can be held
open between requests, so the stream falls back to asking every two and a half
seconds and closing every twenty-five, with the browser reconnecting. Expect
about three seconds there, and know that each open browser is a running function
for most of the day: on a municipal server this costs nothing, and on serverless
it is the largest single item of usage.

---

## The cron schedules

`vercel.json` declares two, in UTC, because Vercel Cron has no timezone:

| Job | UTC | Baghdad |
|---|---|---|
| seal | 20:45 | 23:45 |
| verify | 20:50 | 23:50 |

Two things to know. The Hobby plan allows two cron jobs and runs them at most
once a day, which is why only `seal` and `verify` are declared: they are the ones
that keep the log tamper-evident. `invariants` and `purge-sessions` are not
scheduled and you should call them by hand, or move to a plan that allows more.

```
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP.vercel.app/api/cron/invariants
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP.vercel.app/api/cron/purge-sessions
```

---

## Still true, and still not fixed by this

- **No limit on failed sign-in attempts.** On a public URL this matters more than
  it did on a laptop.
- **ClamAV is not wired.** Uploads are type-checked by their bytes and capped, and
  the screen says "not scanned" rather than pretending.
- **Every fixture account shares one password.** Delete the fixtures before real
  records go in, or change them.
- **There are no backups here, and there cannot be.** Backups need `pg_dump`, a
  scheduler and a disk to write to, and a serverless function has none of the
  three. The backup container is part of the ordinary deployment below and is
  described in `RESTORE.md`. This is a demonstration and holds nothing but
  invented data, so nothing here is worth backing up. It is worth knowing.

Fixed since this page was first written: `archive_file` and
`document_archive_file` now carry row-level security with three policies each
(migration 0220), so the drawing archive is protected at the database level like
everything else rather than by the route check alone.

---

## Running it the ordinary way instead

Nothing here removes the normal deployment. Leave `FILE_STORAGE` unset and the
bytes go to disk; run `src/jobs.mjs` and the cron endpoints are never used. The
Docker Compose stack in the project root still brings the whole thing up with one
command, and is the better answer for a machine inside the municipality.
