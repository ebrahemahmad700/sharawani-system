// The scan tray, over HTTP.
//
//   node test/tray.test.mjs        (server must be running on BASE)

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
  async upload(path, fields, files) { const f = new FormData(); f.append('_csrf', this.csrf); for (const [k, v] of Object.entries(fields)) f.append(k, v); for (const [k, { name, bytes, type }] of Object.entries(files)) f.append(k, new Blob([bytes], { type }), name); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header() }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async signIn(u) { await this.get('/login'); return this.post('/login', { username: u, password: PASSWORD }); }
}

const registry = new Session(); await registry.signIn('shilan');
const it = new Session();       await it.signIn('itadmin');

const pdf = () => Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n'),
  Buffer.from(`% ${Math.random()}\n`),          // unique bytes, so each has its own hash
  Buffer.from('trailer<</Root 1 0 R>>\n%%EOF\n'),
]);

console.log('--- who may use the tray ---');
check('the registry clerk can open the tray', (await registry.get('/tray')).status === 200);
check('IT cannot open the tray', (await it.get('/tray')).status === 403);

console.log('\n--- a scan arrives ---');
await registry.get('/tray');
const up = await registry.upload('/tray/upload', { scanner_code: 'FLOOR1' },
  { file: { name: 'scan ٤٥٢١.pdf', bytes: pdf(), type: 'application/pdf' } });
check('a scan can be added to the tray', up.status === 303 && !String(up.location).includes('error'), up.location);

const tray = await registry.get('/tray');
check('it is waiting in the tray', tray.body.includes('scan ٤٥٢١.pdf'));
check('the scanner it came from is shown', tray.body.includes('FLOOR1'));
const trayId = /href="\/tray\/(\d+)"/.exec(tray.body)?.[1];
check('it can be opened', Boolean(trayId), `id ${trayId}`);

const preview = await fetch(`${BASE}/tray/${trayId}/preview`, { headers: { cookie: registry.header() } });
check('the scan can be looked at before deciding', preview.status === 200 && preview.headers.get('content-type') === 'application/pdf');

const itPreview = await fetch(`${BASE}/tray/${trayId}/preview`, { headers: { cookie: it.header() }, redirect: 'manual' });
check('IT cannot look at a scan', itPreview.status === 403, `status ${itPreview.status}`);

console.log('\n--- claiming it onto a letter ---');
await registry.get('/registry/new');
const reg = await registry.post('/registry/new', { confirm_similar: '1',
  subject: 'تاقیکردنەوەی سینیی سکان', doc_type: 'citizen_request', sender_kind: 'citizen',
  sender_name: 'ئاسۆ کەریم', priority: 'normal',
});
const docId = /\/documents\/(\d+)/.exec(reg.location ?? '')?.[1];
check('a letter exists to attach to', Boolean(docId), `document ${docId}`);

const choose = await registry.get(`/tray/${trayId}`);
check('the letter is offered rather than typed from memory', choose.body.includes(`value="${docId}"`));

const claimed = await registry.post(`/tray/${trayId}/claim`, { document_id: docId, kind: 'original_scan' });
check('claiming sends you to the letter', claimed.status === 303 && String(claimed.location).includes(`/documents/${docId}`), claimed.location);

const doc = await registry.get(`/documents/${docId}`);
check('the scan is now an attachment on that letter', doc.body.includes('scan ٤٥٢١.pdf'));

const afterClaim = await registry.get('/tray');
check('it has left the waiting list', !afterClaim.body.includes('scan ٤٥٢١.pdf') || afterClaim.body.includes('دوایین دیاریکراوەکانی تۆ'));

console.log('\n--- one scan, stored once ---');
const attId = /href="\/attachments\/(\d+)\/view"/.exec(doc.body)?.[1];
const dl = await fetch(`${BASE}/attachments/${attId}`, { headers: { cookie: registry.header() } });
check('the claimed attachment downloads', dl.status === 200, `status ${dl.status}`);

console.log('\n--- a scan nobody needs ---');
await registry.get('/tray');
const up2 = await registry.upload('/tray/upload', { scanner_code: 'FLOOR2' },
  { file: { name: 'blank-page.pdf', bytes: pdf(), type: 'application/pdf' } });
check('a second scan arrives', up2.status === 303);
const tray2 = await registry.get('/tray');
// Find the row for this file rather than taking the last link on the page. The
// tray is ordered newest first, so the last link is the oldest item, and this
// only ever picked the right one while the tray held exactly one thing.
const row2 = tray2.body.split('<tr>').find(r => r.includes('blank-page.pdf')) ?? '';
const id2 = /href="\/tray\/(\d+)"/.exec(row2)?.[1];
check('the scan just uploaded can be found in the list', Boolean(id2), `id ${id2}`);
const archived = await registry.post(`/tray/${id2}/archive`, {});
check('it can be sent to the tray archive', archived.status === 303);
const tray3 = await registry.get('/tray');
// By id, not by name. Every run of this test uploads a file called
// blank-page.pdf, so a name that is still on the page may be last week's rather
// than this one's, and the assertion would fail for a reason that has nothing
// to do with archiving.
check('an archived scan leaves the waiting list', !tray3.body.includes(`href="/tray/${id2}"`));

console.log('\n--- it is written down ---');
const mayor = new Session(); await mayor.signIn('aram');
const log = await mayor.get('/log?action=tray');
for (const a of ['tray.detected', 'tray.claimed', 'tray.archived']) {
  check(`${a} appears in the log`, log.body.includes(a));
}

console.log(failures ? `\n${failures} FAILED` : '\nthe scan tray works');
process.exit(failures ? 1 : 0);
