// The bell, over HTTP.
//
//   node test/notify.test.mjs        (server must be running on BASE)
//
// What this is really checking is not that a notification appears. It is that
// the right person gets it and nobody else does, that IT is told nothing about
// letters through this new door, and that the live stream actually delivers
// inside a couple of seconds rather than on the next page load.

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) this.cookies.set(p.slice(0, i).trim(), p.slice(i + 1)); } }
  async get(path) { const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body }; }
  async json(path) { const r = await fetch(BASE + path, { headers: { cookie: this.header(), accept: 'application/json' }, redirect: 'manual' }); this.store(r); return { status: r.status, body: r.status === 200 ? await r.json() : null }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async signIn(u) { await this.get('/login'); return this.post('/login', { username: u, password: PASSWORD }); }
}

const registry = new Session(); await registry.signIn('shilan');   // registers letters
const mayor    = new Session(); await mayor.signIn('aram');        // routes them
const head     = new Session(); await head.signIn('hemin');        // head of Legal
const clerk    = new Session(); await clerk.signIn('sakar');       // clerk in Legal
const other    = new Session(); await other.signIn('sozan');       // head of Accounting
const it       = new Session(); await it.signIn('itadmin');

/** Where everyone stands before the test does anything. */
const mark = async s => (await s.json('/notifications/poll?after=0')).body.latest;
const before = {
  head: await mark(head), clerk: await mark(clerk), other: await mark(other),
  it: await mark(it), mayor: await mark(mayor),
};

const sinceMark = async (s, who) => (await s.json(`/notifications/poll?after=${before[who]}`)).body;

console.log('--- a letter is registered and sent to the legal room ---');

await registry.get('/registry/new');
const subject = `تاقیکردنەوەی ئاگادارکردنەوە ${Math.random().toString(36).slice(2, 8)}`;
const reg = await registry.post('/registry/new', { confirm_similar: '1',
  subject, doc_type: 'citizen_request', sender_kind: 'citizen',
  sender_name: 'ڕێبین ئەحمەد', priority: 'normal',
});
const docId = /\/documents\/(\d+)/.exec(reg.location ?? '')?.[1];
check('a letter exists to send', Boolean(docId), `document ${docId}`);

const docPage = await mayor.get(`/documents/${docId}`);
// The routing form offers rooms by name. Pick the legal room the same way a
// person would, rather than hard-coding an id that fixtures may renumber.
const legalId = /<option value="(\d+)"[^>]*>\s*ژووری یاسا/.exec(docPage.body)?.[1];
check('the legal room is offered on the routing form', Boolean(legalId), `room ${legalId}`);

const sent = await mayor.post(`/documents/${docId}/route`, { mode: 'single', to_room_id: legalId });
check('the mayor sends it to the legal room', sent.status === 303, sent.location);

console.log('\n--- who was told ---');

const headSaw = await sinceMark(head, 'head');
const headItem = headSaw.items.find(i => String(i.href).endsWith(`/documents/${docId}`));
check('the head of that room is told', Boolean(headItem), `${headSaw.items.length} new`);
check('and told what kind of thing happened', headItem?.kind === 'step.arrived', headItem?.kind);
check('with the letter number, which is not a secret', Boolean(headItem?.number), headItem?.number);
check('and the subject, because this reader may read this letter', headItem?.subject === subject);

const clerkSaw = await sinceMark(clerk, 'clerk');
check('the clerk sitting in that room is told too',
  clerkSaw.items.some(i => String(i.href).endsWith(`/documents/${docId}`)));

const otherSaw = await sinceMark(other, 'other');
check('a head of an unrelated room is told nothing',
  !otherSaw.items.some(i => String(i.href).endsWith(`/documents/${docId}`)), `${otherSaw.items.length} new`);

const mayorSaw = await sinceMark(mayor, 'mayor');
check('the person who sent it is not told about his own action',
  !mayorSaw.items.some(i => String(i.href).endsWith(`/documents/${docId}`)));

