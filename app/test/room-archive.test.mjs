// Every room has its own archive, and a file lent out of it is recorded
// (migration 0600).
//
// Legal files a folder in its own archive. Legal's clerk finds it; Land, the
// front desk and IT do not, by the list, by its address, by its download, or by
// the spreadsheet. The mayor sees it among every room's. The base map rooms
// still have to give a plot number; Legal does not.
//
// Then the folder is lent out: it shows as out on the list and on the record, a
// second loan of the same folder is refused, another room cannot lend or return
// it, an overdue loan turns red, and the return closes it and keeps the history.
//
//   node test/room-archive.test.mjs     (server must be running on BASE)

import pg from 'pg';

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
const OWNER = process.env.DATABASE_URL_OWNER;

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
    const buf = Buffer.from(await res.arrayBuffer());
    const body = buf.toString('utf8');
    const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t;
    return { status: res.status, location: res.headers.get('location'), body, buf, headers: res.headers };
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
  async signIn(username) {
    await this.get('/login');
    const r = await this.post('/login', { username, password: PASSWORD });
    if (r.status === 303) { const h = await this.get('/'); await this.get(h.location?.replace(BASE, '') ?? '/'); }
    return r;
  }
}

const as = async user => { const s = new Session(); const r = await s.signIn(user); check(`${user} signs in`, r.status === 303); return s; };
const pathOf = loc => (loc ?? '').replace(BASE, '').split('?')[0].split('#')[0];
const isoIn = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const hemin = await as('hemin');    // head of Legal
const sakar = await as('sakar');    // clerk in Legal
const hersh = await as('hersh');    // head of Land
const shilan = await as('shilan');  // front desk
const karwan = await as('karwan');  // base map room 8
const aram = await as('aram');      // mayor
const it = await as('itadmin');

const tag = Math.random().toString(36).slice(2, 8);
const title = `دۆسیەی یاسایی ${tag}`;
const pdf = Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);

// --- filing into a room's own archive ------------------------------------------

console.log('\n--- each room files into its own archive ---');

const legalRoomId = /name="room_id" value="(\d+)"/.exec((await hemin.get('/archive/new')).body)?.[1];
check('a room head is offered their own room\'s archive', Boolean(legalRoomId));

const filed = await hemin.upload('/archive/new', {
  room_id: legalRoomId, title, plot_no: '', block: '', neighbourhood: '', owner_names: '', year: '2025',
  shelf: 'L1', section: '3', box_no: '', folder_no: '12',
}, { file: { name: 'case.pdf', bytes: pdf, type: 'application/pdf' } });
check('Legal files a folder with no plot number', filed.status === 303 && /\/archive\/\d+/.test(filed.location ?? ''),
      `${filed.status} ${filed.location ?? filed.body.match(/notice[^>]*>([^<]+)/)?.[1] ?? ''}`);
const recPath = pathOf(filed.location);

const hostile = await hemin.upload('/archive/new', {
  room_id: '1', title: `بۆ ژوورێکی تر ${tag}`, shelf: 'X', section: '1', folder_no: '1',
}, { file: { name: 'x.pdf', bytes: Buffer.concat([pdf, Buffer.from('%x\n')]), type: 'application/pdf' } });
check('but cannot file into another room\'s archive', hostile.status === 400, `status ${hostile.status}`);

const noPlot = await karwan.upload('/archive/new', {
  title: `نەخشە بێ پارچە ${tag}`, plot_no: '', shelf: 'A1', section: '1', folder_no: '2',
}, { file: { name: 'm.pdf', bytes: Buffer.concat([pdf, Buffer.from('%m\n')]), type: 'application/pdf' } });
check('a base map room must still give a plot number', noPlot.status === 400 && noPlot.body.includes('ژمارەی پارچە'), `status ${noPlot.status}`);

console.log('\n--- who sees it ---');

check('Legal\'s clerk sees it in the list', (await sakar.get('/archive')).body.includes(title));
check('and can open it', (await sakar.get(recPath)).status === 200);
check('Land does not see it in its list', !(await hersh.get('/archive')).body.includes(title));
check('nor by asking for Legal\'s archive by number', !(await hersh.get(`/archive?room=${legalRoomId}`)).body.includes(title));
check('nor by its address', (await hersh.get(recPath)).status === 404);
check('nor by its download', (await hersh.get(`${recPath}/download`)).status === 404);
check('the front desk does not see it', (await shilan.get(recPath)).status === 404);
check('the front desk has its own, separate archive', (await shilan.get('/archive')).status === 200);
check('IT has no archive at all', (await it.get('/archive')).status === 403);
const mayorAll = await aram.get('/archive?room=all');
check('the mayor sees it among every room\'s', mayorAll.body.includes(title) && mayorAll.body.includes('هەموو ژوورەکان'));
check('with the room it belongs to', (await aram.get(recPath)).body.includes('ژووری یاسا'));

