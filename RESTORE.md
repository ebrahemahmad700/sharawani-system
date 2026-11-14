# Backup and restore — docsys, شارەوانی ڕانیە

This is the page you read on a bad day. It assumes you know nothing about the
rest of the system.

---

## If the register is gone right now

You need three things: the machine (or any machine with Docker), the `backups`
folder, and the backup passphrase. Then:

```bash
cd sharawani_system
docker compose up -d db            # just the database, nothing else yet
docker compose run --rm backup restore latest --force
docker compose up -d               # now everything
```

It asks you to type the word `restore` before it changes anything. It tells you
what it is about to restore first: which day, how many letters, how many scans,
and whether that backup has ever been proved to work.

Then sign in and check the newest letter is the one it named.

**Do not start the application before restoring.** If it starts first it will
create an empty database and you will be restoring over the top of it, which
works but wastes ten minutes you do not have.

---

## What a backup is

Three files a night, sharing a name:

| file | what it is |
|---|---|
| `docsys-2026-09-11-0200-database.dump.enc` | every letter, every movement, the whole activity log |
| `docsys-2026-09-11-0200-files.tar.gz.enc` | every scanned page |
| `docsys-2026-09-11-0200-manifest.json` | a plain-text description: counts, sizes, hashes |

They are in `./backups` next to `docker-compose.yml`, on the host, where you can
see them in a file manager and copy them.

The two `.enc` files are encrypted. The manifest is not, and deliberately so: you
can see what backups you have, how big they are and how many letters are in each,
without unlocking anything. It contains counts and never contents. No subject, no
name, no letter text.

**Getting them out of the building is not automatic and is the most important
thing you will do.** A backup on the same disk as the system protects you from a
mistake and from nothing else. Copy `./backups` onto a USB disk kept in another
office, or set up an automatic copy to a machine in the directorate. Weekly at
the very least. The files are encrypted, so the disk being lost is a nuisance
rather than a disaster.

---

## The passphrase

`BACKUP_PASSPHRASE` in `.env`. Without it the backups cannot be read, by you or
by anybody.

**Write it on paper and put it in the mayor's safe.** A passphrase stored only on
the server is not a passphrase, because the server is the thing that will be gone
on the day you need it.

If it is not set, no backups are taken at all, and the backup container says so
once an hour:

```bash
docker compose logs backup
```

Set one with `openssl rand -base64 32`, put it in `.env`, then
`docker compose up -d backup`.

Changing it later does not re-encrypt the old backups. Keep the old passphrase
until the last backup written with it has been deleted.

---

## Day to day

Backups happen on their own, at 02:00, and are pruned on a ladder: every night
for fourteen days, then one a week for eight weeks, then one a month for a year.
The newest backup is never deleted, and neither is the newest one that has passed
a rehearsal, whatever the settings say.

```bash
docker compose run --rm backup list       # what is in the cupboard
docker compose run --rm backup check      # are the files intact (no passphrase needed)
docker compose run --rm backup now        # take one right now
```

`check` verifies every file against the hash in its manifest. It catches the
commonest real failure, which is a copy that ran out of disk halfway, and it
needs no secret, so anybody can run it any time.

---

## The rehearsal

**A backup nobody has restored is a rumour.** Every Sunday at 03:00 the system
takes the newest backup, restores it into a scratch database with a different
name, and asks it twenty-seven questions:

- does every table have exactly the rows it had
- are the letters in it, or only the shape of them
- is row-level security still on the same tables, with all its policies
- did the ICU locale and the trigram threshold travel, so Kurdish still sorts and
  approximate search still finds a misspelled name
- does the activity log's seal chain still verify
- is the newest letter the one the backup said
- is a sample of scans byte for byte what the database says they are

Then it drops the scratch database and writes the verdict next to the backup and
into the activity log. Run it yourself any time:

```bash
docker compose run --rm backup rehearse
docker compose run --rm backup rehearse docsys-2026-09-11-0200   # a particular one
```

It cannot touch the live register. The database it builds has a random name and
is thrown away.

If it fails, that is not a drill. Read what it says and fix it before you need
the backup rather than afterwards.

One line it may print is worth explaining, because it looks alarming and is not
about the backup:

```
note  the LIVE activity log has 1 failing seal(s), which is not a backup problem
```

That means the seal chain over the activity log does not verify **in the running
system**, and the backup has faithfully reproduced that. On a development machine
it is normal: `guarantees.test.mjs` empties the activity log to prove that
deleting from it is impossible through the application, and the seal covering the
emptied rows can never verify again, because the log and its seals are both
append-only and nobody, including IT, can tidy that up. On the municipality's own
server it would mean something and you should read `PROGRESS.md` on the seal
chain and then ask.

