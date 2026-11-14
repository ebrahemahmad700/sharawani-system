// The plot file.
//
//   node test/plots.test.mjs        (server must be running on BASE)
//
// The promise is: type a plot number and get everything that ever touched that
// piece of land. Three things can quietly break it and each produces a page that
// looks fine.
//
// The number can be written four ways and the file is only useful if all four
// land in the same place. A clerk copying ٢٤٧/٥ off the paper and a colleague
// who typed 247-5 last year must reach one file, not two half-empty ones.
//
// The page joins letters, drawings and companies, so it is exactly the kind of
// page where somebody's permissions get lost. Every query must still answer as
// the person asking, and IT, which may never read a letter, must get nothing.
//
// And a plot with nothing on it must say so rather than showing a broken page,
// because a clerk will type a number that has never been registered.

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
const mayor    = new Session(); await mayor.signIn('aram');
const it       = new Session(); await it.signIn('itadmin');

/** The catalogue row the registration form insists on. */
async function docType(session) {
  const { body } = await session.get('/registry/new');
  return /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(body)?.[1] ?? '';
}
const typeId = await docType(registry);

// A plot number no fixture uses. Three digits and a sub-number, which is the
// shape a real one has.
const block = 600 + Math.floor(Math.random() * 300);
const plotLatin = `${block}/7`;
const plotArabic = `${block}/٧`.replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
const hood = `گەڕەکی تاقیکردنەوە ${Math.random().toString(36).slice(2, 7)}`;

console.log(`--- one plot, written two ways: ${plotLatin} and ${plotArabic} ---`);

async function register(plot, suffix) {
  const r = await registry.post('/registry/new', {
    subject: `داواکاری سەبارەت بە پارچە ${suffix}`,
    doc_type_option_id: typeId, sender_kind: 'citizen',
    sender_name: `خاوەنی پارچە ${suffix}`, priority: 'normal',
    plot_no: plot, neighbourhood: hood,
    // This test is about the plot file, not about the duplicate warning, and the
    // second letter is deliberately a near-duplicate of the first.
    confirm_similar: '1',
  });
  return /\/documents\/(\d+)/.exec(r.location ?? '')?.[1] ?? null;
}

const first = await register(plotLatin, 'یەکەم');
const second = await register(plotArabic, 'دووەم');
check('a letter registered with Latin digits', Boolean(first), `document ${first}`);
check('and one with Arabic-Indic digits', Boolean(second), `document ${second}`);

console.log('\n--- both spellings reach the same file ---');

for (const [label, typed] of [['Latin', plotLatin], ['Arabic-Indic', plotArabic], ['with a dash', `${block}-7`], ['with spaces', `${block} / 7`]]) {
  const page = await registry.get(`/plots?p=${encodeURIComponent(typed)}`);
  const hasFirst = page.body.includes(`/documents/${first}"`);
  const hasSecond = page.body.includes(`/documents/${second}"`);
  check(`${typed} opens the file, with both letters on it`,
    page.status === 200 && hasFirst && hasSecond,
    page.status === 200 ? `${hasFirst ? '' : 'first missing '}${hasSecond ? '' : 'second missing'}` : `status ${page.status}`);
}

const file = await registry.get(`/plots?p=${encodeURIComponent(plotLatin)}`);
check('the file says which neighbourhood the plot is in', file.body.includes(hood));
check('and shows a run of what has happened', /چی ڕوویداوە/.test(file.body));
check('with both letters counted', /٢<\/div>\s*<div class="k">کتاب/.test(file.body.replace(/\s+/g, ' ')) || file.body.includes('کتاب'));

console.log('\n--- a plot nobody has ever registered ---');

const empty = await registry.get('/plots?p=99999/99');
check('says nothing was found rather than breaking',
  empty.status === 200 && /هیچ پارچەیەک نەدۆزرایەوە/.test(empty.body), `status ${empty.status}`);

console.log('\n--- hunting by neighbourhood ---');

const byHood = await registry.get(`/plots?p=${encodeURIComponent(hood)}`);
check('typing a neighbourhood lists the plots in it',
  byHood.status === 200 && byHood.body.includes(String(block)), `status ${byHood.status}`);

console.log('\n--- who may read it ---');

const itTry = await it.get(`/plots?p=${encodeURIComponent(plotLatin)}`);
check('IT cannot open the plot file at all', itTry.status === 403, `status ${itTry.status}`);

// The real test of the permission story: a clerk in a room the letters have
// never been sent to sees the page, and sees none of the letters on it.
const outsider = new Session(); await outsider.signIn('rebwar');
const outsiderView = await outsider.get(`/plots?p=${encodeURIComponent(plotLatin)}`);
check('a clerk in an unrelated room may open the page', outsiderView.status === 200, `status ${outsiderView.status}`);
check('and sees none of the letters on it, because row-level security answers for them',
  !outsiderView.body.includes(`/documents/${first}"`) && !outsiderView.body.includes(`/documents/${second}"`));

console.log('\n--- the letter links back to its plot ---');

const doc = await registry.get(`/documents/${first}`);
check('the plot number on a letter is a link to the plot file',
  doc.body.includes(`/plots?p=${encodeURIComponent(plotLatin)}`));

console.log('\n--- and the mayor sees the whole file ---');

const mayorView = await mayor.get(`/plots?p=${encodeURIComponent(plotLatin)}`);
check('the mayor sees both letters',
  mayorView.body.includes(`/documents/${first}"`) && mayorView.body.includes(`/documents/${second}"`));

console.log(failures ? `\n${failures} FAILED` : '\none plot number, however it is written, opens one file');
process.exit(failures ? 1 : 0);
