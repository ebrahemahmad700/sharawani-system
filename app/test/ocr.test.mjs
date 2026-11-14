// Finding a letter by what is printed inside the scan.
//
//   node test/ocr.test.mjs        (server must be running on BASE)
//
// A letter is registered whose subject says nothing useful. A picture of a page
// is attached to it. The page is read. Then the words that exist only inside
// that picture are typed into the search box, and the letter comes back.
//
// That chain is the feature. Everything in it can fail quietly: the reader can
// be missing, the text can be stored against the wrong row, the search can be
// looking at the wrong column, or row-level security can hide the text from the
// very people who uploaded it. Each of those produces "no results", which is
// also what a correct system says when there is genuinely nothing, so none of
// them is noticeable without a test that knows the answer.
//
// The page is built here in code rather than committed as a file, for the same
// reason the application icon is: a binary in a repository is a thing nobody can
// review. It carries Latin words, because the standard fonts pdf-lib can embed
// have no Kurdish letters in them. How well Kurdish script reads is a judgement
// a person makes by looking at a real scan, and it is in the testing guide.

import { readScan, isAvailable, canRead } from '../src/lib/ocr.mjs';
import { kuNormalize } from '../src/lib/ku.mjs';

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

// --- drawing a page ---------------------------------------------------------
//
// A PDF with a standard font, built by pdf-lib, which the project already
// depends on for merging scans. Two reasons rather than one:
//
//   It exercises the PDF branch of the reader, which is the one that matters:
//   nearly every scan in this system arrives as a PDF from a sheet feeder, and
//   that path goes through pdftoppm before tesseract ever sees a pixel.
//
//   Helvetica is a shape tesseract has seen a million times. A hand-rolled
//   bitmap font is not, and testing the reader against one measures the font
//   rather than the system: the first version of this test drew its own letters
//   and got "FANLTE «ERODE" back, which said nothing about whether any of the
//   code below works.

import { PDFDocument, StandardFonts } from 'pdf-lib';

async function pageOf(lines) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);                 // A4 at 72 points to the inch
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => {
    page.drawText(line, { x: 60, y: 740 - i * 46, size: 26, font });
  });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** A page with nothing written on it. */
async function blankPage() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// --- is there a reader at all -----------------------------------------------

console.log('--- the reader ---');

const have = await isAvailable();
check('a reader is installed', have.ok, have.ok ? have.version : 'none on this host');
if (!have.ok) {
  console.log('\nThe rest cannot be checked here. That is a valid configuration: without the reader');
  console.log('every scan is labelled as not read and nothing else in the application changes.');
  process.exit(0);
}

check('it can read a PDF', canRead('application/pdf'));
check('it can read a photograph', canRead('image/jpeg'));
check('it will not pretend to read a drawing file', !canRead('image/vnd.dwg'));

console.log('\n--- a page with nothing on it ---');

const blank = await readScan(await blankPage(), 'application/pdf');
check('a blank page is reported as having no writing', ['empty', 'low'].includes(blank.status), blank.status);
check('and no text is invented for it', !blank.text || blank.text.length < 12, JSON.stringify(blank.text));

console.log('\n--- a page with words on it ---');

// A word that appears nowhere else in this system.
//
// A pronounceable word with digits rather than a random run of capitals. A
// reader has a language model behind it and reads "Zewar4821" reliably; the
// first version of this test used random capitals and got "ZEWARWY QJ]" back,
// which is a fair reading of a string no language contains and a poor test.
const mark = String(1000 + Math.floor(Math.random() * 8999));
const inside = `Zewar${mark}`;
const png = await pageOf(['Sharewani Raniye', inside, 'Dawakari nusraw']);

const read = await readScan(png, 'application/pdf');
check('the page is read as having writing', ['done', 'low'].includes(read.status), read.status);
check('and the words come back', (read.text ?? '').toUpperCase().includes('RANIYE'),
  JSON.stringify((read.text ?? '').slice(0, 70)));
// Not an exact match, deliberately. A reader looking at a picture of a page gets
// a character wrong now and then: this one reads "Zewar9702" as "Zewar9/02"
// about half the time. Demanding exactness here would make the test fail on
// behaviour the application is built to tolerate, and the proof that it does
// tolerate it is the search below, which finds the letter anyway.
check('including the invented word, give or take a character',
  (read.text ?? '').toUpperCase().includes('ZEWAR'),
  JSON.stringify((read.text ?? '').slice(0, 70)));
