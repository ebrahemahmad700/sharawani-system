// Taking a backup, and knowing what is in it.
//
// This module depends on nothing from npm. It talks to PostgreSQL through
// psql, pg_dump and pg_restore, and uses only node's own crypto, streams and
// child_process. That is deliberate and it is the most important design
// decision in the file.
//
// Everything else in this system can afford a dependency tree, because if
// express fails to install the worst case is that the website is down for an
// afternoon. Backup is the thing that has to work on the day everything else has
// already gone wrong: the disk is failing, or node_modules is half-written, or
// somebody restored the wrong image. A backup tool that needs a working npm
// install to run has picked exactly the wrong moment to be fragile.
//
// WHICH DATABASE ROLE, AND WHY IT IS NOT THE ONE CALLED BACKUP
//
// The plan created a role named docsys_backup, a member of pg_read_all_data.
// It cannot be used, and finding that out by testing it rather than by reading
// about it is the reason this paragraph exists.
//
// pg_read_all_data grants SELECT on everything. It does NOT set BYPASSRLS, and
// this database has row-level security on document, attachment, activity_log and
// fifteen other tables. Connected as docsys_backup with no app.user_id set, the
// policies match nothing:
//
//     docsys_owner  -> SELECT count(*) FROM document  ->  286
//     docsys_backup -> SELECT count(*) FROM document  ->    0
//
// pg_dump as docsys_backup stops with "query would be affected by row-level
// security policy for table document", which is survivable because it is loud.
// The dangerous part is the fix everybody reaches for next: adding
// --enable-row-security makes pg_dump succeed, and produces a backup containing
// zero letters. It is the correct size for a schema-only dump, it restores
// without a single error, and it is empty. A municipality could run that nightly
// for two years and find out on the worst possible day.
//
// So backups are taken as docsys_owner, which owns the tables and therefore
// bypasses their policies (no table sets FORCE ROW LEVEL SECURITY). The check
// below refuses to run as a role that cannot see the rows, so this can never
// again be discovered after the fact.

import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import { mkdir, readdir, readFile, writeFile, unlink, stat } from 'fs/promises';
import { join, basename } from 'path';
import { encryptTo, decryptFrom } from './backup-crypt.mjs';

export const MANIFEST_FORMAT = 'docsys-backup-manifest-1';

// psql prints one row per line with this between the fields. A unit separator
// cannot appear in a document number, a table name or a hash, which is more than
// can be said for a comma or a pipe.
const FS = '\x1f';

// --- talking to postgres -----------------------------------------------------

/** Connection details out of a postgres:// URL, in the shape the client tools want. */
export function connFrom(url, { database } = {}) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: database ?? decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

function connArgs(c) {
  return ['-h', c.host, '-p', String(c.port), '-U', c.user, '-d', c.database];
}

// The password goes in the environment, never in argv. Anything in argv is
// readable by every process on the machine through ps, which on a shared
// municipal server includes whoever is logged in at the time.
function connEnv(c) {
  return { ...process.env, PGPASSWORD: c.password, PGCONNECT_TIMEOUT: '15' };
}

/**
 * Run one of the postgres client tools, with the plaintext never touching a disk.
 *
 *   onStdout(stream)     read the child's output. pg_dump goes straight into the
 *                        cipher this way.
 *   feedStdin(writable)  write the child's input. A backup file is decrypted
 *                        straight into pg_restore this way.
 *
 * Both are given the stream to work with rather than handing one over, and both
 * of those signatures are the way they are because of a bug. See below.
 */
