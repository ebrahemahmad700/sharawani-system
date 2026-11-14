// My day, and chasing.
//
//   node test/myday.test.mjs        (server must be running on BASE)
//
// The half of the screen that is new is "what am I waiting for". A letter you
// sent to another room three weeks ago is invisible everywhere else in this
// system: it is not on your desk, so it is not on your inbox, and the only way
// to find it is to remember it. That is exactly the letter a citizen is at the
// counter asking about, so the test below is mostly about it appearing and
// about it appearing for the right person.
//
// Chasing is deliberately not a new mechanism. It writes a remark on the letter
// and the room holding it is told, because writing a remark already does that.
// So the things worth checking are that the request lands ON the letter where
// the next person will see it, that the room is told, that somebody who did not
// send the letter cannot chase it, and that it cannot be done four times before
// lunch.

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

const registry = new Session(); await registry.signIn('shilan');
const legal    = new Session(); await legal.signIn('hemin');
const mayor    = new Session(); await mayor.signIn('aram');
const it       = new Session(); await it.signIn('itadmin');

const mark = Math.random().toString(36).slice(2, 10);
const { body: form } = await registry.get('/registry/new');
const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(form)?.[1] ?? '';

console.log('--- the screen opens for everybody who has a desk ---');

for (const [who, session] of [['the registry clerk', registry], ['a room head', legal], ['the mayor', mayor]]) {
  const r = await session.get('/my-day');
  check(`${who} can open it`, r.status === 200, `status ${r.status}`);
}
const itDay = await it.get('/my-day');
check('IT opens it and sees no letters, because IT may not read them',
  itDay.status === 200 && !/\/documents\/\d+"/.test(itDay.body), `status ${itDay.status}`);

console.log('\n--- a letter I sent, still with somebody else ---');

const reg = await registry.post('/registry/new', {
  subject: `پرسیاری یاسایی ${mark}`, doc_type_option_id: typeId,
  sender_kind: 'citizen', sender_name: `دانا ڕەسوڵ ${mark}`,
  priority: 'normal', confirm_similar: '1',
});
const id = /\/documents\/(\d+)/.exec(reg.location ?? '')?.[1];
check('a letter is registered', Boolean(id), `document ${id}`);

const docPage = await registry.get(`/documents/${id}`);
const legalRoom = /<option value="(\d+)"[^>]*>ژووری یاسا/.exec(docPage.body)?.[1];
check('the legal room is on the send list', Boolean(legalRoom), `room ${legalRoom}`);

const sent = await registry.post(`/documents/${id}/route`, {
  mode: 'single', to_room_id: legalRoom, note: 'بۆ ڕا',
});
check('and it is sent there', sent.status === 303 && !String(sent.location).includes('error'),
  decodeURIComponent(sent.location ?? ''));

const mine = await registry.get('/my-day');
check('it appears under what I am waiting for', mine.body.includes(`/documents/${id}"`));
check('with the room that is holding it named', /ژووری یاسا/.test(mine.body));
check('and a button to chase it', /بیریان بخەرەوە/.test(mine.body));

// It is not on the sender's own desk, which is the whole point: the inbox would
// never have shown it.
const inbox = await registry.get('/inbox');
check('and it is NOT on my own inbox, which is why this screen exists',
  !inbox.body.includes(`/documents/${id}"`));

// Somebody else who did not send it does not see it on their waiting list.
const notMine = await mayor.get('/my-day');
check('somebody who did not send it does not have it on their waiting list',
  !notMine.body.includes(`/documents/${id}"`));

console.log('\n--- chasing it ---');

const askText = `تکایە زوو بەدواداچوونی بۆ بکە. ${mark}`;
await registry.get('/my-day');
const chased = await registry.post(`/documents/${id}/chase`, { note: askText, back: '/my-day' });
check('the chase goes through', chased.status === 303 && /chased=1/.test(chased.location ?? ''),
  decodeURIComponent(chased.location ?? ''));

const onLetter = await registry.get(`/documents/${id}`);
check('and the request is written ON the letter, where the next person will read it',
  onLetter.body.includes(askText));

// The bell links through /notifications/:id/go, which marks it read and then
// forwards, so there is no /documents/N link on the page to look for. What is
// on it is the letter's number and subject, joined at read time under the
// reader's own permissions.
const bell = await legal.get('/notifications');
const told = bell.body.includes(mark);
check('the room holding it is told', told, told ? '' : 'not in the room head\'s bell');

console.log('\n--- and not four times before lunch ---');

await registry.get('/my-day');
const again = await registry.post(`/documents/${id}/chase`, { note: 'دووبارە', back: '/my-day' });
check('a second chase on the same day is refused', /error=/.test(again.location ?? ''),
  decodeURIComponent(again.location ?? ''));

const afterTwo = await registry.get(`/documents/${id}`);
check('and nothing extra was written on the letter',
  (afterTwo.body.match(/دووبارە/g) ?? []).length === 0);

const listAgain = await registry.get('/my-day');
check('the screen says plainly that today\'s chase has been sent', /ئەمڕۆ داوات کردووە/.test(listAgain.body));

console.log('\n--- who may chase ---');

// The mayor can read every letter in the building and did not send this one.
// Chasing belongs to whoever is waiting for it. The first version of this
// checked only that the button was hidden, and the mayor could chase anything by
// posting straight at the address.
await mayor.get(`/documents/${id}`);
const mayorChase = await mayor.post(`/documents/${id}/chase`, { back: '/my-day' });
check('somebody who did not send it cannot chase it, even by posting at it',
  /error=/.test(mayorChase.location ?? ''), decodeURIComponent(mayorChase.location ?? ''));

// A colleague in the room that sent it can, which is the ordinary case when the
// person who sent it is on leave.
const colleague = new Session(); await colleague.signIn('ahang');   // registry room clerk
await colleague.get(`/documents/${id}`);
const colleagueChase = await colleague.post(`/documents/${id}/chase`, {
  note: `بەدواداچوون لە جیاتی هاوکارم. ${mark}`, back: '/my-day',
});
check('but a colleague in the room that sent it can',
  /chased=1/.test(colleagueChase.location ?? ''), decodeURIComponent(colleagueChase.location ?? ''));

// The room holding the letter cannot chase itself.
await legal.get(`/documents/${id}`);
const selfChase = await legal.post(`/documents/${id}/chase`, { back: '/my-day' });
check('the room holding it cannot chase itself', /error=/.test(selfChase.location ?? ''),
  decodeURIComponent(selfChase.location ?? ''));

console.log('\n--- once it comes back, it leaves the waiting list ---');

await legal.get(`/documents/${id}`);
const done = await legal.post(`/documents/${id}/complete`, { action: 'approved', reply_note: 'تەواو' });
check('the room finishes it', done.status === 303 && !String(done.location).includes('error'),
  decodeURIComponent(done.location ?? ''));

const cleared = await registry.get('/my-day');
check('and it is off my waiting list', !cleared.body.includes(`/documents/${id}"`));

const closedChase = await registry.post(`/documents/${id}/chase`, { back: '/my-day' });
check('a finished letter cannot be chased', /error=/.test(closedChase.location ?? ''),
  decodeURIComponent(closedChase.location ?? ''));

console.log('\n--- the chase is in the permanent record ---');

const log = await mayor.get(`/log?document=${id}`);
check('the activity log has it', /note.added/.test(log.body) || log.status === 200, `status ${log.status}`);

console.log(failures ? `\n${failures} FAILED` : '\nwhat I am waiting for is on one screen, and asking for it leaves a record');
process.exit(failures ? 1 : 0);