check('with a confidence recorded', typeof read.confidence === 'number', String(read.confidence));
check('and a note of which reader was used', Boolean(read.engine), read.engine ?? '');

console.log('\n--- attaching it to a letter whose subject says nothing ---');

const registry = new Session(); await registry.signIn('shilan');
const subject = `داواکاری گشتی ${Math.random().toString(36).slice(2, 7)}`;

await registry.get('/registry/new');
const reg = await registry.post('/registry/new', { confirm_similar: '1',
  subject, doc_type: 'citizen_request', sender_kind: 'citizen',
  sender_name: 'ئاوات کەریم', priority: 'normal',
});
const docId = /\/documents\/(\d+)/.exec(reg.location ?? '')?.[1];
check('the letter exists', Boolean(docId), `document ${docId}`);

// The words are only in the picture, never in anything typed.
check('the subject does not contain the words', !subject.includes(inside));

const before = await registry.get(`/documents?q=${encodeURIComponent(inside)}`);
check('and searching for them finds nothing yet', !before.body.includes(`/documents/${docId}"`));

await registry.get(`/documents/${docId}`);
const up = await registry.upload(`/documents/${docId}/attachments`, { kind: 'original_scan' },
  { file: { name: `scan-${mark}.pdf`, bytes: png, type: 'application/pdf' } });
check('the page attaches', up.status === 303 && !String(up.location).includes('error'), up.location);

const docPage = await registry.get(`/documents/${docId}`);
const attId = [...docPage.body.matchAll(/href="\/attachments\/(\d+)\/view"/g)].map(m => m[1])[0];
check('the attachment is on the letter', Boolean(attId), `attachment ${attId}`);

console.log('\n--- reading it, now rather than in two minutes ---');

const readNow = await registry.post(`/attachments/${attId}/read`, {});
check('it can be read on request', readNow.status === 303 && !String(readNow.location).includes('error'),
  decodeURIComponent(readNow.location ?? ''));

const textPage = await registry.get(`/attachments/${attId}/text`);
check('what was read can be looked at', textPage.status === 200);
check('and it is what was on the page', textPage.body.toUpperCase().includes('RANIYE'));
check('with the confidence stated rather than implied', /دڵنیایی/.test(textPage.body));

console.log('\n--- and now it can be found ---');

// Searching for what the reader ACTUALLY read, not for what was printed.
//
// This is the difference between testing the feature and testing tesseract. The
// promise is "a letter can be found by the words inside its scan", and the words
// inside its scan are whatever the reader made of them. Demanding the exact
// printed token makes the test fail on a run where the reader put a stroke
// through a digit, which it does perhaps one time in ten: "Zewar9702" comes back
// as "Zewar9/02", the letter is genuinely in the archive under that spelling,
// the search for the printed form finds nothing, and the test reports a broken
// feature that is working exactly as designed.
//
// Falls back to the printed token when nothing recognisable came back, so a
// reader that produced rubbish still fails the test rather than skipping it.
const asRead = /Zewar\S*/i.exec(read.text ?? '')?.[0] ?? inside;
if (asRead !== inside) {
  console.log(`note  the reader saw "${asRead}" where the page said "${inside}", so that is what is searched for`);
}

const after = await registry.get(`/documents?q=${encodeURIComponent(asRead)}`);
check('searching the words inside the picture finds the letter',
  after.body.includes(`/documents/${docId}"`),
  after.body.includes(`/documents/${docId}"`) ? '' : 'not in the results');
check('and the result says the words came from inside a scan',
  after.body.includes('لە ناو سکان'));

console.log('\n--- who may search it ---');

const it = new Session(); await it.signIn('itadmin');
const itSearch = await it.get(`/attachments/${attId}/text`);
check('IT cannot read what the scan said', itSearch.status !== 200, `status ${itSearch.status}`);

console.log('\n--- the normalisation that makes a misread letter still match ---');

// The reader gets a letter wrong here and there on Arabic script. These are the
// substitutions it actually makes, and the normaliser is why they still match.
check('the reader\'s ه and the real ە come out the same', kuNormalize('ژماره') === kuNormalize('ژمارە'));
check('ي and ی come out the same', kuNormalize('رانيه') === kuNormalize('رانیه'));
check('Latin and Arabic-Indic digits come out the same', kuNormalize('247') === kuNormalize('٢٤٧'));

console.log(failures ? `\n${failures} FAILED` : '\nwords inside a scan can be searched for');
process.exit(failures ? 1 : 0);
