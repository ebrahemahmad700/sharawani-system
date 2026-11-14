# PROGRESS — Rania Municipality Document System

Running log of the build. Newest entries at the bottom of each session.
Everything here is written as work happens, not summarised afterwards.

**Started:** 2026-09-10
**Working from:** `BUILD-PLAN.md` (schema, state machine, endpoints) and `PLAN.md` (scope, architecture).
**Design spec:** the nine approved screens in `design/*.dc.html`. Those are the layout authority. I do not redesign them.

---

## How to read this file

| Mark | Meaning |
|---|---|
| DONE | built and checked |
| WIP | in progress right now |
| TODO | queued |
| BLOCKED | needs an answer from the municipality |
| ADDED | not in the original plan; my addition, flagged so it can be reviewed or reverted |

---

## Decisions taken without asking

These were judgement calls made to keep moving. Each is cheap to reverse. Raise any you disagree with.

| # | Decision | Why | Reversible? |
|---|---|---|---|
| A-1 | **Node with Express, server-rendered HTML** for the backend | `PLAN.md` §7.2 says "whatever the team knows well — .NET, Laravel, or Node". Nobody has told me who the team is. Node runs on this machine already and deploys to the Linux server in the runbook without extra tooling. | Yes, but not cheaply once screens exist. Say now if the team is a .NET or PHP shop. |
| A-2 | **Document number prefixes stay as the plan's assumed defaults** (`ه` incoming, `د` outgoing) | Q4 is still open. The plan already carries these as the assumed default and stores them in `system_setting`, not in code. | Yes. One row update, no migration, no redeploy. |
| A-3 | **Working week Sunday to Thursday** | Q7 open. Regional norm and the plan's assumed default. Stored as a setting. | Yes, one row. |
| A-4 | **Eight rooms seeded from the approved screens** | The real list of 25 to 30 rooms does not exist yet. Rooms are data, so this is a fixture, not a design. | Yes, rooms are created through the admin screen. |
| A-5 | Migrations are **extracted verbatim** from `BUILD-PLAN.md`, not retyped | Keeps the plan and the code identical for review. From here the `.sql` files are the source of truth and the plan is the explanation. | n/a |
| A-6 | **Backups are encrypted and will not run without a passphrase** | A backup is a copy of every letter the municipality holds and its purpose is to leave the building. The alternative was a readable copy of the register on a disk somebody carries. | Not really. The passphrase can be changed, but taking backups in the clear is not offered. |
| A-7 | **Backups are taken as `docsys_owner`**, not the role named `docsys_backup` | `pg_read_all_data` does not bypass row-level security, so that role dumps zero letters. Measured. Granting it BYPASSRLS instead would create a second role able to read every letter, which is a second thing to protect. | Yes, one grant, if you would rather have the separate role. |
| A-8 | **Backups land in `./backups` on the host and stay there** | Getting them off the machine depends on what Rania has: a USB disk, an rsync to the directorate, a share in another office. Guessing would produce a copy job that silently does nothing. | n/a. It is the one manual step and `RESTORE.md` says so plainly. |
| A-9 | **The log hash pins whatever time zone its own database already renders with**, rather than one constant for everybody | UTC would be the better constant, and adopting it changes the recipe, which makes every seal already taken fail verification for ever. Crying wolf on untampered history is the exact failure the seal chain must not have. The municipal server pins Asia/Baghdad; the hosted demonstration pins GMT; each keeps its own history verifiable and carries the setting inside its own dump. | No. It is now part of the definition of the hash. |

---

## Open questions still blocking things

| Q | Question | What it blocks | Severity |
|---|---|---|---|
| Q4 | What does a registered document number actually look like on the paper register? Yearly reset, per-room series, prefix? | The registration transaction. Auditors check these against the paper book. | **High.** Building on the assumed default; wrong guess means a data migration later. |
| Q1 | The real list of rooms: name and door number for the 17 to 22 I do not have | Mayor's dashboard, send dialog, sidebar, seed data | Medium. Engine underneath is unaffected. |
| Q2 | Do rooms group under directorates, or sit flat? | Shape of the mayor's dashboard only | Medium |
| Q7 | Deadlines in working days or calendar days? | Overdue calculations | Low, setting-driven |

---

## Log

### 2026-09-10 — Session 1

**DONE — Project skeleton.**
Created `app/` with `db/migrations`, `src/{routes,lib,views}`, `public`, `test`.

**DONE — Schema extracted into twelve migration files.**
Pulled verbatim from `BUILD-PLAN.md` §2 by script, so no transcription errors. Verified every fence boundary landed correctly, no truncated statements, no stray markdown left in the SQL.

| File | Contents | Lines |
|---|---|---|
| `0000_roles.sql` | Five database roles, extensions, database-level settings | 27 |
| `0001_enums.sql` | 19 enumerated types | 26 |
| `0002_org_users_sessions.sql` | directorate, room, app_user, user_session | 93 |
| `0003_number_issuing.sql` | number_counter and the atomic `issue_number()` | 57 |
| `0004_document.sql` | the document table and its indexes | 97 |
| `0005_routing.sql` | routing_step, the guard trigger, the deferred flow invariant | 134 |
| `0006_routes_attachments_tray.sql` | saved routes, attachments, scan tray | 59 |
| `0007_archive.sql` | the drawing archive for rooms 8 and 9 | 85 |
| `0008_templates_leave_log.sql` | templates, leave, external sends, activity log, settings, assistant | 149 |
| `0009_helper_functions.sql` | the `SECURITY DEFINER` helpers policies call | 73 |
| `0010_rls_grants.sql` | row-level security policies and grants | 69 |
| `0011_seed.sql` | system settings needed to boot | 17 |

Note carried forward from the plan: the helper functions in `0009` are `SECURITY DEFINER` and the tables deliberately do **not** use `FORCE ROW LEVEL SECURITY`. Policies that call functions reading the protected tables hit PostgreSQL's policy-recursion error otherwise. Do not "fix" this.

**DONE — Two additions beyond the plan, both flagged ADDED.**

`0140_search_logging.sql`. The log recorded opening a document but not searching for one, so someone could type a citizen's name into the plot search, read the results and leave no trace. Adds four search action codes, a documented detail shape, and two indexes for the investigation queries. Stores the term but never the rows returned, so IT can still not read letters.

`0150_log_seal.sql` and `0160_log_seal_recompute.sql`. The log is append-only against the application and the owner, which stops every route the system offers but not someone with root. These make tampering detectable. Every row is hashed, a nightly job seals the day into a chain, and altering anything breaks every seal after it. Print the weekly hash and file it on paper and deleting rows no longer hides anything.

**DONE — Node project, dependencies installed.**
`express`, `pg`, `argon2`, `cookie-parser`. 88 packages. Note: node on this machine is 18, the plan targets 20. Nothing used so far needs 20, but the server should run 20.

**DONE — Kurdish text handling, in both languages, proven identical.**
`src/lib/ku.mjs` mirrors the SQL functions: digit folding, the eight normalisation steps, plot keys. Plus `parseNumber`, which the corpus needs but the plan never defined.
`test/ku_corpus.tsv` holds all 46 rows from the plan in a format a non-programmer can add to.

**DONE — Live database. Every migration applied to real PostgreSQL 16.15.**

| | |
|---|---|
| tables | 25 |
| enumerated types | 19 |
| indexes | 92 |
| check constraints | 57 |
| tables with row-level security | 9 |
| security policies | 17 |

**DONE — Three test suites, all passing.**

`test/ku.test.mjs` — 46 corpus rows against the JavaScript. 35 pass, 11 need fixtures. Two of the passes are the known Arabic-versus-Kurdish name gaps, which pass by correctly failing to match.

`test/ku_sql.test.mjs` — the one that matters most. Runs 81 distinct strings through three functions in both languages and compares. **243 comparisons, identical.** If these ever drift, a clerk types a name and the record silently is not found. Nothing errors. It just stops working.

`test/guarantees.test.mjs` — the promises made to an auditor:

- twenty connections issuing numbers at the same instant get 1 to 20, no duplicates, no gaps
- an abandoned registration does not burn a number; a completed one always advances
- the log refuses UPDATE, DELETE and TRUNCATE even for the database owner
- an edited log row breaks verification, naming the row
- a deleted log row breaks verification, naming the count

### Bugs found and fixed

Five in the plan, one my own. This is why the schema was executed rather than trusted.

| # | Bug | Where | Fix |
|---|---|---|---|
| 1 | The schema uses `ku_normalize()` in generated columns, but that function is defined in section 6, three sections later. Nothing would have created it. | plan | Extracted to `0020_text_functions.sql`, before any table |
| 2 | `system_setting` is defined alongside templates and the log, but number formatting and the security helpers read it. | plan | Moved to `0040_system_setting.sql` |
| 3 | A worked example of a registration, with `(...)` and `<id>` placeholders, sits inside a SQL block in the schema section and would have been run as DDL. | plan | Trimmed and kept as commented documentation |
| 4 | `concat_ws()` is STABLE, not IMMUTABLE, so PostgreSQL rejects it in a generated column. The archive search column would never have been created. | plan | Immutable concatenation; normalisation collapses the spacing identically |
| 5 | `schema_migration` is defined in the schema, but the migration runner needs it before the first migration runs. | plan | Runner owns it, in the exact shape the plan specified |
| 6 | My seal design hashed rows on insert and verified by folding those stored hashes. Editing a row left its hash untouched, so verification passed. Deletion was caught; alteration was not. | mine | Hashing moved into one function called by both the trigger and the verifier, so verification recomputes from live content |

Migrations were renumbered in tens so ordering fixes no longer require renaming everything.

