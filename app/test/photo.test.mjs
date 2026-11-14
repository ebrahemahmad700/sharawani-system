// Registering a letter from a photograph of it.
//
//   node test/photo.test.mjs        (server must be running on BASE)
//
// Two halves, tested at the level each belongs to.
//
// The guessing is a pure function over text, so it is tested with the Kurdish
// and Arabic a real letter carries, written here as strings. That is the part
// with the judgement in it and the part that will be wrong in interesting ways.
//
// The plumbing is tested over HTTP with a page the test can actually draw: the
// photograph is uploaded, lands in the scan tray, comes back as a filled form,
// and is attached to the letter by the act of registering it. That path has to
// hold whether or not anything was recognised, because a photograph the reader
// made nothing of must still end up filed against the letter.

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractLetterFields, asFormValues, dateFrom } from '../src/lib/letterfields.mjs';

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

// ---------------------------------------------------------------------------
console.log('--- what can be made out of a letter ---');

// An invented letter in the shape the region actually writes them: a letterhead,
// a marked reference, a marked date, a subject after م/, and a plot number.
// Every name and number in it is made up.
const letter = [
  'بەڕێوەبەرایەتی پلاندانانی شار',
  'ژمارە: ٤٥٢١',
  'بەروار: ٢٠٢٦/٩/١١',
  'بۆ / شارەوانی ڕانیە',
  'م/ داواکاری مۆڵەتی بینا',
  'سڵاو و ڕێز،',
  'داواکارییەک پێشکەش کراوە سەبارەت بە پارچە ٢٤٧/٥ لە گەڕەکی سەرچنار.',
  'تکایە پێداچوونەوەی پێویست بکرێت.',
].join('\n');

const { found } = extractLetterFields(letter);

check('the reference number is found', found.reference?.value === '4521', found.reference?.value);
check('the date is found and put in order', found.date?.value === '2026-09-11', found.date?.value);
check('the subject is found after م/', found.subject?.value === 'داواکاری مۆڵەتی بینا', found.subject?.value);
check('the plot number is found and canonicalised', found.plot_no?.value === '247/5', found.plot_no?.value);
check('the neighbourhood is found', /سەرچنار/.test(found.neighbourhood?.value ?? ''), found.neighbourhood?.value);
check('the letterhead is taken as the sender', /پلاندانانی/.test(found.sender_name?.value ?? ''), found.sender_name?.value);

check('every guess says which line it came from',
  Object.values(found).every(f => typeof f.from === 'string' && f.from.length > 0));

const values = asFormValues(found);
check('the sender\'s own number goes in the contact field, not the document number',
  (values.sender_contact ?? '').includes('4521') && values.incoming_no === undefined,
  values.sender_contact);

console.log('\n--- the same letter written in Arabic ---');

const arabic = [
  'مديرية تخطيط المدينة',
  'العدد: ٧٧٣',
  'التاريخ: ١١/٩/٢٠٢٦',
  'الموضوع: طلب اجازة بناء',
  'بخصوص القطعة ١٢٣/٤ في محلة سەرچنار.',
].join('\n');
const ar = extractLetterFields(arabic).found;
check('the Arabic reference marker works', ar.reference?.value === '773', ar.reference?.value);
check('a day-first date is read the right way round', ar.date?.value === '2026-09-11', ar.date?.value);
check('the Arabic subject marker works', /اجازة بناء/.test(ar.subject?.value ?? ''), ar.subject?.value);
check('the Arabic plot marker works', ar.plot_no?.value === '123/4', ar.plot_no?.value);

console.log('\n--- what it refuses to guess ---');

check('an ambiguous date is left alone rather than invented', dateFrom('5/9/26') === null, String(dateFrom('5/9/26')));
check('a month over twelve is refused', dateFrom('2026/13/11') === null, String(dateFrom('2026/13/11')));
check('a year out of range is refused', dateFrom('1899/09/11') === null, String(dateFrom('1899/09/11')));
check('a page with nothing on it produces nothing',
  Object.keys(extractLetterFields('').found).length === 0);
check('a page of prose with no markers invents no reference',
  extractLetterFields('سڵاو، ئەمە نامەیەکی ئاساییە بێ هیچ ژمارەیەک.').found.reference === undefined);

// The one that matters most: a guess must never be silently a different letter's
// number. A reference marker with no digits after it yields nothing at all.
check('a marker with no number after it yields nothing',
  extractLetterFields('ژمارە:\nبەروار:').found.reference === undefined);

// ---------------------------------------------------------------------------
console.log('\n--- the photograph itself ---');

async function pageOf(lines) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 60, y: 740 - i * 46, size: 26, font }));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

const registry = new Session(); await registry.signIn('shilan');

const camera = await registry.get('/registry/photo');
check('the camera screen opens', camera.status === 200);
check('and asks a phone for its back camera', camera.body.includes('capture="environment"'));
check('while a desktop browser still gets an ordinary file chooser',
  camera.body.includes('accept="image/*,.pdf"'));

const mark = String(1000 + Math.floor(Math.random() * 8999));
const photo = await pageOf(['Shareda Raniye', `Waraqa ${mark}`, 'Dawakari mollat']);

const posted = await registry.upload('/registry/photo', {}, {
  file: { name: `photo-${mark}.pdf`, bytes: photo, type: 'application/pdf' },
});
check('the photograph is accepted', posted.status === 200, `status ${posted.status}`);
check('and comes back as a form to check', posted.body.includes('name="tray_id"'));
check('which says what was read and where from', /لە کوێوە/.test(posted.body));
check('and says plainly that these are suggestions', /پێشنیارن/.test(posted.body));

const trayId = /name="tray_id" value="(\d+)"/.exec(posted.body)?.[1];
check('the photograph is waiting in the scan tray', Boolean(trayId), `tray item ${trayId}`);

const tray = await registry.get('/tray');
check('and is visible there, so an abandoned form loses nothing',
  tray.body.includes(`photo-${mark}.pdf`));

console.log('\n--- registering from it ---');

const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(posted.body)?.[1];
const subject = `مۆڵەتی بینا ${mark}`;
const reg = await registry.post('/registry/new', { confirm_similar: '1',
  tray_id: trayId, subject, doc_type_option_id: typeId ?? '',
  sender_kind: 'citizen', sender_name: 'ڕێبین ئەحمەد', priority: 'normal',
});
const docId = /\/documents\/(\d+)/.exec(reg.location ?? '')?.[1];
check('the letter is registered', Boolean(docId), reg.location ?? '');

const docPage = await registry.get(`/documents/${docId}`);
check('and the photograph is attached to it without a second step',
  docPage.body.includes(`photo-${mark}.pdf`));

const trayAfter = await registry.get('/tray');
check('and has left the waiting list', !trayAfter.body.includes(`href="/tray/${trayId}"`));

console.log('\n--- who may use it ---');

// HR. The archive rooms may use it since the audit of 13 September: they can start
// letters (migration 0450) and a photographed letter goes into their own tray.
const archive = new Session(); await archive.signIn('bafrin');   // hr
const notForThem = await archive.get('/registry/photo');
check('somebody who does not register letters cannot', notForThem.status === 403, `status ${notForThem.status}`);

console.log(failures ? `\n${failures} FAILED` : '\na letter can be registered from a photograph of it');
process.exit(failures ? 1 : 0);
