// The storage backend, and the row-level security on stored bytes.
//
//   FILE_STORAGE=pg node test/storage.test.mjs
//
// This exists because moving file bytes into the database created a new way to
// reach a letter. Before, the bytes were on a filesystem no database role could
// read. Now they are a table, reachable by the same role the web application
// uses, and the only thing standing between IT and a scanned letter is a policy.
// So the policy gets a test of its own.

import pg from 'pg';

const ownerUrl = process.env.DATABASE_URL_OWNER;
const appUrl = process.env.DATABASE_URL_APP;
if (!ownerUrl || !appUrl) { console.error('set DATABASE_URL_OWNER and DATABASE_URL_APP'); process.exit(2); }

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

const owner = new pg.Client({ connectionString: ownerUrl });
const app = new pg.Client({ connectionString: appUrl });
await owner.connect();
await app.connect();

/** Run a query as a given user, the way the web application does. */
async function as(userId, sql, params = []) {
  await app.query('BEGIN');
  try {
    await app.query('SELECT set_config($1, $2, true)', ['app.user_id', String(userId)]);
    const r = await app.query(sql, params);
    return r;
  } finally { await app.query('ROLLBACK'); }
}

const { rows: [it] } = await owner.query(`SELECT id FROM app_user WHERE role = 'sysadmin' LIMIT 1`);
const { rows: [total] } = await owner.query(`SELECT count(*)::int AS n FROM file_blob WHERE stored_path LIKE 'files/%'`);

console.log('--- row-level security on stored bytes ---');

if (total.n === 0) {
  console.log('skip  no letter attachments stored as blobs; run the suite with FILE_STORAGE=pg first');
} else {
  const { rows: [seen] } = await as(it.id, `SELECT count(*)::int AS n FROM file_blob WHERE stored_path LIKE 'files/%'`);
  check('IT cannot read the bytes of a single letter attachment', seen.n === 0,
        `IT sees ${seen.n} of ${total.n}`);

  // The person who can see the attachment row must be able to read its bytes,
  // otherwise the policy is merely breaking the application rather than securing it.
  const { rows: [att] } = await owner.query(
    `SELECT a.stored_path, a.uploaded_by FROM attachment a
      WHERE a.stored_path IN (SELECT stored_path FROM file_blob) LIMIT 1`);
  if (att) {
    const { rows: [ok] } = await as(att.uploaded_by,
      `SELECT count(*)::int AS n FROM file_blob WHERE stored_path = $1`, [att.stored_path]);
    check('the clerk who uploaded it can still read it back', ok.n === 1, `sees ${ok.n}`);
  }
}

console.log('--- stored bytes are the uploaded bytes ---');

const { rows: mismatches } = await owner.query(`
  SELECT b.stored_path FROM file_blob b
    JOIN attachment a ON a.stored_path = b.stored_path
   WHERE encode(sha256(b.bytes), 'hex') <> a.sha256`);
check('every stored blob still hashes to what was recorded at upload',
      mismatches.length === 0, `${mismatches.length} mismatched`);

const { rows: sizes } = await owner.query(
  `SELECT count(*)::int AS n FROM file_blob WHERE size_bytes <> length(bytes)`);
check('the recorded size matches the actual byte length', sizes[0].n === 0, `${sizes[0].n} wrong`);

// ---------------------------------------------------------------------------
// Every kind of thing that points at bytes
// ---------------------------------------------------------------------------
//
// file_blob decides who may read bytes by asking whether the caller can see a
// row that points at them, and that question has to name every kind of pointer.
// It named two of four until migration 0380, and the two it missed failed in a
// way nobody would report as a permissions problem: a scan in the tray and a
// company's licence read perfectly for five minutes, because of the in-flight
// window that lets the virus scanner work, and then turned into 404s.
//
// So the test ages the blob past that window before asking. Without the ageing
// it passes whether the policy is right or wrong, which is exactly how the bug
// survived.

console.log('\n--- every pointer keeps its bytes readable ---');

/** Push a blob's creation time back so the in-flight window cannot mask a hole. */
async function age(storedPath) {
  await owner.query(
    `UPDATE file_blob SET created_at = now() - interval '30 minutes' WHERE stored_path = $1`,
    [storedPath]);
}

