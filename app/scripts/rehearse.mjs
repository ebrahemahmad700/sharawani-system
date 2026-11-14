// Prove that the newest backup actually restores.
//
//   node scripts/rehearse.mjs                  the newest backup
//   node scripts/rehearse.mjs docsys-2026-09-11-0200
//   node scripts/rehearse.mjs --keep           leave the rehearsal database behind to poke at
//
// This is the part everybody skips, and it is the only part that proves
// anything. A backup nobody has restored is a rumour. Every failure this guards
// against produces a file of a plausible size that pg_dump was perfectly happy
// to write:
//
//   the dump was taken through a role that row-level security applies to, so it
//   holds the schema and no letters;
//   the ICU locale did not travel, so Kurdish sorts differently and the trigram
//   threshold is back to its default, and search quietly gets worse;
//   the scans are on a disk that was never in the backup at all, so every
//   attachment row points at a file that is not there;
//   the archive was truncated by a copy that ran out of room, three weeks ago;
//   row-level security came back disabled, and the restored system works
//   perfectly except that everybody can read everything.
//
// So the rehearsal restores into a database with a different name, asks it the
// questions above, and throws it away. It cannot touch the live register: it
// never connects to it except to read the counts it is checking against and to
// write down what happened.

import { randomBytes } from 'crypto';
import { createHash } from 'crypto';
import { readFile, writeFile, rm, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  connFrom, query, scalar, exec, listBackups, checkIntegrity, restoreDatabase,
  restoreFiles, countFilesInArchive, archivePreamble, tableCounts, securityShape,
  highWater, human,
} from '../src/lib/backup.mjs';
import { INVARIANTS } from '../src/lib/invariants.mjs';

const argv = process.argv.slice(2);
const keep = argv.includes('--keep');
const wanted = argv.find(a => !a.startsWith('--')) ?? null;

const dir = process.env.BACKUP_DIR || '/srv/backups';
const passphrase = process.env.BACKUP_PASSPHRASE || '';
const url = process.env.DATABASE_URL_OWNER;

if (!url) { console.error('rehearse: DATABASE_URL_OWNER is not set'); process.exit(2); }
if (passphrase.length < 12) { console.error('rehearse: BACKUP_PASSPHRASE is not set'); process.exit(2); }

const live = connFrom(url);

// --- which backup ------------------------------------------------------------

const entries = await listBackups(dir);
if (!entries.length) { console.error(`rehearse: no backups in ${dir}`); process.exit(2); }

const entry = wanted ? entries.find(e => e.prefix === wanted) : entries[0];
if (!entry) { console.error(`rehearse: no backup named ${wanted} in ${dir}`); process.exit(2); }
const manifest = entry.manifest;
if (!manifest) { console.error(`rehearse: ${entry.prefix} has no readable manifest`); process.exit(2); }

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log(`\nrehearsing ${entry.prefix}, taken ${manifest.taken_at}\n`);

// --- 1. the files are the ones the manifest describes ------------------------
//
// First, and without the passphrase, because a truncated copy is the commonest
// way a backup goes bad and there is no point decrypting a file that is short.

console.log('--- the files on disk ---');
const integrity = await checkIntegrity(entry);
for (const a of integrity.artefacts) {
  check(`${a.name} is present, the right size and unaltered`,
    a.present && a.size_ok && a.sha_ok,
    a.present ? (a.size_ok ? (a.sha_ok ? human(a.found_bytes) : 'contents differ from the manifest')
      : `${a.found_bytes} bytes, manifest says ${a.expected_bytes}`) : 'missing');
}

const dumpArtefact = manifest.artefacts.find(a => a.content === 'pgdump-custom');
const filesArtefact = manifest.artefacts.find(a => a.content === 'files-tar-gz');
if (!dumpArtefact) { console.error('rehearse: this backup has no database in it'); process.exit(2); }
const dumpPath = join(dir, dumpArtefact.name);

// --- 2. the database-level commands travelled --------------------------------
//
// Lost silently by any dump taken without --create. The system comes up, every
// letter is there, and Kurdish sorting and approximate search are subtly wrong
// for ever after. Read out of the archive itself, not out of the manifest, since
// the manifest is only a description and the archive is the thing that restores.

