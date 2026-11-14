// Second pass: the steps that the first pass did not reach, on a phone.
import { launch, ctxFor, overflow, shot, shotAround, mark, inkPdf, inkPng, HERE } from './lib.mjs';
import { writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

const DEV = process.env.DEV || 'i390';
const DOC1 = Number(process.env.DOC1 || 1230);
const BAR1 = process.env.BAR1 || '20260007099';
const PIN1 = process.env.PIN1 || '';
const M = mark();
const out = join(HERE, `journey2-${DEV}.jsonl`);
writeFileSync(out, '');
const rec = o => { appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o).slice(0, 1500)); };
async function step(name, fn) {
  const t0 = Date.now();
  try { const r = await fn(); rec({ step: name, ok: true, ms: Date.now() - t0, ...(r || {}) }); return r; }
  catch (e) { rec({ step: name, ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 400) }); return null; }
}
const ov = async page => { const o = await overflow(page); return { sw: o.sw, iw: o.iw, offenders: o.offenders.slice(0, 4) }; };

const browser = await launch();
const S = await ctxFor(browser, 'shilan', DEV);
const p = S.page;

await step('attach-pdf', async () => {
  await p.goto(`/documents/${DOC1}`);
  await p.locator('#attachments input[type=file]').setInputFiles([{ name: `${M}-contract.pdf`, mimeType: 'application/pdf', buffer: inkPdf() }]);
  await p.selectOption('#attachments select[name=kind]', 'supporting');
  await p.locator('#attachments form.attach-upload button[type=submit]').tap();
  await p.waitForURL(/attached=1|error=/, { timeout: 20000 });
  // Attachment list touch targets
  const t = await p.$$eval('#attachments .attach-list li', lis => lis.map(li => {
    const box = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top), l: Math.round(r.left) }; };
    return { name: box(li.querySelector('.attach-name')), view: box(li.querySelector('a.btn')), dl: box(li.querySelectorAll('a.btn')[1]), summary: box(li.querySelector('summary')), text: li.querySelector('.attach-name').textContent.trim().slice(0, 40) };
  }));
  await shotAround(p, p.locator('#attachments'), `j2-${DEV}-01-attach-list`, { above: 0, height: 420 });
  return { url: p.url(), targets: t };
});

await step('view-pdf-and-image', async () => {
  await p.goto(`/documents/${DOC1}`);
  const links = await p.$$eval('#attachments .attach-list li', lis => lis.map(li => ({ name: li.querySelector('.attach-name').textContent.trim(), href: li.querySelector('a.btn').getAttribute('href') })));
  const pdf = links.find(l => /pdf/i.test(l.name));
  const img = links.find(l => /png|وێنە/i.test(l.name));
  const res = { links: links.map(l => l.name.slice(0, 30)) };
  await p.locator(`#attachments a.btn[href="${pdf.href}"]`).tap();
  await p.waitForURL(/\/view/);
  await p.waitForSelector('.pdf-page canvas', { timeout: 15000 });
  await p.waitForTimeout(1000);
  res.pdf = await p.evaluate(() => {
    const c = document.querySelector('.pdf-page canvas');
    const r = c.getBoundingClientRect();
    const host = document.querySelector('.pdf-view').getBoundingClientRect();
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0; for (let i = 0; i < d.length; i += 40) if (d[i] < 60) dark++;
    const zb = [...document.querySelectorAll('[data-zoom]')].map(b => { const x = b.getBoundingClientRect(); return { t: b.textContent, w: Math.round(x.width), h: Math.round(x.height), label: b.getAttribute('aria-label'), title: b.title }; });
    return { canvasW: Math.round(r.width), canvasH: Math.round(r.height), hostW: Math.round(host.width), dark, zoomHidden: document.querySelector('[data-viewer-zoom]').hidden, zoomButtons: zb, status: document.querySelector('[data-pdf-status]')?.textContent };
  });
  res.pdfOverflow = await ov(p);
  await shot(p, `j2-${DEV}-02-pdf-view`);
  await p.locator('[data-zoom="1"]').tap(); await p.waitForTimeout(700);
  await p.locator('[data-zoom="1"]').tap(); await p.waitForTimeout(1000);
  res.pdfZoomed = await p.evaluate(() => { const v = document.querySelector('.pdf-view'); return { viewScrollW: v.scrollWidth, viewClientW: v.clientWidth, docSW: document.documentElement.scrollWidth, iw: innerWidth, canvasW: Math.round(document.querySelector('.pdf-page canvas').getBoundingClientRect().width) }; });
  // Can a finger pan the zoomed page? Swipe inside the viewer.
  const vb = await p.locator('.pdf-view').boundingBox();
  const before = await p.evaluate(() => document.querySelector('.pdf-view').scrollLeft);
  await p.evaluate(() => { const v = document.querySelector('.pdf-view'); v.scrollLeft = -100; });
  const after = await p.evaluate(() => document.querySelector('.pdf-view').scrollLeft);
  res.pan = { before, after };
  await shot(p, `j2-${DEV}-03-pdf-zoomed`);
  // Orientation change on the viewer: rotate to landscape and back.
  const vp = p.viewportSize();
  await p.setViewportSize({ width: vp.height, height: vp.width });
  await p.waitForTimeout(1200);
  res.landscape = await p.evaluate(() => ({ canvasW: Math.round(document.querySelector('.pdf-page canvas').getBoundingClientRect().width), hostW: Math.round(document.querySelector('.pdf-view').clientWidth), docSW: document.documentElement.scrollWidth, iw: innerWidth }));
  await shot(p, `j2-${DEV}-04-pdf-landscape`);
  await p.setViewportSize(vp);
  await p.waitForTimeout(1200);
  res.backPortrait = await p.evaluate(() => ({ canvasW: Math.round(document.querySelector('.pdf-page canvas').getBoundingClientRect().width), hostW: Math.round(document.querySelector('.pdf-view').clientWidth), docSW: document.documentElement.scrollWidth, iw: innerWidth }));
  if (img) {
    await p.goto(img.href);
    await p.waitForSelector('.img-view img');
    await p.waitForFunction(() => document.querySelector('.img-view img').complete);
    res.img = await p.evaluate(() => { const i = document.querySelector('.img-view img'); const r = i.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), natural: i.naturalWidth, alt: i.alt }; });
    await p.locator('[data-zoom="1"]').tap(); await p.waitForTimeout(300);
    await p.locator('[data-zoom="1"]').tap(); await p.waitForTimeout(300);
    res.imgZoom = await p.evaluate(() => { const i = document.querySelector('.img-view img'); const v = document.querySelector('.img-view'); return { imgW: Math.round(i.getBoundingClientRect().width), viewSW: v.scrollWidth, viewCW: v.clientWidth, docSW: document.documentElement.scrollWidth }; });
    res.imgOverflow = await ov(p);
    await shot(p, `j2-${DEV}-05-img-view`);
  }
  return res;
});