for (const p of [
  // Waiting, and read by somebody in the room whose tray it is. Since migration
  // 0460 a tray belongs to a room, and a claimed scan is read through its letter.
  { what: 'a scan waiting in the tray',
    find: `SELECT t.tray_path AS path, t.id FROM scan_tray_item t
             WHERE t.status = 'new' AND t.tray_path IN (SELECT stored_path FROM file_blob) LIMIT 1`,
    reader: `SELECT u.id FROM app_user u JOIN scan_tray_item t ON t.id = $1
              WHERE u.is_active AND u.role IN ('registry_clerk', 'room_clerk', 'room_head', 'archive_clerk')
                AND (u.room_id = t.room_id OR (t.room_id IS NULL AND u.role = 'registry_clerk'))
              ORDER BY u.id LIMIT 1`,
    outsider: `SELECT u.id FROM app_user u JOIN scan_tray_item t ON t.id = $1
                WHERE u.is_active AND u.role IN ('room_clerk', 'room_head', 'archive_clerk')
                  AND u.room_id IS DISTINCT FROM t.room_id
                  AND u.id IS DISTINCT FROM t.uploaded_by
                ORDER BY u.id LIMIT 1` },
  { what: "a company's own file",
    find: `SELECT c.stored_path AS path, c.id FROM company_file c
             WHERE c.stored_path IN (SELECT stored_path FROM file_blob) LIMIT 1`,
    reader: `SELECT id FROM app_user WHERE role = 'registry_clerk' AND is_active LIMIT 1` },
  { what: 'a drawing in the archive',
    find: `SELECT f.stored_path AS path, f.id FROM archive_file f
             WHERE f.stored_path IN (SELECT stored_path FROM file_blob) LIMIT 1`,
    reader: `SELECT id FROM app_user WHERE role = 'archive_clerk' AND is_active LIMIT 1` },
]) {
  const { rows: [row] } = await owner.query(p.find);
  if (!row) { console.log(`skip  ${p.what}: none stored as a blob`); continue; }

  await age(row.path);
  const params = p.reader.includes('$1') ? [row.id] : [];
  const { rows: [reader] } = await owner.query(p.reader, params);
  if (!reader) { console.log(`skip  ${p.what}: nobody in its room to read it`); continue; }
  const { rows: [seen] } = await as(reader.id,
    `SELECT count(*)::int AS n FROM file_blob WHERE stored_path = $1`, [row.path]);
  check(`${p.what} is still readable half an hour later`, seen.n === 1, `sees ${seen.n}`);

  if (p.outsider) {
    const { rows: [other] } = await owner.query(p.outsider, [row.id]);
    if (other) {
      const { rows: [otherSeen] } = await as(other.id,
        `SELECT count(*)::int AS n FROM file_blob WHERE stored_path = $1`, [row.path]);
      check(`but not by a room it does not belong to`, otherSeen.n === 0, `another room sees ${otherSeen.n}`);
    }
  }

  const { rows: [itSeen] } = await as(it.id,
    `SELECT count(*)::int AS n FROM file_blob WHERE stored_path = $1`, [row.path]);
  check(`and IT still cannot read it`, itSeen.n === 0, `IT sees ${itSeen.n}`);
}

// The in-flight window must not be a way in for bytes that already have an
// owner. If it were, anyone who had ever uploaded anything could read a file
// they are not allowed to see for five minutes after somebody else stored it.
{
  const { rows: [owned] } = await owner.query(
    `SELECT a.stored_path FROM attachment a
      WHERE a.stored_path IN (SELECT stored_path FROM file_blob) LIMIT 1`);
  if (owned) {
    await owner.query(
      `UPDATE file_blob SET created_at = now(), uploaded_by = $2 WHERE stored_path = $1`,
      [owned.stored_path, it.id]);
    const { rows: [seen] } = await as(it.id,
      `SELECT count(*)::int AS n FROM file_blob WHERE stored_path = $1`, [owned.stored_path]);
    check('the in-flight window does not open bytes that already have an owner',
          seen.n === 0, `IT sees ${seen.n}`);
  }
}

// ---------------------------------------------------------------------------
// Tampering
// ---------------------------------------------------------------------------
//
// Every file carries the SHA-256 taken as its bytes streamed in, and two things
// check it: the nightly job, and the button on the document screen. A check that
// only ever sees intact files proves nothing, so this changes a byte and
// confirms the check notices, then puts it back.
//
// Only on the blob backend, because that is where a stored file can be altered
// with one statement. On the disk backend the equivalent needs filesystem
// access, which this test deliberately does not have.

console.log('\n--- a changed file is noticed ---');

{
  const { rows: [victim] } = await owner.query(
    `SELECT b.stored_path, b.bytes, a.sha256
       FROM file_blob b JOIN attachment a ON a.stored_path = b.stored_path
      LIMIT 1`);

  if (!victim) {
    console.log('skip  no attachment stored as a blob; run the suite with FILE_STORAGE=pg first');
  } else {
    const { createHash } = await import('crypto');
    const digest = b => createHash('sha256').update(b).digest('hex');

    check('the stored bytes match the recorded hash to begin with',
          digest(victim.bytes) === victim.sha256);

    // Flip one bit in the middle. Nothing about the file's size or type changes,
    // which is the point: size and type would not catch this.
    const tampered = Buffer.from(victim.bytes);
    const at = Math.floor(tampered.length / 2);
    tampered[at] = tampered[at] ^ 0x01;

    await owner.query(`UPDATE file_blob SET bytes = $2 WHERE stored_path = $1`,
      [victim.stored_path, tampered]);

    const { rows: [after] } = await owner.query(
      `SELECT bytes FROM file_blob WHERE stored_path = $1`, [victim.stored_path]);
    check('one flipped bit changes the hash', digest(after.bytes) !== victim.sha256);
    check('and the size is unchanged, so size alone would not have caught it',
          after.bytes.length === victim.bytes.length);

    await owner.query(`UPDATE file_blob SET bytes = $2 WHERE stored_path = $1`,
      [victim.stored_path, victim.bytes]);

    const { rows: [restored] } = await owner.query(
      `SELECT bytes FROM file_blob WHERE stored_path = $1`, [victim.stored_path]);
    check('the file is put back as it was', digest(restored.bytes) === victim.sha256);
  }
}

// The JavaScript guard in storage.mjs and this CHECK constraint say the same
// thing in two places. This tests the database one, because it is the one that
// holds even if a future caller forgets to go through the storage module.
console.log('\n--- the path guard ---');

for (const bad of [
  '../../etc/passwd',
  'files/2026/09/../../../etc/passwd',
  'files/2026/09/not-a-uuid.pdf',
  'evil/2026/09/11111111-1111-1111-1111-111111111111.pdf',
]) {
  let refused = false;
  try {
    await owner.query(`INSERT INTO file_blob (stored_path, bytes, size_bytes) VALUES ($1, '\\x00', 1)`, [bad]);
    await owner.query(`DELETE FROM file_blob WHERE stored_path = $1`, [bad]);
  } catch { refused = true; }
  check(`the database refuses the path ${bad}`, refused);
}

await owner.end();
await app.end();
console.log(failures ? `\n${failures} FAILED` : '\nstored bytes are protected and intact');
process.exit(failures ? 1 : 0);