console.log('\n--- how the database itself gets rebuilt ---');
let preamble = '';
try { preamble = await archivePreamble({ path: dumpPath, passphrase }); }
catch (e) { check('the archive can be read at all', false, e.message); }

const want = manifest.created_with ?? {};
check('the archive creates the database rather than assuming one',
  /CREATE DATABASE/i.test(preamble));
check('with the encoding it was built with',
  new RegExp(`ENCODING\\s*=?\\s*'${want.encoding ?? 'UTF8'}'`, 'i').test(preamble), want.encoding);
if (want.locale_provider === 'i') {
  check('with the ICU collation provider, which is what orders Kurdish',
    /LOCALE_PROVIDER\s*=?\s*icu/i.test(preamble));
  check(`with the ICU locale ${want.icu_locale}`,
    want.icu_locale ? preamble.includes(want.icu_locale) : false, want.icu_locale ?? 'none recorded');
}
// pg_dump writes these as  ALTER DATABASE docsys SET "TimeZone" TO 'Asia/Baghdad';
// with the setting name quoted and TO rather than =, which is not the shape
// pg_settings reports it in. Both forms are accepted rather than assuming one.
for (const setting of want.settings ?? []) {
  const [key, ...rest] = setting.split('=');
  const name = key.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = rest.join('=').trim();
  const line = new RegExp(`ALTER DATABASE\\s+\\S+\\s+SET\\s+"?${name}"?\\s*(?:TO|=)\\s*'?${
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'?`, 'i');
  check(`the database setting ${setting} travelled`, line.test(preamble));
}

// --- 3. restore it into a database that is not the live one ------------------

const scratch = `docsys_rehearsal_${randomBytes(4).toString('hex')}`;
const admin = connFrom(url, { database: 'postgres' });
const scratchConn = connFrom(url, { database: scratch });

const canCreate = await scalar(admin, `SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname = current_user`);
if (canCreate !== 't') {
  console.error(
    `\nrehearse: ${live.user} may not create a database, so there is nowhere to restore into.\n` +
    `          Grant it once, as the superuser:\n\n` +
    `            docker compose exec db psql -U postgres -c 'ALTER ROLE ${live.user} CREATEDB'\n`);
  process.exit(2);
}

// Built exactly as db/migrations/0000_roles.sql builds the real one. TEMPLATE
// template0 is required whenever the locale differs from the cluster default,
// which for an ICU database it does.
const create = [
  `CREATE DATABASE "${scratch}"`,
  `ENCODING '${(want.encoding ?? 'UTF8').replace(/'/g, '')}'`,
  want.collate ? `LC_COLLATE '${want.collate.replace(/'/g, '')}'` : '',
  want.ctype ? `LC_CTYPE '${want.ctype.replace(/'/g, '')}'` : '',
  want.locale_provider === 'i' ? `LOCALE_PROVIDER icu` : '',
  want.locale_provider === 'i' && want.icu_locale ? `ICU_LOCALE '${want.icu_locale.replace(/'/g, '')}'` : '',
  `TEMPLATE template0`,
].filter(Boolean).join(' ');

// Tracked separately from whether the restore worked. A restore that failed
// halfway still leaves a database behind, and a rehearsal that litters the
// cluster with half-restored copies every Sunday is its own small disaster.
let created = false;
let tempFiles = null;

