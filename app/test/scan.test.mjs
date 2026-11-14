// Virus scanning against a real clamd.
//
//   CLAMD_HOST=clamav FILE_STORAGE=pg node test/scan.test.mjs
//
// Skips itself when CLAMD_HOST is unset, which is the normal state on a host that
// cannot run a scanner. It does not upload through the web form, because the byte
// whitelist would refuse the EICAR file before any scanner saw it, which is
// itself the first line of defence. This tests the second line.

import pg from 'pg';
import { randomUUID } from 'crypto';
import { scanFile } from '../src/lib/files.mjs';

if (!process.env.CLAMD_HOST) {
  console.log('skip  CLAMD_HOST is not set, so there is no scanner to talk to');
  console.log('      that is a valid configuration: uploads are labelled "not scanned" rather than assumed clean');
  process.exit(0);
}

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

// The industry-standard harmless test file. Every scanner recognises it; it does
// nothing at all. Split so this source file is not itself flagged by a scanner
// looking at the repository.
const EICAR = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR' + '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'latin1');
const CLEAN = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

const owner = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER });
await owner.connect();

// The scanner reads as whoever uploaded the file, because the bytes have no
// attachment row pointing at them yet. So the test blobs need an uploader too.
const { rows: [uploader] } = await owner.query(`SELECT id FROM app_user WHERE role = 'archive_clerk' LIMIT 1`);
const ACTOR = { id: uploader.id };

const now = new Date();
const dir = `files/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
const paths = [];

async function store(bytes, ext = 'pdf') {
  const p = `${dir}/${randomUUID()}.${ext}`;
  paths.push(p);
  if ((process.env.FILE_STORAGE || 'disk') === 'pg') {
    await owner.query(`INSERT INTO file_blob (stored_path, bytes, size_bytes, uploaded_by) VALUES ($1, $2, $3, $4)`, [p, bytes, bytes.length, ACTOR.id]);
  } else {
    const { mkdir, writeFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const root = process.env.FILES_DIR || join(process.cwd(), 'files');
    await mkdir(dirname(join(root, p)), { recursive: true });
    await writeFile(join(root, p), bytes);
  }
  return p;
}

console.log('--- a known-bad file ---');
const badPath = await store(EICAR);
const bad = await scanFile(badPath, ACTOR);
check('the test virus is detected', bad === 'infected', `got "${bad}"`);

console.log('\n--- an ordinary file ---');
const goodPath = await store(CLEAN);
const good = await scanFile(goodPath, ACTOR);
check('a clean PDF comes back clean', good === 'clean', `got "${good}"`);

console.log('\n--- a scanner that is not there ---');
const saved = process.env.CLAMD_HOST;
process.env.CLAMD_HOST = 'no-such-host-exists.invalid';
const unreachable = await scanFile(goodPath, ACTOR);
check('an unreachable scanner reports an error, never "clean"', unreachable === 'error', `got "${unreachable}"`);
process.env.CLAMD_HOST = saved;

// Cleanup: these are test blobs, not records.
for (const p of paths) {
  if ((process.env.FILE_STORAGE || 'disk') === 'pg') {
    await owner.query(`DELETE FROM file_blob WHERE stored_path = $1`, [p]);
  }
}
await owner.end();

console.log(failures ? `\n${failures} FAILED` : '\nvirus scanning works');
process.exit(failures ? 1 : 0);
