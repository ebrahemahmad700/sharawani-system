// Confidential letters, the reply-by date promised at the counter, and the
// registers as spreadsheets (migration 0600).
//
// Confidential: the front desk registers a letter as confidential and sends it
// to Legal. The other front-desk clerk cannot open it, find it, or see it in the
// register or the spreadsheet; Legal, the mayor and the clerk who registered it
// can. A room clerk cannot change the mark, through the form or underneath it.
//
// Reply-by: the date is printed on the receipt, shown on the letter and in the
// inbox of the room that holds it, and once it is close it appears in the front
// desk's and the mayor's list of promises coming due.
//
//   node test/letter-flags.test.mjs     (server must be running on BASE)

import pg from 'pg';

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
const APP = process.env.DATABASE_URL_APP;

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
    return { status: res.status, location: res.headers.get('location'), body, headers: res.headers };
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
  async signIn(username) {
    await this.get('/login');
    const r = await this.post('/login', { username, password: PASSWORD });
    if (r.status === 303) { const h = await this.get('/'); await this.get(h.location?.replace(BASE, '') ?? '/'); }
    return r;
  }
}

const as = async user => { const s = new Session(); const r = await s.signIn(user); check(`${user} signs in`, r.status === 303); return s; };
const isoIn = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const docId = loc => /\/documents\/(\d+)/.exec(loc ?? '')?.[1];

const shilan = await as('shilan');  // front desk, registers it
const ahang = await as('ahang');    // the other person at the front desk
const hemin = await as('hemin');    // head of Legal, where it is sent
const sakar = await as('sakar');    // clerk in Legal
const hersh = await as('hersh');    // head of Land, not involved
const aram = await as('aram');      // mayor

const tag = Math.random().toString(36).slice(2, 8);
const register = async (s, fields) => {
  await s.get('/registry/new');
  const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec((await s.get('/registry/new')).body)?.[1];
  return s.post('/registry/new', {
    doc_type_option_id: typeId, sender_kind: 'citizen', priority: 'normal', confirm_similar: '1', ...fields,
  });
};

// --- confidential --------------------------------------------------------------

console.log('\n--- a confidential letter ---');

const secretSubject = `کتابی نهێنی ${tag}`;
const reg = await register(shilan, { subject: secretSubject, sender_name: `هاووڵاتی ${tag}`, is_confidential: '1', reply_by: isoIn(2) });
const id = docId(reg.location);
check('the front desk registers a confidential letter', reg.status === 303 && Boolean(id), `${reg.status} ${reg.location}`);

const own = await shilan.get(`/documents/${id}`);
check('the clerk who registered it sees it, marked confidential', own.status === 200 && own.body.includes('نهێنی'));

const legalId = /<option value="(\d+)">ژووری یاسا/.exec(own.body)?.[1];
const sent = await shilan.post(`/documents/${id}/route`, { mode: 'single', to_room_id: legalId, note: '' });
check('and sends it to Legal', sent.status === 303 && !(sent.location ?? '').includes('error='), sent.location);

// The letter started at the front desk and was sent from there, which for an
// ordinary letter is enough for anyone in that room to open it.
check('the other person at the front desk cannot open it', (await ahang.get(`/documents/${id}`)).status === 404);
check('nor find it by search', !(await ahang.get('/documents?q=' + encodeURIComponent(tag))).body.includes(secretSubject));
check('nor print its receipt', (await ahang.get(`/documents/${id}/receipt`)).status === 404);
check('nor read its trail through the hand-off the front desk made', !(await ahang.get('/my-day')).body.includes(secretSubject));

// A front-desk clerk who did not register it: the mayor's office registers one.
const mayorSecret = `کتابی نهێنی سەرۆک ${tag}`;
const mreg = await register(aram, { subject: mayorSecret, sender_name: `فەرمانگە ${tag}`, sender_kind: 'government', is_confidential: '1' });
const mid = docId(mreg.location);
check('the mayor registers a confidential letter', Boolean(mid), `${mreg.status} ${mreg.location}`);
check('the front-desk clerk cannot open it', (await shilan.get(`/documents/${mid}`)).status === 404);
check('nor see it in the register', !(await shilan.get('/registry?q=' + encodeURIComponent(tag))).body.includes(mayorSecret));
const shilanCsv0 = await shilan.get(`/registry/export.csv?from=${isoIn(-1)}&to=${isoIn(1)}`);
check('nor in the register spreadsheet', shilanCsv0.status === 200 && !shilanCsv0.body.includes(mayorSecret), `status ${shilanCsv0.status}`);
check('while the one she registered herself is', shilanCsv0.body.includes(secretSubject));