try {
  console.log(`\n--- restoring into ${scratch} ---`);
  await exec(admin, create);
  created = true;

  const meta = await restoreDatabase({ path: dumpPath, passphrase, conn: scratchConn });

  // The ALTER DATABASE settings, applied by hand.
  //
  // pg_restore carries them only when it is creating the database, and it is
  // deliberately not creating one here: the scratch copy has a different name so
  // that it cannot possibly be the live one. They are applied anyway, because a
  // rehearsal in a database configured differently from the real one is not a
  // rehearsal. The time zone in particular is not cosmetic; it is an ingredient
  // of the activity log's hash, which is what migration 0440 is about.
  //
  // After the restore and connected to the new database, not before and from
  // outside it. pg_trgm.similarity_threshold belongs to an extension, and to a
  // session where that extension is not installed it is an unrecognised name
  // that only a superuser may set: "permission denied to set parameter". Once
  // the restore has created the extension, the database's own owner can set it.
  //
  // That the settings are IN the archive is proved separately, above, by reading
  // them out of it. This is only about making the copy faithful.
  for (const setting of want.settings ?? []) {
    const [k, ...rest] = setting.split('=');
    await exec(scratchConn,
      `ALTER DATABASE "${scratch}" SET ${k.trim()} = '${rest.join('=').trim().replace(/'/g, "''")}'`)
      .catch(e => console.error(`[rehearse] could not apply ${setting}: ${e.message.split('\n')[0]}`));
  }
  check('the dump restores without a single error', true, human(meta.plain_bytes));
  check('and the bytes that came out are the bytes that went in',
    meta.sha256_plain === dumpArtefact.sha256_plain,
    meta.sha256_plain === dumpArtefact.sha256_plain ? '' : 'the plaintext hash differs from the manifest');

  // --- 4. is everything there ----------------------------------------------

  console.log('\n--- is every row there ---');
  const got = await tableCounts(scratchConn);
  const expected = manifest.counts;

  const missingTables = Object.keys(expected).filter(t => !(t in got));
  check('every table in the backup came back', missingTables.length === 0,
    missingTables.length ? missingTables.join(', ') : `${Object.keys(expected).length} tables`);

  const wrong = Object.entries(expected)
    .filter(([t, n]) => t in got && got[t] !== n)
    .map(([t, n]) => `${t}: ${got[t]} not ${n}`);
  check('every table has exactly the rows it had', wrong.length === 0,
    wrong.length ? wrong.slice(0, 6).join(', ') : `${Object.values(expected).reduce((a, b) => a + b, 0)} rows`);

  // The one that catches a dump taken through a role row-level security applies
  // to. It is stated separately from the count check above because it is the
  // specific disaster, and a named check is what somebody reads in a log.
  check('the letters are in it, not just the shape of them',
    (got.document ?? 0) > 0 && got.document === expected.document,
    `${got.document ?? 0} document(s)`);

  // --- 5. is the security boundary still there ------------------------------
  //
  // A restore that loses row-level security produces a system that works
  // perfectly and in which everybody can read everything. Nothing on any screen
  // would look wrong.

  console.log('\n--- is the security boundary still there ---');
  const sec = await securityShape(scratchConn);
  const wantSec = manifest.security ?? {};

  check('row-level security is on the same tables',
    sec.rls_tables === wantSec.rls_tables &&
    (wantSec.rls_table_names ?? []).every(t => sec.rls_table_names.includes(t)),
    `${sec.rls_tables} of ${wantSec.rls_tables}`);
  check('every policy came back', sec.policies === wantSec.policies,
    `${sec.policies} of ${wantSec.policies}`);

  const missingFns = (wantSec.security_definer_functions ?? [])
    .filter(f => !sec.security_definer_functions.includes(f));
  check('every function that does the filtering came back', missingFns.length === 0,
    missingFns.length ? missingFns.join(', ') : `${sec.security_definer_functions.length} functions`);

  // --- 6. is the log still provably untampered ------------------------------
  //
  // The seal chain is the system's answer to "somebody with root edited the
  // log". Running it against the restored copy answers a second question the
  // live database cannot: whether the backup and restore themselves changed
  // anything. And the last seal hash is the one printed weekly and filed on
  // paper in the mayor's office, so this ties a restored database to a piece of
  // paper that never went through any of this machinery.

  console.log('\n--- is the activity log still provably intact ---');

  // Against the live database's own answer, not against perfection.
  //
  // The question a backup has to answer is whether the copy is faithful. If the
  // seal chain is already broken in the original — because somebody with root
  // edited the log, or because a destructive test truncated it, which is how it
  // happens on a development machine — then a backup that reproduces exactly
  // that is a correct backup. Demanding that every seal verify would fail the
  // backup for something the backup did not do, and worse, would go on failing
  // every night until somebody stopped reading the output.
  //
  // The state of the live chain is reported separately below, because it is
  // worth knowing, and it is the nightly verify job's business rather than this
  // one's.
  const sealLine = c => `${c[1]} seal(s), ${c[0]} failing`;
  const [liveSeals] = await query(live, `SELECT count(*) FILTER (WHERE NOT ok), count(*) FROM verify_log()`);
  const [copySeals] = await query(scratchConn, `SELECT count(*) FILTER (WHERE NOT ok), count(*) FROM verify_log()`);

  check('the seal chain survives the round trip exactly as it stands',
    liveSeals[0] === copySeals[0] && liveSeals[1] === copySeals[1],
    `live ${sealLine(liveSeals)}; restored ${sealLine(copySeals)}`);

  if (Number(liveSeals[0]) > 0) {
    const bad = await query(live, `SELECT seal_id, note FROM verify_log() WHERE NOT ok`);
    console.log(`  note  the LIVE activity log has ${liveSeals[0]} failing seal(s), which is not a backup problem:`);
    for (const [id, note] of bad.slice(0, 5)) console.log(`          seal ${id}: ${note}`);
  }

  const seal = await highWater(scratchConn);
  check('and the last seal is the one the backup recorded',
    seal.seal.hash === manifest.newest.seal.hash,
    seal.seal.hash ? `${String(seal.seal.hash).slice(0, 16)}…` : 'no seals yet');

  // --- 7. does it make sense --------------------------------------------------

  console.log('\n--- does the restored register make sense ---');
  for (const { name, sql } of INVARIANTS) {
    const n = Number(await scalar(scratchConn, sql));
    check(name, n === 0, n === 0 ? '' : `${n} violation(s)`);
  }
  check('the newest letter is the one the backup recorded',
    seal.incoming === manifest.newest.incoming,
    `${seal.incoming ?? 'none'}`);

  // --- 8. the scans -----------------------------------------------------------
  //
  // The database says a file exists at a path. The files archive is a separate
  // artefact taken a moment later. Nothing except this check has ever compared
  // the two, and a backup where every attachment row points at a file that is
  // not in the tarball is a backup of a filing cabinet full of empty folders.

  if (filesArtefact) {
    console.log('\n--- the scans ---');
    const filesPath = join(dir, filesArtefact.name);

    const inArchive = await countFilesInArchive({ path: filesPath, passphrase });
    check('the scans archive holds the files the manifest counted',
      inArchive === filesArtefact.files, `${inArchive} of ${filesArtefact.files}`);

    // The question is not "is this file in the tarball". It is "can this scan be
    // got back out of this backup", and there are two places the bytes can be.
    //
    // With FILE_STORAGE=disk the bytes are a file and travel in the tar; with
    // FILE_STORAGE=pg they are a row in file_blob and travelled in the dump. A
    // system that has been run both ways, as a development machine has, holds
    // some of each: this one has 60 attachments in the database and 95 on disk.
    // Checking only the tar failed five scans that were never supposed to be in
    // it, which is a check reporting its own assumption rather than a fault.
    //
    // sha256 here is hex text, not bytea. The first version wrapped it in
    // encode(), the query failed, the catch turned it into an empty list, and
    // the rehearsal reported "no scans to sample" for a hundred and fifty-five
    // of them. A check that skips itself in silence is worse than no check, so a
    // query failure is now a failure.
    let sample = [];
    let sampleError = null;
    try {
      // 'db' or 'disk' as a word, not a boolean. psql prints a boolean as t or
      // f, and casting it to text to be safe prints true or false instead, so
      // comparing against 't' quietly put every scan in the wrong basket and
      // the check failed on five files that were never meant to be in the tar.
      sample = await query(scratchConn, `
        SELECT a.stored_path, a.sha256,
               CASE WHEN b.stored_path IS NOT NULL THEN 'db' ELSE 'disk' END
          FROM attachment a
          LEFT JOIN file_blob b ON b.stored_path = a.stored_path
         WHERE a.sha256 IS NOT NULL AND a.stored_path IS NOT NULL
         ORDER BY a.id DESC LIMIT 30`);
    } catch (e) { sampleError = e.message.split('\n')[0]; }

    const onDisk = sample.filter(r => r[2] === 'disk');
    const inDatabase = sample.filter(r => r[2] === 'db');

    if (sampleError) {
      check('the scans can be listed to sample', false, sampleError);
    } else if (!sample.length) {
      const total = Number(await scalar(scratchConn, `SELECT count(*) FROM attachment`));
      check('a sample of scans matches what the database says they are',
        total === 0, total === 0 ? 'there are no scans' : `${total} scans, none with a hash to check`);
    } else {
      // The ones whose bytes are in the database came back with the dump, so
      // they are hashed where they sit, without unpacking anything.
      if (inDatabase.length) {
        const wrong = [];
        for (const [path, want] of inDatabase) {
          const got = await scalar(scratchConn,
            `SELECT encode(digest(bytes, 'sha256'), 'hex') FROM file_blob WHERE stored_path = '${path.replace(/'/g, "''")}'`);
          if (got !== want) wrong.push(path);
        }
        check('the scans kept in the database are byte for byte what it says they are',
          wrong.length === 0,
          wrong.length ? wrong.slice(0, 3).join(', ') : `${inDatabase.length} scan(s) checked`);
      }

      if (onDisk.length) {
        tempFiles = await mkdtemp(join(tmpdir(), 'docsys-rehearse-'));
        let extracted = true;
        try {
          await restoreFiles({
            path: filesPath, passphrase, into: tempFiles,
            members: onDisk.map(([p]) => `./${p}`), say: () => {},
          });
        } catch (e) {
          extracted = false;
          check('every sampled scan is in the scans archive', false,
            e.message.split('/').filter(l => /Not found/.test(l)).slice(0, 3).join(' ') || e.message.split('\n')[0]);
        }

        if (extracted) {
          const wrong = [];
          for (const [rel, want] of onDisk) {
            try {
              const got = createHash('sha256').update(await readFile(join(tempFiles, rel))).digest('hex');
              if (got !== want) wrong.push(rel);
            } catch { wrong.push(`${rel} (missing)`); }
          }
          check('the scans kept on disk are byte for byte what the database says they are',
            wrong.length === 0,
            wrong.length ? wrong.slice(0, 3).join(', ') : `${onDisk.length} scan(s) checked`);
        }
      }
    }
  }
} catch (err) {
  check('the rehearsal ran to the end', false, err.message.split('\n')[0]);
} finally {
  if (tempFiles) await rm(tempFiles, { recursive: true, force: true }).catch(() => {});
  if (created && !keep) {
    await exec(admin, `DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`)
      .catch(e => console.error(`[rehearse] could not drop ${scratch}: ${e.message}`));
  } else if (created && keep) {
    console.log(`\n[rehearse] left ${scratch} in place. Drop it with:`);
    console.log(`  psql -c 'DROP DATABASE "${scratch}" WITH (FORCE)'`);
  }
}

