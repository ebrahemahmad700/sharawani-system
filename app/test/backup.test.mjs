// Backup, and putting it back.
//
//   docker compose run --rm backup test
//
// Runs in the backup container, because it needs pg_dump and pg_restore and
// those are only there. It writes into a temporary directory and restores into a
// scratch database with a random name, so it cannot touch either the real backup
// cupboard or the live register.
//
// WHAT IS WORTH TESTING HERE
//
// Almost every way a backup fails is silent. That is the whole subject. pg_dump
// writes a file of a plausible size and exits zero; the file copies; the
// manifest reads well; and the thing is empty, or unreadable, or restores into a
// database that behaves differently. So the tests below are mostly about
// detecting success that is not success:
//
//   an encrypted file that is really encrypted, not just renamed
//   a backup taken through a role that can see nothing, refused rather than
//     written
//   a scans archive that is actually full, which is the bug that shipped for
//     twenty minutes during the writing of this
//   a retention ladder that cannot empty the cupboard
//   and then the real thing: take one, restore it, compare everything
//
// The last of those is scripts/rehearse.mjs, run here as a subprocess rather
// than reimplemented, so that this test proves the tool the municipality will
// actually run on a Sunday morning.

import { spawn } from 'child_process';
import { mkdtemp, rm, readFile, writeFile, stat } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';
import { encryptTo, decryptFrom, readHeader } from '../src/lib/backup-crypt.mjs';
import {
  connFrom, query, scalar, takeBackup, listBackups, checkIntegrity, planPruning,
  assertCanSeeEverything, human,
} from '../src/lib/backup.mjs';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

const url = process.env.DATABASE_URL_OWNER;
if (!url) { console.error('backup.test: DATABASE_URL_OWNER is not set'); process.exit(2); }
const conn = connFrom(url);

// Its own passphrase, so the test never depends on, prints, or writes anything
// encrypted with the real one.
const PASS = 'test-passphrase-not-the-real-one-9f3a';
const dir = await mkdtemp(join(tmpdir(), 'docsys-backup-test-'));

function collect(stream) {
  return new Promise((resolve, reject) => {
    const parts = [];
    stream.on('data', d => parts.push(d));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(parts)));
  });
}

// ---------------------------------------------------------------------------
console.log('--- the encrypted container ---');

const secret = Buffer.from(
  'ژمارە ٢٤٧/٥ — a sentence that must not survive into the file in one piece. '.repeat(40));
const plain = join(dir, 'sample.enc');

const written = await encryptTo(plain, PASS, 'test', Readable.from([secret]));
check('a backup file is written', written.bytes > 0, human(written.bytes));

const raw = await readFile(plain);
check('and the thing it was made from is not sitting inside it',
  !raw.includes(Buffer.from('ژمارە ٢٤٧/٥')) && !raw.includes(Buffer.from('must not survive')));

const head = await readHeader(plain);
check('the header says what the file is, without the passphrase',
  head.header.cipher === 'aes-256-gcm' && head.header.kdf === 'scrypt' && head.header.content === 'test',
  `${head.header.cipher}, ${head.header.kdf}`);

const back = join(dir, 'sample.out');
const meta = await decryptFrom(plain, PASS, createWriteStream(back));
check('it decrypts to exactly what went in',
  Buffer.compare(await readFile(back), secret) === 0);
check('and the hash of what came out matches the hash of what went in',
  meta.sha256_plain === written.sha256_plain);

// The two failures that matter, and the honest fact that they look identical.
let wrongPass = null;
try { await decryptFrom(plain, 'the-wrong-passphrase-entirely', createWriteStream(join(dir, 'no'))); }
catch (e) { wrongPass = e.message; }
check('the wrong passphrase is refused rather than producing rubbish',
  Boolean(wrongPass) && /would not decrypt/.test(wrongPass));

// One byte, in the middle of the ciphertext.
const tampered = join(dir, 'tampered.enc');
const bytes = Buffer.from(raw);
const at = Math.floor((head.bodyStart + head.bodyEnd) / 2);
bytes[at] = bytes[at] ^ 0x01;
await writeFile(tampered, bytes);

let altered = null;
try { await decryptFrom(tampered, PASS, createWriteStream(join(dir, 'no2'))); }
catch (e) { altered = e.message; }
check('a single flipped bit is detected', Boolean(altered) && /would not decrypt/.test(altered));