**DONE — Development fixtures.** Nine rooms and fifteen staff covering all nine roles, taken from the approved screens. Every name is invented; no real person, plot or letter is anywhere in this repository.

**DONE — Web server running, login working end to end.**
Express with server-rendered HTML. Strict content security policy, no external scripts. Cross-site request forgery tokens derived from the session, so there is no store to keep in step. Sessions carry a random token and only its hash is stored.
Verified against the live database: the login page renders in Kurdish, a good password signs in and sets the cookie, a bad one is refused, the mayor lands on his dashboard route, and both outcomes reach the log with the address they came from. The failure row records the reason and the username, never the password.

**DONE — The routing engine.** `src/lib/routing.mjs`, the heart of the system. Send to one room, send by sequence, receive, complete, return, recall, plus the trail, room inboxes and the overdue report.

**DONE — Registration and search.** `src/lib/documents.mjs`. Register incoming, register outgoing and close, cancel, and the tiered search: exact number ranks above plot number, above containment, above fuzzy.

**DONE — The whole life of a letter, tested against the real database.** `test/routing.test.mjs`, sixty assertions, all passing. Highlights:

- a sequence writes every step at once, first active and the rest waiting, sharing one group, numbered 1 of 3, 2 of 3, 3 of 3
- completing a step promotes the next one and resolves its recipient only then, because who is on leave in three days is not knowable today
- returning a letter mid-sequence cancels the rest, so the trail never shows a journey that will not happen
- an unopened letter can be recalled; once the room opens it, it cannot
- closing issues an outgoing number and leaves the incoming one untouched
- a cancelled letter keeps its number forever, so the auditor finds the cancellation rather than a gap
- the plot number typed in Arabic-Indic digits finds the letter
- a subject word typed on an Arabic keyboard finds the letter typed on a Kurdish one
- every search is logged with both what was typed and what it normalised to

### More bugs found

| # | Bug | Where | Fix |
|---|---|---|---|
| 7 | A room could never be created. The rule that a deputy must not be the head was written so that two nulls counted as equal, so a room with neither was rejected. The admin screen would have failed on first use. | plan | Allow both null; still forbid deputy equal to head |
| 8 | A letter awaiting closure had its room cleared. The schema insists it keeps one, and the schema is right: the paper is on that desk until the registry collects it. | mine | Keep the room, clear only the step |
| 9 | A letter the mayor sent from the registry had no room of origin, so returning it went nowhere. | mine | Fall back to the sender's own room |
| 10 | The return leg at the end of a sequence tried to grow the group it was joining, which meant editing steps already finished. The guard refused, correctly: a trail is a record, not a plan that can be revised. | mine | The leg gets its own group, and reads as the way back rather than a numbered stage |

Two more guard behaviours confirmed working, both of which stopped my own test from cheating: a finished step cannot be edited at all, and a deadline on an active step cannot be moved. A deadline that can be edited is not a deadline.

### 2026-09-10 — Session 1, continued (Fable 5.1 from this point)

**DONE — Every screen, wired and tested as every role.**
Login, mayor's dashboard, rooms overview, activity log viewer, registry (register in, register out), inbox, document with trail and actions, route (single and sequence), outgoing register, drawing archive, leave, administration (users, rooms), plus the maintenance lock. Each route file names the design screen it implements.

**DONE — Real file upload.** `src/lib/files.mjs`. The type is decided by looking at the bytes, never the extension: a PDF renamed to `.dwg` is stored as a PDF, an executable is refused before a byte is written. Hard size cap enforced while streaming. Stored path is a uuid under a month directory; the user's filename is a column, never a path. SHA-256 computed as the bytes pass. A virus-scan hook that returns `skipped` until ClamAV is wired, and the screen shows "not scanned" rather than pretending.

**DONE — The drawing archive is a real archive.** I had first built it as "record now, file later" and the schema refused, correctly: a record *is* a file with a hash, and the person who verifies a drawing on the shelf must be a different person from the one who uploaded it, and a DWG cannot be verified until a PDF sits beside it because a browser cannot show a DWG. All three rules now hold and are tested.

**DONE — Scanned pages on a letter.** The original scan, the handwritten reply on the back, an attached letter, the outgoing copy. Attached to the step the room holds, so the trail knows which stage each page belongs to. IT gets a 404 on every one of them.

**DONE — The print sheet.** Paper is the workflow. One page: number, subject, sender, where the paper copy lives, the trail so far, and a dashed box for the next hand to write in. No sidebar, no buttons, prints on load, logged.

**DONE — The assistant, free layer.** `src/lib/assistant.mjs`. The plan's rules layer: five question shapes matched by pattern, answered from the eight tool functions on the read-only role, phrased in Kurdish from templates. Where is letter N; what is waiting in room X; which rooms are late; who is on leave; how many letters today or this month. Anything else gets an honest "I did not understand, here is what I can answer" and a link to search. Every question, tool call, answer and fallback is logged. The model backend plugs in behind the same function when the week-24 bake-off picks one; until then nothing leaves the building.

**DONE — Jobs process.** `src/jobs.mjs` on the jobs role: nightly seal and verify of the log chain, the four state-machine invariants, hourly session purge. Each prints the weekly seal hash for the paper printout. Leave rollover was dropped: delegations carry dates and routing checks them at send time, so there is nothing to roll over.

**DONE — README** with the exact commands to run it from nothing.

### Test totals at the end of the session

| Suite | What it proves | Result |
|---|---|---|
| `ku.test.mjs` | the 46-row corpus against the JavaScript normaliser | 35 pass, 11 need fixtures, 0 fail |
| `ku_sql.test.mjs` | SQL and JavaScript agree byte for byte | 243 comparisons identical |
| `routing.test.mjs` | the life of a letter against the database | 59 pass |
| `guarantees.test.mjs` | numbering, append-only log, tamper detection | all hold |
| `http.test.mjs` | the whole flow over HTTP, security policies live | 29 pass |
| `screens.test.mjs` | every screen as every role, uploads, leave cover, lock | 99 pass |
| `features.test.mjs` | print, attachments, the assistant | 24 pass |

### Bugs found in this part

| # | Bug | Where | Fix |
|---|---|---|---|
| 11 | The read-only role is set to read-only transactions by default, and the same plan grants that role INSERT on the log and conversation tables so the assistant's questions are logged. The two contradict; every question failed with "cannot execute INSERT in a read-only transaction". | plan | The transaction is opened read-write; the grants are the real boundary and they allow exactly three tables |
| 12 | The multipart parser decodes filenames as Latin-1 by default. Every Kurdish filename was stored as mojibake, silently. | mine | Decode as UTF-8 |
| 13 | Fuzzy archive search compared the query against the whole search blob. A two-word owner name with its vowels dropped scored 0.235 against a 0.25 threshold, and 0.053 against the blob. Measured, not guessed. | mine | Word similarity against the name columns, threshold 0.3, measured at 0.333 |
| 14 | The assistant's patterns were written in ordinary Kurdish, but the question is normalised first, so ڕ and ێ never matched. Then my fix normalised the whole pattern and the normaliser's lower-casing turned `\S` into `\s`. | mine | Normalise only the Kurdish runs inside a pattern |
| 15 | An error thrown inside an async handler's own catch block killed the process. | mine | Fixed the scoping; added process-level guards so one bad handler can never sign out the building |
| 16 | The invariants job read an unnamed column and compared NaN to zero. | mine | Alias the column |
| 17 | Role refusals called a template engine that does not exist, so every 403 was a 500. | mine | A real refusal page |
| 18 | The numeric `:id` route was declared before `/archive/new`, so "new" was parsed as an id. | mine | Digit-constrained id routes |

### What is NOT built, honestly

- **Form templates** (the HR forms on screen 8). The route redirects to leave. The `template` and `template_fill` tables exist.
- **The scan tray** (network scanner to folder to one-click attach). Attachments are uploaded from the document page instead. The `scan_tray_item` table exists.
- **External sends** by email or WhatsApp. The `external_send` table and its queue exist; no transport is wired, and the confidentiality discussion earlier argues for a policy decision before one is.
- **ClamAV.** The hook exists and reports `skipped`; the screen shows it.
- **DWG to PDF conversion.** Version one requires the PDF alongside, as the plan chose.
- **Kurdish alphabetical sorting.** Lists sort in root collation. The research found no Kurdish collation exists in the international locale data; the fix is a sort key column, not yet done.
- **The model backend** for the assistant. Deliberately left for the measured bake-off.
- **Directorate views** beyond a redirect, pending Q2.
- **The real room list**, pending Q1. Nine rooms are seeded.

### Model note

The user asked for Fable 5.1 for ten minutes and then a switch back to Opus 5. I cannot change my own model; the switch needs the model command run again.

### Where things are running now

- PostgreSQL 16 in Docker as `docsys-pg` on port 55432, password `devpw`, database `docsys`, fixtures loaded.
- The web server on http://localhost:3111 with all fixture accounts, password `guhare-2026`.
- Uploaded test files under `app/files/`.

### 2026-09-10 — ACCESS.md added

Every credential, port, role, environment variable, start command and known
security gap gathered into `ACCESS.md` at the project root, read out of the
running system rather than from memory. Development credentials only; the last
section lists what must change before a real record is entered.

### 2026-09-10 — Packaged to run anywhere, and why not Vercel

A Vercel deployment was asked for and is not possible. Two blockers are
architectural, not configuration. Uploads are written to disk and Vercel's
filesystem is wiped between requests, so every scan and drawing would vanish.
And `0000_roles.sql` creates five roles with different privileges, one of them
BYPASSRLS, which needs superuser; managed serverless Postgres does not grant it,
so the role separation that stops IT reading letters cannot be built there. A
deployment would have looked like it worked and failed the tester silently.

