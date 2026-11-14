// Writing the reply.
//
//   node test/reply.test.mjs        (server must be running on BASE)
//
// The letter's whole life in one run: registered, sent to a room, answered by
// that room, replied to from what the room said, printed, numbered, closed.
//
// The order is the thing being tested. A reply is drafted, then signed, then
// numbered as it leaves, and a number in this building is never reused. So a
// draft must be printable WITHOUT a number and must say so on the paper, and
// the number must appear only when the file closes. Getting that backwards
// would burn a number on every draft the mayor sends back for rewriting, and
// the register would grow gaps nobody could explain to an auditor.
//
// The other half is that a closed reply is the record of what was sent. Once
// the citizen holds a piece of paper, the copy in the system may not quietly
// become a different piece of paper.

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) this.cookies.set(p.slice(0, i).trim(), p.slice(i + 1)); } }
  async get(path) { const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async signIn(u) { await this.get('/login'); return this.post('/login', { username: u, password: PASSWORD }); }
}

const registry = new Session(); await registry.signIn('shilan');   // registry clerk
const legal    = new Session(); await legal.signIn('hemin');       // head of the legal room
const clerk    = new Session(); await clerk.signIn('sakar');       // a clerk in that room
const mayor    = new Session(); await mayor.signIn('aram');

const mark = Math.random().toString(36).slice(2, 10);
const { body: form } = await registry.get('/registry/new');
const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(form)?.[1] ?? '';

console.log('--- a letter arrives and a room answers it ---');

const reg = await registry.post('/registry/new', {
  subject: `داواکاری ڕوونکردنەوەی یاسایی ${mark}`,
  doc_type_option_id: typeId, sender_kind: 'citizen',
  sender_name: `ئاواز مەحمود ${mark}`, priority: 'normal',
  confirm_similar: '1',
});
const id = /\/documents\/(\d+)/.exec(reg.location ?? '')?.[1];
check('the letter is registered', Boolean(id), `document ${id}`);

// Find the legal room and send it there.
const docPage = await registry.get(`/documents/${id}`);
const legalRoom = /<option value="(\d+)"[^>]*>ژووری یاسا/.exec(docPage.body)?.[1]
  ?? /<option value="(\d+)"/.exec(docPage.body)?.[1];
const sent = await registry.post(`/documents/${id}/route`, {
  mode: 'single', to_room_id: legalRoom, note: 'بۆ ڕای یاسایی',
});
check('and sent to a room', sent.status === 303 && !String(sent.location).includes('error'),
  decodeURIComponent(sent.location ?? ''));

const opinion = `بەپێی یاسای ژمارە ٢١ ڕێگە پێدراوە. ${mark}`;
await legal.get(`/documents/${id}`);
const answered = await legal.post(`/documents/${id}/complete`, {
  action: 'approved', reply_note: opinion,
});
check('the room writes its opinion and finishes',
  answered.status === 303 && !String(answered.location).includes('error'),
  decodeURIComponent(answered.location ?? ''));

console.log('\n--- the composer ---');

const composer = await registry.get(`/documents/${id}/reply`);
check('it opens', composer.status === 200, `status ${composer.status}`);
check('the room\'s opinion is on the screen beside the box', composer.body.includes(opinion));
check('and has been put into the draft, so nothing is retyped',
  (composer.body.match(new RegExp(mark, 'g')) ?? []).length >= 2);
check('the recipient is filled in from the sender', composer.body.includes(`ئاواز مەحمود ${mark}`));
check('and the reference to the incoming letter is there', /ئاماژە بە کتابەکەت ژمارە/.test(composer.body));

console.log('\n--- the draft is printable, and says it is a draft ---');

const draftPrint = await registry.get(`/documents/${id}/reply/print`);
check('the draft prints', draftPrint.status === 200, `status ${draftPrint.status}`);
check('on the municipality\'s letterhead', /شارەوانی ڕانیە/.test(draftPrint.body));
check('with a signature line and a place for the seal',
  /واژووی سەرۆکی شارەوانی/.test(draftPrint.body) && /مۆر/.test(draftPrint.body));
check('marked plainly as a draft with no number yet', /ژمارە نەدراوە/.test(draftPrint.body));
check('and it says so at the foot as well, where somebody signing would look',
  /ئەم پەڕەیە ڕەشنووسە/.test(draftPrint.body));

console.log('\n--- writing it ---');

const text = `بۆ / ئاواز مەحمود ${mark}\n\nپاش پێداچوونەوە، داواکارییەکەت پەسەند کرا.\n\n${opinion}\n\nلەگەڵ ڕێزدا،`;
await registry.get(`/documents/${id}/reply`);
const saved = await registry.post(`/documents/${id}/reply`, {
  body: text, recipient: `ئاواز مەحمود ${mark}`,
});
check('the draft saves', saved.status === 303 && /saved=1/.test(saved.location ?? ''), saved.location ?? '');

const reopened = await registry.get(`/documents/${id}/reply`);
check('and comes back when the page is opened again', reopened.body.includes('داواکارییەکەت پەسەند کرا'));

