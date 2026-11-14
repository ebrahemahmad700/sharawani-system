// Scan tray, scanner screen and photo registration: ahang (front desk), karwan (archive), sakar (legal).
import { launch, close, as, note, shot, notice, invalidField, BASE, inkPdf, inkPng, tifBytes, textPdf, saveJson } from './lib.mjs';

const MARK = 'rtr1';
const LETTER = { id: 1211, no: 'ه/2026/690', barcode: '20260006901' };
const b = await launch();
const { page: h } = await as('ahang');
const F = (name, mimeType, buffer) => ({ name, mimeType, buffer });
const R = {};

async function upload(p, files, { merge = true, code = null } = {}) {
  await p.goto('/tray');
  if (code !== null) await p.fill('#scanner_code', code);
  await p.setInputFiles('form[action="/tray/upload"] #file', files);
  const box = p.locator('form[action="/tray/upload"] input[name=merge]');
  if (merge) await box.check(); else await box.uncheck();
  const inv = await invalidField(p, 'form[action="/tray/upload"]');
  if (inv) return { invalid: inv, inline: (await p.locator('form[action="/tray/upload"]').innerText()).replace(/\s+/g, ' ').slice(-200) };
  await p.click('form[action="/tray/upload"] button[type=submit]');
  await p.waitForLoadState('domcontentloaded', { timeout: 60000 });
  return { url: decodeURIComponent(p.url()).slice(0, 140), notices: await notice(p) };
}
const trayItems = async p => { await p.goto('/tray'); return p.locator('.card:has(h2:text("سکانە نوێیەکان")) tbody tr').evaluateAll(ts => ts.map(t => ({ text: t.innerText.replace(/\s+/g, ' ').slice(0, 120), href: t.querySelector('a')?.getAttribute('href') }))); };

// Merged: two PDFs, a PNG and a JPG
await h.goto('/tray');
const jpg = Buffer.from(await h.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#eee'; x.fillRect(0, 0, 300, 400); x.fillStyle = '#111'; x.fillRect(40, 40, 200, 80); return c.toDataURL('image/jpeg').split(',')[1]; }), 'base64');
let r = await upload(h, [F(`${MARK}-p1.pdf`, 'application/pdf', inkPdf()), F(`${MARK}-p2.pdf`, 'application/pdf', await textPdf(['PAGE TWO'])), F(`${MARK}-p3.png`, 'image/png', inkPng()), F(`${MARK}-p4.jpg`, 'image/jpeg', jpg)]);
note('tray', 'merged 4', r);
r = await upload(h, [F(`${MARK}-s1.pdf`, 'application/pdf', await textPdf(['SEPARATE 1'])), F(`${MARK}-s2.png`, 'image/png', inkPng(150)), F(`${MARK}-s3.tif`, 'image/tiff', tifBytes())], { merge: false });
note('tray', 'not merged 3 incl tif', r);
r = await upload(h, [F(`${MARK}-m1.pdf`, 'application/pdf', inkPdf()), F(`${MARK}-m2.tif`, 'image/tiff', tifBytes())], { merge: true });
note('tray', 'merge with tif', r);
r = await upload(h, [F(`${MARK}-one.tif`, 'image/tiff', tifBytes())], { merge: true });
note('tray', 'single tif, merge ticked', r);
// 41 files and 40 files
const many = k => Array.from({ length: k }, (_, i) => F(`${MARK}-many-${i + 1}.png`, 'image/png', inkPng(40 + i)));
r = await upload(h, many(41), { merge: true });
note('tray', '41 files merged', r);
await shot(h, 'tray-41-files');
r = await upload(h, many(40), { merge: true });
note('tray', '40 files merged', r);
// a single 45-page PDF
r = await upload(h, [F(`${MARK}-45pages.pdf`, 'application/pdf', await textPdf(['LONG'], 45))], { merge: true });
note('tray', 'one pdf with 45 pages', r);
// wrong types
r = await upload(h, [F(`${MARK}.docx`, 'application/octet-stream', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100)]))]);
note('tray', 'docx', r);
r = await upload(h, [F(`${MARK}-fake.pdf`, 'application/pdf', Buffer.from('plain text pretending to be a pdf'))]);
note('tray', 'renamed text as pdf', r);
r = await upload(h, [F(`${MARK}-ok.pdf`, 'application/pdf', inkPdf()), F(`${MARK}-bad.pdf`, 'application/pdf', Buffer.from('not a pdf, second file'))], { merge: true });
note('tray', 'one good one bad', r);
// same file twice
const same = await textPdf([`SAME ${MARK}`]);
r = await upload(h, [F(`${MARK}-same.pdf`, 'application/pdf', same)], { merge: false });
note('tray', 'same file first', r);
r = await upload(h, [F(`${MARK}-same-again.pdf`, 'application/pdf', same)], { merge: false });
note('tray', 'same file again', r);
// scanner code field
r = await upload(h, [F(`${MARK}-code.pdf`, 'application/pdf', await textPdf(['CODE']))], { merge: false, code: '<b>X</b>' });
note('tray', 'scanner code markup', r);

