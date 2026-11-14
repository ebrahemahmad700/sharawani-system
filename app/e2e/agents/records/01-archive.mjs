// Map archive: entry with every type, validation, search, verification, location, download, plot file.
import { launch, close, as, note, shot, notice, invalidField, MARK, inkPdf, inkPng, dwgBytes, dxfBytes, tifBytes, toKu, saveJson } from './lib.mjs';

const b = await launch();
const R = { mark: MARK, created: {} };
const base = 6000 + Math.floor(Math.random() * 3000);
const plot = n => `${base}/${n}`;

const { page: k } = await as('karwan');

// A real JPEG made by Chrome's canvas.
await k.goto('/archive');
const jpgB64 = await k.evaluate(() => { const c = document.createElement('canvas'); c.width = 120; c.height = 90; const x = c.getContext('2d'); x.fillStyle = '#ddd'; x.fillRect(0, 0, 120, 90); x.fillStyle = '#222'; x.fillRect(20, 20, 60, 40); return c.toDataURL('image/jpeg').split(',')[1]; });
const jpg = Buffer.from(jpgB64, 'base64');

async function fillNew(p, v, files) {
  await p.goto('/archive/new');
  for (const [key, val] of Object.entries(v)) await p.fill(`#${key}`, val);
  if (files.file) await p.setInputFiles('#file', files.file);
  if (files.preview) await p.setInputFiles('#preview', files.preview);
}
async function submitNew(p) {
  const [resp] = await Promise.all([
    p.waitForResponse(r => r.url().includes('/archive/new') && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null),
    p.click('form[action="/archive/new"] button[type=submit]'),
  ]);
  await p.waitForLoadState('domcontentloaded');
  return { status: resp?.status() ?? null, url: p.url(), notices: await notice(p) };
}
const std = (n, extra = {}) => ({ plot_no: plot(n), block: 'B', neighbourhood: `گەڕەکی ${MARK}`, title: `نەخشەی تاقیکردنەوە ${MARK} ${n}`, year: '2015', owner_names: `خاوەن ${MARK} حەسەن`, shelf: 'C-12', section: '2', box_no: '4', folder_no: '47', ...extra });
const F = (name, mimeType, buffer) => ({ name, mimeType, buffer });

// 1. Every type
const types = [
  ['dwg-nopreview', F(`naxsha-${MARK}-1.dwg`, 'application/octet-stream', dwgBytes()), null],
  ['dwg-preview', F(`naxsha-${MARK}-2.dwg`, 'application/octet-stream', dwgBytes()), F('p.pdf', 'application/pdf', inkPdf())],
  ['dxf-preview', F(`naxsha-${MARK}-3.dxf`, 'application/dxf', dxfBytes()), F('p3.pdf', 'application/pdf', inkPdf())],
  ['dxf-nopreview', F(`naxsha-${MARK}-3b.dxf`, 'application/dxf', dxfBytes()), null],
  ['pdf', F(`naxsha-${MARK}-4.pdf`, 'application/pdf', inkPdf()), null],
  ['jpg', F(`naxsha-${MARK}-5.jpg`, 'image/jpeg', jpg), null],
  ['png', F(`naxsha-${MARK}-6.png`, 'image/png', inkPng()), null],
  ['tif', F(`naxsha-${MARK}-7.tif`, 'image/tiff', tifBytes()), null],
];
let n = 1;
for (const [label, file, preview] of types) {
  await fillNew(k, std(n), { file, preview });
  const r = await submitNew(k);
  const id = /\/archive\/(\d+)/.exec(r.url)?.[1];
  R.created[label] = { id, plot: plot(n), ...r };
  note('archive', `new ${label}`, { status: r.status, url: r.url, notices: r.notices });
  if (id) await shot(k, `arch-detail-${label}`);
  n++;
}

