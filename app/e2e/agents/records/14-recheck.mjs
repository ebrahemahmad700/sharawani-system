// Re-check the main findings against the running server at the end of the session.
import { launch, close, as, note, shot, notice, invalidField, toKu, BASE, inkPdf, dwgBytes } from './lib.mjs';
import { PDFDocument } from 'pdf-lib';

const b = await launch();
const out = {};
// 1. company edit with Kurdish digits / duplicate
const { page: s } = await as('shilan');
await s.goto('/companies/95/edit');
await s.fill('#registration_no', toKu('778899'));
const [r1] = await Promise.all([s.waitForResponse(x => x.url().includes('/companies/95/edit') && x.request().method() === 'POST'), s.click('form[action$="/edit"] button[type=submit]')]);
await s.waitForLoadState('domcontentloaded');
out.companyEditKurdish = { status: r1.status(), url: decodeURIComponent(s.url()), notices: await notice(s), h1: await s.locator('h1').first().innerText() };
await shot(s, 'recheck-company-edit-kurdish');
await s.goto('/companies/95/edit');
await s.fill('#registration_no', 'RC-RCO1-EPAST'); await s.fill('#note', 'گۆڕانکاری');
const [r2] = await Promise.all([s.waitForResponse(x => x.url().includes('/companies/95/edit') && x.request().method() === 'POST'), s.click('form[action$="/edit"] button[type=submit]')]);
await s.waitForLoadState('domcontentloaded');
out.companyEditDuplicate = { status: r2.status(), url: decodeURIComponent(s.url()), notices: await notice(s), note: await s.inputValue('#note').catch(() => null) };
await s.goto('/companies/new');
await s.fill('#name', '   '); await s.fill('#registration_no', 'RC-RECHECK-1');
const [r3] = await Promise.all([s.waitForResponse(x => x.url().endsWith('/companies/new') && x.request().method() === 'POST'), s.click('form[action="/companies/new"] button[type=submit]')]);
await s.waitForLoadState('domcontentloaded');
out.companyNewWhitespace = { status: r3.status(), url: decodeURIComponent(s.url()), notices: await notice(s) };

// 2. archive wrong content keeps the form?
const { page: k } = await as('karwan');
await k.goto('/archive/new');
await k.fill('#plot_no', '8567/99'); await k.fill('#title', 'نەخشەی پشکنینەوە rarc1'); await k.fill('#shelf', 'C'); await k.fill('#section', '1'); await k.fill('#folder_no', '2');
await k.setInputFiles('#file', { name: 'fake.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('not a drawing at all, plain text') });
await k.click('form[action="/archive/new"] button[type=submit]'); await k.waitForLoadState('domcontentloaded');
out.archiveWrongContent = { url: k.url(), notices: await notice(k), title: await k.inputValue('#title').catch(() => null), plot: await k.inputValue('#plot_no').catch(() => null) };
await k.goto('/archive/206');
out.archiveDwgNoPreview = { fileInputs: await k.locator('input[type=file]').count(), editLinks: await k.locator('a[href*="/edit"]').count() };

// 3. template select field
const { page: h } = await as('ahang');
await h.goto('/templates/56');
out.templateSelect = { options: await h.locator('#f_kind option').allInnerTexts() };

// 4. room deactivation by IT with an active letter (room A holds ه/2026/730)
const { page: it } = await as('itadmin');
await it.goto('/admin/rooms');
const row = it.locator('tr:has(form[action="/admin/rooms/154"])');
const canDeactivate = await row.locator('form[action$="/deactivate"]').count();
if (canDeactivate) {
  await row.locator('form[action$="/deactivate"] button').click(); await it.waitForLoadState('domcontentloaded');
  out.roomDeactivate = { notices: await notice(it), nowInactive: await it.locator('tr:has(form[action="/admin/rooms/154"]) form[action$="/activate"]').count() };
  if (out.roomDeactivate.nowInactive) { await it.locator('tr:has(form[action="/admin/rooms/154"]) form[action$="/activate"] button').click(); await it.waitForLoadState('domcontentloaded'); }
}

// 5. merge order
async function pdfW(i) { const d = await PDFDocument.create(); d.addPage([300 + 10 * i, 400]); return Buffer.from(await d.save()); }
const orders = [];
for (let run = 0; run < 3; run++) {
  const M = 'rchk' + run + Date.now().toString(36).slice(-3);
  const files = []; for (let i = 1; i <= 8; i++) files.push({ name: `${M}-p${i}.pdf`, mimeType: 'application/pdf', buffer: await pdfW(i) });
  await h.goto('/tray');
  await h.setInputFiles('form[action="/tray/upload"] #file', files);
  await h.locator('form[action="/tray/upload"] input[name=merge]').check();
  await h.click('form[action="/tray/upload"] button[type=submit]'); await h.waitForLoadState('domcontentloaded');
  const rowT = h.locator('.card:has(h2:text("سکانە نوێیەکان")) tbody tr', { hasText: M }).first();
  const href = await rowT.locator('a').getAttribute('href');
  const merged = await PDFDocument.load(await (await h.request.get(`${BASE}${href}/preview`)).body());
  orders.push(merged.getPages().map(p => (Math.round(p.getWidth()) - 300) / 10).join(','));
  // tidy: send it to the tray archive
  await h.goto(href); await h.click('form[action$="/archive"] button'); await h.waitForLoadState('domcontentloaded');
}
out.mergeOrders = orders;

// 6. assistant legal queue count
const { page: a } = await as('aram');
await a.goto('/assistant');
await a.fill('form[action="/assistant/ask"] input[name=q]', 'چی لە ژووری یاسا چاوەڕوانە؟');
await Promise.all([a.waitForResponse(x => x.url().endsWith('/assistant/ask')), a.click('form[action="/assistant/ask"] button')]); await a.waitForLoadState('domcontentloaded');
const bubbles = await a.locator('.card div[style*="max-width:78%"]').allInnerTexts();
out.assistantLegal = bubbles[bubbles.length - 1]?.replace(/\s+/g, ' ').slice(0, 90);
await shot(a, 'recheck-assistant-legal', { locator: a.locator('.card').first() });
await a.goto('/inbox?room=6');
out.legalInboxOpen = (await a.locator('.stats .stat').first().innerText()).replace(/\s+/g, ' ');
await a.fill('form[action="/assistant/ask"] input[name=q]', 'مۆڵەتی کۆمپانیای ئاسۆ کەی بەسەردەچێت؟').catch(() => {});
await a.goto('/assistant');
await a.fill('form[action="/assistant/ask"] input[name=q]', 'مۆڵەتی کۆمپانیای ئاسۆ کەی بەسەردەچێت؟');
await Promise.all([a.waitForResponse(x => x.url().endsWith('/assistant/ask')), a.click('form[action="/assistant/ask"] button')]); await a.waitForLoadState('domcontentloaded');
const b2 = await a.locator('.card div[style*="max-width:78%"]').allInnerTexts();
out.assistantLicence = b2[b2.length - 1]?.replace(/\s+/g, ' ').slice(0, 90);
await shot(a, 'recheck-assistant-licence', { locator: a.locator('.card').first() });

note('recheck', 'results', out);
await close();