// --- lending ---------------------------------------------------------------------

console.log('\n--- lending a folder out and back ---');

await sakar.get(recPath);
const lent = await sakar.post(`${recPath}/lend`, { borrower_name: 'دلێر عەلی', borrower_room_id: '', due_on: isoIn(3), purpose: 'بۆ گرێبەست' });
check('the clerk records the folder leaving', lent.status === 303 && (lent.location ?? '').includes('lent=1'), lent.location);
const outRec = await sakar.get(recPath);
check('the record says who has it', outRec.body.includes('ئێستا لای') && outRec.body.includes('دلێر عەلی'));
check('the list says it is out', (await sakar.get('/archive')).body.includes('لای دلێر عەلی'));

const twice = await hemin.post(`${recPath}/lend`, { borrower_name: 'کەسێکی تر', due_on: isoIn(2) });
check('it cannot be lent twice at once', (twice.location ?? '').includes('error='), twice.location);

const past = await hemin.post(`${recPath}/lend`, { borrower_name: 'کەسێکی تر', due_on: isoIn(-2) });
check('a return date in the past is refused', (past.location ?? '').includes('error='), past.location);

const landReturn = await hersh.post(`${recPath}/return`, {});
check('another room cannot mark it returned', (landReturn.location ?? '').includes('error='), landReturn.location);

if (OWNER) {
  // Make the loan overdue the only way it can become so: time passing.
  const db = new pg.Client({ connectionString: OWNER }); await db.connect();
  await db.query(`UPDATE archive_loan SET due_on = current_date - 2
                   WHERE returned_at IS NULL AND archive_file_id = $1`, [Number(recPath.split('/').pop())]);
  await db.end();
  const late = await hemin.get('/archive');
  check('an overdue loan is shown as late on the archive', late.body.includes('دواکەوتوو') && late.body.includes('فایلە دەرچووەکان'));
} else {
  console.log('skip  overdue: DATABASE_URL_OWNER not set');
}

const back = await sakar.post(`${recPath}/return`, {});
check('the clerk records its return', (back.location ?? '').includes('returned=1'), back.location);
const afterRec = await sakar.get(recPath);
check('it is back on the shelf', !afterRec.body.includes('ئێستا لای'));
check('and the loan stays in its history', afterRec.body.includes('مێژووی دەرچوون') && afterRec.body.includes('دلێر عەلی'));
const again = await sakar.post(`${recPath}/return`, {});
check('returning it twice is refused', (again.location ?? '').includes('error='), again.location);

// --- the spreadsheet -------------------------------------------------------------

console.log('\n--- the archive as a spreadsheet ---');

const injTitle = `=HYPERLINK("http://x") ${tag}`;
await hemin.get('/archive/new');
await hemin.upload('/archive/new', { room_id: legalRoomId, title: injTitle, shelf: 'L1', section: '3', folder_no: '13' },
  { file: { name: 'inj.pdf', bytes: Buffer.concat([pdf, Buffer.from('%inj\n')]), type: 'application/pdf' } });

const csv = await hemin.get('/archive/export.csv');
check('Legal can download its archive', csv.status === 200 && (csv.headers.get('content-type') ?? '').startsWith('text/csv'), `status ${csv.status}`);
check('the file starts with the mark Excel needs for Kurdish', csv.buf[0] === 0xEF && csv.buf[1] === 0xBB && csv.buf[2] === 0xBF);
check('it has the folder', csv.body.includes(title));
check('a title that looks like a formula is written as text', csv.body.includes(`"'=HYPERLINK`) && !csv.body.includes(`"=HYPERLINK`));
const landCsv = await hersh.get('/archive/export.csv');
check('Land\'s spreadsheet does not have Legal\'s folder', landCsv.status === 200 && !landCsv.body.includes(title));
check('IT gets no spreadsheet', (await it.get('/archive/export.csv')).status === 403);

console.log(failures ? `\n${failures} FAILED` : '\nevery room keeps its own archive, and knows where its folders are');
process.exit(failures ? 1 : 0);
