// Every screen, as every role, plus the administrative actions.
//
// Signs in as each fixture account, opens each page that role should see, and
// checks it renders rather than erroring. Then walks the administrative flows:
// create a room and a user, request and approve leave for a room head and
// confirm the deputy now receives that room's letters, register a drawing and
// find it three different ways, lock the system and confirm everyone else is
// shut out, unlock it.
//
//   node test/screens.test.mjs         (server must be running on BASE)

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

class Session {
  constructor() { this.cookies = new Map(); }
  #cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  #store(res) {
    const list = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const raw of list) { const [pair] = raw.split(';'); const i = pair.indexOf('='); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1)); }
  }
  async get(path) {
    const res = await fetch(BASE + path, { headers: { cookie: this.#cookieHeader() }, redirect: 'manual' });
    this.#store(res);
    const body = await res.text();
    const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t;
    return { status: res.status, location: res.headers.get('location'), body };
  }
  async post(path, fields) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) (Array.isArray(v) ? v : [v]).forEach(x => form.append(k, x));
    if (!form.has('_csrf')) form.append('_csrf', this.csrf);
    const res = await fetch(BASE + path, { method: 'POST', redirect: 'manual',
      headers: { cookie: this.#cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    this.#store(res);
    return { status: res.status, location: res.headers.get('location'), body: await res.text() };
  }
  async upload(path, fields, files) {
    const form = new FormData();
    form.append('_csrf', this.csrf);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    for (const [k, { name, bytes, type }] of Object.entries(files)) form.append(k, new Blob([bytes], { type }), name);
    const res = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.#cookieHeader() }, body: form });
    this.#store(res);
    return { status: res.status, location: res.headers.get('location'), body: await res.text() };
  }
  async signIn(username, password = PASSWORD) {
    await this.get('/login');
    const r = await this.post('/login', { username, password });
    if (r.status === 303) { const h = await this.get('/'); await this.get(h.location?.replace(BASE, '') ?? '/'); }
    return r;
  }
}

const ERROR_PAGE = 'هەڵەیەک ڕوویدا';
const ok = r => r.status === 200 && !r.body.includes(ERROR_PAGE);

// --- every screen, every role -----------------------------------------------

console.log('--- every screen as every role ---');

const SCREENS = {
  aram:    ['/dashboard', '/rooms', '/inbox', '/outgoing', '/documents', '/archive', '/leave', '/log', '/registry'],
  nabaz:   ['/dashboard', '/rooms', '/inbox', '/outgoing', '/documents', '/archive', '/leave', '/log'],
  shilan:  ['/registry', '/registry/new', '/inbox', '/outgoing', '/documents', '/leave'],
  hemin:   ['/inbox', '/outgoing', '/documents', '/archive', '/leave', '/log'],
  sakar:   ['/inbox', '/outgoing', '/documents', '/archive', '/leave'],
  karwan:  ['/archive', '/archive/new', '/inbox', '/documents', '/leave'],
  zhyan:   ['/archive'],
  bafrin:  ['/leave', '/inbox', '/outgoing', '/documents'],
  itadmin: ['/admin/users', '/admin/rooms', '/log'],
};

const sessions = {};
for (const [user, paths] of Object.entries(SCREENS)) {
  const s = new Session(); sessions[user] = s;
  const r = await s.signIn(user);
  check(`${user} signs in`, r.status === 303, `status ${r.status}`);
  for (const p of paths) {
    const page = await s.get(p);
    check(`  ${user} opens ${p}`, ok(page), `status ${page.status}${page.body.includes(ERROR_PAGE) ? ' (error page)' : ''}`);
  }
}

// --- refusals across roles ----------------------------------------------------

console.log('\n--- the doors that must stay shut ---');

const itDash = await sessions.itadmin.get('/dashboard');
check('IT cannot open the dashboard', itDash.status === 403, `status ${itDash.status}`);
const itReg = await sessions.itadmin.get('/registry');
check('IT is sent from the register to its own screen', itReg.status === 303 && /\/admin\/users$/.test(itReg.location ?? ''), `status ${itReg.status} ${itReg.location}`);
const itDocs = await sessions.itadmin.get('/documents');
check('IT searching letters finds none (row-level security hides every letter)',
      itDocs.status === 200 && !/href="\/documents\/\d+"/.test(itDocs.body), `status ${itDocs.status}`);
const clerkAdmin = await sessions.shilan.get('/admin/users');
check('a clerk cannot open user administration', clerkAdmin.status === 403, `status ${clerkAdmin.status}`);
const headLock = await sessions.hemin.post('/admin/lock', { message: 'x' });
check('a room head cannot lock the system', headLock.status === 403, `status ${headLock.status}`);

// --- administration -----------------------------------------------------------

console.log('\n--- administration ---');

const it = sessions.itadmin;
await it.get('/admin/rooms');
const code = 'TEST_' + Date.now().toString(36).toUpperCase().slice(-5);
const mkRoom = await it.post('/admin/rooms', { name: 'ژووری تاقیکردنەوە', code, room_number: '99', kind: 'office', default_due_days: '4' });
check('IT can create a room', mkRoom.status === 303 && mkRoom.location?.includes('ok=1'), mkRoom.location);
const roomsPage = await it.get('/admin/rooms');
check('the new room appears', roomsPage.body.includes(code));
const dupRoom = await it.post('/admin/rooms', { name: 'دووبارە', code, kind: 'office' });
check('a duplicate room code is refused with a message', dupRoom.location?.includes('error='), dupRoom.location);

await it.get('/admin/users');
const uname = 'test' + Date.now().toString(36).slice(-6);
const roomId = /value="(\d+)">ژووری تاقیکردنەوە/.exec(roomsPage.body)?.[1]
  ?? /<option value="(\d+)">ژووری تاقیکردنەوە/.exec((await it.get('/admin/users')).body)?.[1];
const mkUser = await it.post('/admin/users', { full_name: 'کارمەندی تاقیکردنەوە', username: uname, role: 'room_clerk', room_id: roomId ?? '' });
// Shown on the page that answers the form, never in an address (browser audit, 13 September).
const temp = /وشەی نهێنی کاتی: ([a-z0-9-]{10,})/.exec(mkUser.body ?? '')?.[1] ?? '';
check('IT can create a user and gets a temporary password', mkUser.status === 200 && temp.length >= 10 && !(mkUser.location ?? '').includes('temp='), `status ${mkUser.status}`);

const newbie = new Session();
const first = await newbie.signIn(uname, temp);
check('the new user can sign in with the temporary password', first.status === 303, `status ${first.status}`);
const forced = await newbie.get('/inbox');
check('and is forced to change it before doing anything', forced.status === 303 && forced.location?.endsWith('/password'), forced.location);
await newbie.get('/password');
const changed = await newbie.post('/password', { current: temp, next: 'a-real-password-2026', confirm: 'a-real-password-2026' });
check('changing the password works', changed.status === 303, `status ${changed.status}`);
const afterChange = await newbie.get('/inbox');
check('after which the inbox opens', ok(afterChange), `status ${afterChange.status}`);

const noRoom = await it.post('/admin/users', { full_name: 'بێ ژوور', username: uname + 'x', role: 'room_clerk', room_id: '' });
check('a clerk without a room is refused', noRoom.location?.includes('error='), noRoom.location);

// --- leave creates cover ------------------------------------------------------

console.log('\n--- leave and deputy cover ---');

const hr = sessions.bafrin;
await hr.get('/leave');
// A day either side of today, not today alone.
//
// toISOString gives a UTC date and the database runs on Baghdad time, so for the
// three hours between 21:00 UTC and midnight the two disagree about what day it
// is. A leave request for "today" then falls on yesterday as far as
// resolve_room_assignee is concerned, no cover is created, and this test failed
// every evening for reasons that had nothing to do with the code under test.
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const coverFrom = day(-1);
const coverTo = day(1);
const legalHeadId = /option value="(\d+)">هێمن ڕەشید/.exec((await hr.get('/leave')).body)?.[1];
// The same person cannot have two leaves on the same days, so a leave left from an
// earlier run of this suite is cancelled first. That is also the proof that
// cancelling works and ends the cover.
{
  const before = await hr.get('/leave');
  const rows = [...before.body.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map(m => m[0]).filter(r => r.includes('هێمن ڕەشید'));
  for (const r of rows) {
    const cancelId = /action="\/leave\/(\d+)\/cancel"/.exec(r)?.[1];
    if (cancelId) await hr.post(`/leave/${cancelId}/cancel`, {});
  }
}
check('HR can pick the legal head', !!legalHeadId);
const req = await hr.post('/leave/new', { user_id: legalHeadId, start_date: coverFrom, end_date: coverTo, leave_type: 'annual', note: 'تاقیکردنەوە' });
check('HR can request leave for a room head', req.status === 303 && req.location?.includes('ok=1'), req.location);

let leavePage = await hr.get('/leave');
check('the request warns who will cover', leavePage.body.includes('جێگر:') && leavePage.body.includes('ساکار ئەحمەد'));
const leaveId = [...leavePage.body.matchAll(/action="\/leave\/(\d+)\/decide"/g)].map(m => m[1]).pop();
const approve = await hr.post(`/leave/${leaveId}/decide`, { decision: 'approved' });
check('HR can approve it', approve.status === 303, `status ${approve.status}`);

// Now a letter sent to legal must land on the deputy, not the absent head.
const reg = sessions.shilan;
await reg.get('/registry/new');
const letter = await reg.post('/registry/new', { confirm_similar: '1', subject: 'کتابێک بۆ ژووری یاسا لە کاتی مۆڵەتدا', doc_type: 'internal',
  sender_kind: 'internal', sender_name: 'تاقیکردنەوە', priority: 'normal' });
const docPath = letter.location?.replace(BASE, '').split('?')[0];
const mayor = sessions.aram;
const docPage = await mayor.get(docPath);
const legalRoomId = [...docPage.body.matchAll(/<option value="(\d+)">([^<]+)</g)].find(m => m[2].includes('یاسا'))?.[1];
await mayor.post(`${docPath}/route`, { mode: 'single', to_room_id: legalRoomId, note: '' });
const trailPage = await mayor.get(docPath);
check('a letter sent to the room while the head is away goes to the deputy',
      trailPage.body.includes('ساکار ئەحمەد') && trailPage.body.includes('جێگر'));
const dashboard = await mayor.get('/dashboard');
check('the dashboard shows the head as away', dashboard.body.includes('لە مۆڵەتە'));

// --- the archive --------------------------------------------------------------

console.log('\n--- the drawing archive ---');

const ar = sessions.karwan;
await ar.get('/archive/new');
const plot = `${Math.floor(100 + Math.random() * 900)}/7`;
// The bytes decide the type, so these must look like real files at the front.
// Different bytes every run: the same file cannot be archived twice.
const fakeDwg = Buffer.concat([Buffer.from('AC1032'), Buffer.from(String(Math.random())), Buffer.alloc(4096, 7)]);
const fakePdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const meta = { plot_no: plot, block: '12', neighbourhood: 'سەرچنار', title: 'نەخشەی پارچەی تاقیکردنەوە',
  owner_names: 'سەلام حەسەن', year: '2019', shelf: 'A3', section: '2', box_no: '', folder_no: '41' };

const mk = await ar.upload('/archive/new', meta, {
  file:    { name: '../../evil name ٢٤٧.dwg', bytes: fakeDwg, type: 'application/octet-stream' },
  preview: { name: 'drawing.pdf', bytes: fakePdf, type: 'application/pdf' },
});
check('the archive clerk can upload a drawing with its PDF', mk.status === 303 && /\/archive\/\d+/.test(mk.location ?? ''), `${mk.status} ${mk.location ?? mk.body.slice(0, 200)}`);
const arPath = mk.location.replace(BASE, '').split('?')[0];

const renamed = await ar.upload('/archive/new', { ...meta, plot_no: plot + '/x' }, {
  file: { name: 'really-a-pdf.dwg', bytes: Buffer.concat([fakePdf, Buffer.from('%' + Math.random() + '\n')]), type: 'application/acad' },
});
const renamedPage = await ar.get(renamed.location?.replace(BASE, '').split('?')[0] ?? '/archive');
check('a PDF renamed to .dwg is stored as what it is', /\/archive\/\d+/.test(renamed.location ?? '') && renamedPage.body.includes('PDF') && !renamedPage.body.includes('داگرتنی DWG'), renamed.location ?? `status ${renamed.status}`);

const junk = await ar.upload('/archive/new', { ...meta, plot_no: plot + '/y' }, {
  file: { name: 'macro.exe', bytes: Buffer.from('MZ\x90\x00garbage-garbage-garbage'), type: 'application/octet-stream' },
});
check('a file that is none of the allowed types is refused', junk.status === 400 && junk.body.includes('قبوڵ ناکرێت'), `status ${junk.status}`);

const rec = await ar.get(arPath);
check('the stored name is the original, the path is not', rec.body.includes('evil name') && !rec.body.includes('evil name ٢٤٧.dwg"'));
check('the size is shown', rec.body.includes('کیلۆبایت'));

const byExact = await ar.get('/archive?q=' + encodeURIComponent(plot));
check('exact plot number finds it', byExact.body.includes('نەخشەی پارچەی تاقیکردنەوە'));
const byArabicDigits = await ar.get('/archive?q=' + encodeURIComponent(plot.replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]).replace('/', ' / ')));
check('the same plot in Arabic-Indic digits with spaces finds it', byArabicDigits.body.includes('نەخشەی پارچەی تاقیکردنەوە'));
const byPrefix = await ar.get('/archive?q=' + plot.split('/')[0]);
check('the plot prefix alone finds it', byPrefix.body.includes('نەخشەی پارچەی تاقیکردنەوە'));
const byOwner = await ar.get('/archive?q=' + encodeURIComponent('سلام حسن'));
check('the owner typed on an Arabic keyboard finds it', byOwner.body.includes('نەخشەی پارچەی تاقیکردنەوە'));
check('the result shows where it is on the shelf', byExact.body.includes('ڕەف A3') && byExact.body.includes('دۆسیە 41'));

const dl = await fetch(BASE + arPath + '/download', { headers: { cookie: [...ar.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
const dlBytes = Buffer.from(await dl.arrayBuffer());
check('the download returns the exact bytes uploaded', dl.status === 200 && dlBytes.equals(fakeDwg), `status ${dl.status}, ${dlBytes.length} bytes`);
check('the download carries the original name', (dl.headers.get('content-disposition') ?? '').includes(encodeURIComponent('evil name')));

const selfVerify = await ar.post(`${arPath}/verify`, {});
check('the uploader cannot verify their own upload', selfVerify.location?.includes('error='), selfVerify.location);

const other = sessions.zhyan;
await other.get(arPath);
const verify = await other.post(`${arPath}/verify`, {});
check('a second clerk can verify it', verify.status === 303 && verify.location?.includes('saved=1'), verify.location);
const verified = await other.get(arPath);
check('the record shows as verified', verified.body.includes('پشتڕاستکراوە') && !verified.body.includes('هێشتا پشتڕاست'));

const dwgNoPdf = await ar.upload('/archive/new', { ...meta, plot_no: plot + '/z' }, {
  file: { name: 'lonely.dwg', bytes: Buffer.concat([fakeDwg, Buffer.from('lonely')]), type: 'application/octet-stream' },
});
const lonelyPath = dwgNoPdf.location?.replace(BASE, '').split('?')[0];
await other.get(lonelyPath);
const lonelyVerify = await other.post(`${lonelyPath}/verify`, {});
check('a DWG without a PDF cannot be verified', lonelyVerify.location?.includes('error='), lonelyVerify.location);

// --- the lock -----------------------------------------------------------------

console.log('\n--- the maintenance lock ---');

await mayor.get('/dashboard');
const lock = await mayor.post('/admin/lock', { message: 'سیستەم بۆ نوێکردنەوە داخراوە' });
check('the mayor can lock the system', lock.status === 303, `status ${lock.status}`);
const kicked = await sessions.hemin.get('/inbox');
check('everyone else is signed out at once', kicked.status === 303 && kicked.location?.includes('/login'), kicked.location);
const retry = new Session();
const refused = await retry.signIn('hemin');
check('and cannot sign back in', refused.status === 401, `status ${refused.status}`);
check('they see the mayor message', refused.body.includes('بۆ نوێکردنەوە داخراوە'));
const stillMayor = await mayor.get('/dashboard');
check('the mayor stays signed in', ok(stillMayor), `status ${stillMayor.status}`);
const unlock = await mayor.post('/admin/unlock', {});
check('the mayor can unlock', unlock.status === 303);
const back = await retry.signIn('hemin');
check('after which others can sign in again', back.status === 303, `status ${back.status}`);

const log = await mayor.get('/log?action=system');
check('both lock and unlock are in the log', log.body.includes('system.locked') && log.body.includes('system.unlocked'));

console.log(failures ? `\n${failures} FAILED` : '\nevery screen and every administrative flow works');
process.exit(failures ? 1 : 0);