Packaged with Docker Compose instead, which runs on any host that runs
containers: a laptop, a VPS, Railway, Render, Fly.

**Added.** `app/Dockerfile` two-stage, no compiler in the runtime image.
`app/docker-entrypoint.sh` with server, jobs, test and shell commands.
`app/db/docker-init/10-roles.sh`, which runs the roles SQL as superuser on an
empty volume. `docker-compose.yml`, `.env.example`, `.gitignore`,
`HANDOVER.md` for the colleague doing the testing.

The database port is deliberately not published; the app reaches it over the
private compose network.

**Bugs found and fixed doing this.**

| # | Bug | Where | Fix |
|---|---|---|---|
| 19 | The session cookie's Secure flag was tied to `NODE_ENV`. The container image sets `NODE_ENV=production`, so the browser silently dropped the cookie over plain HTTP and login appeared to loop with no error anywhere. | mine | `SECURE_COOKIES` decides it, `NODE_ENV` is only the fallback |
| 20 | `routing.test.mjs` and `guarantees.test.mjs` refuse any database that is not localhost. Inside compose the host is `db`, so the database-backed tests silently stopped after the second suite. | mine | The guard stands, with an explicit `ALLOW_DESTRUCTIVE_TESTS=1` opt-in stated per run |

**Verified, not assumed.** Built and started clean: 18 migrations applied, 9
rooms, 15 users. All five roles created with only `docsys_jobs` holding
BYPASSRLS. Signed in as the mayor over plain HTTP and loaded the dashboard.
Full suite inside the container: 211 passed, 0 failed.

A Vercel API token was pasted into the chat during this session. It is burned and
must be rotated at vercel.com/account/tokens. It was not used.

### 2026-09-10 — The Vercel port

Built and tested. The application now runs on a serverless host without losing
uploads, without losing the nightly seal, and without losing the row-level
security that keeps IT out of the letters. Full guide in DEPLOY-VERCEL.md.

**Correction to the previous entry.** It said the role separation could not be
built on managed Postgres. The BYPASSRLS part is true and needs superuser, but
the jobs can connect as the table owner instead, which bypasses row-level
security for the same reason, and a non-owner application role can be created on
any managed provider. The port was work, not an impossibility, and the earlier
entry overstated it.

**Added.** `src/lib/storage.mjs`, two backends behind one interface: disk as
before, or bytes in the database for hosts with no durable filesystem.
`0190_file_blob.sql` with the table and its policies. `src/lib/jobs-core.mjs`,
the job bodies split out so the daemon and an HTTP caller run identical code.
`src/routes/cron.mjs`, the jobs over HTTP behind a bearer secret.
`api/index.js`, `vercel.json`, `.vercelignore`. `db/setup-hosted.mjs` for role
setup and, more importantly, `--verify`. `test/storage.test.mjs`.

**The file_blob policy is the interesting part.** A blob is readable only when
the attachment or archive_file row pointing at it is readable. Those tables carry
their own policies, so the EXISTS sees exactly what the current user may see.
Measured on the live database: IT sees 0 of 4 letter attachments and the clerk
who uploaded one still reads it back.

**Bugs found and fixed doing this.**

| # | Bug | Where | Fix |
|---|---|---|---|
| 21 | The blob insert used ON CONFLICT DO NOTHING. That makes Postgres apply the SELECT policy to the new row, and that policy needs a parent row which does not exist yet at upload time, so every single upload failed with a row-level security violation. | mine | A plain INSERT. A uuid collision should fail loudly anyway, which is what 'wx' already does on disk |
| 22 | The storage layer read with no actor, so the policy hid every blob from everyone including the clerk who had just uploaded it. Downloads returned 404 with nothing in the log to explain it. | mine | Reads take the actor; both download routes pass req.user |
| 23 | The session cookie's Secure flag was tied to NODE_ENV, so a production build could not be tested over plain HTTP and login appeared to loop with no error. | mine | SECURE_COOKIES decides it, NODE_ENV is only the fallback |
| 24 | setup-hosted.mjs called format() with untyped parameters, which Postgres refuses, then tried ALTER ROLE NOBYPASSRLS which only a superuser may do. | mine | Explicit casts; the superuser-only attributes are verified rather than set, and a refusal is reported rather than swallowed |

**Verified, not assumed.** 219 checks pass on the disk backend and 219 on the
database backend, the two runs differing only in FILE_STORAGE. The cron endpoint
refuses a missing secret and a wrong secret with 404, runs the seal with the
right one, and returns 400 for an unknown job name. The daemon still works after
the refactor. setup-hosted --verify passes all thirteen checks against the live
database.

**Not verified.** No real managed Postgres was involved. Providers differ in
which ALTER ROLE statements they refuse, which is why setup-hosted reports each
refusal instead of guessing, and why --verify exists.

**Found while comparing.** Wano ERP, already on Vercel, uses node-cron at
server.js line 1717 for a daily job. Vercel has no process to run it, so that job
has never fired on the live deployment.

### 2026-09-10 — The assistant gets a model, and three real gaps close

**The assistant is now for the mayor and the deputy mayor only.** It reaches
across every room in the building and it is the one feature that sends anything
outside it, so the audience is the two people who already see everything. Four
other roles were tested and refused.

**It has a model behind it, and it is genuinely useful now.** Groq, tool-calling,
with the rules layer still running first for nothing and offline.

The model was chosen by measurement, not preference. On Kurdish Sorani with real
proper nouns in the data:

| Model | Keeps Kurdish names | Calls tools |
|---|---|---|
| qwen/qwen3.8-27b | both room and person, byte for byte | correct, with arguments |
| openai/gpt-oss-120b | drops person names | correct, omits arguments |
| groq/compound | keeps them | cannot call tools at all |

It chains tools on its own: find_room then room_performance, find_document then
document_trail. Asked for the best restaurant in Rania it says it only knows this
system, rather than inventing one.

What the model can see is worth stating plainly. It never gets the database. It
gets a question and a list of named functions. Every function runs on the
read-only role inside withReadonly(user), so row-level security decides what
comes back and the prompt has no say in it. What does leave the building is the
question and the rows a tool returned. The system_setting row assistant_backend
switches it back to fully offline without a deploy.

**Failed sign-ins are now throttled.** Counted from the activity log, which was
already recording every failure, so there is no second table to fall out of step.
Two limits with different thresholds: per account it tightens quickly and expires
quickly, per address it stays loose because thirty people behind one office
router share an address and a tight limit there would lock out the building.
Measured: refused on the sixth attempt, and the mayor still signed in normally
while another account was being guessed at.

**The drawing archive now has row-level security.** It had only the route check.
Letters were protected at two levels from the start; drawings at one. This
mattered more once file bytes moved into the database.

**Kurdish alphabetical sorting works.** No Kurdish collation exists in the
international locale data, so the order is built by hand: each of the
thirty-three letters maps to one character, and one translate call gives a key
that can be indexed. Unlike ku_normalize it keeps ڕ, ڵ, ۆ and ێ distinct, because
folding is right for searching and wrong for sorting.

**Bugs found and fixed.**

| # | Bug | Where | Fix |
|---|---|---|---|
| 25 | The assistant never worked at all beyond the first question: it writes last_message_at on every answer and the read-only role was granted INSERT and SELECT on that table but never UPDATE. Every question ended in "permission denied". | plan | UPDATE granted on two columns only |
| 26 | The throttle passed req.ip while the log stores the address unwrapped from IPv4-mapped IPv6, so the per-address count would never have matched a single row. | mine | Both use the same clientIp |
| 27 | The forced password change verifies the current password by calling login(), so a throttled user was told their password was wrong. | mine | The throttle reason is passed through and shown |
| 28 | The first Kurdish sort key mapped letters to A-Z then a-g, assuming byte order. The database uses a case-insensitive ICU collation where C and c are equal, so it put ن and ه ahead of ب, the exact bug it was meant to fix. | mine | Digits then lowercase, which order identically under every collation |
| 29 | Two tests asserted the assistant falls back to "I did not understand", which was really asserting the model layer is switched off. | mine | Both now accept either honest answer |

**Verified.** 249 checks pass, up from 219. Both storage backends, the model
layer live, the throttle, and Kurdish order confirmed against the fixture names.

**Still not built, honestly.** Form templates, the scan tray, email and WhatsApp
sending, directorate views. ClamAV and DWG-to-PDF both need a program running
beside the database, which a serverless host cannot provide; on a municipal
server they can be wired, on Vercel they cannot.

### 2026-09-10 — Virus scanning, form templates, the scan tray

Everything on the outstanding list is now built except DWG-to-PDF, which was
dropped by decision rather than left undone: automated conversion of plot
drawings fails in ways nobody checks, so a person exports the PDF and confirms it
is the right drawing.

**Virus scanning works.** clamd's INSTREAM protocol spoken directly over TCP, so
no library. Set CLAMD_HOST and it is live; leave it unset and every file is
labelled "not scanned" rather than assumed clean. A scanner that is down returns
'error', never 'clean', because "we could not check" and "we checked and it is
fine" must never look the same. What happens then is a policy choice: the default
accepts the file and labels it, because a registry that stops accepting scans of
letters when a daemon crashes costs more than the marginal risk of a whitelisted
PDF. CLAM_FAIL_CLOSED=true refuses instead. ClamAV is a compose service behind a
profile, so a first start stays fast and a municipal server turns it on with one
flag. Verified against the real daemon with the standard test file.

**Form templates are built.** Four seeded: leave request, internal memo,
administrative decision, staff notice. A template is HTML with {{field}}
placeholders plus a schema saying what the fields are; filling one in writes a
row and prints a sheet with a signature block. The template's version is copied
onto the fill, so a form printed last year still reads the way it did last year.
Values a clerk types are escaped and can never become markup. Placeholders with no
field behind them are refused at authoring time rather than printing as a gap.

