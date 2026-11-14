// The life of a letter, end to end, against a real database.
//
// Registers letters, routes them one room at a time and by sequence, completes,
// returns, recalls, and closes them. Checks the state after every event rather
// than only at the end, because a state machine that arrives at the right place
// by the wrong route will break on the next change.
//
//   DATABASE_URL_OWNER=... node test/routing.test.mjs

import pg from 'pg';
import { sendSingle, sendSequence, receive, complete, returnStep, recall, trail, roomInbox, overdue } from '../src/lib/routing.mjs';
import { registerIncoming, registerOutgoingAndClose, cancelDocument, searchDocuments, getDocument } from '../src/lib/documents.mjs';

const url = process.env.DATABASE_URL_OWNER;
if (!url) { console.error('set DATABASE_URL_OWNER'); process.exit(2); }
// This test writes letters, routes and log rows, so it must never touch a real
// database. A localhost URL is the usual proof. Inside docker compose the database
// is reachable as "db" on a private network and is created from scratch by the
// compose file, so there the operator states the intent per run instead:
//   docker compose run --rm -e ALLOW_DESTRUCTIVE_TESTS=1 app test
if (!/localhost|127\.0\.0\.1/.test(url) && !process.env.ALLOW_DESTRUCTIVE_TESTS) {
  console.error('development database only.');
  console.error('This test writes to the database. Set ALLOW_DESTRUCTIVE_TESTS=1 if this is a disposable one.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const q = (sql, params) => client.query(sql, params);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};
const expectThrow = async (name, fn, code) => {
  try { await fn(); check(name, false, 'no error thrown'); }
  catch (e) { check(name, e.code === code, e.code === code ? '' : `got ${e.code}: ${e.message}`); }
};

// Actors, from the fixtures.
const who = async username => {
  const { rows } = await q(`SELECT id, username, full_name AS "fullName", role, room_id AS "roomId" FROM app_user WHERE username = $1`, [username]);
  return rows[0];
};
const room = async code => (await q(`SELECT id, name FROM room WHERE code = $1`, [code])).rows[0];

const mayor    = await who('aram');
const registry = await who('shilan');
const legalHead= await who('hemin');
const contracts= await who('dler');
const landHead = await who('hersh');
const accountsHead = await who('sozan');

const REGISTRY = await room('REGISTRY');
const LEGAL    = await room('LEGAL');
const CONTRACTS= await room('CONTRACTS_14');
const LAND     = await room('LAND');
const ACCOUNTS = await room('ACCOUNTS');

const newLetter = (subject, extra = {}) => registerIncoming(q, {
  subject, docType: 'citizen_request', senderKind: 'citizen',
  senderName: 'کەریم ساڵح', byUser: registry, ...extra,
});

console.log('--- registration ---');

await q('BEGIN');
// Other suites may have approved leave for one of these heads, which makes the
// deputy the recipient. This test is about routing, not cover, so any live
// delegation on the rooms it uses is ended for the duration of the transaction.
// It rolls back with everything else.
await q(`UPDATE room_delegation SET ended_early_at = now()
          WHERE ended_early_at IS NULL AND room_id = ANY($1::bigint[])`,
        [[LEGAL.id, CONTRACTS.id, LAND.id, ACCOUNTS.id]]);
const a = await newLetter('داواکاری مۆڵەتی بیناسازی بۆ پارچە ٢٤٧/٥', { plotNo: '247/5', neighbourhood: 'سەرچنار' });
check('a registered letter gets a number', !!a.incoming_no, a.incoming_no);
check('it starts as registered', a.status === 'registered');
check('the plot key is derived', a.plot_key === '247/5', a.plot_key);

const b = await newLetter('داواکاری تر');
check('the next letter gets the next number', b.incoming_seq === a.incoming_seq + 1,
      `${a.incoming_seq} then ${b.incoming_seq}`);

console.log('\n--- send to one room ---');

const step1 = await sendSingle(q, { documentId: a.id, toRoomId: LEGAL.id, byUser: mayor, note: 'تکایە بیروڕای یاسایی' });
let doc = await getDocument(q, a.id);
check('the document moves into flow', doc.status === 'in_flow');
check('it is now in the room it was sent to', doc.current_room_id === LEGAL.id);
check('the step is active', step1.status === 'active');
check('a deadline was set', !!step1.due_at);
check('the recipient resolved to the room head', step1.assigned_to === legalHead.id);

// The whole inbox, not the first hundred: every run of the suite leaves letters
// open in legal, and past a hundred the newest one is the one that is cut off.
const inbox = await roomInbox(q, LEGAL.id, { limit: 100000 });
check('it appears in that room inbox', inbox.some(r => r.document_id === a.id));

await expectThrow('sending to the room that already holds it is refused',
  () => sendSingle(q, { documentId: a.id, toRoomId: LEGAL.id, byUser: mayor }), 'same_room');

console.log('\n--- receive and complete ---');

const received = await receive(q, { documentId: a.id, byUser: legalHead });
check('opening the letter records when', !!received.received_at);

const done = await complete(q, { documentId: a.id, byUser: legalHead, action: 'opinion', replyNote: 'ڕێگەپێدراوە' });
check('with nothing waiting, it becomes ready to close', done.outcome === 'ready_to_close');
doc = await getDocument(q, a.id);
check('the document is ready to close', doc.status === 'ready_to_close');
check('it stays with the room that finished it, where the paper is',
      doc.current_room_id === LEGAL.id);
check('but nobody owes an action on it', doc.current_step_id === null);

console.log('\n--- send by sequence ---');

const seq = await sendSequence(q, {
  documentId: b.id, roomIds: [LEGAL.id, CONTRACTS.id, ACCOUNTS.id], byUser: mayor,
  note: 'بە ڕیزبەندی', returnToAssigner: true,
});
check('every step is written at once', seq.length === 3);
check('the first is active', seq[0].status === 'active');
check('the rest wait', seq.slice(1).every(s => s.status === 'waiting'));
check('they share one group', new Set(seq.map(s => s.sequence_group_id)).size === 1);
check('positions are 1 of 3, 2 of 3, 3 of 3',
      seq.every((s, i) => s.group_position === i + 1 && s.group_size === 3));
check('only the last leg returns to the assigner',
      seq[2].return_to_assigner === true && seq[0].return_to_assigner === false);
check('later steps have no recipient yet, because leave is not knowable in advance',
      seq[1].assigned_to === null);

await expectThrow('a sequence with a repeated room is refused',
  () => sendSequence(q, { documentId: a.id, roomIds: [LEGAL.id, LEGAL.id], byUser: mayor }), 'duplicate_room');
await expectThrow('a sequence of one room is refused',
  () => sendSequence(q, { documentId: a.id, roomIds: [LEGAL.id], byUser: mayor }), 'too_few');

console.log('\n--- the sequence advances ---');

const s1 = await complete(q, { documentId: b.id, byUser: legalHead, action: 'opinion' });
check('completing step 1 promotes step 2', s1.outcome === 'next_in_sequence');
check('step 2 is in the second room', s1.step.to_room_id === CONTRACTS.id);
check('step 2 now has a deadline', !!s1.step.due_at);
check('step 2 resolved its recipient on activation', s1.step.assigned_to === contracts.id);

const s2 = await complete(q, { documentId: b.id, byUser: contracts, action: 'approved' });
check('completing step 2 promotes step 3', s2.outcome === 'next_in_sequence');
check('step 3 is in the third room', s2.step.to_room_id === ACCOUNTS.id);

const s3 = await complete(q, { documentId: b.id, byUser: accountsHead, action: 'approved' });
check('after the last room it returns to the assigner', s3.outcome === 'returned_to_assigner');
check('the return leg goes to the mayor room', s3.step.to_room_id === mayor.roomId);
check('the return leg is marked as such', s3.step.kind === 'return_leg');

const t = await trail(q, b.id);
check('the trail shows all four legs', t.length === 4, `${t.length} steps`);
check('the trail is in order', t.every((s, i) => i === 0 || s.seq_no > t[i - 1].seq_no));

console.log('\n--- returning a letter ---');

const c = await newLetter('کتابێک بۆ ژووری هەڵە');
await sendSingle(q, { documentId: c.id, toRoomId: LAND.id, byUser: mayor });
await expectThrow('returning without a reason is refused',
  () => returnStep(q, { documentId: c.id, byUser: landHead, reason: '  ' }), 'reason_required');

const ret = await returnStep(q, { documentId: c.id, byUser: landHead, reason: 'ئەمە پەیوەندی بە ژووری ئێمەوە نییە' });
check('a returned letter bounces back', ret.outcome === 'bounced');
check('it goes back to the room that sent it', ret.step.to_room_id === mayor.roomId);
check('the bounce carries the reason', ret.step.note.includes('پەیوەندی'));

console.log('\n--- returning mid-sequence cancels the rest ---');

const d = await newLetter('ڕیزبەندی کە دەگەڕێتەوە');
const dseq = await sendSequence(q, { documentId: d.id, roomIds: [LEGAL.id, CONTRACTS.id, ACCOUNTS.id], byUser: mayor });
await returnStep(q, { documentId: d.id, byUser: legalHead, reason: 'زانیاری کەمە' });
const dtrail = await trail(q, d.id);
const cancelled = dtrail.filter(s => s.status === 'cancelled');
check('the rest of the sequence is cancelled', cancelled.length === 2, `${cancelled.length} cancelled`);
check('a journey that will never happen is not left showing as waiting',
      !dtrail.some(s => s.status === 'waiting'));

console.log('\n--- recall ---');

const e = await newLetter('کتابێک بۆ گەڕاندنەوە');
await sendSingle(q, { documentId: e.id, toRoomId: ACCOUNTS.id, byUser: mayor });
await expectThrow('someone else cannot recall your letter',
  () => recall(q, { documentId: e.id, byUser: legalHead }), 'not_yours');
const rec = await recall(q, { documentId: e.id, byUser: mayor });
check('an unopened letter can be recalled', rec.outcome === 'recalled');

const f = await newLetter('کتابێک کە کراوەتەوە');
await sendSingle(q, { documentId: f.id, toRoomId: ACCOUNTS.id, byUser: mayor });
await receive(q, { documentId: f.id, byUser: accountsHead });
await expectThrow('once opened it cannot be recalled',
  () => recall(q, { documentId: f.id, byUser: mayor }), 'already_opened');

console.log('\n--- closing ---');

const closed = await registerOutgoingAndClose(q, {
  documentId: a.id, recipient: 'کەریم ساڵح', summary: 'وەڵامی داواکاری', byUser: registry,
});
check('closing issues an outgoing number', !!closed.outgoing_no, closed.outgoing_no);
check('the document is closed', closed.status === 'closed');
check('the incoming number is untouched', closed.incoming_no === a.incoming_no);
await expectThrow('a closed letter cannot be closed twice',
  () => registerOutgoingAndClose(q, { documentId: a.id, recipient: 'x', byUser: registry }), 'already_out');

console.log('\n--- cancellation keeps the number ---');

const g = await newLetter('کتابێک کە هەڵدەوەشێتەوە');
const beforeSeq = g.incoming_seq;
await cancelDocument(q, { documentId: g.id, reason: 'دووبارە تۆمارکرا', byUser: registry });
const h = await newLetter('کتابی دوای هەڵوەشاندنەوە');
check('a cancelled letter does not release its number', h.incoming_seq === beforeSeq + 1,
      `cancelled ${beforeSeq}, next ${h.incoming_seq}`);
const gDoc = await getDocument(q, g.id);
check('the cancelled entry is still there for the auditor', gDoc.status === 'cancelled' && !!gDoc.incoming_no);

console.log('\n--- search ---');

const byNumber = await searchDocuments(q, { text: String(a.incoming_seq), byUser: registry });
check('searching the bare number finds the letter', byNumber.some(r => r.id === a.id));
check('the number match ranks top', byNumber[0]?.tier === 100, `tier ${byNumber[0]?.tier}`);

const byPlot = await searchDocuments(q, { text: '٢٤٧/٥', byUser: registry });
check('searching the plot in Arabic-Indic digits finds it', byPlot.some(r => r.id === a.id));

const bySubject = await searchDocuments(q, { text: 'بیناسازی', byUser: registry });
check('searching a word in the subject finds it', bySubject.some(r => r.id === a.id));

const misspelled = await searchDocuments(q, { text: 'بيناسازي', byUser: registry });
check('the same word typed on an Arabic keyboard finds it', misspelled.some(r => r.id === a.id));

const { rows: searchLog } = await q(
  `SELECT detail FROM activity_log WHERE action = 'search.documents' ORDER BY id DESC LIMIT 1`);
check('the search was logged with the term', searchLog[0]?.detail?.raw === 'بيناسازي',
      JSON.stringify(searchLog[0]?.detail));

console.log('\n--- overdue ---');

// There is no way to move the clock, and the guard trigger refuses to change a
// deadline on an active step — correctly, since a deadline that can be edited is
// not a deadline. So the guard is lifted for exactly this one statement, which
// stands in for three days passing.
await q(`SET CONSTRAINTS ALL IMMEDIATE`);
await q(`ALTER TABLE routing_step DISABLE TRIGGER trg_routing_step_guard`);
await q(`UPDATE routing_step SET due_at = now() - interval '3 days' WHERE document_id = $1 AND status = 'active'`, [c.id]);
await q(`ALTER TABLE routing_step ENABLE ALWAYS TRIGGER trg_routing_step_guard`);
const late = await overdue(q);
check('an overdue letter is reported', late.some(r => r.document_id === c.id));
check('it says how many days over', late.find(r => r.document_id === c.id)?.days_over > 2);

await q('ROLLBACK');
await client.end();

console.log(failures ? `\n${failures} FAILED` : '\nthe whole lifecycle works');
process.exit(failures ? 1 : 0);