// The header is authenticated too, so it cannot be edited to say something else.
const relabelled = join(dir, 'relabelled.enc');
const h = Buffer.from(raw);
const headerText = h.subarray(20, 20 + h.readUInt32BE(16)).toString('utf8');
const changed = headerText.replace('"content":"test"', '"content":"tes1"');
if (changed.length === headerText.length) {
  Buffer.from(changed, 'utf8').copy(h, 20);
  await writeFile(relabelled, h);
  let edited = null;
  try { await decryptFrom(relabelled, PASS, createWriteStream(join(dir, 'no3'))); }
  catch (e) { edited = e.message; }
  check('editing the readable header breaks the file rather than relabelling it',
    Boolean(edited) && /would not decrypt/.test(edited));
} else {
  check('editing the readable header breaks the file rather than relabelling it', false,
    'the test could not build an equal-length header');
}

// ---------------------------------------------------------------------------
console.log('\n--- refusing to take a backup that would be empty ---');

// The headline failure. docsys_backup is a member of pg_read_all_data, which
// does not bypass row-level security, so a dump taken through it holds the
// schema and no letters. The point is not that it fails; it is that it fails
// LOUDLY, here, before anything is written.
const backupRole = connFrom(url.replace(/\/\/[^:]+:/, '//docsys_backup:'));
let reachable = true;
try { await scalar(backupRole, 'SELECT 1'); } catch { reachable = false; }

if (!reachable) {
  console.log('note  docsys_backup could not be connected to here (its password differs), so the');
  console.log('      refusal below is checked against the owner only.');
} else {
  const docs = Number(await scalar(backupRole, 'SELECT count(*) FROM document'));
  check('a role that row-level security applies to really does see no letters',
    docs === 0, `${docs} document(s)`);

  let refused = null;
  try { await assertCanSeeEverything(backupRole); } catch (e) { refused = e.message; }
  check('and a backup through it is refused before a byte is written',
    Boolean(refused) && /silently incomplete/.test(refused ?? ''),
    (refused ?? 'it was NOT refused').split('\n')[0].slice(0, 90));
}

const owner = await assertCanSeeEverything(conn);
check('the owner can see the letters, so a backup through it is allowed',
  owner.documents > 0 && owner.rooms > 0, `${owner.documents} documents, ${owner.rooms} rooms`);

// ---------------------------------------------------------------------------
console.log('\n--- taking one ---');

const filesDir = (process.env.FILE_STORAGE || 'disk').toLowerCase() === 'disk'
  ? (process.env.FILES_DIR || '/srv/files') : null;

const { manifest } = await takeBackup({ conn, dir, passphrase: PASS, filesDir, say: () => {} });

check('the manifest counts every table', Object.keys(manifest.counts).length > 20,
  `${Object.keys(manifest.counts).length} tables`);
check('and the counts are real, not estimates',
  manifest.counts.document === Number(await scalar(conn, 'SELECT count(*) FROM document')),
  `${manifest.counts.document} documents`);
check('it records how the database itself was built',
  manifest.created_with?.encoding === 'UTF8' && Boolean(manifest.created_with?.locale_provider),
  `${manifest.created_with?.encoding}, provider ${manifest.created_with?.locale_provider}, locale ${manifest.created_with?.icu_locale}`);
check('and which migrations had been applied',
  Number(manifest.migrations?.count) > 0, `${manifest.migrations?.count}, latest ${manifest.migrations?.latest}`);
check('it records the last seal, which is the one printed on paper each week',
  manifest.newest?.seal?.id >= 0);

// No letter text anywhere in the manifest. It is readable by whoever carries the
// disk, so it must say how much, never what.
const manifestText = JSON.stringify(manifest);
const subject = await scalar(conn, `SELECT subject FROM document WHERE subject IS NOT NULL ORDER BY id DESC LIMIT 1`);
check('the manifest carries counts, not correspondence',
  !subject || !manifestText.includes(subject), subject ? subject.slice(0, 30) : 'no subject to look for');

const dumpArtefact = manifest.artefacts.find(a => a.content === 'pgdump-custom');
check('the database artefact is a real size, not an empty archive',
  dumpArtefact.bytes > 20_000, human(dumpArtefact.bytes));

// The bug this test exists for. A tar whose reader started a tenth of a second
// late is an empty gzip stream: 20 bytes of ciphertext, a manifest confidently
// claiming 290 files, and nothing anywhere reporting a problem.
const filesArtefact = manifest.artefacts.find(a => a.content === 'files-tar-gz');
if (filesArtefact) {
  check('the scans archive holds the scans rather than being an empty archive',
    filesArtefact.files === 0 || filesArtefact.plain_bytes > 1000,
    `${filesArtefact.files} file(s) in ${human(filesArtefact.bytes)}`);
}