**The scan tray is built,** with two ways in. A watched folder for the municipal
server, where the scanner drops a file and it appears with nobody uploading
anything. An upload form everywhere else. Claiming a scan does not copy it: the
attachment row points at the bytes already stored, so a scanned page exists once.

**Bugs found and fixed.**

| # | Bug | Where | Fix |
|---|---|---|---|
| 30 | Virus scanning could never have worked on the database storage backend. The scan runs before the attachment row exists, so the blob policy hid the bytes from the scanner. Every upload came back 'error', the screen said "not scanned", and it looked exactly like a host with no scanner installed. Nothing would have alerted anyone. | mine | An in-flight read window |
| 31 | The first version of that window let anyone read any parentless blob for an hour. The storage test caught it at once: IT could see ten of eighteen letter attachments. | mine | Scoped to the uploader, five minutes, and only while no parent row exists. Now IT sees 0 of 20 |
| 32 | The inline auto-print script has never run on any print sheet. The Content-Security-Policy is script-src 'self', which blocks inline scripts silently: the page renders, the dialogue never opens, and it looks like the browser being awkward. | mine | An external /print.js, used by both sheets |
| 33 | The per-address sign-in limit of twenty in fifteen minutes was tripped by the test suite itself, which means thirty people behind one office router would trip it on an ordinary Monday. | mine | Raised to a genuine backstop; the per-account limit stays tight, and it is the real defence |
| 34 | The maintenance lock logs a failed sign-in for everyone it refuses, and the throttle counted them. Lock the system, five people try, unlock it, and those five are throttled for something they did not do. | mine | The throttle ignores lock refusals, which carry no information about a password |
| 35 | The tray's letter picker joined to routing_step, so a letter registered a minute ago was not offered. That is exactly the letter whose original scan is being filed. | mine | No join |

**Verified.** 298 checks pass, up from 249. Both storage backends, with the model
assistant live and a real ClamAV daemon running.

**Also confirmed by accident.** An attempt to clear accumulated log rows during
testing was refused by the database, as the owner. The append-only guarantee holds
against the person who owns the tables.

### 2026-09-10 — Live, with a database

https://sharawani01.vercel.app now runs the whole system against a Neon Postgres.
Signing in works, every screen loads, the assistant answers from both layers, all
four forms are listed and the scan tray is reachable.

The database was set up by db/setup-hosted.mjs, then twenty-eight migrations, then
the fixtures. The security verification passes all thirteen checks against the
hosted database: the application role owns no tables and cannot bypass row-level
security, the policies are on where they matter, and the log still has its guard
triggers.

**Bugs found deploying, all in code, none in the plan.**

| # | Bug | Fix |
|---|---|---|
| 36 | Two migrations name docsys_owner in ALTER DEFAULT PRIVILEGES, and a managed provider's owner role has a different name, so the whole migration run stopped at 0120. | setup-hosted creates the named roles so the statements resolve, and grants the running role membership of docsys_owner, without which Postgres refuses to change privileges on its behalf |
| 37 | The trigram similarity threshold could not be set anywhere. ALTER DATABASE is refused by the provider, ALTER ROLE was refused for that parameter, and putting it on the connection string is rejected outright by a pooled connection: "unsupported startup parameter in options". Every sign-in returned 500. | Set per transaction in db.mjs, in the same round trip that sets the actor. Nothing can refuse it and no host needs special handling |
| 38 | The assistant's time budget was 45 seconds inside a 30-second function limit, so a model answer could never finish on Vercel. It came back as the question echoed with no answer. | Function limit raised to 60 seconds, assistant budget lowered to 25 |

**Two things behave differently there, both by necessity.** Virus scanning reports
"not scanned", because a serverless host has nowhere to run the daemon; it works
on the compose stack. The scan tray offers only the upload form, not the watched
folder, for the same reason.

The local system is unchanged and still the better one: files on a disk you
control, a real jobs process, ClamAV, and nothing leaving the building unless the
assistant's model backend is switched on.

### 2026-09-11 — It fits on a phone, and it tells you

Two things were asked for: make every screen work on a phone as an installable
application, and tell people when something reaches them instead of waiting for
them to notice.

**Being told.** A notification table, a bell with a count on it, a card in the
corner when something lands, and a live connection that delivers it. Raised by a
letter arriving, coming back, being finished, being taken back, a folder being
signed for, a note written, a delivery list moving, a leave request and its
answer, and a delegation starting. A morning job says what is due tomorrow and
what is late, once each and never twice: a bell that cries wolf gets turned off,
and then the one that mattered is missed too.

Three decisions worth recording.

*The list is private with no exception.* The policy is `user_id = app_user_id()`
and there is nothing else in it. Not the mayor, not IT. What has been drawn to
your attention is not a thing other people get to read.

*A notification carries ids, never letter text.* The subject on screen comes from
joining to the document at the moment you look, under the same rule that governs
the letter, so losing access to a letter silently stops its subject appearing in
your old notifications. A copied string would not do that. A CHECK constraint
refuses the usual mistakes at the database, mirroring FORBIDDEN_DETAIL_KEYS in
lib/log.mjs, so it holds for call sites written after everyone has forgotten why.

*Live means live, on both kinds of host.* One dedicated connection runs
LISTEN docsys_notify and a waiting request wakes in under a second; measured at
591 ms locally. Where LISTEN cannot work — serverless, or a pooled connection at
a managed provider, where it connects, accepts the command and then delivers
nothing — it falls back to asking every two and a half seconds. Measured at
2676 ms on Vercel. Detected rather than assumed, and it falls back for good the
moment LISTEN misbehaves.

**Web push carries no payload, ever.** A normal push hands an encrypted message
to Google or Apple to deliver. The ciphertext is opaque to them but its
existence, timing and size are not, and the arrangement routes Rania metadata
through a third party abroad. So this sends a doorbell with an empty body: the
service worker wakes, asks this server over the browser's own authenticated
connection how many things are waiting, and shows a number. The happy side
effect is that a payload-less push needs only a signed VAPID token, which is one
ES256 JWT and about eighty lines, with no encryption to get subtly wrong.

**The service worker caches four files and one page.** Nothing else, ever. A
cache is a database on the machine that survives sign-out and the browser
closing; caching pages "for offline" would put the mayor's correspondence on the
disk of whichever shared workstation last opened it, where row-level security
cannot reach. Offline shows a notice and nothing.

**On a phone.** The sidebar becomes a drawer — a checkbox and CSS, so it opens
with scripting off — the four number cards stack, and a wide register scrolls
sideways rather than squeezing eight columns into a thumb's width. Nothing is
hidden on the small screen that is visible on the large one. The icons are drawn
in code from the palette in app.css, because a binary in a repository is a file
nobody can review.

**Bugs found while building this, all pre-existing.**

| # | Bug | Fix |
|---|---|---|
| 39 | The sign-out button posted no CSRF token, so signing out returned "request refused" on every screen in the application. The form is rendered by the page shell, which had no way to reach the token. | The middleware puts it on `req.user`, which is a per-request object, and the shell reads it there |
| 40 | The room switcher used an inline `onchange`, which `script-src 'self'` refuses silently. With scripting on, the `<noscript>` button is hidden and the blocked handler never fires, so choosing a room did nothing at all. | `data-auto-submit`, wired by app.js |
| 41 | A room inbox stops at a hundred letters and said nothing about the rest, so in a room that far behind the most recent arrivals were invisible on the one screen meant to show what the room owes. | It says how many are not shown and offers to show them all |
| 42 | Sending a finished letter back to the room that finished it reached the database and came back as a constraint violation and a 500. A finished letter stays assigned to that room, correctly, because the paper is on that desk. | Refused in the routing function with the same message the active-step case already used |

Two new test files, 485 checks passing on both storage backends, and two new
guarantees: a notification cannot be made to carry letter text, and only its
recipient can read it. The PWA test checks the things that actually break — icon
sizes against what the manifest claims, the viewport tag on every screen, every
table inside something that scrolls, and the service worker's allowlist holding
no page.

### 2026-09-11 — Four things that are worth looking at

Asked for the four features from the list: a corridor wall board, search inside
scans, QR codes on printed paper, and registering a letter by photographing it.
All four are built, tested and deployed.

**The wall board.** A television outside the mayor's office showing the day's
figures, a tile per room, and a line for each event as it happens. It reaches
exactly one database function, `board_snapshot()`, which returns counts, room
names and letter numbers and has no way to return a subject, a sender or
anybody's name. That is the whole security model and it is deliberately in the
database: a corridor screen is read by whoever walks past, including the people
whose letters are in it. The test tries to get a subject out of the page, out of
the data behind it and out of the live stream, and fails on all three.

Rooms are ordered busiest first and quiet ones fade back, because a wall board
gets about two seconds of somebody's attention and alphabetical order wastes it.
Arabic-Indic zero is a dot, and a grid of dots at that size reads as damage, so
an empty room steps back rather than showing a large ٠.

**Reading scans.** tesseract and poppler in the image, a job every two minutes,
and a button for a clerk who wants it now. Text goes in `attachment_text` with
the attachment's own row-level security, so if you cannot open the scan you
cannot search what is written in it, IT included.

The one real discovery: **tesseract has no Central Kurdish model and never has
had one.** Its Arabic *language* model has never seen ژ, پ, چ, گ, ڕ or ێ, so it
substitutes the nearest Arabic letter and ژمارە comes back as زماره, which no
amount of normalising recovers. Its Arabic *script* model, trained on
letterforms rather than on a language, reads all of them: on the same test page
the language model scored 64% and produced nonsense in the number line, the
script model produced the line correctly. The script model is downloaded at
build time, pinned to the 4.1.0 tag.

