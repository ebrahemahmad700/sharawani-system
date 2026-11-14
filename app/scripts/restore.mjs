// Put a backup back. The one you run on the worst day.
//
//   node scripts/restore.mjs latest                     the newest backup
//   node scripts/restore.mjs docsys-2026-09-11-0200     a particular one
//   node scripts/restore.mjs latest --into docsys_check somewhere else, to look first
//   node scripts/restore.mjs latest --no-files          the register only, scans later
//   node scripts/restore.mjs latest --force             over a database that exists
//   node scripts/restore.mjs latest --yes               no question asked
//
// Read RESTORE.md before running this. It is short and it assumes nothing.
//
// By default it refuses to write over a database that already exists, and that
// refusal is the most useful thing in the file. The commonest way a restore
// destroys data is not a bad backup: it is somebody restoring last night's copy
// over a database that was actually fine, at nine in the morning, losing the
// day's registrations to fix a problem that turned out to be the network.

import { createInterface } from 'readline';
import { join } from 'path';
import {
  connFrom, scalar, exec, listBackups, checkIntegrity, restoreDatabase, restoreFiles, human,
} from '../src/lib/backup.mjs';

// --- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const TAKES_VALUE = new Set(['--into', '--files']);
const positional = [];
const flags = new Set();
const values = new Map();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (TAKES_VALUE.has(a)) { values.set(a.slice(2), argv[++i]); continue; }
  if (a.startsWith('--')) { flags.add(a.slice(2)); continue; }
  positional.push(a);
}
const wanted = positional[0] ?? 'latest';

const dir = process.env.BACKUP_DIR || '/srv/backups';
const passphrase = process.env.BACKUP_PASSPHRASE || '';
const url = process.env.DATABASE_URL_OWNER;

function stop(message) { console.error(`\nrestore: ${message}\n`); process.exit(2); }

if (!url) stop('DATABASE_URL_OWNER is not set.');
if (passphrase.length < 12) {
  stop('BACKUP_PASSPHRASE is not set.\n' +
       '         It is the passphrase the backup was WRITTEN with, not a new one. If nobody\n' +
       '         knows it, the backups cannot be read, and there is no way around that from\n' +
       '         here. It was meant to be on paper in the mayor\'s safe.');
}

// --- which backup ------------------------------------------------------------

const entries = await listBackups(dir);
if (!entries.length) stop(`no backups in ${dir}`);

const entry = wanted === 'latest' ? entries[0] : entries.find(e => e.prefix === wanted);
if (!entry) {
  stop(`no backup named ${wanted}. There are ${entries.length}:\n         ` +
       entries.slice(0, 10).map(e => e.prefix).join('\n         '));
}

const manifest = entry.manifest;
if (!manifest) stop(`${entry.prefix} has no readable manifest`);

const dumpArtefact = manifest.artefacts.find(a => a.content === 'pgdump-custom');
const filesArtefact = manifest.artefacts.find(a => a.content === 'files-tar-gz');
if (!dumpArtefact) stop(`${entry.prefix} has no database in it`);

const target = values.get('into') || manifest.database;
const renaming = target !== manifest.database;
const admin = connFrom(url, { database: 'postgres' });

console.log(`
About to restore:

  backup        ${entry.prefix}
  taken         ${manifest.taken_at}
  from          ${manifest.database} on ${manifest.host}, taken as ${manifest.taken_as}
  contains      ${manifest.counts.document ?? '?'} documents, ${manifest.counts.activity_log ?? '?'} log rows, ${manifest.files} scans
  newest letter ${manifest.newest?.incoming ?? '?'}
  migrations    ${manifest.migrations?.count ?? '?'} applied, latest ${manifest.migrations?.latest ?? '?'}
  rehearsal     ${entry.rehearsal ? (entry.rehearsal.ok ? `passed ${entry.rehearsal.at}` : `FAILED ${entry.rehearsal.at}`) : 'never rehearsed'}

  into          ${target}${renaming ? '   (a copy to look at, not the live name)' : ''}
`);

if (entry.rehearsal && !entry.rehearsal.ok) {
  console.log('  Warning: the last rehearsal of this backup failed. Expect trouble.\n');
} else if (!entry.rehearsal) {
  console.log('  Warning: this backup has never been rehearsed. Nobody has proved it restores.\n');
}

// --- the files are intact, before anything is touched ------------------------