// --- the verdict -------------------------------------------------------------

const failed = checks.filter(c => !c.ok);
const verdict = {
  format: 'docsys-rehearsal-1',
  prefix: entry.prefix,
  at: new Date().toISOString(),
  ok: failed.length === 0,
  checks_run: checks.length,
  checks_failed: failed.length,
  checks,
};
await writeFile(join(dir, `${entry.prefix}-rehearsal.json`), JSON.stringify(verdict, null, 2) + '\n', { mode: 0o600 });

// Into the live activity log, so that a rehearsal which stopped passing is
// visible to somebody who never reads a backup directory.
const detail = JSON.stringify({
  prefix: entry.prefix, checks: checks.length, failed: failed.length,
  failures: failed.map(f => f.name).slice(0, 8),
}).replace(/'/g, "''");
await exec(live, `INSERT INTO activity_log (user_id, action, detail)
  VALUES (NULL, '${verdict.ok ? 'ops.backup_verified' : 'ops.backup_failed'}', '${detail}'::jsonb)`)
  .catch(e => console.error(`[rehearse] could not write the log row: ${e.message}`));

console.log(
  verdict.ok
    ? `\n${checks.length} checks passed. ${entry.prefix} restores, and what comes back is the register.\n`
    : `\n${failed.length} of ${checks.length} checks FAILED. This backup cannot be relied on.\n`);
process.exit(verdict.ok ? 0 : 1);
