// The promises this system makes to an auditor, tested against a real database.
//
//   1. Two clerks registering at the same instant never receive the same number.
//   2. Numbers are never reused, even after a cancellation.
//   3. Nobody can update or delete a log row. Not the application, not the owner.
//   4. Altering or removing a log row is detectable after sealing.
//   5. A notification carries ids, never letter text, and only its recipient
//      can read it.
//
//   DATABASE_URL_OWNER=... node test/guarantees.test.mjs

import pg from 'pg';

const url = process.env.DATABASE_URL_OWNER;
if (!url) { console.error('set DATABASE_URL_OWNER'); process.exit(2); }

const conn = () => new pg.Client({ connectionString: url });
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

const admin = conn(); await admin.connect();

// This test deliberately tampers with the log to prove tampering is caught, so
// it starts from a clean slate. Only ever run it against a development database.
// Inside docker compose the database is reachable as "db" rather than localhost,
// and is created from scratch by the compose file. There the operator states the
// intent per run instead of the hostname proving it:
//   docker compose run --rm -e ALLOW_DESTRUCTIVE_TESTS=1 app node test/guarantees.test.mjs
if (!/localhost|127.0.0.1/.test(url) && !process.env.ALLOW_DESTRUCTIVE_TESTS) {
  console.error('refusing to run: this test empties the activity log and must never touch a real database.');
  console.error('Set ALLOW_DESTRUCTIVE_TESTS=1 if this database is disposable.');
  process.exit(2);
}
await admin.query(`ALTER TABLE activity_log DISABLE TRIGGER trg_log_no_truncate`);
await admin.query(`ALTER TABLE log_seal      DISABLE TRIGGER trg_seal_no_truncate`);
await admin.query(`TRUNCATE log_seal, activity_log RESTART IDENTITY`);
await admin.query(`ALTER TABLE activity_log ENABLE ALWAYS TRIGGER trg_log_no_truncate`);
await admin.query(`ALTER TABLE log_seal      ENABLE ALWAYS TRIGGER trg_seal_no_truncate`);
await admin.query(`DELETE FROM number_counter WHERE year = 2099`);

// --- 1. Concurrent issuing --------------------------------------------------
// Twenty connections all issue a number for the same counter at the same time.
// The row lock inside issue_number must serialise them into 1..20 with no gaps
// and no repeats.
const N = 20;
const clients = await Promise.all(Array.from({ length: N }, async () => { const c = conn(); await c.connect(); return c; }));

const issued = await Promise.all(clients.map(async c => {
  await c.query('BEGIN');
  const { rows } = await c.query(`SELECT issue_number('incoming', 2099) AS n`);
  await c.query('COMMIT');
  return rows[0].n;
}));
await Promise.all(clients.map(c => c.end()));

const unique = new Set(issued);
const sorted = [...issued].sort((a, b) => a - b);
const contiguous = sorted.every((v, i) => v === sorted[0] + i);
check('concurrent issuing gives no duplicates', unique.size === N, `${unique.size} distinct of ${N}`);
check('concurrent issuing leaves no gaps', contiguous, `range ${sorted[0]} to ${sorted[N - 1]}`);

// --- 2. Numbers are never reused --------------------------------------------
const { rows: [before] } = await admin.query(`SELECT next_value FROM number_counter WHERE kind='incoming' AND year=2099`);
await admin.query('BEGIN');
await admin.query(`SELECT issue_number('incoming', 2099)`);
await admin.query('ROLLBACK');                       // the clerk abandoned the registration
const { rows: [after] } = await admin.query(`SELECT next_value FROM number_counter WHERE kind='incoming' AND year=2099`);
// A rolled-back transaction does give the number back, which is correct: nothing
// was registered. What must never happen is a COMMITTED number being reissued.
await admin.query(`SELECT issue_number('incoming', 2099)`);
const { rows: [afterCommit] } = await admin.query(`SELECT next_value FROM number_counter WHERE kind='incoming' AND year=2099`);
check('an abandoned registration does not consume a number', before.next_value === after.next_value);
check('a completed registration always advances the counter', afterCommit.next_value === after.next_value + 1);

// --- 3. The log refuses to be edited ----------------------------------------
await admin.query(
  `INSERT INTO activity_log (user_id, action, detail) VALUES (NULL, 'ops.migration_applied', '{"test":true}')`);
const { rows: [logRow] } = await admin.query(`SELECT id, row_hash FROM activity_log ORDER BY id DESC LIMIT 1`);

for (const [op, sql] of [
  ['UPDATE',   `UPDATE activity_log SET action = 'auth.login' WHERE id = ${logRow.id}`],
  ['DELETE',   `DELETE FROM activity_log WHERE id = ${logRow.id}`],
  ['TRUNCATE', `TRUNCATE activity_log`],
]) {
  let refused = false;
  try { await admin.query(sql); } catch { refused = true; }
  check(`log refuses ${op} even for the database owner`, refused);
}
check('every log row is hashed on insert', logRow.row_hash !== null);