let items = await trayItems(h);
const mine = items.filter(i => i.text.includes(MARK));
note('tray', 'my tray items', { count: mine.length, items: mine.map(i => i.text) });
await shot(h, 'tray-list', { fullPage: true });

// Detect the letter: a page with the barcode digits printed on it
r = await upload(h, [F(`${MARK}-barcode.pdf`, 'application/pdf', await textPdf([LETTER.barcode, `LETTER ${LETTER.barcode}`]))], { merge: false });
items = await trayItems(h);
const bc = items.find(i => i.text.includes(`${MARK}-barcode`));
await h.goto(bc.href);
await h.waitForTimeout(2500);
await shot(h, 'tray-item-barcode');
const t0 = Date.now();
await h.click('form[action$="/detect"] button');
await h.waitForLoadState('domcontentloaded', { timeout: 120000 });
note('tray-detect', 'detect with barcode', { ms: Date.now() - t0, url: h.url(), notices: await notice(h) });
await shot(h, 'tray-detect-result');
// photo screen says whether the reader is installed
await h.goto('/registry/photo');
note('tray-detect', 'photo screen reader notice', { notices: await notice(h) });

// Claim an item onto the letter, archive another
items = await trayItems(h);
const toClaim = items.find(i => i.text.includes(`${MARK}-s1`));
await h.goto(toClaim.href);
note('tray-claim', 'letters offered', { count: await h.locator('#document_id option').count(), hasLetter: await h.locator('#document_id option', { hasText: '690' }).count() });
await h.selectOption('#document_id', String(LETTER.id)).catch(async () => { await h.evaluate(id => { const o = document.createElement('option'); o.value = id; document.querySelector('#document_id').append(o); document.querySelector('#document_id').value = id; }, String(LETTER.id)); });
await h.selectOption('#kind', { index: 0 });
await h.click('form[action$="/claim"] button[type=submit]'); await h.waitForLoadState('domcontentloaded');
note('tray-claim', 'claimed', { url: h.url(), notices: await notice(h), attachments: (await h.locator('#attachments, .attach-list').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200) });
const claimedId = /\/tray\/(\d+)/.exec(toClaim.href)[1];
const pv = await h.request.get(`${BASE}/tray/${claimedId}/preview`);
note('tray-claim', 'claimed item preview afterwards', { status: pv.status() });
const again = await h.request.post(`${BASE}/tray/${claimedId}/claim`, { form: { _csrf: await h.locator('input[name=_csrf]').first().inputValue(), document_id: String(LETTER.id), kind: 'original_scan' }, maxRedirects: 0 });
note('tray-claim', 'claim same item twice', { status: again.status() });
const toArchive = items.find(i => i.text.includes(`${MARK}-s2`));
await h.goto(toArchive.href);
await h.click('form[action$="/archive"] button'); await h.waitForLoadState('domcontentloaded');
note('tray-claim', 'archived', { url: h.url(), notices: await notice(h), stillListed: (await trayItems(h)).some(i => i.text.includes(`${MARK}-s2`)) });
// TIF item page
const tif = (await trayItems(h)).find(i => i.text.includes(`${MARK}-s3`));
if (tif) { await h.goto(tif.href); note('tray-claim', 'tif item page', { viewer: (await h.locator('.viewer-main').innerText()).replace(/\s+/g, ' ').slice(0, 100) }); await shot(h, 'tray-tif-item'); }