function run(cmd, args, { env, feedStdin, onStdout, cwd, allowPartialInput = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: env ?? process.env,
      cwd,
      stdio: [feedStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    let out = '', err = '';
    if (!onStdout) child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });

    // The consumer reads from a PassThrough, never from child.stdout directly,
    // and the pipe is attached in this tick.
    //
    // This is not tidiness. A consumer that does anything asynchronous before it
    // starts reading — and encryptTo does, because deriving the key from the
    // passphrase costs a tenth of a second of scrypt — gets NOTHING. By the time
    // it looks, the child has exited and node has destroyed the stdio stream,
    // buffered contents and all. It does not throw and the exit code is zero.
    //
    //   reader attached immediately   tar -czf - /srv/files  ->  19,943 bytes
    //   reader attached after scrypt  the same command       ->           0
    //
    // The first version of this file had the second shape and wrote a backup
    // whose scans archive was an empty gzip stream, 20 bytes, next to a manifest
    // that confidently said 290 files. Nothing anywhere reported a problem. The
    // restore rehearsal caught it, which is the entire argument for having one.
    //
    // pipe() attaches synchronously and applies backpressure, so a slow consumer
    // pauses the child rather than losing what it sent.
    let consumer = Promise.resolve();
    if (onStdout) {
      const relay = new PassThrough();
      child.stdout.pipe(relay);
      consumer = onStdout(relay);
      // Marked as observed now, read for real on close. Without this a failure
      // here between now and the child exiting is an unhandled rejection, which
      // node turns into an uncaught exception and a stack trace instead of the
      // sentence below.
      consumer.catch(() => {});
    }

    // The producer writes INTO child.stdin, rather than handing over a stream
    // for this function to pipe. That distinction cost an afternoon.
    //
    // The first version took a PassThrough, piped it to child.stdin, and let the
    // decryptor write into the PassThrough with stream.pipeline. pipeline ends
    // and then DESTROYS its destination, and destroying a PassThrough is not the
    // same as ending it: the readable side is torn down instead of flushed, so
    // 'end' never reaches child.stdin and stdin is never closed. pg_restore sat
    // waiting for input that had already been fully delivered, for ever. No
    // error, no exit, no output after the last line printed.
    //
    // Writing straight into child.stdin means pipeline ends the real thing, and
    // pg_restore sees the end of its archive.
    let producer = Promise.resolve();
    if (feedStdin) {
      // The child may close its input first, on its own error. That must not
      // become an EPIPE crash: the non-zero exit below is the useful report.
      child.stdin.on('error', () => {});
      producer = Promise.resolve().then(() => feedStdin(child.stdin));
      producer.catch(() => {});
    }

    child.on('error', e => reject(new Error(`${cmd}: ${e.message}`)));
    child.on('close', async code => {
      // Both sides are always awaited, whatever happened. Leaving a rejected
      // decryption unobserved while reporting the child's exit code turns a
      // wrong passphrase into an unhandled rejection and a confusing crash.
      const [fed, consumed] = await Promise.allSettled([producer, consumer]);

      if (code !== 0) {
        return reject(new Error(`${cmd} exited ${code}: ${err.trim().split('\n').slice(-6).join(' / ') || 'no message'}`));
      }
      if (fed.status === 'rejected') {
        // A child that finished happily without reading all of its input leaves
        // the writer with a broken pipe. That is a real failure for a restore,
        // where every byte matters, and completely normal for a caller that only
        // wanted the first part of an archive. Only the caller knows which.
        const earlyExit = /EPIPE|ERR_STREAM_PREMATURE_CLOSE|premature close/i
          .test(String(fed.reason?.message ?? ''));
        if (!(allowPartialInput && earlyExit)) return reject(fed.reason);
      }
      if (consumed.status === 'rejected') return reject(consumed.reason);
      resolve({ stdout: out, stderr: err, consumed: consumed.value, fed: fed.value });
    });
  });
}

