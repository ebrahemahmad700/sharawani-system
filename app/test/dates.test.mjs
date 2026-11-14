// Date fields in the system's own order, and the dashboard's two columns.
//
//   node test/dates.test.mjs        (server must be running on BASE)
//
// The browser's date box wrote «mm/dd/yyyy» or «dd/mm/yyyy» depending on the
// machine, while every screen shows ٢٠٢٦/٠٩/١٣ (design test, 13 September). The
// fields are now text in ساڵ/مانگ/ڕۆژ with a calendar from public/app.js, and
// the server reads what is typed in either kind of digit. The calendar itself is
// tried in a real browser by e2e/audit/j3-records.spec.mjs.

import { readDay, dayValue, dateInput } from '../src/lib/html.mjs';

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i).trim(); const v = p.slice(i + 1); if (v) this.cookies.set(k, v); else this.cookies.delete(k); } } }
  async get(path) { const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async signIn(u) { await this.get('/login'); const r = await this.post('/login', { username: u, password: PASSWORD }); await this.get('/inbox'); return r; }
}

const KU = s => String(s).replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d)));
const errorOf = location => decodeURIComponent(/error=([^&]+)/.exec(location ?? '')?.[1] ?? '');

// --- reading a typed date, without the server ----------------------------------

const readings = [
  ['٢٠٢٦/٠٩/١٣', '2026-09-13'], ['2026-09-13', '2026-09-13'], ['2026/9/3', '2026-09-03'],
  ['١٣/٩/٢٠٢٦', '2026-09-13'], ['20260913', '2026-09-13'], ['۲۰۲۶.۰۹.۱۳', '2026-09-13'],
  [' ٢٠٢٨ / ٠٢ / ٢٩ ', '2028-02-29'], ['', ''], ['   ', ''],
  ['2026/02/29', null], ['2026/13/01', null], ['2026/04/31', null], ['13/13/26', null], ['abc', null], ['2026/09/13x', null],
];
for (const [typed, want] of readings) {
  check(`reads «${typed}» as ${JSON.stringify(want)}`, readDay(typed) === want, JSON.stringify(readDay(typed)));
}
check('shows a stored day as ٢٠٢٦/٠٩/١٣', dayValue('2026-09-13') === '٢٠٢٦/٠٩/١٣' && dayValue(new Date(2027, 2, 1)) === '٢٠٢٧/٠٣/٠١');
check('keeps a mistyped date as it was typed, to be corrected', dayValue('2026/02/30') === '2026/02/30' && dayValue(null) === '');
const field = String(dateInput({ id: 'end_date', required: true, after: 'start_date' }));
check('a date field is text in ساڵ/مانگ/ڕۆژ, not the browser\'s date box',
  !field.includes('type="date"') && field.includes('type="text"') && field.includes('placeholder="ساڵ\u200E/\u200Eمانگ\u200E/\u200Eڕۆژ"')
  && field.includes('data-after="start_date"') && / required/.test(field), field);

// --- leave ------------------------------------------------------------------------

const hr = new Session(); await hr.signIn('bafrin');
const leavePage = await hr.get('/leave');
check('the leave form has no browser date box left', leavePage.status === 200 && !leavePage.body.includes('type="date"')
  && (leavePage.body.match(/data-date/g) ?? []).length === 2);

// Far ahead and different every run: a person cannot have two leaves on the same days.
const offset = 3000 + Math.floor(Math.random() * 4000);
const dayAhead = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const from = dayAhead(offset), to = dayAhead(offset + 3);
const kuFrom = KU(from.replaceAll('-', '/')), kuTo = KU(to.replaceAll('-', '/'));

const typedKurdish = await hr.post('/leave/new', { start_date: kuFrom, end_date: kuTo, leave_type: 'annual', note: 'بەرواری کوردی' });
check('a leave typed in Kurdish digits is accepted', typedKurdish.status === 303 && /ok=1/.test(typedKurdish.location ?? ''), typedKurdish.location);
const listed = await hr.get('/leave');
check('and listed with those days', listed.body.includes(kuFrom) && listed.body.includes(kuTo));
// Cancelled again, so the next run's days stay free and nobody is told about a test leave.
const mine = new RegExp(`action="/leave/(\\d+)/cancel"`).exec(listed.body.slice(listed.body.indexOf(kuFrom)));
if (mine) await hr.post(`/leave/${mine[1]}/cancel`, {});

const notADay = await hr.post('/leave/new', { start_date: '٢٠٢٦/٠٢/٣٠', end_date: '٢٠٢٦/٠٣/٠٢', leave_type: 'annual' });
check('a day that does not exist is refused with the format to use, not the error page',
  notADay.status === 303 && /بەروارەکان دروست نین/.test(errorOf(notADay.location)) && /ساڵ\/مانگ\/ڕۆژ/.test(errorOf(notADay.location)), errorOf(notADay.location));
const backwards = await hr.post('/leave/new', { start_date: KU(dayAhead(offset + 20).replaceAll('-', '/')), end_date: KU(dayAhead(offset + 15).replaceAll('-', '/')), leave_type: 'annual' });
check('an end before the start is refused by the server too', backwards.status === 303 && /«تا»/.test(errorOf(backwards.location)), errorOf(backwards.location));

// --- companies ----------------------------------------------------------------------

const clerk = new Session(); await clerk.signIn('shilan');
const mark = Math.random().toString(36).slice(2, 8).toUpperCase();
await clerk.get('/companies/new');
const bad = await clerk.post('/companies/new', { name: `کۆمپانیای بەروار ${mark}`, registration_no: `DATE-${mark}`, licence_expires_on: '2027/02/31' });
check('a licence date that is not a day refuses the form with the reason', bad.status === 400 && bad.body.includes('بەرواری بەسەرچوونی مۆڵەت دروست نییە'));
check('and keeps what was typed in the box', bad.body.includes('value="2027/02/31"'));

const good = await clerk.post('/companies/new', { name: `کۆمپانیای بەروار ${mark}`, registration_no: `DATE-${mark}`, licence_expires_on: '٠١/٠٣/٢٠٢٧' });
check('a licence date written the paper way round is accepted', good.status === 303 && /\/companies\/\d+/.test(good.location ?? ''), `${good.status} ${good.location}`);
const companyId = /\/companies\/(\d+)/.exec(good.location ?? '')?.[1];
if (companyId) {
  const edit = await clerk.get(`/companies/${companyId}/edit`);
  check('and shown back in the edit form as ٢٠٢٧/٠٣/٠١', edit.body.includes('value="٢٠٢٧/٠٣/٠١"'));
  const cleared = await clerk.post(`/companies/${companyId}/edit`, { name: `کۆمپانیای بەروار ${mark}`, registration_no: `DATE-${mark}`, licence_expires_on: '' });
  const after = await clerk.get(`/companies/${companyId}/edit`);
  check('emptying the field removes the date', cleared.status === 303 && /id="licence_expires_on"[^>]*value=""/.test(after.body));
}

// --- the mayor's dashboard ----------------------------------------------------------

const mayor = new Session(); await mayor.signIn('aram');
const dash = await mayor.get('/dashboard');
check('the dashboard puts rooms and the assistant beside the activity list as one pair',
  dash.status === 200 && /class="grid cols-2 dash-pair"/.test(dash.body) && /class="dash-side"/.test(dash.body)
  && /class="card dash-feed"/.test(dash.body) && /class="card dash-rooms"/.test(dash.body) && !/cols-2" style="align-items:start"/.test(dash.body));

console.log(failures ? `\n${failures} FAILED` : '\nall date checks hold');
process.exit(failures ? 1 : 0);