const itSaw = await sinceMark(it, 'it');
check('IT is told nothing about a letter moving', itSaw.items.length === 0, `${itSaw.items.length} new`);

console.log('\n--- the list is private ---');

// The head's notification id, asked for by somebody else. The policy is
// user_id = app_user_id() with no exception, so it is not "forbidden", it does
// not exist.
const headId = headItem?.id;
const stolen = await other.get(`/notifications/${headId}/go`);
check('another user following the head\'s notification is sent nowhere near it',
  stolen.status === 303 && stolen.location === '/notifications', `${stolen.status} ${stolen.location}`);

const otherList = await other.get('/notifications');
check('and it is not on their screen', !otherList.body.includes(subject));

console.log('\n--- reading it ---');

const badge = (await head.json('/notifications/count')).body;
check('the badge counts it', badge.unread >= 1, `unread ${badge.unread}`);

const go = await head.get(`/notifications/${headId}/go`);
check('following it opens the letter', go.status === 303 && go.location === `/documents/${docId}`, go.location);

const afterGo = (await head.json('/notifications/count')).body;
check('and marks that one read', afterGo.unread === badge.unread - 1, `${badge.unread} -> ${afterGo.unread}`);

await head.get('/notifications');
const cleared = await head.post('/notifications/read', {});
check('everything can be marked read at once', cleared.status === 303);
check('after which the badge is empty', (await head.json('/notifications/count')).body.unread === 0);

console.log('\n--- the live stream ---');

// Open the stream as the clerk, then have the mayor do something, and see how
// long the clerk waits. Anything over a couple of seconds is not "live".
const streamMark = (await clerk.json('/notifications/poll?after=0')).body.latest;
const control = new AbortController();
const opened = Date.now();
let delivered = null;

const reading = (async () => {
  const res = await fetch(`${BASE}/events?after=${streamMark}`, {
    headers: { cookie: clerk.header(), accept: 'text/event-stream' },
    signal: control.signal,
  });
  if (res.status !== 200) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes('event: notify')) {
      const data = /data: (\{.*\})/.exec(buffer)?.[1];
      if (data && data.includes(`/documents/${liveId}`)) { delivered = Date.now(); control.abort(); return; }
    }
  }
})().catch(() => {});

// Give the stream a moment to be listening before anything happens.
await new Promise(r => setTimeout(r, 400));

// A second letter, sent to the same room. A fresh one rather than the first
// letter again: a finished letter stays with the room that finished it, so
// sending it back there is refused, correctly.
await registry.get('/registry/new');
const second = await registry.post('/registry/new', { confirm_similar: '1',
  subject: `تاقیکردنەوەی ڕاستەوخۆ ${Math.random().toString(36).slice(2, 8)}`,
  doc_type: 'citizen_request', sender_kind: 'citizen', sender_name: 'شاد عومەر', priority: 'normal',
});
const liveId = /\/documents\/(\d+)/.exec(second.location ?? '')?.[1];
await mayor.get(`/documents/${liveId}`);
await mayor.post(`/documents/${liveId}/route`, { mode: 'single', to_room_id: legalId });

await Promise.race([reading, new Promise(r => setTimeout(r, 12000))]);
control.abort();

check('the open browser is told without being asked', Boolean(delivered),
  delivered ? `${delivered - opened} ms` : 'nothing arrived in 12 s');
if (delivered) check('and told quickly enough to be called live', delivered - opened < 6000, `${delivered - opened} ms`);

console.log('\n--- what a push would say ---');

const count = await clerk.json('/notifications/count');
check('the service worker can ask how many', count.status === 200 && typeof count.body.unread === 'number');
check('and is told nothing else at all',
  Object.keys(count.body).length === 1, Object.keys(count.body).join(','));

console.log(failures ? `\n${failures} FAILED` : '\nthe bell works');
process.exit(failures ? 1 : 0);