// --- 4. Tampering is detectable ---------------------------------------------
const seal = await admin.query(`SELECT * FROM seal_log()`);
check('sealing produces a seal', seal.rows.length === 1 && seal.rows[0].seal_hash !== null,
      seal.rows[0] ? `rows ${seal.rows[0].from_log_id}-${seal.rows[0].to_log_id}` : '');

const clean = await admin.query(`SELECT * FROM verify_log()`);
check('a clean log verifies', clean.rows.every(r => r.ok), clean.rows.map(r => r.note).join('; '));

// Now tamper the way someone with database access actually would: disable the
// guard trigger, change a row, put the trigger back.
await admin.query(`ALTER TABLE activity_log DISABLE TRIGGER trg_log_no_update`);
await admin.query(`UPDATE activity_log SET detail = '{"test":"edited"}' WHERE id = $1`, [logRow.id]);
await admin.query(`ALTER TABLE activity_log ENABLE ALWAYS TRIGGER trg_log_no_update`);

const tampered = await admin.query(`SELECT * FROM verify_log()`);
const caught = tampered.rows.some(r => !r.ok);
check('an edited log row breaks verification', caught,
      tampered.rows.filter(r => !r.ok).map(r => `seal ${r.seal_id}: ${r.note}`).join('; '));

// And deletion of a row.
await admin.query(`ALTER TABLE activity_log DISABLE TRIGGER trg_log_no_update`);
await admin.query(`DELETE FROM activity_log WHERE id = $1`, [logRow.id]);
await admin.query(`ALTER TABLE activity_log ENABLE ALWAYS TRIGGER trg_log_no_update`);
const deleted = await admin.query(`SELECT * FROM verify_log()`);
check('a deleted log row breaks verification', deleted.rows.some(r => !r.ok),
      deleted.rows.filter(r => !r.ok).map(r => `seal ${r.seal_id}: ${r.note}`).join('; '));

// --- 5. A notification never carries the letter ----------------------------
//
// The promise made in migration 0400: a notification row says what happened and
// points at a document, and the subject is fetched by joining to that document
// under row-level security when somebody looks. If a future call site ever
// copies the subject into the detail object instead, everything would still
// appear to work and the copy would outlive the reader's right to see it. The
// constraint is what stops that, so the constraint is what is tested.

const leaks = ['subject', 'body', 'sender_name', 'note', 'reply_note', 'opinion'];
let refusedAll = true;
for (const key of leaks) {
  try {
    await admin.query(
      `INSERT INTO notification (user_id, kind, detail)
       VALUES ((SELECT id FROM app_user ORDER BY id LIMIT 1), 'note.added', $1::jsonb)`,
      [JSON.stringify({ [key]: 'داواکاری هاوڵاتی لەسەر پارچە ٢٤٧/٥' })]);
    refusedAll = false;
    console.log(`     "${key}" was accepted into a notification`);
    await admin.query(`DELETE FROM notification WHERE detail ? $1`, [key]);
  } catch {
    /* refused, which is the point */
  }
}
check('a notification cannot be made to carry letter text', refusedAll,
      `${leaks.length} forbidden keys tried`);

// The same row, with ids only, is fine. Otherwise the constraint would be
// refusing everything and the check above would pass for the wrong reason.
const okInsert = await admin.query(
  `INSERT INTO notification (user_id, kind, detail)
   VALUES ((SELECT id FROM app_user ORDER BY id LIMIT 1), 'note.added', '{"note_id": 7}'::jsonb)
   RETURNING id`);
check('while ids are accepted', okInsert.rows.length === 1);
await admin.query(`DELETE FROM notification WHERE id = $1`, [okInsert.rows[0].id]);

// And nobody but the recipient may read one, which is a policy rather than a
// constraint. Checked as the application role, because the owner bypasses
// row-level security by design.
const appUrl = process.env.DATABASE_URL_APP;
if (appUrl) {
  const { rows: [pair] } = await admin.query(
    `SELECT (SELECT id FROM app_user WHERE is_active ORDER BY id LIMIT 1)      AS a,
            (SELECT id FROM app_user WHERE is_active ORDER BY id DESC LIMIT 1) AS b`);
  const { rows: [made] } = await admin.query(
    `INSERT INTO notification (user_id, kind) VALUES ($1, 'step.arrived') RETURNING id`, [pair.a]);

  const asApp = new pg.Client({ connectionString: appUrl });
  await asApp.connect();
  const seenBy = async who => {
    await asApp.query('BEGIN');
    await asApp.query(`SELECT set_config('app.user_id', $1, true)`, [String(who)]);
    const { rows } = await asApp.query(`SELECT id FROM notification WHERE id = $1`, [made.id]);
    await asApp.query('COMMIT');
    return rows.length;
  };
  check('the person it is for can read their notification', (await seenBy(pair.a)) === 1);
  check('and nobody else can, whatever their role', (await seenBy(pair.b)) === 0);
  await asApp.end();
  await admin.query(`DELETE FROM notification WHERE id = $1`, [made.id]);
} else {
  console.log('skip  notification privacy needs DATABASE_URL_APP as well');
}

await admin.query(`DELETE FROM number_counter WHERE year = 2099`);
await admin.end();

console.log(failures ? `\n${failures} guarantee(s) FAILED` : '\nall guarantees hold');
process.exit(failures ? 1 : 0);