// Other rooms: sakar cannot see ahang's items; karwan uses his own tray
const { page: sk } = await as('sakar');
const other = (await trayItems(h)).find(i => i.text.includes(MARK));
const skr = await sk.goto(other.href);
note('tray-rooms', 'sakar opens front-desk item', { status: skr.status(), url: sk.url() });
const skList = await trayItems(sk);
note('tray-rooms', 'sakar tray has my items', { count: skList.filter(i => i.text.includes(MARK)).length });
const { page: kw } = await as('karwan');
r = await upload(kw, [F(`${MARK}-karwan.pdf`, 'application/pdf', await textPdf(['ARCHIVE ROOM']))], { merge: false });
note('tray-rooms', 'karwan upload', r);
const kItem = (await trayItems(kw)).find(i => i.text.includes(`${MARK}-karwan`));
await kw.goto(kItem.href);
note('tray-rooms', 'karwan claim list', { options: await kw.locator('#document_id option').count() });
await kw.goto('/registry/photo');
note('tray-rooms', 'karwan photo screen', { url: kw.url(), status: 'ok', notices: await notice(kw) });

// Scanner screen (simulator): into a letter, into the tray, into registration
for (const [label, path] of [['tray', '/scan?to=tray'], ['letter', `/scan?document_id=${LETTER.id}`], ['registry', '/scan?to=registry']]) {
  await h.goto(path);
  const scanners = await h.locator('input[name=scanner_id]').count();
  if (!scanners) { note('scan-screen', `${label}: no scanners`, { body: (await h.locator('.card').first().innerText()).replace(/\s+/g, ' ').slice(0, 200) }); continue; }
  await h.waitForTimeout(1500);
  const statuses = await h.locator('[data-scanner-status]').allInnerTexts();
  const labels = await h.locator('.scanner-option').allInnerTexts();
  const t1 = Date.now();
  await h.click('form[action="/scan"] button[type=submit]');
  await h.waitForLoadState('domcontentloaded', { timeout: 200000 });
  note('scan-screen', label, { scanners, labels: labels.map(x => x.replace(/\s+/g, ' ').slice(0, 80)), statuses, ms: Date.now() - t1, url: h.url(), notices: await notice(h) });
  await shot(h, `scan-screen-${label}`);
  if (label === 'registry' && h.url().includes('tray_id')) {
    await h.fill('#subject', `کتابی سکانکراو ${MARK}`); await h.fill('#sender_name', `نێردەر ${MARK}`);
    await h.click('form[data-similar-form] button[type=submit]'); await h.waitForLoadState('domcontentloaded');
    if (await h.locator('input[name="confirm_similar"]').count()) { await h.click('form[data-similar-form] .row button[type=submit]'); await h.waitForLoadState('domcontentloaded'); }
    note('scan-screen', 'registered from scan', { url: h.url(), attachments: (await h.locator('.attach-list').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160) });
  }
}

// Photo registration
await h.goto('/registry/photo');
await h.setInputFiles('#photo', F(`${MARK}-photo.jpg`, 'image/jpeg', jpg));
const t2 = Date.now();
await h.click('form[action="/registry/photo"] button[type=submit]'); await h.waitForLoadState('domcontentloaded', { timeout: 120000 });
note('photo', 'photo read', { ms: Date.now() - t2, url: h.url(), notices: await notice(h) });
await shot(h, 'photo-suggestions', { fullPage: true });
if (await h.locator('form[action="/registry/new"] #subject').count()) {
  await h.fill('#subject', `کتابی وێنەگیراو ${MARK}`); await h.fill('#sender_name', `نێردەر ${MARK}`);
  await h.click('form[action="/registry/new"] button[type=submit]'); await h.waitForLoadState('domcontentloaded');
  if (await h.locator('input[name="confirm_similar"]').count()) { await h.click('form[data-similar-form] .row button[type=submit]'); await h.waitForLoadState('domcontentloaded'); }
  note('photo', 'registered from photo', { url: h.url(), attachments: (await h.locator('.attach-list').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160) });
}
await h.goto('/registry/photo');
await h.setInputFiles('#photo', F(`${MARK}-photo.docx`, 'application/octet-stream', Buffer.from('PK\x03\x04 not an image')));
note('photo', 'wrong type (browser)', { invalid: await invalidField(h, 'form[action="/registry/photo"]'), inline: (await h.locator('form[action="/registry/photo"]').innerText()).replace(/\s+/g, ' ').slice(0, 200) });
await h.goto('/registry/photo');
await h.setInputFiles('#photo', F(`${MARK}-fake.jpg`, 'image/jpeg', Buffer.from('this is not a jpeg')));
await h.click('form[action="/registry/photo"] button[type=submit]'); await h.waitForLoadState('domcontentloaded');
note('photo', 'renamed text as jpg', { url: decodeURIComponent(h.url()), notices: await notice(h) });

console.log('problems', h.problems, sk.problems, kw.problems);
await close();
