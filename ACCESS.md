# ACCESS — how to get into the system

**Development only.** Every account, name, room, plot and letter named here is
invented. These passwords are for the laptop this was built on. None of them may
ever be used on a machine that real municipal records will live on. See the last
section.

**The short way to run all of it** is `docker compose up --build` from the
project root, after copying `.env.example` to `.env`. That builds the image,
creates the five database roles, applies every migration, loads the fixtures and
starts both the server and the jobs process. Sections 2 to 5 below describe the
hand-built setup that predates it and still works. To hand the system to someone
else for testing, give them [HANDOVER.md](HANDOVER.md).

---

## 1. The web application

| | |
|---|---|
| Address | http://localhost:3111 |
| Password, every account | `guhare-2026` |
| Where that comes from | `FIXTURE_PASSWORD` in `app/db/fixtures.mjs`, line 24 |
| Stored as | argon2id, 64 MiB memory, 3 iterations, 1 thread. The password itself is nowhere in the database |

### The fifteen accounts

| Username | Name | Role | Room | First screen |
|---|---|---|---|---|
| `aram` | ئارام حەمە | mayor | ژووری سەرۆکی شارەوانی | `/dashboard` |
| `nabaz` | نەبەز تۆفیق | deputy_mayor | ژووری سەرۆکی شارەوانی | `/dashboard` |
| `shilan` | شیلان عومەر | registry_clerk | ژووری هات و دەرچوو | `/registry` |
| `ahang` | ئاھەنگ نەوزاد | room_clerk | ژووری هات و دەرچوو | `/inbox` |
| `hemin` | هێمن ڕەشید | room_head | ژووری یاسا | `/inbox` |
| `sakar` | ساکار ئەحمەد | room_clerk | ژووری یاسا | `/inbox` |
| `dler` | دلێر عەلی | room_head | گرێبەستە گشتییەکان ١٤ | `/inbox` |
| `rebwar` | ڕێبوار مستەفا | room_clerk | گرێبەستە گشتییەکان ١٤ | `/inbox` |
| `hersh` | هێرش قادر | room_head | ژووری زەوی و زار | `/inbox` |
| `sozan` | سۆزان مەحمود | room_head | ژووری ژمێریاری | `/inbox` |
| `bafrin` | بەفرین سەلام | hr | ژووری کارگێڕی | `/leave` |
| `shne` | شنە عەبدوڵا | room_clerk | ژووری کارگێڕی | `/inbox` |
| `karwan` | کاروان ئیبراهیم | archive_clerk | نەخشەی بنەڕەتی ٨ | `/archive` |
| `zhyan` | ژیان کەریم | archive_clerk | نەخشەی بنەڕەتی ٩ | `/archive` |
| `itadmin` | بەڕێوەبەری سیستەم | sysadmin | none | `/admin/users` |

Heads and deputies, which is what decides where a letter lands when someone is
away. Aram heads the mayor's room, Nabaz is his deputy. Shilan heads the
registry with Ahang under her. Hemin heads legal, Sakar is his deputy. Dler
heads contracts, Rebwar is his deputy. Bafrin heads administration, Shne is her
deputy. Karwan and Zhyan each head their own archive room. Hersh heads land and
Sozan heads accounts, and neither has a deputy.

### Which account can open which screen

| Screen | Path | Who |
|---|---|---|
| Dashboard | `/dashboard` | mayor, deputy mayor only |
| Rooms overview | `/rooms` | mayor, deputy mayor, directorate head |
| Activity log | `/log` | every signed-in person, filtered by what their role may see |
| Registry | `/registry`, `/registry/new` | any signed-in person, the registry room in practice |
| Inbox | `/inbox` | everyone with a room |
| A document | `/documents/:id` | whoever row-level security allows. IT gets nothing |
| Print sheet | `/documents/:id/print` | same as the document |
| Outgoing register | `/outgoing` | everyone |
| Drawing archive, reading | `/archive` | mayor, deputy, directorate head, room head, room clerk, archive clerk |
| Drawing archive, writing | `/archive/new`, verify, location | archive clerk, mayor, deputy only |
| Leave | `/leave` | everyone. Deciding needs hr, mayor, deputy or directorate head |
| Assistant | `/assistant` | mayor, deputy, directorate head, room head, registry clerk, hr |
| Users and rooms | `/admin/users`, `/admin/rooms` | sysadmin only |
| Lock the system | `/admin/lock` | mayor only |