Even the script model gets a letter wrong here and there, so the search matches
by word similarity as well as containment. Most of what it misreads, the
project's existing Kurdish normaliser already folds back together, which is a
piece of luck worth recording: ه against ە and ي against ی are exactly the
substitutions it makes.

**QR codes.** A library rather than hand-rolled, and the reasoning is the
opposite of the barcode's. Code 39 is eleven rows and a check digit and a wrong
table is visible by eye. QR is Reed-Solomon over GF(256), eight masks scored
against four penalty rules, format bits with their own BCH code and a placement
spiral, and every one of those can be wrong in a way that still draws a
convincing square no phone will read. So: a pinned zero-dependency library, and a
decoder written from the specification in the test that reads the payload back
out of the SVG. That decoder found two real faults in itself before it found
none in the encoder: the format bits were read in the wrong order, and the data
blocks were not de-interleaved, which produced "kcxud}du`~s" for "https://docsys"
and looked like a masking bug for some time.

The PIN travels in the URL fragment, which a browser never sends to a server, so
scanning a receipt does not put a tracking PIN in an access log.

**Photographing a letter.** The camera screen files the photograph in the scan
tray, reads it, guesses the reference, date, subject, plot and neighbourhood from
the markers a letter in this region actually carries (ژمارە, بەروار, بابەت, م/,
پارچە, گەڕەک and their Arabic twins), and hands back the registration form filled
in. Registering claims the photograph onto the letter, so one action registers
and files.

Every value is labelled a suggestion and shown next to the line it came from.
That is the opposite of the rule everywhere else in this system, where something
that might be wrong is refused, and it is deliberate: the clerk is looking at the
paper anyway, and a guess shown beside its evidence is confirmable at a glance.
An ambiguous date is left empty rather than guessed.

**Bugs found and fixed while building.**

| # | Bug | Fix |
|---|---|---|
| 43 | The field extractor tried its markers in list order, so گەڕەک matched before گەڕەکی and the neighbourhood came out as "ی سەرچنار" with the stranded letter attached | markers are sorted longest first before any is tried |
| 44 | The first test of the reader drew its own bitmap font and got "FANLTE «ERODE" back, which measured the font rather than the system | the test page is a PDF with an embedded standard font, which also exercises the pdftoppm branch that every real scan goes through |

592 checks passing on both storage backends, guarantees holding, and the guide
is thirteen pages.

---

### 2026-09-11 — Backup, and a restore that is actually rehearsed

Before today there was no backup. No dump script, no restore path, nothing
scheduled. A municipality's incoming register is a legal record it must be able
to produce years later, and one failed disk would have ended it.

There is now a `backup` container, a nightly dump, a weekly rehearsal that proves
the newest backup restores, and `RESTORE.md`.

**The shape.** Three files a night sharing a name: the database, the scans, and a
plain-text manifest. The manifest is readable without the passphrase on purpose,
because knowing what backups exist and how large they are is something an
operator must be able to do without unlocking anything. It carries counts, sizes,
hashes, the migration state, how the database was created, and the last seal
hash. It carries no subject, no name and no letter text, and there is a test for
that.

**Encryption is not optional.** A backup is a copy of every letter the
municipality holds and its whole purpose is to leave the building. AES-256-GCM,
key from scrypt, header authenticated as additional data, and the plaintext never
touches a disk: pg_dump goes through a pipe straight into the cipher. Without a
passphrase the container takes nothing and complains once an hour, which is
deliberate: refusing outright would crash-loop and bury the sentence explaining
why, and writing an unencrypted copy would be the leak we are trying to prevent.
The format is specified in the file header so anybody can decrypt a backup in
twenty lines of Python without this repository, because a backup whose only
reader is one file in one repository has a single point of failure and it is the
same one it was meant to protect against.

**No npm dependencies at all.** The backup tooling uses psql, pg_dump, pg_restore
and node's standard library, nothing else. Everything else here can afford a
dependency tree; backup is the thing that has to work on the day node_modules is
half-written. It gets its own image, built FROM postgres:16 with the node binary
copied in, so the client tools match the server by construction rather than by
luck: bookworm ships the PostgreSQL 15 client and pg_dump refuses a server newer
than itself.

**The role named backup cannot be used.** `docsys_backup` is a member of
`pg_read_all_data`, which grants SELECT on everything and does **not** bypass
row-level security. Measured, not assumed:

```
docsys_owner  -> SELECT count(*) FROM document  ->  286
docsys_backup -> SELECT count(*) FROM document  ->    0
```

pg_dump through it stops with an error, which is survivable because it is loud.
The danger is the flag anybody would reach for next: `--enable-row-security`
makes it succeed and produces a backup with no letters in it, of an entirely
plausible size, that restores without a single error. So backups are taken as the
owner, and the tool refuses any connection that cannot see the rows before a byte
is written.

#### What the rehearsal found

This is the part worth reading. The rehearsal restores the newest backup into a
scratch database with a random name, asks it twenty-seven questions, and drops
it. Writing it found four real defects, three of which had been in the system for
weeks, and none of which any existing test could see.

**1. The database could not be restored from its own dump.** pg_dump begins every
dump by setting the search path to nothing, correctly, so that a restore does not
depend on whoever is running it. But our own functions call each other
unqualified. `plot_key` calls `fold_digits`, the planner inlines it while
creating the generated column on `archive_file`, and:

```
ERROR: function fold_digits(text) does not exist
CONTEXT: SQL function "plot_key" during inlining
```

`ku_normalize` has the same call and is plpgsql, so it would have failed later
still, during the data load, in the middle of a restore somebody was relying on.
Migration 0430 pins the search path on all 24 functions that lacked one. Every
SECURITY DEFINER function already had one, which was not luck because the build
plan requires it, but nothing was checking the ordinary ones and they needed it
for an entirely different reason.

**2. The activity log's tamper-evidence chain was not deterministic.** The
restored copy reported that the log had been altered. Nothing had been. The row
hash includes the timestamp cast to text, and that cast renders in the session's
time zone and date style:

| setting | hash |
|---|---|
| TimeZone Asia/Baghdad | a929f99b3dfe601c… |
| TimeZone UTC | 8a95683d31030224… |
| DateStyle SQL, DMY | 91231792966c76cf… |

The trigger is ENABLE ALWAYS, so it fires again for every row pg_restore loads
and recomputes each hash from the restored values. Restore into a database whose
time zone is not Asia/Baghdad and every seal fails. For a feature whose only job
is to be believed on the day somebody claims a letter was never registered,
crying wolf after an ordinary restore is the worst available failure. Migration
0440 pins the time zone and date style onto the hash function itself, and proves
it by recomputing a real row under deliberately wrong settings and comparing.
Asia/Baghdad rather than UTC, because UTC would be a different recipe and would
invalidate every seal already taken. That constant is now part of the definition
of the hash and must not follow the municipality's clock if it ever moves.

**3. A restore as the owner stopped part way with "permission denied to set
parameter".** pg_dump --create writes the per-database settings into the archive,
including the trigram similarity threshold. A setting belonging to an extension
is an unrecognised name to any session that has not loaded that extension, and
only a superuser may set an unrecognised name on a database. With --exit-on-error
the whole restore stops there. Fixed with one grant in `0000_roles.sql`. The
alternative was restoring as the postgres superuser, which is a much larger thing
to hand to whoever is on duty at three in the morning.

**4. The application would not start against a restored database.** The
entrypoint runs the fixture loader, the fixture loader correctly refuses a
database it cannot prove is disposable, it exits non-zero, and `set -e` stops the
web server ever starting. The database came back perfectly and the system did not
come up. Fixtures are now never fatal.

Two more were mine, found the same way, and worth recording because both are
invisible:

**5. A stream reader that starts late gets nothing.** The encryptor derives its
key first, which is a tenth of a second of scrypt, and by the time it looked at
the child's output the child had exited and node had destroyed the stream,
buffered contents and all. No error, exit code zero.

```
reader attached immediately   tar -czf - /srv/files  ->  19,943 bytes
reader attached after scrypt  the same command       ->           0
```

The first backup written had a scans archive of 20 bytes next to a manifest
confidently claiming 290 files.

**6. Then the opposite, feeding a child process.** A PassThrough piped into
pg_restore's input, written by stream.pipeline: pipeline ends and then destroys
its destination, and destroying a PassThrough tears the readable side down
instead of flushing it, so the end never reaches the child and pg_restore waited
for input that had already been delivered, for ever. Producers now write into the
child's input stream directly.

#### What it checks

Row counts per table against the manifest, exactly; that the letters are in it
and not just the shape of them; that row-level security came back on all 23
tables with all 53 policies and all 17 filtering functions; that the ICU locale,
the encoding and the trigram threshold travelled, read out of the archive itself
rather than out of the manifest; that the seal chain comes back exactly as it
stands; the state-machine invariants; the newest letter; and that a sample of
scans is byte for byte what the database says, whichever backend holds the bytes.
That last one needed splitting by storage, because a machine that has been run
both ways holds some of each, and checking only the tar failed five scans that
were never meant to be in it.

Retention keeps a daily, weekly and monthly ladder and never deletes two things
whatever the settings say: the newest backup, and the newest one that has passed
a rehearsal. Fourteen backups nobody has ever restored are worth less than one
somebody has.

#### Two more, found while applying the fix

**The hosted database made the fix wrong.** Migration 0440 first pinned
Asia/Baghdad, because that is what the municipal server is set to. Applied to the
hosted demonstration database it failed on its own check, before changing
anything, saying that the seal chain would break:

```
0440: recomputing a log row hash under different session settings gave a
different answer (339d7760… vs c1ba08f8…). The seal chain would break on restore.
```

| | renders timestamps as |
|---|---|
| the municipal server | Asia/Baghdad / ISO, MDY |
| the hosted demonstration | GMT / ISO, MDY |

Rows already in a log were hashed under whatever their own database renders with,
so pinning anything else rewrites the recipe and invalidates every seal ever
taken there. Each database now pins what it was already using, read at migration
time. The value is baked into the function definition and travels inside the
dump, so a restored copy keeps verifying wherever it lands. The check that caught
this was written on the assumption it would never fire.

**One flaky check was hiding thirty-one others.** The reader test searches for the
exact token printed on its test page, and tesseract puts a stroke through a digit
perhaps one run in ten: `Zewar9702` comes back as `Zewar9/02`, the letter is in
the archive under that spelling, the search for the printed form finds nothing,
and the test reports a broken feature that is working exactly as designed. It now
searches for what the reader actually read, which is what the promise is about.

Worse than the flake was what it revealed: `set -e` in the test entrypoint meant
the first failing file ended the run, so `photo.test.mjs` never ran at all and
the totals read 559 rather than "interrupted at 561 of 592". Every file is now
run, failures are collected, and the names are printed at the end.

#### The drill

Done by hand, once, properly: a bare postgres:16 carrying nothing but the five
roles, a restore into it, the application started against it, then the front
door, screens, features and guarantees test files run against the result. All
passed, row-level security included. The ICU locale, the trigram threshold, the
time zone, 53 policies, 286 documents and working Kurdish normalisation all came
back.

#### Totals

592 checks passing as before, plus 37 new ones in `test/backup.test.mjs`, which
runs in the backup container because pg_dump is deliberately not in the
application one. That test runs the rehearsal as a subprocess rather than
reimplementing it, so what is tested is the tool the municipality will actually
run on a Sunday.

**Still not done:** getting the backup directory out of the building. That is a
USB disk or an rsync, it depends on what Rania has, and `RESTORE.md` says so in
the plainest words in the document.

---

### 2026-09-12 — Four things the office actually does

Asked for functionality rather than plumbing, and all four of the candidates I
put up were wanted. None of them needed a schema change, which is worth saying
because it was not a constraint I was given: the columns were already there and
what was missing was the screens that use them.

**The plot file.** Type a plot number and get every letter about that piece of
land, every drawing in the archive, every company on any of them, and a run down
the side of what has happened. `247/5`, `٢٤٧/٥`, `247-5` and `247 / 5` all open
one file, because `plot_key` already canonicalised all four and nothing had ever
asked it to. Typing a neighbourhood name lists the plots in it instead.

This is the shape municipal work has and the shape nothing in the system had.
Before it, answering "what about plot 247/5" meant searching letters, then
searching the archive separately, then asking whoever remembered about the
company. The answer existed; it was spread across four screens and one person's
memory.

No filtering of its own, deliberately. Every query runs through `withActor`, so
the page answers as the person asking: a clerk from an unrelated room opens it
and finds it empty, which is correct, and IT cannot open it at all.

**Writing the reply.** The system tracked a letter beautifully and then lost it
at the last step: the reply was typed in Word from a printout of the rooms'
opinions, and half the file lived on somebody's desktop. Now the composer opens
from the letter with those opinions down the side and a draft already assembled
from them.

The order is the office's, not the computer's: write, print, then number. A
number here is consumed for ever, so numbering a draft the mayor sends back for
rewriting would leave a hole in the register nobody could explain to an auditor.
A draft prints on letterhead with the seal circle and signature line and says
twice that it has no number yet. Only the registry, the mayor or his deputy can
issue one; a room head can draft, because they know what it should say.

Once sent, the text is fixed. The paper the citizen holds and the copy in the
system are the same thing or the feature is worse than useless.

The text lives in `document.outgoing_summary`, which already existed, is already
covered by row-level security, already prints on the folder cover and is already
searched. The column was named for a one-line summary and now holds the reply;
renaming it would rewrite five files to say the same thing, and this sentence is
the honest version of that trade.

**"This looks familiar".** Citizens re-submit, and each attempt used to get its
own number and its own file. Now a resemblance stops the registration before a
number is drawn: the same plot, or a similar subject from a similar sender inside
eighteen months, with the panel saying which of those it matched on.

A warning and never a refusal, with three ways forward and none of them "no":
open the earlier letter, register this one as a follow-on (which fills
`related_document_id`, another column that existed and was never written), or
press register again. It is checked on the server when the form is submitted,
which is the one that counts, and again live while the clerk types, which only
moves the warning to while the citizen is still at the counter.

**My day.** Two halves of the eight-in-the-morning question. What is on my desk,
overdue first. And what I am waiting for: the letters I sent to another room that
have never come back, how long ago, and whether the room has even opened them.

That second half is information that existed nowhere. A letter you sent three
weeks ago is not on your desk, so it is not on your inbox, and the only way to
find it was to remember it. It is exactly the letter a citizen is at the counter
asking about.

Chasing deliberately invents no new mechanism. It writes a remark on the letter,
and the room holding it is told, because writing a remark already does that. The
request therefore lands where the next person to open the letter will read it
rather than in a notification read once and gone; it says who asked and when, so
a room that is genuinely blocked has something to answer; and it is already in
the activity log and already delivered by the existing bell. Once a day: a bell
that cries wolf gets turned off.

#### What the tests found

**A hidden button is not a permission.** The chase endpoint checked that the
letter was with another room and never checked who was asking. The button was
hidden for everybody else, which is decoration. The mayor, who can read every
letter in the building, could chase any of them by posting straight at the
address. Now the rule is enforced where the work happens: the person who sent it,
or somebody in the room that sent it, which is the ordinary case when a clerk is
on leave.

**The new check broke nine existing test files.** Every test that registers a
letter registers one that resembles what the last run registered, so the warning
fired and no letter was created. Those tests now pass `confirm_similar`, saying
what they mean: this file is not about that check.

That was tedious and it is the most useful thing that happened today, because it
is a measurement of how often the warning fires on work that is not a duplicate.
It fired constantly on a body of near-identical letters. It should fire rarely on
real ones, and the testing guide now asks specifically for that number: register
twenty genuinely different letters and count the interruptions. A check that
cries wolf is worse than no check, and I would rather hear it from Rania than
discover it after the pilot.

Two sharpenings came out of it. A subject under twelve normalised characters is
not matched on at all, because "وەڵام" and "داواکاری" are subjects and by
resemblance they are every letter in the building. And a cancelled letter is
never offered as the duplicate: its number is kept for the auditor, not held up
as something to look at instead.

**One flaky check was hiding thirty-one others**, found the same afternoon and
fixed in the test entrypoint: every file now runs even when an earlier one fails,
and the names of the failures are printed at the end. Before that, the first
failure ended the run and the totals read like a smaller suite rather than an
interrupted one.

**A test that counts must not count with a fuzzy tool.** The duplicate test first
proved "no second number was issued" by searching for the subject and counting
results. The search is deliberately approximate and answered sixty. It counts off
the plot file now, which is exact.

#### Totals

685 checks passing, up from 592. Ninety-three new ones in four files: `plots`,
`duplicate`, `reply` and `myday`. The responsive test now walks the two new
screens as well, so they are held to the same phone-width rule as everything
else. Guarantees hold; the backup suite still passes and its rehearsal still
restores.

---

### 2026-09-13 — Ten things from the first round of testing

The first report from somebody actually using the demo. Ten items, every one of
them real, and two of them worse than they were described.

**The mouse wheel did nothing on any page.** Reported as "the scroller isn't
working properly". Two lines on `body`, each harmless alone: `overflow-x: hidden`
made body a scroll container that could never scroll, and `overscroll-behavior:
none` told the browser not to pass the scroll on to the page. Found by turning a
real wheel in a real Chrome and measuring `scrollY`: zero on every page. A CSS fix
that sits behind a one-hour cache and a service worker reaches nobody, so the
stylesheet and scripts now carry a fingerprint of their contents on the URL.

**On a phone, half of a letter's page could not be reached.** Found while looking
at the attachments complaint. The one-column grid was `1fr`, which is never
narrower than its widest child, so one row of buttons made the column 547 pixels
on a 390-pixel screen, and the page clipped the rest. The attachments' buttons were
in the half that was cut off. That is very likely what "I can't open the PDF" was
on a phone. It is `minmax(0, 1fr)` now.

**Opening attachments.** The server was never refusing; a room that holds a letter
could always fetch its files. What failed was everything around the file: a table
whose buttons hung off the card, a filename as the only link, and a PDF handed to
whatever the browser does with PDFs, which on a phone is download it somewhere
nobody looks. Every file now has view and download buttons and says which room
attached it, and the view is drawn in the page by PDF.js, served from this server.
A browser test draws a PDF with a black square on it and counts the dark pixels.

**A DWG could not be stored in the drawing archive.** The form called the section
optional and the table required it. The generic error page was the whole message.
The section is required on the form now, everything the table needs is checked and
named first, and a refused upload takes its stored bytes back out, which it did not
before.

**Legal and contracts could not start a letter.** Only the mayor, the deputy and
the registry could insert one. Migration 0450 lets every working role start a
letter from their own room, checked in the database as well as the route. The
number still comes from the one counter, so the register is still one sequence.
`origin_room_id` gives the whole room sight of the letter; it waits in the room's
inbox until someone sends it; a clerk may send a letter their room started.