What the rehearsal is actually checking is that the chain comes back from the
backup in exactly the state it went in.

---

## Restoring

### The whole server is gone

Install Docker on the replacement machine, copy the project and the `backups`
folder onto it, put `.env` back (including the passphrase), and:

```bash
docker compose up -d db
docker compose run --rm backup restore latest --force
docker compose up -d
```

This rebuilds the database from scratch with the right encoding, the right ICU
collation, and its settings, then loads everything and unpacks the scans.

This exact drill has been done once by hand: a bare PostgreSQL server carrying
nothing but the five roles, a restore into it, the application started against
it, and then the front-door, screens, features and guarantees test files run
against the result. Every one passed, including all the row-level-security
guarantees. The nightly rehearsal checks the same restore automatically, but in
the existing cluster rather than a new one, so it is worth repeating this drill
on a spare machine once a year.

### The database is damaged but the machine is fine

Stop the application first, so nobody is writing while you work:

```bash
docker compose stop app jobs
docker compose run --rm backup restore latest --force
docker compose up -d app jobs
```

### You only want to look at an old backup

This does not touch the live system at all. It builds a copy beside it:

```bash
docker compose run --rm backup restore docsys-2026-09-11-0200 --into docsys_look
docker compose exec db psql -U docsys_owner -d docsys_look
```

Delete it when you are done:

```bash
docker compose exec db psql -U postgres -c 'DROP DATABASE docsys_look WITH (FORCE)'
```

### Options

| flag | what it does |
|---|---|
| `--force` | replace a database that already exists. Refused without it. |
| `--yes` | do not ask for confirmation. For scripts only. |
| `--into NAME` | restore a copy under another name instead |
| `--no-files` | restore the register now and the scans later |

### Afterwards

1. Start the application. It applies any newer migrations by itself, so a backup
   taken on an older version catches up on the way up.
2. Check the newest letter is the one the restore named.
3. `docker compose run --rm jobs node src/jobs.mjs verify` — confirms the
   activity log still verifies end to end.
4. **Take a fresh backup immediately**, before anybody registers anything. Until
   you do, the backup you restored from is your only copy of this state.

---

## Reading a backup without this software

The format is written down so that you are never dependent on this repository
being available. `app/src/lib/backup-crypt.mjs` has the full specification, and
it is short:

```
offset      bytes   what
0           16      the ASCII magic "DOCSYS-BACKUP-1\n"
16          4       the length of the header, big-endian uint32
20          n       the header, UTF-8 JSON
20 + n      ...     the ciphertext
size - 16   16      the AES-GCM authentication tag
```

The header gives the scrypt parameters and salt, and the cipher and its nonce.
The key is `scrypt(passphrase, salt, N, r, p)`, 32 bytes. The cipher is
AES-256-GCM, and the header bytes are the additional authenticated data. That is
twenty lines of Python and it needs nothing from here.

Once decrypted, the database file is an ordinary PostgreSQL custom-format archive
for `pg_restore`, and the scans file is an ordinary `tar.gz`.

---

## What is NOT in a backup

- **`.env`**, which holds the database passwords, the CSRF secret, the push keys
  and the backup passphrase itself. Keep a copy of it somewhere safe and separate.
  Restoring without it means new secrets, which signs everybody out and stops push
  notifications until the browsers are re-registered.
- **The database roles.** They are created by the database container the first
  time it starts, so a fresh `docker compose up -d db` makes them before you
  restore. This is why the order in this page matters.
- **Anything typed but not saved.** A backup is a moment, not a film. The most
  you can lose is the work between the last backup and the failure, which at
  02:00 nightly is up to one working day. If that is too much, take a second
  backup at midday: set `BACKUP_HOUR` to `2` and add a cron entry on the host
  calling `docker compose run --rm backup now`.

---

## What is deliberately true, and might surprise you

**Backups are taken as `docsys_owner`, not as the role called `docsys_backup`.**
That role exists, is a member of `pg_read_all_data`, and cannot be used. Reading
all data is not the same as bypassing row-level security, and this database has
row-level security on twenty-three tables. Connected as `docsys_backup`,
`SELECT count(*) FROM document` returns **0**. `pg_dump` through it stops with an
error, which is survivable. What is not survivable is the flag people reach for
next: `--enable-row-security` makes it succeed and write a backup containing no
letters at all, which restores perfectly and is empty. The backup tool refuses to
run through any connection that cannot see the rows, so this cannot happen by
accident.

**The backup container holds keys the web server does not.** It has the owner
connection and the passphrase. It is a separate container for that reason: a flaw
in a web page cannot reach either.

**Nothing is ever written unencrypted, not even briefly.** `pg_dump` output goes
through a pipe straight into the cipher. There is no moment when a plaintext copy
of the register exists on a disk.