### Sessions

Twelve hours maximum, thirty minutes idle, both read from `system_setting` and
changeable without a deploy. The cookie holds a random token and only its
SHA-256 is stored, so a stolen database gives nobody a live session. The cookie
is marked Secure only when `NODE_ENV=production`, which is why local HTTP works.

---

## 2. The database

| | |
|---|---|
| Container | `docsys-pg`, postgres:16 |
| Host and port | localhost:55432 |
| Database | `docsys`, UTF-8, ICU root collation, timezone Asia/Baghdad |
| Every role's dev password | `devpw` |

| Role | Password | What it may do |
|---|---|---|
| `docsys_owner` | devpw | Owns every table. Runs migrations and fixtures. Still cannot edit the log |
| `docsys_app` | devpw | The web server. Subject to row-level security, NOBYPASSRLS, 30 second statement timeout |
| `docsys_readonly` | devpw | The assistant. NOBYPASSRLS, 8 second timeout, may INSERT into exactly three logging tables |
| `docsys_jobs` | devpw | The nightly jobs. BYPASSRLS, because sealing the log must see every row |
| `docsys_backup` | devpw | Member of pg_read_all_data. For pg_dump, nothing else |

Connection strings, as the application uses them:

```
postgres://docsys_owner:devpw@localhost:55432/docsys
postgres://docsys_app:devpw@localhost:55432/docsys
postgres://docsys_readonly:devpw@localhost:55432/docsys
postgres://docsys_jobs:devpw@localhost:55432/docsys
```

A psql shell, from Git Bash on Windows. The prefix stops Git Bash rewriting the
arguments into Windows paths:

```
MSYS_NO_PATHCONV=1 docker exec -it docsys-pg psql -U docsys_owner -d docsys
```

---

## 3. Environment variables

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `DATABASE_URL_OWNER` | migrations, fixtures | none, required | |
| `DATABASE_URL_APP` | web server | none, required | |
| `DATABASE_URL_READONLY` | web server, assistant | none, required | |
| `DATABASE_URL_JOBS` | jobs process | none, required | |
| `PORT` | web server | 3000 | this machine runs 3111 |
| `CSRF_SECRET` | web server | a fresh random value each start | set it, or a restart signs everyone out |
| `FILES_DIR` | uploads | `app/files` | |
| `MAX_UPLOAD_BYTES` | uploads | 62914560, that is 60 MiB | a DWG can be large |
| `CLAMD_HOST` | virus scan | unset | while unset every file is marked not scanned, on screen |
| `NODE_ENV` | cookies | unset | set to `production` to mark the session cookie Secure |
| `FIXTURE_PASSWORD` | fixtures | `guhare-2026` | |
| `FIXTURE_FORCE` | fixtures | unset | fixtures refuse to run twice without it |
| `ALLOW_REMOTE_FIXTURES` | fixtures | unset | fixtures refuse any host that is not localhost |

---

## 4. Starting it after a reboot

```
docker start docsys-pg

cd C:\Users\Ibrahim\Desktop\sharawani_system\app
DATABASE_URL_APP=postgres://docsys_app:devpw@localhost:55432/docsys \
DATABASE_URL_READONLY=postgres://docsys_readonly:devpw@localhost:55432/docsys \
CSRF_SECRET=dev-secret PORT=3111 node src/server.mjs
```

The jobs process, in a second terminal, optional:

```
DATABASE_URL_JOBS=postgres://docsys_jobs:devpw@localhost:55432/docsys node src/jobs.mjs
```

Or run one job by hand and watch it print:

```
node src/jobs.mjs seal              # hash the day's log rows into the chain
node src/jobs.mjs verify            # recompute every row hash, report any that moved
node src/jobs.mjs invariants        # the four state-machine rules
node src/jobs.mjs purge-sessions    # delete expired sessions
```

Left to its own schedule the jobs process seals at 23:45, verifies at 23:50,
checks invariants at 02:00, and purges sessions at quarter past every hour.

Stopping the server on Windows, since `pkill` does not exist there:

```
Get-NetTCPConnection -LocalPort 3111 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## 5. Rebuilding from nothing

```
docker rm -f docsys-pg
docker run -d --name docsys-pg -e POSTGRES_PASSWORD=devpw -p 55432:5432 postgres:16
sed 's|<set in /etc/docsys/env>|devpw|g' db/migrations/0000_roles.sql > /tmp/roles.sql
docker cp /tmp/roles.sql docsys-pg:/tmp/roles.sql
MSYS_NO_PATHCONV=1 docker exec docsys-pg psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/roles.sql
DATABASE_URL_OWNER=postgres://docsys_owner:devpw@localhost:55432/docsys node db/migrate.mjs
DATABASE_URL_OWNER=postgres://docsys_owner:devpw@localhost:55432/docsys node db/fixtures.mjs
```

---

## 6. Tests

```
node test/ku.test.mjs           # Kurdish normalisation, no database needed
node test/ku_sql.test.mjs       # the SQL and JavaScript normalisers agree, byte for byte
node test/routing.test.mjs      # the life of a letter, against the database
node test/guarantees.test.mjs   # numbering, append-only log, tamper detection
node test/http.test.mjs         # the whole flow over HTTP, server must be running
node test/screens.test.mjs      # every screen as every role
node test/features.test.mjs     # print sheet, attachments, the assistant
```

`guarantees.test.mjs` empties the development activity log as part of proving
the seal chain. Do not run it against anything you care about.

---

## 7. What is in the database right now

| | |
|---|---|
| Rooms | 9 |
| People | 15 |
| Letters | 25, numbered ه/2026/1 to ه/2026/25 |
| Outgoing numbers issued | 7, ending د/2026/7 |
| Routing steps | 25 |
| Attachments | 16 |
| Archive drawings | 26 |
| Leave records | 10 |
| Activity log rows | 10, ids 66 to 75, the earlier ones cleared by the guarantees test |
| Seal chain | 1 link |

Number formats live in `system_setting`, not in code. Incoming prefix ه, outgoing
prefix د, reset yearly. Change them there once the paper register is finally
read, and every future number follows. Issued numbers never change and are never
reused, including for a cancelled letter.

The system lock is currently off. It was switched on and off during testing by
`aram`, which is why `lock_at` and `lock_by` still carry values.

---

## 8. Before this touches a real record

Everything below is a real gap, not a formality.

- **Change every password.** All five database roles use `devpw`. All fifteen
  accounts share one password. Real accounts get a fresh random temporary
  password each and `must_change_password` set, which the fixtures deliberately
  turn off so testing is quick.
- **Put it behind TLS** and set `NODE_ENV=production`, so the session cookie is
  marked Secure. Over plain HTTP the cookie travels readable.
- **Set `CSRF_SECRET` to a fixed random value** held outside the repository. It
  regenerates on every restart today, which signs everyone out.
- **There is no limit on failed sign-in attempts.** Every failure is logged with
  the attempted username and never the attempted password, but nothing slows an
  attacker down. This needs adding before the system leaves the building's own
  network.
- **ClamAV is not wired.** Uploads are type-sniffed by their bytes and capped in
  size, and the screen honestly says not scanned. Wire `CLAMD_HOST` first.
- **The database port is published to every interface** by that docker run line.
  Bind it to 127.0.0.1 on a real machine.
- **Back up with `docsys_backup`,** and store the weekly seal hash on paper,
  signed. That printed hash is what makes the log tamper-evident to an outsider.