**A scan from another room appeared in room 9's tray.** A confidentiality problem
reported as a convenience one. The tray was one list for the building. And behind
it a second hole: a scan claimed onto a letter could still be read through its old
tray address by every paper-handling role, whatever the letter's own rules said.
Migration 0460 gives each tray item a room and an uploader, turns on row-level
security for the table, and narrows the blob policy to items still waiting. Existing
rows are given their room from the activity log, which had recorded it all along.

**Rooms 8 and 9 attach DWG to letters.** Decided by room kind, which is data, not
by room numbers in code. DWG is served as a download, because a browser asked to
show one inline shows a blank tab.

**Numbers like 2٤0/4.** A Kurdish keyboard's number row and the keypad give
different digits. Identifiers are now put into one kind as they are typed and when
saved. Which kind depends on the letters around them: a bare plot number takes
0-9, like letter numbers and barcodes; a shelf code like ب٣ keeps ٠-٩. The first
version folded everything to 0-9 and an existing test caught it turning ب٣ into
ب3, which is the same mixture the other way round.

**Removing a chosen file.** A file box has no remove button. Every one now lists
its files with a remove button each, checks size and type on choosing, and on the
tray removes one page of several.

**Two people at once.** On two browsers it always worked; the tests now prove it
in the same second. In one browser it cannot work on any website, since tabs share
a cookie. What was wrong was the silence: the sign-in page bounced straight back to
the first person, and a tab left open as Shilan became Aram without a word. Now the
sign-in page explains and offers to switch, and the stale tab covers itself with a
warning. Signing in over someone's session also ends it properly.

**Scanners.** The request was "add scanner devices to detect the document".
`lib/escl.mjs` drives network scanners over eSCL, the protocol behind AirScan and
Mopria that almost every office model supports: no drivers, the server does the
talking. A scan button on a letter, on the tray and on the new-letter form puts the
pages where it was pressed. Only local-network addresses are accepted, and only
IT, the mayor and the deputy can add one. "Detect" is `lib/detect.mjs`: the reader
looks for a barcode or a letter number on the page and suggests the letter; it
never attaches by itself, because a misread digit is a different letter. A
simulated scanner (`SCANNER_SIMULATOR=1`) lets the flow be tried on the demo and in
the tests; the protocol itself is tested against a fake scanner on a real socket
that answers busy once, sends JPEG pages from a feeder and a full-URL job address.

#### How it was tested

Playwright, driving the Chrome already installed, in `app/e2e/`. Fifteen browser
tests for the parts only a browser can show. They run against the local stack and,
the read-only ones, against the demo.

#### Totals

The HTTP suite, 781 checks, all passing, including 55 in `fixes` (one per reported
behaviour) and 37 in `scanner`. Two older tests were reading the first hundred
letters of the legal room's inbox; a day of repeated runs left 113 open there, and
the newest letter was the one cut off. They read the whole inbox now. Fifteen browser tests passing. Guarantees hold. The
backup suite's 36 checks pass, which includes restoring the database with the three
new migrations from its own dump.

Deployed to the demo with the three migrations applied. The simulated scanner is
added there, and a live scan into the mayor's tray was drawn and archived again.

### 2026-09-13 — A whole-system audit in a real browser, then five testers