const [entry] = await listBackups(dir);
const integrity = await checkIntegrity(entry);
check('the files on disk are the ones the manifest describes', integrity.ok);

// Truncation, which is how a copy to a full disk fails, found without the
// passphrase by anybody at any time.
const victim = join(dir, dumpArtefact.name);
const full = await readFile(victim);
await writeFile(victim, full.subarray(0, full.length - 500));
const afterCut = await checkIntegrity(entry);
check('a truncated copy is spotted without needing the passphrase', !afterCut.ok,
  afterCut.artefacts.find(a => !a.size_ok)?.name ?? '');
await writeFile(victim, full);
check('and the intact file passes again once restored', (await checkIntegrity(entry)).ok);

// ---------------------------------------------------------------------------
console.log('\n--- how many are kept ---');

const day = n => new Date(Date.UTC(2026, 0, n)).toISOString();
const fake = (n, rehearsed = false) => ({
  prefix: `docsys-${n}`,
  manifest: { taken_at: day(n) },
  rehearsal: rehearsed ? { ok: true } : null,
});

const many = Array.from({ length: 60 }, (_, i) => fake(60 - i));
const plan = planPruning(many, { daily: 14, weekly: 4, monthly: 2 });
check('old backups are dropped once the ladder is full', plan.remove.length > 0,
  `${plan.keep.length} kept, ${plan.remove.length} removed`);
check('the newest is always kept', plan.keep.some(e => e.prefix === 'docsys-60'));

const withProven = [...many.slice(0, 30), fake(1, true)];
const plan2 = planPruning(withProven, { daily: 2, weekly: 0, monthly: 0 });
check('and so is the newest one that has passed a rehearsal, however old',
  plan2.keep.some(e => e.prefix === 'docsys-1'),
  'a backup somebody has actually restored is worth more than ten nobody has');

const plan3 = planPruning([fake(5)], { daily: 0, weekly: 0, monthly: 0 });
check('a retention setting of zero cannot empty the cupboard',
  plan3.remove.length === 0 && plan3.keep.length === 1);

const damaged = planPruning([fake(9), { prefix: 'docsys-x', manifest: null, rehearsal: null }],
  { daily: 0, weekly: 0, monthly: 0 });
check('a backup whose manifest cannot be read is never deleted',
  damaged.keep.some(e => e.prefix === 'docsys-x'),
  'it cannot be judged, so it is not thrown away');

// ---------------------------------------------------------------------------
console.log('\n--- and putting it back ---');
console.log('(running scripts/rehearse.mjs, which is the tool that runs every Sunday)\n');

const rehearsal = await new Promise(resolve => {
  const child = spawn(process.execPath, ['/srv/scripts/rehearse.mjs', entry.prefix], {
    env: { ...process.env, BACKUP_DIR: dir, BACKUP_PASSPHRASE: PASS },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => { out += d; process.stdout.write(`  ${d}`.replace(/\n(?!$)/g, '\n  ')); });
  child.stderr.on('data', d => { out += d; });
  child.on('close', code => resolve({ code, out }));
});

check('the rehearsal passes end to end', rehearsal.code === 0,
  rehearsal.code === 0 ? '' : rehearsal.out.split('\n').filter(l => /FAIL/.test(l)).slice(0, 3).join(' | '));

const verdict = JSON.parse(await readFile(join(dir, `${entry.prefix}-rehearsal.json`), 'utf8'));
check('and it writes down what it checked, so the next person can see', verdict.checks_run > 15,
  `${verdict.checks_run} checks`);
check('every one of which passed', verdict.checks_failed === 0);

// The checks that matter most, named, so that a rehearsal quietly losing one of
// them is noticed here rather than never.
for (const needle of [
  'the letters are in it',
  'row-level security is on the same tables',
  'every policy came back',
  'seal chain survives',
  'every function pins its search path',
]) {
  const found = verdict.checks.find(c => c.name.includes(needle));
  check(`the rehearsal still checks: ${needle}`, Boolean(found) && found.ok);
}

// A rehearsal must leave nothing behind.
const leftovers = await query(conn,
  `SELECT datname FROM pg_database WHERE datname LIKE 'docsys_rehearsal%'`);
check('the rehearsal database is dropped afterwards', leftovers.length === 0,
  leftovers.map(r => r[0]).join(', '));

await rm(dir, { recursive: true, force: true });

console.log(failures
  ? `\n${failures} FAILED`
  : '\nbackups are taken, are encrypted, refuse to be empty, and restore into the register');
process.exit(failures ? 1 : 0);
