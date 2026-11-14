// The corridor wall board.
//
//   node test/board.test.mjs        (server must be running on BASE)
//
// The board hangs on a wall where anyone can read it, so the test that matters
// is not that it shows numbers. It is that a letter's subject, its sender and
// the name of whoever touched it cannot be got out of it by any route: not off
// the page, not out of the data behind it, and not out of the live stream.

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

const mayor    = new Session(); await mayor.signIn('aram');
const registry = new Session(); await registry.signIn('shilan');
const clerk    = new Session(); await clerk.signIn('sakar');
const it       = new Session(); await it.signIn('itadmin');

console.log('--- who may put it on a wall ---');

const anon = await fetch(`${BASE}/board`, { redirect: 'manual' });
check('nobody signed in is sent to the sign-in page rather than shown anything',
  anon.status === 303 && anon.headers.get('location') === '/login', `${anon.status}`);

check('the mayor can open it', (await mayor.get('/board')).status === 200);
check('IT can open it, because IT hangs it on the wall', (await it.get('/board')).status === 200);

const clerkTry = await clerk.get('/board');
check('an ordinary clerk cannot', clerkTry.status === 303, `${clerkTry.status}`);

const clerkData = await fetch(`${BASE}/board/data`, { headers: { cookie: clerk.header() }, redirect: 'manual' });
check('and cannot read the data behind it either', clerkData.status === 403, `${clerkData.status}`);

console.log('\n--- what it will not say ---');

// A letter with a subject and a sender nobody could produce by accident, then
// put through the two events the board reports on.
const mark = Math.random().toString(36).slice(2, 10);
const subject = `پاراستنی نهێنی ${mark}`;
const sender = `کەسی نهێنی ${mark}`;

await registry.get('/registry/new');
const reg = await registry.post('/registry/new', { confirm_similar: '1',
  subject, doc_type: 'citizen_request', sender_kind: 'citizen', sender_name: sender, priority: 'normal',
});
const docId = /\/documents\/(\d+)/.exec(reg.location ?? '')?.[1];
check('a letter exists with a subject worth hiding', Boolean(docId), `document ${docId}`);

const docPage = await mayor.get(`/documents/${docId}`);
const roomId = /<option value="(\d+)"[^>]*>\s*ژووری یاسا/.exec(docPage.body)?.[1];
await mayor.post(`/documents/${docId}/route`, { mode: 'single', to_room_id: roomId });

const page = await mayor.get('/board');
const data = await (await fetch(`${BASE}/board/data`, { headers: { cookie: mayor.header() } })).text();

check('the letter reached the board at all', data.includes('تۆمارکرا') || data.includes('نێردرا'),
  'nothing in the feed');
check('the page does not carry the subject', !page.body.includes(subject));
check('the page does not carry the sender', !page.body.includes(sender));
check('the page does not carry the mark anywhere at all', !page.body.includes(mark));
check('the data does not carry the subject', !data.includes(subject));
check('the data does not carry the sender', !data.includes(sender));
check('the data does not carry the mark anywhere at all', !data.includes(mark));

// The staff names are the other thing a corridor should not publish: who is
// slow, read by whoever walks past, is a different kind of harm.
for (const name of ['ئارام حەمە', 'شیلان عومەر', 'هێمن']) {
  check(`the data does not name ${name}`, !data.includes(name));
}

console.log('\n--- the shape of it ---');

let parsed = null;
try { parsed = JSON.parse(data); } catch { /* reported below */ }
check('the data is valid JSON', Boolean(parsed));
if (parsed) {
  check('it has today\'s four figures',
    ['registered', 'closed', 'in_flow', 'late'].every(k => typeof parsed.today[k] === 'number' || typeof parsed.today[k] === 'string'),
    JSON.stringify(parsed.today));
  check('it has a tile per room', Array.isArray(parsed.rooms) && parsed.rooms.length > 0, `${parsed.rooms?.length} rooms`);
  check('a room tile carries only a name, a number and counts',
    parsed.rooms.every(r => Object.keys(r).every(k =>
      ['name', 'room_number', 'sort_order', 'open', 'late', 'paper_waiting'].includes(k))),
    Object.keys(parsed.rooms[0] ?? {}).join(','));
  check('a feed line carries only a time, a phrase, a letter number and a room',
    (parsed.recent ?? []).every(e => Object.keys(e).every(k => ['at', 'says', 'number', 'room'].includes(k))),
    Object.keys(parsed.recent?.[0] ?? {}).join(','));
}

console.log('\n--- it updates itself ---');

const control = new AbortController();
let got = null;
const reading = (async () => {
  const res = await fetch(`${BASE}/board/stream`, {
    headers: { cookie: mayor.header(), accept: 'text/event-stream' }, signal: control.signal,
  });
  if (res.status !== 200) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    if (buf.includes('event: board')) { got = buf; control.abort(); return; }
  }
})().catch(() => {});

await Promise.race([reading, new Promise(r => setTimeout(r, 10000))]);
control.abort();

check('the board is sent an update without asking', Boolean(got), got ? '' : 'nothing in 10 s');
if (got) check('and that update says nothing about any letter either', !got.includes(mark));

console.log(failures ? `\n${failures} FAILED` : '\nthe wall board says enough and no more');
process.exit(failures ? 1 : 0);