A Playwright audit signed in as every account and went through every screen on a
laptop and a phone: 35 problems, all fixed (HANDOVER.md, "Fixed from the browser
audit"). The biggest were pages kept by the browser after signing out, temporary
passwords in the address bar, and letter lists that took two to five seconds for
every ordinary room: the permission check ran once per letter. It now runs once
per screen (migration 0480), 2.2 s to 18 ms, and every account was checked to see
exactly the same rows on every table before and after.

Five testers then each took one part: letters, security, desktop design, phones,
and records. 87 more problems, all but three fixed ("The second round").
The worst were in routing. An old page or a second person could finish the next
room's step, because letter forms carried no step. A room head who did not hold a
letter could take it. Closing from the letter page erased the saved reply.
Recalling after a forward broke the one-active-step rule. Migration 0490 hides a
sequence's waiting rooms until their turn and adds the cancelled/closed
notifications; 0500 lets an approved leave be cancelled.

One regression was caught only by the browser suite: the menu drawer's new focus
trap called `.forEach` on a single element, which stopped every script after it on
every page (file pickers, digit folding, scanner status). Fixed and re-crawled.

#### Totals

HTTP suite 871 checks passing, including `audit` (one check per audit fix).
Guarantees hold. Backup suite passes. Fifteen browser tests pass. Audit journeys
j1–j5: 26 tests pass; the only findings left are two 404s caused by test speed (a
sequence's waiting room opening the letter before its turn, which is now correct,
and a scan preview still loading when the scan was attached). The crawl opened 595
pages as 15 people with no script errors; it found HR offered a scan button the scan
page refused, and a long routing trail making the cover sheet 17px too wide on a
phone. Both fixed and re-crawled.

### 2026-09-13 (evening) — One design, written down

"The design has multiple inconsistencies." Three reviews measured it: one by eye on
the letter screens, one on the records and admin screens, one measuring every
component on 104 pages and listing the outliers. About fifty kinds of difference.

The root cause of the worst of them was the order of the stylesheet: the phone
rules came before the desktop rules for the same elements and lost to them, so on
a phone nothing changed size, and iPhones zoomed in on every field. The rest came
from the same thing being hand-written in each route: 75 distinct inline styles,
five ways to show a count beside a heading, four "not found" pages.

`app/e2e/agents/DESIGN-RULES.md` now decides each of those once. The stylesheet
was reordered (controls first, pieces, phone last) and given classes for every
pattern the routes were writing by hand (card-head, card-sub, cell-sub, attention,
caution, form, inactive, empty compact). Four workers applied the rules to the
routes in parallel, one set of files each. The sign-in page became the approved
two-panel design, and the inbox got its tabs.

Bugs found on the way: inactive transaction types were never dimmed (the style
attribute was escaped); licence expiry counted a timestamp difference, so today
read as expired; the tray's upload message had a misplaced bracket and always said
the pages were merged; a middle dot beside a Kurdish count reads as the zero ٠.

#### Totals

HTTP suite 871 checks passing. Fifteen browser tests pass. Audit journeys: 26
tests pass, with the same two test-speed 404s as before.

### 2026-09-13 (night) — Dates in the system's own order, and the dashboard's two sides

The two things the design pass left. First, **the date boxes**: the browser's own
date box writes the day in the order of the machine's language, so the same field
read «mm/dd/yyyy» on one desk and «dd/mm/yyyy» on another. There is no setting
for that, so the four date fields (leave «لە» and «تا», a company's licence
expiry, a company file's expiry) stopped being the browser's box.

- `dateInput()` in `src/lib/html.mjs` is a text field in ساڵ/مانگ/ڕۆژ, shown as
  ٢٠٢٦/٠٩/١٣ like every date on every screen. `public/app.js` adds a calendar
  (Kurdish month names, the week from Saturday, today ringed in gold, the keyboard
  working right-to-left) and writes whatever was typed back in that form.
- `readDay()` reads the form on the server: either kind of digit, / - or . between,
  eight digits with nothing between, and the paper order ١٣/٩/٢٠٢٦. A day that does
  not exist (٢٠٢٦/٠٢/٣٠) is refused with the format to use. Before, the company form
  answered «هەندێک خانە شێوەیان هەڵەیە» for any of three fields.
- Leave's «تا» cannot be earlier than «لە»: its calendar greys those days and the
  field says so before the form is sent. The server still refuses it on its own.
- The placeholder needed left-to-right marks between its words: in a left-to-right
  field plain «ساڵ/مانگ/ڕۆژ» put ساڵ on the right, over the day's digits.

Second, **the mayor's dashboard**. The activity list was taller than the rooms and
the assistant beside it and left an empty strip under the assistant. The list now
takes the height of that side and scrolls inside itself. The first version moved
the problem across: with the eighty test rooms in the local database the rooms side
was 6,000px and the activity card five-sixths empty. So the list is forty lines,
and the rooms table scrolls inside its card past 560px with its headings held at
the top. On a phone it is one column and both lists are their own length.

One tester, in a real browser, at five desk widths and two phone sizes: every
behaviour held and there were no console errors. It found what is fixed above, plus
a date typed with spaces being cut at twelve characters into a different day,
Escape and the arrow keys not answering in two corners, and the calendar opening
below the fold on a 320px phone. All fixed.

`test/dates.test.mjs` (28 checks) holds the reading, the refusals, the forms and the
dashboard markup, and is in the suite list in `docker-entrypoint.sh`. The rule is in
`app/e2e/agents/DESIGN-RULES.md` section 5: a date is always `dateInput()`.

### 2026-09-13 (late night) — Seven tools for the mayor

Asked for after a list of fourteen ideas: the handwritten instruction, a check for
forged letters, the escalation ladder, the weekly room report, security alerts,
the whole case on one screen, and the map of plots. What each one does for the
people using it is in HANDOVER.md, "Seven tools for the mayor". What is worth
knowing about how they are built:

**هامش (migration 0550, routes/margin.mjs, lib/margin.mjs, public/margin.js).**
- The browser draws the ink and the stamp. It is the only thing in the stack that
  joins Kurdish letters, the same reason every print sheet is printed by the browser.
- Strokes are kept as points relative to the page, so the page can be redrawn at
  any size.
- The server lays the PNG over that page of the PDF with pdf-lib, turning it back
  for pages stored with /Rotate. The tester measured the ink where it was drawn to
  0.2% on plain, 90° and 270° pages.
- The stamped file, the margin_note row, the log row and the send happen in one
  transaction.
- Attachment kind margin_note needed its own migration (0510), because an enum
  value cannot be used in the transaction that adds it.

**Verification (0540, routes/verify.mjs, lib/verify.mjs).**
- Ten characters from a 32-letter alphabet, generated in Node with a cryptographic
  generator; 50 bits.
- Issued inside registerOutgoingAndClose, so every closed letter has one, with a
  savepoint around the insert.
- The public function returns only the outgoing number, date, recipient and
  whether the letter was cancelled. Misses are logged and throttled per address.

**The ladder (0520).**
- A security_invoker view, late_step, computes the rung. Per-type numbers are
  columns on doc_type_option, and the defaults are system_setting rows.
- The existing deadlines job announces each rung once per step, so Vercel's daily
  cron needed no change. The Saturday report bell rides on the same job.

**Security alerts (0530, 0570, 0580).**
- An AFTER INSERT trigger on activity_log runs the rules, so no code path can skip
  them.
- Its body is wrapped so a failure becomes a warning, and a broken rule can never
  stop a sign-in.
- One row per rule, person and hour or day, with a hit count. A seen alert that
  happens again opens again (0570) and names the latest target (0580).
- Refusals were not logged at all before; they are now `access.refused`.

**The map (0560, routes/plotmap.mjs, public/plotmap.js).**
- Leaflet 1.9.4 is vendored under public/vendor/leaflet.
- Rania's streets, water, parks, buildings and place names were downloaded once
  from OpenStreetMap through Overpass and reduced to a 0.9 MB file,
  public/map/rania.json.
- No tiles and no outside requests while in use, other than the fonts every page
  already loads.
- Plot places are staff-given, one row per canonical plot key.

**The report and the case (routes/reports.mjs, routes/case.mjs).** Both are read
live under row-level security. The case is a recursive walk up and down
related_document_id.

**Testing.** One tester went through all seven in Chrome, on a desk and on a
phone, as every role. The bugs it found are fixed:

- the running week counted letters as late before their deadline;
- moving a plot left its outline behind, and redrawing added to it;
- a genuine code typed with Kurdish digits was called forged;
- a repeated alert named its first target;
- two pages printed any ?error= text;
- out-of-range deadline numbers were saved as the default without a word;
- a handful of wording and layout details.

`test/mayor-tools.test.mjs` holds all seven over HTTP. Its ladder part makes a
letter ten days late through the owner connection, and only on a disposable
database. The test is in the suite list.

**Results.**
- Server suite: 988 checks, none failing, including mayor-tools; guarantees hold;
  backup rehearsal passes.
- Browser: e2e 15/15, journeys 18/18, lock-down 8/8.
- Crawl: 15 people, 777 pages, all 200. Its only new findings, the alert
  thresholds without a required mark and three tap targets under 28px (case
  markers, map list buttons, the dashboard alert link), were fixed before
  deploying.
- Demo: migrations 0510–0580 applied on Neon and code deployed. screens + people
  8/8 there. Every new screen opens as the mayor with no console errors.

### 2026-09-30 — What came in beside what went out

A design brief for a "document detail and file comparison view": one screen with the
intake scan and the final stamped scan side by side, the tracking numbers over them
and the audit trail under them. Built as `/documents/:id/compare`, adapted where the
brief and this system disagree:

- **Right and left swap.** The brief puts the first scan on the left. Kurdish reads
  right to left, so what came in is on the right, where the eye starts.
- **No national-identity number.** The brief's header carries one. The register has
  never held one and this screen did not become the reason to start: it shows the
  sender's name, their contact if they gave one, the plot and the barcode.
- **Two tracking numbers, not an invented one.** The letter already has an incoming
  number, an outgoing number and a barcode. They are the header.
- **The stamps are labelled as the register's, not the paper's.** A band over the
  intake scan and under the outgoing one, both starting «لە تۆماردا:». The outgoing
  band also carries the verification code from migration 0540, which is the thing a
  receiver can actually check.
- **The palette stays.** The brief asks for slate and navy; the screens in `design/`
  are the layout authority, so it is the system's green, gold and parchment, with the
  brief's structure and contrast.

Notes on how it is built:

- Which two scans: the earliest scan that is not marked outgoing, and the latest one
  that is (`is_outgoing`, set when the kind «کۆپی دەرچوو» is chosen). Either side can
  be switched by hand, but only to a file of the same letter — `?in=`/`?out=` are
  looked up in that letter's own list, so an id from elsewhere falls back to the
  default rather than being fetched.
- `public/compare.js` rather than the viewer's `viewer.js`: two files are open at
  once in half the width each, so each pane draws one page at a time and keeps its
  own page number and zoom in its own closure.
- Nothing new in the database. The screen reads the register, the steps and the
  attachments under row-level security, like every other read.

`test/compare.test.mjs` holds it over HTTP, including the two empty states and the
file id from another letter. It is in the suite list.

**Results.** 24 checks in `compare.test.mjs`, all passing. Server suite 1008 passing;
the two failures in `routing` and `http` are this machine's test database holding
246 open letters in one room and 376 escalated steps, past the 100 and 50 the inbox
and the late list read — neither test touches anything this change went near.
Browser: e2e 15/15, crawl 807 pages all 200. The crawl found the zoom buttons a few
pixels under the phone tap size; widened here and on the attachment viewer, which
had the same two buttons. Deployed to the demo; no migration was needed.

**Found while checking the demo:** six files uploaded there on 11–13 September are
real personal documents — a named person's recommendation letter (four copies) and a
bank payment receipt. They were on a public site and should never have been. Removed
on the owner's word, together with seventeen orphaned files nothing referenced any
more (about 1 MB, including two more copies of the same letter and four drawings).
The demo now holds two invented demonstration sheets and nothing else.

### 2026-10-03 — The marks on the scan, and where is my paper

Two things the colleague asked for after testing.

**The arrival and dispatch marks (migration 0590, routes/stamp.mjs, public/stamp.js).**
On paper the front desk stamps the letter the moment it arrives, in a corner the
clerk picks, and again when the answer leaves. The scan now takes the same mark.

- The clerk drags the mark where they want it, picks one of three sizes, and
  presses the button; nothing is sent before that.
- The mark is measured as a fraction of the page on screen and drawn at the same
  fraction into a transparent sheet 1600px wide, which the server lays over the
  page with the هامش code (lib/margin.mjs). Dragged to 59%/77% of the page, the
  ink came out inside 62–98% × 72–95% and nowhere else — measured in a browser,
  not asserted.
- The mark carries the number and, for an arrival, the barcode: the stamped paper
  now has on it the number the applicant types into the tracking page. A dispatch
  mark carries the verification code instead.
- A new file every time, the scan underneath untouched; `document_stamp` is the
  index, append-only like `margin_note`.
- A dispatch mark is refused until there is an outgoing number to print.
- The comparison screen prefers a stamped copy for its side, so stamping is also
  how that screen fills up.

**Where is my paper (routes/track.mjs).** The public tracking result led with a
stage word and kept the room in a table at the bottom. The applicant's question is
which room has it, so that is now the first thing on the card, with the date it
last moved; before the first send and after the answer it says so in a sentence
instead of showing nothing. No new data is published: `public_track()` already
returned the room, and still names one only while the letter is with a room.

`test/stamp.test.mjs` holds the marks over HTTP, including the refusal before an
outgoing number exists, IT being refused, and the comparison screen picking up the
stamped copies. It is in the suite list.

**Results.** 18 checks in `stamp.test.mjs`, all passing; the comparison tests still
pass beside them. Server suite 1025 passing, with four failures in `routing`,
`http` and `screens` that are this machine's test database and not the code: 246
open letters in one room past the inbox's 100, 376 escalated steps past the late
list's 50, and five pending leave requests, so the screens test approves somebody
else's leave and the deputy never covers. A clean local database clears all four.
Browser: e2e 15/15, crawl 834 pages all 200 — the only new entry is the radio
buttons on the stamping screen at 22px, the same as every other radio in the
system and inside a full-width label. Deployed; migration 0590 applied on Neon.
Both demo scans are now stamped so the screen shows what it does.

### 2026-10-07 — The map drew over the menu

Reported from a phone with a photograph: open the plot map, open the menu, and the
streets are drawn straight over the open drawer.

Leaflet numbers its own layers from 400 (panes) up to 1000 (controls). Those
numbers are meant to be read against each other inside the map; this page reads
them against everything else, where the drawer is 60 and the top bar 90. So the map
outranked both.

The fix is one rule rather than a bidding war over numbers: `.plot-map` becomes a
stacking context of its own (`position: relative; z-index: 0; isolation: isolate`),
so every number Leaflet uses is resolved inside that box and the box itself sits at
0 in the page.

Checked by asking the browser rather than by eye: at three points down the open
drawer, `document.elementFromPoint` now returns the menu, on the phone and on the
demo. The desktop map is unchanged — seven panes, the canvas, both controls, and a
plot popup still opens over the map's own layers.

### 2026-10-07 — No way back off the wall board

Reported from a phone: open «تابلۆی کار» from the menu and the menu is gone. The
Android back gesture brings it back, but nothing on the page says so.

The board is not a page of the system; it is a document of its own, written for a
television in the corridor that nobody signs in to. That is why it has no menu, and
that part is right. What was missing is that a member of staff who reached it from
the menu was given no way out of it.

So the board now carries one link, «گەڕانەوە», at the start of its header — but only
for a viewer signed in as the mayor, his deputy or IT. A corridor machine, which
holds the board cookie and no session, still gets a screen with nothing on it to
touch: a link on a wall anybody can reach is a door nobody asked for.

Checked both doors on a 390px screen: signed in, the link is 101×44, the browser
agrees it is the top element at that point, there is no sideways overflow, and
tapping it lands on the dashboard with the menu present — on the local stack and on
the demo. With a board token and no session, the page renders its twenty tiles and
zero links. Browser suite 15/15.