check('Legal, where it was sent, can open it', (await hemin.get(`/documents/${id}`)).status === 200);
check('and so can Legal\'s clerk', (await sakar.get(`/documents/${id}`)).status === 200);
check('a room it was never sent to cannot', (await hersh.get(`/documents/${id}`)).status === 404);
check('the mayor can', (await aram.get(`/documents/${id}`)).status === 200);
const shilanCsv = await shilan.get(`/registry/export.csv?from=${isoIn(-1)}&to=${isoIn(1)}`);
check('it is in the spreadsheet of the clerk who registered it, marked', shilanCsv.body.includes(secretSubject) && shilanCsv.body.includes('"بەڵێ"'));

console.log('\n--- who may change the mark ---');

await sakar.get(`/documents/${id}`);
const sakarFlip = await sakar.post(`/documents/${id}/flags`, { reply_by: '' });
check('a room clerk is refused by the screen', (sakarFlip.location ?? '').includes('error='), sakarFlip.location);

if (APP) {
  // Underneath the screen: the web server's own connection, acting as Legal's
  // clerk, trying to clear the mark directly. The trigger refuses it.
  const db = new pg.Client({ connectionString: APP }); await db.connect();
  const { rows: [u] } = await db.query(`SELECT id FROM app_user WHERE username = 'sakar'`).catch(() => ({ rows: [] }));
  let refused = false;
  try {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [String(u?.id ?? '')]);
    await db.query(`UPDATE document SET is_confidential = false WHERE id = $1`, [id]);
  } catch (e) { refused = e.code === '42501'; }
  await db.query('ROLLBACK').catch(() => {}); await db.end();
  check('and by the database, if anything got past the screen', refused);
} else {
  console.log('skip  database refusal: DATABASE_URL_APP not set');
}

const unmark = await aram.post(`/documents/${id}/flags`, { reply_by: isoIn(2) });
check('the mayor may take the mark off', (unmark.location ?? '').includes('done=flags'), unmark.location);
check('after which the whole front desk sees it again', (await ahang.get(`/documents/${id}`)).status === 200);

// --- reply-by ------------------------------------------------------------------

console.log('\n--- the reply promised at the counter ---');

const page = await hemin.get(`/documents/${id}`);
check('the letter shows the promised date', page.body.includes('بەڵێنی وەڵام بۆ داواکار') && page.body.includes('ڕۆژی ماوە'));
check('the inbox of the room that has it shows it too', (await hemin.get('/inbox')).body.includes('بەڵێنی وەڵام'));
check('the receipt prints it', (await shilan.get(`/documents/${id}/receipt`)).body.includes('بەرواری وەڵامدانەوە'));
check('the front desk sees it among promises coming due', (await shilan.get('/registry')).body.includes('بەڵێنی وەڵامدانەوە') );
check('and so does the mayor\'s dashboard', (await aram.get('/dashboard')).body.includes(secretSubject));

const early = await shilan.post(`/documents/${id}/flags`, { reply_by: isoIn(-30) });
check('a date before the letter arrived is refused', (early.location ?? '').includes('error='), early.location);
const bad = await register(shilan, { subject: `کتابی هەڵە ${tag}`, sender_name: 'x y', reply_by: 'next week' });
check('a reply-by that is not a date is refused at registration', bad.status === 400, `status ${bad.status}`);

// --- the outgoing register -------------------------------------------------------

console.log('\n--- the outgoing register as a spreadsheet ---');
const out = await shilan.get(`/outgoing/export.csv?from=${isoIn(-400)}&to=${isoIn(1)}`);
check('the front desk downloads the outgoing register', out.status === 200 && (out.headers.get('content-type') ?? '').startsWith('text/csv') && out.body.includes('ژمارەی دەرچوو'), `status ${out.status}`);
const it = await as('itadmin');
check('IT does not', (await it.get('/outgoing/export.csv')).status === 403);
check('nor the incoming one', (await it.get('/registry/export.csv')).status === 403);
check('a room head cannot take the whole incoming register', (await hersh.get('/registry/export.csv')).status === 403);

console.log(failures ? `\n${failures} FAILED` : '\nconfidential letters stay with the people they were sent to, and promises are kept in sight');
process.exit(failures ? 1 : 0);