/** One query. Returns an array of rows, each an array of strings. */
export async function query(conn, sql) {
  const { stdout } = await run('psql', [
    ...connArgs(conn), '-X', '-q', '-t', '-A', '-F', FS,
    '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ], { env: connEnv(conn) });
  return stdout.split('\n').filter(l => l !== '').map(l => l.split(FS));
}

/** One query expected to return exactly one value. */
export async function scalar(conn, sql) {
  const rows = await query(conn, sql);
  return rows.length ? rows[0][0] : null;
}

/** Run statements that return nothing, stopping at the first error. */
export async function exec(conn, sql) {
  await run('psql', [...connArgs(conn), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { env: connEnv(conn) });
}

// --- what is in the database -------------------------------------------------

/**
 * Refuse to back up through a connection that cannot see the rows.
 *
 * The failure this exists for produces a backup of the right shape with none of
 * the contents, and nothing downstream would notice: pg_dump succeeds,
 * pg_restore succeeds, the database comes back with every table and no letters.
 * So the question is asked directly, before anything is written.
 */
export async function assertCanSeeEverything(conn) {
  const [row] = await query(conn, `
    SELECT current_user,
           (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user),
           (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
              AND rowsecurity AND tableowner = current_user),
           (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity)`);
  const [who, privileged, ownedRls, totalRls] = row;

  // Owning the table is as good as BYPASSRLS here, because no table in this
  // database sets FORCE ROW LEVEL SECURITY. That is checked rather than assumed.
  const forced = await scalar(conn,
    `SELECT count(*) FROM pg_class WHERE relforcerowsecurity`);

  const ok = privileged === 't' || (Number(ownedRls) === Number(totalRls) && Number(forced) === 0);
  if (!ok) {
    throw new Error(
      `refusing to back up as "${who}": row-level security applies to this role, so the dump ` +
      `would be silently incomplete. It owns ${ownedRls} of ${totalRls} protected tables and ` +
      `${Number(forced) ? `${forced} table(s) force RLS even on their owner` : 'is neither superuser nor BYPASSRLS'}. ` +
      `Back up as docsys_owner. See the note at the top of src/lib/backup.mjs.`);
  }

  // Belt and braces: a table that should never be empty, actually read.
  const docs = Number(await scalar(conn, `SELECT count(*) FROM document`));
  const rooms = Number(await scalar(conn, `SELECT count(*) FROM room`));
  if (rooms === 0) {
    throw new Error(`refusing to back up as "${who}": it cannot see a single room, which no real database has.`);
  }
  return { user: who, documents: docs, rooms };
}

/**
 * An exact row count for every table.
 *
 * count(*) on each, not the planner's estimate from pg_stat_user_tables. An
 * estimate is fine for deciding whether to vacuum and useless for proving a
 * backup is complete, which is the only thing these numbers are for.
 *
 * The counting is done inside the database with format('%I') doing the quoting,
 * so no table name is ever pasted into SQL from javascript.
 */
export async function tableCounts(conn) {
  const rows = await query(conn, `
    SELECT table_name,
           (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
                               false, true, '')))[1]::text::bigint AS n
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`);
  return Object.fromEntries(rows.map(([name, n]) => [name, Number(n)]));
}

/** The shape of the security boundary, which a restore must bring back intact. */
export async function securityShape(conn) {
  const [[rlsTables, policies]] = await query(conn, `
    SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity),
           (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')`);
  const functions = (await query(conn, `
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef ORDER BY 1`)).map(r => r[0]);
  const rlsNames = (await query(conn, `
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity ORDER BY 1`))
    .map(r => r[0]);
  return {
    rls_tables: Number(rlsTables),
    rls_table_names: rlsNames,
    policies: Number(policies),
    security_definer_functions: functions,
  };
}

/** The anchors a restore is checked against: the newest of everything. */
export async function highWater(conn) {
  const [[docId, incoming, logId, sealId, sealHash, sealTo]] = await query(conn, `
    SELECT coalesce((SELECT max(id) FROM document), 0),
           coalesce((SELECT incoming_year || '/' || incoming_seq FROM document ORDER BY id DESC LIMIT 1), ''),
           coalesce((SELECT max(id) FROM activity_log), 0),
           coalesce((SELECT max(id) FROM log_seal), 0),
           coalesce((SELECT encode(seal_hash, 'hex') FROM log_seal ORDER BY id DESC LIMIT 1), ''),
           coalesce((SELECT max(to_log_id) FROM log_seal), 0)`);
  return {
    document_id: Number(docId),
    incoming: incoming || null,
    log_id: Number(logId),
    seal: { id: Number(sealId), hash: sealHash || null, to_log_id: Number(sealTo) },
  };
}

/**
 * How the database itself was created, and what was set on it afterwards.
 *
 * Not the contents: the collation provider, the ICU locale, the encoding, and
 * the ALTER DATABASE settings. These are the properties a restore can lose while
 * appearing to succeed, so they are written down in plain sight and checked
 * again on the way back in.
 *
 * to_jsonb of the catalogue row rather than named columns, because PostgreSQL
 * renamed daticulocale to datlocale in 17 and a backup tool that stops working
 * on a version upgrade is a backup tool that stops working.
 */
export async function databaseSettings(conn) {
  const raw = await scalar(conn, `SELECT to_jsonb(d) FROM pg_database d WHERE datname = current_database()`);
  const d = JSON.parse(raw ?? '{}');
  const encoding = await scalar(conn, `SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname = current_database()`);
  const settings = await query(conn, `
    SELECT unnest(coalesce(s.setconfig, ARRAY[]::text[]))
      FROM pg_database d LEFT JOIN pg_db_role_setting s
        ON s.setdatabase = d.oid AND s.setrole = 0
     WHERE d.datname = current_database()`);
  return {
    encoding,
    collate: d.datcollate ?? null,
    ctype: d.datctype ?? null,
    locale_provider: d.datlocprovider ?? null,       // 'i' = icu, 'c' = libc
    icu_locale: d.daticulocale ?? d.datlocale ?? null,
    settings: settings.map(r => r[0]).filter(Boolean).sort(),
  };
}

/**
 * Which migrations this database has applied.
 *
 * The column is `version`, which is the filename. Getting this wrong is not
 * fatal and that is exactly the problem: the first version asked for a column
 * called `filename`, the query failed, the catch turned it into zero, and the
 * manifest said the database had no migrations applied while sitting next to a
 * row count saying schema_migration had forty-two rows. The catch is still here
 * for a database too old to have the table at all, but it now says so.
 */
export async function migrationState(conn) {
  try {
    const rows = await query(conn,
      `SELECT count(*), coalesce(max(version), '') FROM schema_migration`);
    return { count: Number(rows[0][0]), latest: rows[0][1] || null };
  } catch (e) {
    return { count: null, latest: null, error: e.message.split('\n')[0].slice(0, 120) };
  }
}

// --- taking one --------------------------------------------------------------

/** docsys-2026-09-11-0200, in the server's own timezone so it reads as the clock on the wall. */
export function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `docsys-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Take one backup: the database, the scans, and a manifest describing both.
 *
 * Three files rather than one archive, sharing a name. The database and the
 * files are each encrypted on their own, so restoring the register on a morning
 * when the letters matter more than the scans does not mean waiting for sixty
 * gigabytes to decrypt first. The manifest stays in plain text, because knowing
 * what backups exist and how big they are is a thing an operator must be able to
 * do without unlocking anything.
 *
 * Nothing is ever written unencrypted, not even briefly: pg_dump's output goes
 * through a pipe into the cipher and out to the final file.
 */
export async function takeBackup({
  conn, dir, passphrase, filesDir = null, say = console.log,
}) {
  await mkdir(dir, { recursive: true });

  const who = await assertCanSeeEverything(conn);
  say(`[backup] connected as ${who.user}: ${who.documents} document(s), ${who.rooms} room(s) visible`);

  const started = Date.now();
  const prefix = stamp();
  const artefacts = [];

  // --- the database --------------------------------------------------------
  //
  // Custom format, not plain SQL. It is compressed, pg_restore can list what is
  // inside it without restoring, and it carries large binary columns without the
  // hex-doubling that plain SQL does to file_blob. A full dump rather than
  // --data-only, because `document` has circular foreign keys and a data-only
  // dump of it cannot be restored without disabling triggers.
  //
  // --create is not optional here, and this is the subtlest thing in the file.
  // A plain pg_dump describes the contents of a database and says nothing about
  // how the database itself was made. This one was made with
  //
  //     LOCALE_PROVIDER icu ICU_LOCALE 'und-u-ks-level1'
  //     ALTER DATABASE docsys SET pg_trgm.similarity_threshold = 0.25
  //     ALTER DATABASE docsys SET timezone = 'Asia/Baghdad'
  //
  // and every one of those changes how the restored system behaves: the ICU
  // locale is what makes Kurdish sort and compare correctly, the similarity
  // threshold is what makes approximate search find a misspelled name, and the
  // timezone is what makes "today" mean today in Rania. Restored without them,
  // the system comes up, every letter is present, and search quietly stops
  // working the way it did. --create carries all three into the dump.
  const dumpPath = join(dir, `${prefix}-database.dump.enc`);
  say(`[backup] dumping ${conn.database} ...`);
  const { consumed: dumped } = await run('pg_dump', [
    ...connArgs(conn), '--format=custom', '--compress=6', '--create', '--no-password',
  ], {
    env: connEnv(conn),
    onStdout: stream => encryptTo(dumpPath, passphrase, 'pgdump-custom', stream),
  });

  artefacts.push({
    name: basename(dumpPath), content: 'pgdump-custom',
    bytes: dumped.bytes, plain_bytes: dumped.plain_bytes,
    sha256_file: dumped.sha256_file, sha256_plain: dumped.sha256_plain,
  });
  say(`[backup] database   ${human(dumped.bytes)}  ${basename(dumpPath)}`);

  // --- the scans -----------------------------------------------------------
  //
  // Only when the files live on a disk. With FILE_STORAGE=pg the bytes are in
  // the file_blob table and the dump above already has them, and tarring an
  // empty directory as well would suggest the scans were backed up twice.
  let fileCount = 0;
  if (filesDir) {
    const filesPath = join(dir, `${prefix}-files.tar.gz.enc`);
    say(`[backup] packing scans from ${filesDir} ...`);
    const { consumed: packed } = await run('tar', ['-czf', '-', '-C', filesDir, '.'], {
      onStdout: stream => encryptTo(filesPath, passphrase, 'files-tar-gz', stream),
    });
    fileCount = await countFilesOnDisk(filesDir);
    artefacts.push({
      name: basename(filesPath), content: 'files-tar-gz',
      bytes: packed.bytes, plain_bytes: packed.plain_bytes,
      files: fileCount,
      sha256_file: packed.sha256_file, sha256_plain: packed.sha256_plain,
    });
    say(`[backup] scans      ${human(packed.bytes)}  ${fileCount} file(s)  ${basename(filesPath)}`);
  }

  // --- the manifest --------------------------------------------------------
  //
  // Counts, hashes and versions. No subject, no name, no letter text, for the
  // same reason the activity log carries none: this file is readable by anybody
  // who can see the backup directory, including whoever carries the disk.
  const manifest = {
    format: MANIFEST_FORMAT,
    prefix,
    taken_at: new Date().toISOString(),
    took_ms: Date.now() - started,
    database: conn.database,
    host: conn.host,
    taken_as: who.user,
    postgres: await scalar(conn, `SELECT current_setting('server_version')`),
    app_version: await appVersion(),
    migrations: await migrationState(conn),
    created_with: await databaseSettings(conn),
    file_storage: filesDir ? 'disk' : 'pg',
    files: fileCount,
    counts: await tableCounts(conn),
    security: await securityShape(conn),
    newest: await highWater(conn),
    artefacts,
  };

  const manifestPath = join(dir, `${prefix}-manifest.json`);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  say(`[backup] manifest   ${basename(manifestPath)}`);

  return { manifest, manifestPath, prefix, dir };
}

async function hashOf(path) {
  const { createHash } = await import('crypto');
  const { createReadStream } = await import('fs');
  const h = createHash('sha256');
  await new Promise((resolve, reject) => {
    const s = createReadStream(path);
    s.on('data', d => h.update(d));
    s.on('error', reject);
    s.on('end', resolve);
  });
  return { sha256_file: h.digest('hex') };
}

async function countFilesOnDisk(root) {
  let n = 0;
  const walk = async d => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(join(d, e.name));
      else if (e.isFile()) n++;
    }
  };
  await walk(root).catch(() => {});
  return n;
}

async function appVersion() {
  try {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    return pkg.version ?? null;
  } catch { return null; }
}

export function human(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = Number(bytes);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}

// --- reading a directory of backups ------------------------------------------

/** Every backup in a directory, newest first, with its rehearsal verdict if it has one. */
export async function listBackups(dir) {
  let names;
  try { names = await readdir(dir); } catch { return []; }

  const out = [];
  for (const name of names.filter(n => n.endsWith('-manifest.json')).sort().reverse()) {
    const prefix = name.replace(/-manifest\.json$/, '');
    let manifest = null;
    try { manifest = JSON.parse(await readFile(join(dir, name), 'utf8')); } catch { /* damaged */ }
    let rehearsal = null;
    try { rehearsal = JSON.parse(await readFile(join(dir, `${prefix}-rehearsal.json`), 'utf8')); } catch { /* none yet */ }
    out.push({ prefix, dir, manifestPath: join(dir, name), manifest, rehearsal });
  }
  return out;
}

/** Every file belonging to one backup. */
export function filesOf(entry) {
  const names = [`${entry.prefix}-manifest.json`, `${entry.prefix}-rehearsal.json`];
  for (const a of entry.manifest?.artefacts ?? []) names.push(a.name);
  return names.map(n => join(entry.dir, n));
}

/**
 * Check a backup's files are the ones the manifest describes, without the
 * passphrase. A copy that ran out of disk halfway is the commonest way a backup
 * goes bad, and it is detectable by anybody, at any time, with no secret.
 */
export async function checkIntegrity(entry) {
  const results = [];
  for (const a of entry.manifest?.artefacts ?? []) {
    const path = join(entry.dir, a.name);
    let present = true, size = null, sha = null;
    try { size = (await stat(path)).size; } catch { present = false; }
    if (present) sha = (await hashOf(path)).sha256_file;
    results.push({
      name: a.name, present,
      size_ok: present && size === a.bytes,
      sha_ok: present && sha === a.sha256_file,
      expected_bytes: a.bytes, found_bytes: size,
    });
  }
  return { ok: results.length > 0 && results.every(r => r.present && r.size_ok && r.sha_ok), artefacts: results };
}

// --- retention ---------------------------------------------------------------

/**
 * Decide what to delete, keeping a daily, weekly and monthly ladder.
 *
 * Two rules beyond the ladder, both learned from other people's disasters:
 *
 *   The newest backup is never deleted, whatever the numbers say. A retention
 *   setting somebody typed wrong must not be able to empty the cupboard.
 *
 *   The newest backup that has PASSED A REHEARSAL is never deleted either, even
 *   if it falls off the bottom of the ladder. Fourteen backups nobody has ever
 *   restored are worth less than one that somebody has, and on the day it
 *   matters that is the one to reach for.
 */
export function planPruning(entries, { daily = 14, weekly = 8, monthly = 12 } = {}) {
  const sorted = [...entries].sort((a, b) =>
    (b.manifest?.taken_at ?? '').localeCompare(a.manifest?.taken_at ?? ''));

  const keep = new Set();
  if (sorted.length) keep.add(sorted[0].prefix);

  const proven = sorted.find(e => e.rehearsal?.ok === true);
  if (proven) keep.add(proven.prefix);

  const seen = { week: new Set(), month: new Set() };
  let dailyKept = 0;

  for (const e of sorted) {
    const at = e.manifest?.taken_at;
    if (!at) { keep.add(e.prefix); continue; }      // cannot judge it, so do not delete it
    const d = new Date(at);

    if (dailyKept < daily) { keep.add(e.prefix); dailyKept++; continue; }

    const weekKey = `${d.getUTCFullYear()}-${isoWeek(d)}`;
    if (seen.week.size < weekly && !seen.week.has(weekKey)) { seen.week.add(weekKey); keep.add(e.prefix); continue; }

    const monthKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (seen.month.size < monthly && !seen.month.has(monthKey)) { seen.month.add(monthKey); keep.add(e.prefix); continue; }
  }

  return {
    keep: sorted.filter(e => keep.has(e.prefix)),
    remove: sorted.filter(e => !keep.has(e.prefix)),
  };
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

/** Carry out a pruning plan. */
export async function prune(entries, keepSettings, { say = console.log, dryRun = false } = {}) {
  const { remove } = planPruning(entries, keepSettings);
  for (const e of remove) {
    for (const f of filesOf(e)) {
      if (dryRun) { say(`[prune] would remove ${basename(f)}`); continue; }
      await unlink(f).catch(() => {});
    }
    if (!dryRun) say(`[prune] removed ${e.prefix}`);
  }
  return remove.map(e => e.prefix);
}

// --- putting one back --------------------------------------------------------

/**
 * Restore a database dump.
 *
 * Two shapes, because there are two occasions.
 *
 *   create: true    the real thing. pg_restore connects to the maintenance
 *                   database, runs the CREATE DATABASE the dump carries, with
 *                   the ICU locale and encoding it was built with, applies the
 *                   ALTER DATABASE settings, and fills it. This is what you run
 *                   when the server is gone.
 *
 *   create: false   into a database that already exists and is named something
 *                   else. This is the rehearsal, and the whole point of giving
 *                   it a different name is that it cannot possibly touch the
 *                   live register. Without --create, pg_restore ignores every
 *                   database-level command in the archive, which is why the
 *                   rehearsal checks those separately rather than assuming.
 *
 * --exit-on-error, because pg_restore's default is to carry on after a failed
 * statement and report the count at the end, which produces a database that is
 * 98 per cent restored and a process that exited zero.
 */
export async function restoreDatabase({ path, passphrase, conn, create = false, say = console.log }) {
  const args = [...connArgs(conn), '--no-owner', '--no-password', '--exit-on-error'];
  // --single-transaction gives all-or-nothing, which is what you want for a
  // restore into an empty database. It cannot be combined with --create,
  // because CREATE DATABASE may not run inside a transaction block.
  if (create) args.push('--create');
  else args.push('--clean', '--if-exists', '--single-transaction');

  const { fed } = await run('pg_restore', args, {
    env: connEnv(conn),
    feedStdin: stdin => decryptFrom(path, passphrase, stdin),
  });

  say(`[restore] ${human(fed.plain_bytes)} restored into ${create ? 'a new database' : conn.database}`);
  return fed;
}

/**
 * The database-level commands the archive carries, as SQL text.
 *
 * pg_restore can write an archive out as SQL instead of executing it, and with
 * --create the first statements are the CREATE DATABASE and the ALTER DATABASE
 * SETs. Reading them is how the rehearsal proves the ICU locale and the trigram
 * threshold survived into the backup, without needing a second cluster to
 * restore them into.
 *
 * pg_restore stops reading once it has the schema, so the decryptor is left
 * writing into a closed pipe. That is expected here and nowhere else, which is
 * what allowPartialInput says.
 */
export async function archivePreamble({ path, passphrase, lines = 80 }) {
  let text = '';
  await run('pg_restore', ['--create', '--schema-only', '--file=-'], {
    allowPartialInput: true,
    feedStdin: stdin => decryptFrom(path, passphrase, stdin),
    onStdout: async stream => {
      for await (const chunk of stream) if (text.length < 200_000) text += chunk;
    },
  });
  return text.split('\n').slice(0, lines).join('\n');
}

/** Unpack the scans from a backup into a directory. */
export async function restoreFiles({ path, passphrase, into, members = null, say = console.log }) {
  await mkdir(into, { recursive: true });
  const { fed } = await run('tar', ['-xzf', '-', '-C', into, ...(members ?? [])], {
    feedStdin: stdin => decryptFrom(path, passphrase, stdin),
  });
  say(`[restore] ${human(fed.plain_bytes)} of scans unpacked into ${into}`);
  return fed;
}

/** How many files a scans archive holds, without unpacking it. */
export async function countFilesInArchive({ path, passphrase }) {
  let n = 0;
  await run('tar', ['-tzf', '-'], {
    feedStdin: stdin => decryptFrom(path, passphrase, stdin),
    onStdout: async stream => {
      let tail = '';
      for await (const chunk of stream) {
        const parts = (tail + chunk).split('\n');
        tail = parts.pop();
        for (const p of parts) if (p && !p.endsWith('/')) n++;
      }
      if (tail && !tail.endsWith('/')) n++;
    },
  });
  return n;
}

export { run, connArgs, connEnv };