process.stdout.write('Checking the backup files are complete ... ');
const integrity = await checkIntegrity(entry);
if (!integrity.ok) {
  console.log('NO\n');
  for (const a of integrity.artefacts) {
    if (!a.present) console.error(`  ${a.name} is missing`);
    else if (!a.size_ok) console.error(`  ${a.name} is ${a.found_bytes} bytes, should be ${a.expected_bytes}`);
    else if (!a.sha_ok) console.error(`  ${a.name} does not match the manifest`);
  }
  stop('this backup is damaged. Try the one before it:  node scripts/backup.mjs --check');
}
console.log('yes');

// --- refuse to write over something that exists ------------------------------

const exists = Number(await scalar(admin,
  `SELECT count(*) FROM pg_database WHERE datname = '${target.replace(/'/g, "''")}'`)) > 0;

if (exists && !flags.has('force')) {
  stop(`the database "${target}" already exists.\n` +
       `         If it is broken and you mean to replace it, stop the application first and\n` +
       `         run again with --force. If it is fine, restore a copy beside it instead:\n\n` +
       `           node scripts/restore.mjs ${entry.prefix} --into docsys_check`);
}

if (!flags.has('yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(r => rl.question(
    exists ? `This DROPS the existing "${target}" and replaces it. Type restore to continue: `
           : `Restore into "${target}"? Type restore to continue: `,
    a => { rl.close(); r(a); }));
  if (answer.trim() !== 'restore') stop('nothing was changed.');
}

// --- the database ------------------------------------------------------------

if (exists) {
  console.log(`\nDropping ${target} ...`);
  await exec(admin, `DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
}

const dumpPath = join(dir, dumpArtefact.name);

if (renaming) {
  // A copy under another name, for looking at. The database has to be built
  // here, because pg_restore cannot rename what the archive creates, and it is
  // built with the same collation settings so that what you look at behaves the
  // way the real one does.
  const w = manifest.created_with ?? {};
  const create = [
    `CREATE DATABASE "${target}"`,
    `ENCODING '${(w.encoding ?? 'UTF8').replace(/'/g, '')}'`,
    w.collate ? `LC_COLLATE '${w.collate.replace(/'/g, '')}'` : '',
    w.ctype ? `LC_CTYPE '${w.ctype.replace(/'/g, '')}'` : '',
    w.locale_provider === 'i' ? 'LOCALE_PROVIDER icu' : '',
    w.locale_provider === 'i' && w.icu_locale ? `ICU_LOCALE '${w.icu_locale.replace(/'/g, '')}'` : '',
    'TEMPLATE template0',
  ].filter(Boolean).join(' ');

  console.log(`Creating ${target} ...`);
  await exec(admin, create);
  console.log('Restoring the database ...');
  await restoreDatabase({ path: dumpPath, passphrase, conn: connFrom(url, { database: target }) });

  // The ALTER DATABASE settings are database-level commands, which pg_restore
  // skips when it is not creating the database. Applied by hand so the copy
  // searches the way the original does.
  for (const setting of manifest.created_with?.settings ?? []) {
    const [k, ...rest] = setting.split('=');
    await exec(admin, `ALTER DATABASE "${target}" SET ${k.trim()} = '${rest.join('=').trim().replace(/'/g, "''")}'`)
      .catch(e => console.error(`  could not apply ${setting}: ${e.message}`));
  }
} else {
  console.log('Restoring the database ...');
  // --create, so the database is rebuilt with the collation provider, the ICU
  // locale and the ALTER DATABASE settings it had. Restoring the contents into a
  // database made some other way gives a system where Kurdish sorts wrongly and
  // approximate search is quietly worse, which nobody notices for months.
  await restoreDatabase({ path: dumpPath, passphrase, conn: admin, create: true });
}

// --- the scans ---------------------------------------------------------------

if (filesArtefact && !flags.has('no-files')) {
  const into = values.get('files') || process.env.FILES_DIR || '/srv/files';
  console.log(`Restoring ${filesArtefact.files} scans into ${into} ...`);
  await restoreFiles({ path: join(dir, filesArtefact.name), passphrase, into });
} else if (filesArtefact) {
  console.log(`\nSkipped ${filesArtefact.files} scans. Restore them with:`);
  console.log(`  node scripts/restore.mjs ${entry.prefix} --no-... --files /srv/files`);
}

console.log(`
Restored ${manifest.counts.document ?? '?'} documents from ${entry.prefix}  (${human(dumpArtefact.bytes)} encrypted).

Next, in this order:

  1. Start the application. It applies migrations on the way up, so a backup
     taken on an older version catches itself up.
  2. Sign in and check the newest letter is ${manifest.newest?.incoming ?? 'the one you expect'}.
  3. Confirm the activity log still verifies end to end:
         node src/jobs.mjs verify
  4. Take a fresh backup before anybody registers anything. The backup you just
     restored from is, until you do, the only copy of this state.
`);
