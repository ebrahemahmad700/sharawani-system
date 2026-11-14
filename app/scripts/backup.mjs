// Take one backup.
//
//   node scripts/backup.mjs                take one now and prune old ones
//   node scripts/backup.mjs --list         what is in the backup directory
//   node scripts/backup.mjs --check        verify the files match their manifests
//   node scripts/backup.mjs --no-prune     take one and delete nothing
//
// Reads:
//   DATABASE_URL_OWNER    the connection. Must be the owner; see lib/backup.mjs.
//   BACKUP_DIR            where to write. Default /srv/backups.
//   BACKUP_PASSPHRASE     required. There is no default and there will not be.
//   FILES_DIR             the scans, when FILE_STORAGE=disk.
//   BACKUP_KEEP_DAILY / _WEEKLY / _MONTHLY
//
// It writes a row into the activity log whichever way it ends, because a backup
// job that silently stopped running six weeks ago is the failure this whole
// exercise exists to prevent, and the only way anybody finds out is if its
// absence is visible somewhere people look.

import { join } from 'path';
import {
  connFrom, takeBackup, listBackups, checkIntegrity, prune, human, exec,
} from '../src/lib/backup.mjs';

const args = new Set(process.argv.slice(2));
const dir = process.env.BACKUP_DIR || '/srv/backups';
const passphrase = process.env.BACKUP_PASSPHRASE || '';
const url = process.env.DATABASE_URL_OWNER;

// --- the two things it refuses to start without ------------------------------

function refuse(message) {
  console.error(`\nbackup: ${message}\n`);
  process.exit(2);
}

if (!url) refuse('DATABASE_URL_OWNER is not set. A backup taken as any other role is silently empty; see RESTORE.md.');

// A passphrase is not optional and cannot be generated for you.
//
// Generating one would produce a backup that only the machine that made it can
// read, which is worthless precisely when it is needed, because the machine that
// made it is the one that caught fire. Leaving it off would produce a readable
// copy of every letter the municipality has, on a disk whose whole purpose is to
// be carried out of the building. Neither is a thing to do quietly, so it stops.
if (!args.has('--list') && !args.has('--check') && passphrase.length < 12) {
  refuse(
    'BACKUP_PASSPHRASE is not set, or is shorter than twelve characters.\n' +
    '        A backup is a copy of every letter the municipality holds and it is meant to\n' +
    '        leave the building, so it is encrypted. Choose one, put it in .env, and write\n' +
    '        it on paper in the mayor\'s safe. A passphrase kept only on the server is not\n' +
    '        a passphrase, because the server is the thing that will be gone.\n\n' +
    '        Generate one:  openssl rand -base64 32');
}

const conn = connFrom(url);

// --- reading the cupboard ----------------------------------------------------

if (args.has('--list') || args.has('--check')) {
  const entries = await listBackups(dir);
  if (!entries.length) {
    console.log(`No backups in ${dir}.`);
    process.exit(0);
  }
  console.log(`${entries.length} backup(s) in ${dir}, newest first:\n`);
  for (const e of entries) {
    const m = e.manifest;
    const size = (m?.artefacts ?? []).reduce((t, a) => t + (a.bytes || 0), 0);
    const verdict = e.rehearsal
      ? (e.rehearsal.ok ? `rehearsed ${e.rehearsal.at?.slice(0, 10)} PASSED` : `rehearsed ${e.rehearsal.at?.slice(0, 10)} FAILED`)
      : 'never rehearsed';
    console.log(`  ${e.prefix}  ${human(size).padStart(8)}  ${String(m?.counts?.document ?? '?').padStart(6)} documents  ${verdict}`);

    if (args.has('--check')) {
      const c = await checkIntegrity(e);
      for (const a of c.artefacts) {
        const state = !a.present ? 'MISSING'
          : !a.size_ok ? `WRONG SIZE (${a.found_bytes} not ${a.expected_bytes})`
          : !a.sha_ok ? 'ALTERED'
          : 'intact';
        console.log(`      ${state === 'intact' ? ' ' : '!'} ${a.name}  ${state}`);
      }
    }
  }
  process.exit(0);
}

// --- taking one --------------------------------------------------------------

const filesDir = (process.env.FILE_STORAGE || 'disk').toLowerCase() === 'disk'
  ? (process.env.FILES_DIR || '/srv/files')
  : null;

// The log row is written through psql on the same connection the backup used,
// rather than through lib/log.mjs, because this process has no pg pool and no
// npm packages at all. The action codes are the ones already in the vocabulary.
async function logOps(action, detail) {
  const json = JSON.stringify(detail).replace(/'/g, "''");
  await exec(conn, `INSERT INTO activity_log (user_id, action, detail) VALUES (NULL, '${action}', '${json}'::jsonb)`)
    .catch(e => console.error(`[backup] could not write the log row: ${e.message}`));
}

try {
  const { manifest, prefix } = await takeBackup({ conn, dir, passphrase, filesDir });

  const total = manifest.artefacts.reduce((t, a) => t + a.bytes, 0);
  console.log(`[backup] ${prefix} complete: ${human(total)} in ${(manifest.took_ms / 1000).toFixed(1)}s`);

  await logOps('ops.backup_completed', {
    prefix,
    bytes: total,
    documents: manifest.counts.document ?? null,
    log_rows: manifest.counts.activity_log ?? null,
    files: manifest.files,
    tables: Object.keys(manifest.counts).length,
    seal_id: manifest.newest.seal.id,
    ms: manifest.took_ms,
  });

  if (!args.has('--no-prune')) {
    const entries = await listBackups(dir);
    const removed = await prune(entries, {
      daily: Number(process.env.BACKUP_KEEP_DAILY || 14),
      weekly: Number(process.env.BACKUP_KEEP_WEEKLY || 8),
      monthly: Number(process.env.BACKUP_KEEP_MONTHLY || 12),
    });
    if (removed.length) console.log(`[backup] pruned ${removed.length} old backup(s)`);
  }

  // Said last, so it is the line on the screen when somebody runs this by hand.
  console.log(`[backup] ${join(dir, prefix)}-*  — now copy this directory off the machine.`);
  process.exit(0);
} catch (err) {
  console.error(`[backup] FAILED: ${err.message}`);
  await logOps('ops.backup_failed', { stage: 'take', error: String(err.message).slice(0, 400) });
  process.exit(1);
}