// 2. Wrong types
for (const [label, file, preview] of [
  ['txt-as-dwg', F('fake.dwg', 'application/octet-stream', Buffer.from('hello this is not a drawing at all')), null],
  ['docx', F('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(200, 1)])), null],
  ['png-preview', F(`x-${MARK}.dwg`, 'application/octet-stream', dwgBytes()), F('prev.png', 'image/png', inkPng())],
  ['empty-file', F('empty.pdf', 'application/pdf', Buffer.alloc(0)), null],
]) {
  await fillNew(k, std(50 + n), { file, preview });
  // what the browser says before sending
  const inv = await invalidField(k, 'form[action="/archive/new"]');
  const r = await submitNew(k);
  note('archive', `wrong type ${label}`, { invalid: inv, status: r.status, url: r.url, notices: r.notices, keptValues: await k.inputValue('#title').catch(() => null) });
  await shot(k, `arch-wrong-${label}`);
  n++;
}

// 3. Missing required: browser, and whitespace-only
await fillNew(k, std(70, { title: '', shelf: '' }), { file: F('m.pdf', 'application/pdf', inkPdf()) });
note('archive', 'missing title (browser)', { invalid: await invalidField(k, 'form[action="/archive/new"]') });
await fillNew(k, std(71, { shelf: '   ', section: '  ', title: '  ab ' }), { file: F('m.pdf', 'application/pdf', inkPdf()) });
note('archive', 'whitespace shelf/section/title (browser)', { invalid: await invalidField(k, 'form[action="/archive/new"]') });
let r = await submitNew(k);
note('archive', 'whitespace shelf/section/title (server)', r);
await shot(k, 'arch-whitespace');

// 4. Year validation
for (const [label, year] of [['kurdish', toKu('2015')], ['3digits', '201'], ['2099', '2099'], ['1800', '1800'], ['2101', '2101'], ['persian', '۲۰۱۶']]) {
  await fillNew(k, std(80 + n, { year }), { file: F(`y-${label}.pdf`, 'application/pdf', inkPdf()) });
  const inv = await invalidField(k, 'form[action="/archive/new"]');
  let res = null;
  if (!inv) { res = await submitNew(k); if (/\/archive\/\d+/.test(res.url)) R.created[`year-${label}`] = res.url; }
  note('archive', `year ${label} ${year}`, { invalid: inv, ...res });
  if (res && !/\/archive\/\d+/.test(res.url)) await shot(k, `arch-year-${label}`);
  n++;
}

// 5. Very long title (300 chars, the maximum) and one line of unbroken text
const longTitle = (`نەخشەیدرێژ${MARK}`).repeat(40).slice(0, 300);
await fillNew(k, std(95, { title: longTitle }), { file: F('long.pdf', 'application/pdf', inkPdf()) });
r = await submitNew(k);
note('archive', 'long title 300', { status: r.status, url: r.url, notices: r.notices });
R.created.long = r.url;
if (/\/archive\/\d+/.test(r.url)) await shot(k, 'arch-long-detail', { fullPage: true });
await k.goto(`/archive?q=${encodeURIComponent(plot(95))}`);
await shot(k, 'arch-long-list', { fullPage: true });
const overflow = await k.evaluate(() => ({ body: document.documentElement.scrollWidth, win: innerWidth }));
note('archive', 'long title list width', overflow);

// 6. Duplicate: exact same plot, title and bytes twice
const dupBytes = inkPdf();
for (let i = 0; i < 2; i++) {
  await fillNew(k, std(96, { title: `نەخشەی دووبارە ${MARK}` }), { file: F(`dup-${MARK}.pdf`, 'application/pdf', dupBytes) });
  r = await submitNew(k);
  note('archive', `duplicate #${i + 1}`, { status: r.status, url: r.url, notices: r.notices });
  R.created[`dup${i}`] = r.url;
}
await k.goto(`/archive?q=${encodeURIComponent(plot(96))}`);
note('archive', 'duplicate search rows', { rows: await k.locator('tbody tr').count() });
await shot(k, 'arch-duplicate-list');

saveJson('archive-created.json', R);
await close();