await step('chase-blocked-by-own-note', async () => {
  await p.goto('/my-day');
  const row = p.locator('tr', { has: p.locator(`a[href="/documents/${DOC1}"]`) });
  const n = await row.count();
  let cell = null;
  if (n) {
    cell = await row.first().locator('td').last().textContent();
    await row.first().scrollIntoViewIfNeeded();
    await shotAround(p, row.first(), `j2-${DEV}-06-myday-row-note-blocks-chase`, { above: 20, height: 200 });
  }
  // The letter page still offers chasing.
  await p.goto(`/documents/${DOC1}`);
  const hasChase = await p.locator('form[action$="/chase"]').count();
  let err = null;
  if (hasChase) {
    await p.locator('form[action$="/chase"] button').scrollIntoViewIfNeeded();
    await p.locator('form[action$="/chase"] button').tap();
    await p.waitForURL(/error=|done=|chased=|sent=/);
    err = await p.locator('.content > .notice').textContent().catch(() => null);
    await shot(p, `j2-${DEV}-07-chase-refused`, { x: 0, y: 0, width: p.viewportSize().width, height: 320 });
  }
  const notes = await p.$$eval('.card h2', hs => hs.map(h => h.textContent.trim()));
  return { myDayRow: n, lastCell: cell && cell.trim(), letterPageOffersChase: !!hasChase, refusal: err };
});

// A second letter, sent without a note, so the chase can happen; paper signed on the barcode screen.
let doc2 = null, bar2 = null;
await step('register-and-send-second', async () => {
  await p.goto('/registry/new');
  await p.tap('#subject'); await p.keyboard.type(`${M} دووەم نامەی مۆبایل`);
  await p.tap('#sender_name'); await p.keyboard.type(`نێردەر ${M}`);
  const submit = p.locator('form[data-similar-form] > .row button[type=submit]');
  await submit.scrollIntoViewIfNeeded();
  await submit.tap();
  await Promise.race([p.waitForURL(/\/documents\/\d+/, { timeout: 15000 }), p.waitForSelector('input[name="confirm_similar"]', { state: 'attached', timeout: 15000 })]).catch(() => {});
  await p.waitForLoadState('load');
  if (!/\/documents\/\d+/.test(p.url())) await p.locator('form[data-similar-form] > .row button[type=submit]').tap();
  await p.waitForURL(/\/documents\/\d+/);
  doc2 = Number(/\/documents\/(\d+)/.exec(p.url())[1]);
  bar2 = await p.evaluate(() => [...document.querySelectorAll('table tr')].find(r => r.querySelector('th')?.textContent.includes('بارکۆد'))?.querySelector('td')?.textContent.trim());
  const legal = await p.$$eval('#to_room option', os => os.find(o => o.textContent.includes('یاسا'))?.value);
  await p.selectOption('#to_room', legal);
  await p.locator('form[action$="/route"]:has(input[value=single]) button[type=submit]').tap();
  await p.waitForURL(/sent=1|error=/);
  return { doc2, bar2, url: p.url() };
});