// Not by looking for the words "outgoing number" on the page: the form that
// issues one is on the page whether or not one has been issued, so the phrase is
// there either way. The status pill is the honest signal.
const stillDraft = await registry.get(`/documents/${id}`);
check('the letter is not closed by saving a draft',
  !/<span class="pill muted">داخراو<\/span>/.test(stillDraft.body));

console.log('\n--- who may write one ---');

const clerkTry = await clerk.get(`/documents/${id}/reply`);
check('a room clerk cannot open the composer', clerkTry.status === 403, `status ${clerkTry.status}`);

const clerkWrite = await clerk.post(`/documents/${id}/reply`, { body: 'نا', recipient: 'کەس' });
check('and cannot write one by posting straight at it', clerkWrite.status === 403, `status ${clerkWrite.status}`);

// The head of the room that did the work may draft, which is the point: they
// know what it should say. Issuing the number is somebody else's job.
const legalCompose = await legal.get(`/documents/${id}/reply`);
check('the head of the room that answered it may draft the reply',
  legalCompose.status === 200, `status ${legalCompose.status}`);
const legalSend = await legal.post(`/documents/${id}/reply/send`, { recipient: 'x', channel: 'hand' });
check('but may not issue the outgoing number', legalSend.status === 403, `status ${legalSend.status}`);

console.log('\n--- issuing the number and closing ---');

await registry.get(`/documents/${id}/reply`);
const closed = await registry.post(`/documents/${id}/reply/send`, {
  recipient: `ئاواز مەحمود ${mark}`, channel: 'hand',
});
check('the registry issues the number and closes the file',
  closed.status === 303 && /closed=1/.test(closed.location ?? ''), closed.location ?? '');

const after = await registry.get(`/documents/${id}`);
const outgoingNo = /ژمارەی دەرچوو<\/th><td class="mono"><span dir="ltr">([^<]+)/.exec(after.body)?.[1];
check('the letter now carries an outgoing number', Boolean(outgoingNo), outgoingNo ?? 'none found');
check('and the reply itself is shown on the letter it answers',
  after.body.includes('داواکارییەکەت پەسەند کرا'),
  after.body.includes('وەڵامی نێردراو') ? 'the heading is there but not the text' : 'not on the page');

const finalPrint = await registry.get(`/documents/${id}/reply/print`);
check('the printed reply now carries the number', outgoingNo ? finalPrint.body.includes(outgoingNo) : false);
check('and is no longer marked a draft', !/ژمارە نەدراوە/.test(finalPrint.body));

console.log('\n--- a sent reply is not editable ---');

await registry.get(`/documents/${id}/reply`);
const tamper = await registry.post(`/documents/${id}/reply`, {
  body: 'ئەمە شتێکی تەواو جیاوازە کە دوای ناردن نووسراوە.', recipient: 'کەسێکی تر',
});
check('editing the reply after it has gone out is refused',
  /error=/.test(tamper.location ?? ''), decodeURIComponent(tamper.location ?? ''));

const unchanged = await registry.get(`/documents/${id}/reply/print`);
check('and the paper the citizen holds still matches the copy in the system',
  unchanged.body.includes('داواکارییەکەت پەسەند کرا')
  && !unchanged.body.includes('تەواو جیاوازە'));

console.log('\n--- and a second number cannot be drawn for the same letter ---');

const twice = await registry.post(`/documents/${id}/reply/send`, { recipient: 'x', channel: 'hand' });
check('closing an already closed letter is refused', /error=/.test(twice.location ?? ''),
  decodeURIComponent(twice.location ?? ''));

console.log('\n--- a cancelled letter has no reply ---');

// Registered and cancelled, to check the one route that does not go through the
// composer. A blank sheet of municipal letterhead carrying a real subject line
// is not a thing to hand anybody.
await registry.get('/registry/new');
const doomed = await registry.post('/registry/new', {
  subject: `کتابێک کە هەڵدەوەشێنرێتەوە ${mark}`, doc_type_option_id: typeId,
  sender_kind: 'citizen', sender_name: `کەسێک ${mark}`, priority: 'normal',
  confirm_similar: '1',
});
const doomedId = /\/documents\/(\d+)/.exec(doomed.location ?? '')?.[1];
check('a letter to cancel is registered', Boolean(doomedId), `document ${doomedId}`);

await mayor.get(`/documents/${doomedId}`);
await mayor.post(`/documents/${doomedId}/cancel`, { reason: 'تاقیکردنەوە' });

const cancelledPage = await registry.get(`/documents/${doomedId}`);
check('a cancelled letter offers no reply button', !/نووسینی وەڵام/.test(cancelledPage.body));
const cancelledPrint = await registry.get(`/documents/${doomedId}/reply/print`);
check('and its reply cannot be printed either', cancelledPrint.status === 403,
  `status ${cancelledPrint.status}`);

console.log('\n--- IT, as always ---');

const it = new Session(); await it.signIn('itadmin');
const itTry = await it.get(`/documents/${id}/reply`);
check('IT cannot read the reply', itTry.status !== 200, `status ${itTry.status}`);

console.log(failures ? `\n${failures} FAILED` : '\nthe reply is written, printed, numbered and kept, in that order');
process.exit(failures ? 1 : 0);