await step('hemin-barcode-sign-paper-timed', async () => {
  const H = await ctxFor(browser, 'hemin', DEV);
  const hp = H.page;
  await hp.goto('/barcode');
  const focused = await hp.evaluate(() => document.activeElement?.id);
  await hp.tap('#q');
  await hp.keyboard.type(bar2);
  const t0 = Date.now();
  await Promise.all([hp.waitForURL(/q=/), hp.locator('form[action="/barcode"] button[type=submit]').tap()]);
  const tLookup = Date.now() - t0;
  const focusedAfterResult = await hp.evaluate(() => ({ id: document.activeElement?.id, scrollY }));
  await hp.screenshot({ path: join(HERE, 'shots', `j2-${DEV}-08-barcode-result.png`), fullPage: true, scale: 'css' });
  const btn = hp.locator('form[action$="/paper-received"] button');
  const bb = await btn.boundingBox();
  const t1 = Date.now();
  await btn.tap();
  await hp.waitForURL(/ok=|error=/, { timeout: 40000 });
  await hp.waitForLoadState('load');
  const tSign = Date.now() - t1;
  const after = await hp.evaluate(() => ({
    notice: document.querySelector('.content > .notice')?.textContent.trim() ?? null,
    paperCell: [...document.querySelectorAll('table tr')].find(r => r.querySelector('th')?.textContent.includes('پەڕگەی کاغەزی'))?.querySelector('td')?.textContent.trim().replace(/\s+/g, ' '),
    url: location.href,
  }));
  await hp.screenshot({ path: join(HERE, 'shots', `j2-${DEV}-09-barcode-after-sign.png`), scale: 'css' });
  await H.context.close();
  return { focusedOnLoad: focused, tLookup, focusedAfterResult, buttonBox: bb, tSign, ...after };
});

await step('myday-chase', async () => {
  await p.goto('/my-day');
  const row = p.locator('tr', { has: p.locator(`a[href="/documents/${doc2}"]`) });
  await row.first().scrollIntoViewIfNeeded();
  const btn = row.first().locator('form[action$="/chase"] button');
  const has = await btn.count();
  if (!has) return { chaseButton: false, cell: await row.first().locator('td').last().textContent() };
  const bb = await btn.boundingBox();
  const pinned = await row.first().locator('td').last().evaluate(td => getComputedStyle(td).position);
  await shotAround(p, row.first(), `j2-${DEV}-10-myday-row`, { above: 60, height: 220 });
  await btn.tap();
  await p.waitForLoadState('load');
  const notice = await p.locator('.content > .notice').textContent().catch(() => null);
  return { chaseButton: true, bb, pinned, url: p.url(), notice };
});

await step('public-track', async () => {
  const T = await ctxFor(browser, null, DEV);
  const tp = T.page;
  await tp.goto('/track');
  const focused = await tp.evaluate(() => document.activeElement?.id);
  const o = await ov(tp);
  // pin for doc1 from receipt
  const pin = PIN1 || await (async () => { const rp = await S.context.newPage(); await rp.goto(`/documents/${DOC1}/receipt`); const v = await rp.evaluate(() => document.querySelector('.pin b')?.textContent.trim()); await rp.close(); return v; })();
  await tp.tap('#barcode'); await tp.keyboard.type(BAR1);
  await tp.tap('#pin'); await tp.keyboard.type(pin);
  await Promise.all([tp.waitForNavigation(), tp.tap('button[type=submit]')]);
  const r = await tp.evaluate(() => ({ status: document.querySelector('.card .pill')?.textContent.trim(), notice: document.querySelector('.notice')?.textContent.trim(), stepsLive: !!document.querySelector('[aria-live]') }));
  const o2 = await ov(tp);
  await tp.screenshot({ path: join(HERE, 'shots', `j2-${DEV}-11-track.png`), fullPage: true, scale: 'css' });
  await T.context.close();
  return { focused, overflowForm: o, ...r, overflowResult: o2 };
});

rec({ step: 'summary', doc2, bar2, M, problems: p.problems.slice(0, 10) });
await browser.close();
