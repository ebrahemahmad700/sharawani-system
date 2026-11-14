// The main jobs, done completely on a phone with touch.
import { launch, ctxFor, overflow, smallTargets, shot, shotAround, mark, inkPdf, inkPng, HERE, BASE, PASSWORD } from './lib.mjs';
import { writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

const DEV = process.env.DEV || 'i390';
const M = mark();
const out = join(HERE, `journey-${DEV}.jsonl`);
writeFileSync(out, '');
const rec = o => { appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o).slice(0, 600)); };

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    rec({ step: name, ok: true, ms: Date.now() - t0, ...(r || {}) });
    return r;
  } catch (e) {
    rec({ step: name, ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 400) });
    return null;
  }
}

const browser = await launch();
const ov = async page => { const o = await overflow(page); return { sw: o.sw, iw: o.iw, offenders: o.offenders.slice(0, 4) }; };

// 1. Sign in on the phone, through the form, with taps.
const S = await ctxFor(browser, null, DEV);
let p = S.page;
await step('sign-in', async () => {
  await p.goto('/login');
  const o = await ov(p);
  await shot(p, `j-${DEV}-01-login`);
  await p.tap('#username');
  await p.keyboard.type('shilan');
  await p.tap('#password');
  await p.keyboard.type(PASSWORD);
  const btn = await p.locator('button[type=submit]').boundingBox();
  await p.tap('button[type=submit]');
  await p.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 15000 });
  return { landed: p.url(), overflow: o, submitBox: btn };
});

// 2. The drawer.
await step('drawer-open-close-navigate', async () => {
  await p.goto('/registry');
  const tog = await p.locator('.nav-toggle').boundingBox();
  await p.tap('.nav-toggle');
  await p.waitForTimeout(400);
  const sb = await p.locator('.sidebar').boundingBox();
  const backdrop = await p.locator('.nav-backdrop').boundingBox();
  await shot(p, `j-${DEV}-02-drawer-open`);
  // Is the last nav item reachable (scroll inside the drawer)?
  const navInfo = await p.evaluate(() => {
    const nav = document.querySelector('.sidebar .nav');
    const links = [...nav.querySelectorAll('a')];
    const last = links[links.length - 1].getBoundingClientRect();
    const who = document.querySelector('.whoami').getBoundingClientRect();
    return { navScrollH: nav.scrollHeight, navClientH: nav.clientHeight, links: links.length, lastBottom: Math.round(last.bottom), whoTop: Math.round(who.top), whoBottom: Math.round(who.bottom), ih: innerHeight, pageScrollY: scrollY };
  });
  // Tap backdrop at the far left.
  await p.touchscreen.tap(30, 400);
  await p.waitForTimeout(400);
  const sbAfter = await p.locator('.sidebar').boundingBox();
  // Open again and follow a link.
  await p.tap('.nav-toggle');
  await p.waitForTimeout(400);
  await p.tap('.sidebar .nav a[href="/inbox"]');
  await p.waitForURL(/\/inbox/);
  const checked = await p.evaluate(() => document.querySelector('#nav-toggle').checked);
  // Back button: does the drawer come back open (bfcache)?
  await p.goBack();
  await p.waitForTimeout(500);
  const checkedAfterBack = await p.evaluate(() => document.querySelector('#nav-toggle').checked);
  const sbBack = await p.locator('.sidebar').boundingBox();
  return { toggle: tog, sidebarOpen: sb, backdrop, navInfo, sidebarAfterBackdropTap: sbAfter, checkedAfterNav: checked, checkedAfterBack, sidebarAfterBack: sbBack, url: p.url() };
});

// 3. Register a letter.
let docId = null, barcode = null, incomingNo = null;
await step('register-letter', async () => {
  await p.goto('/registry/new');
  await shot(p, `j-${DEV}-03-register-form`);
  const o = await ov(p);
  await p.tap('#subject');
  await p.keyboard.type(`${M} نامەی تاقیکردنەوەی مۆبایل`);
  await p.tap('#sender_name');
  await p.keyboard.type(`نێردەر ${M}`);
  await p.fill('#sender_contact', '07501234567');
  await p.waitForTimeout(900); // similar panel
  const similarLive = await p.locator('[data-similar-live] .card').count();
  const submit = p.locator('form[data-similar-form] > .row button[type=submit]');
  await submit.scrollIntoViewIfNeeded();
  await submit.tap();
  await Promise.race([
    p.waitForURL(/\/documents\/\d+/, { timeout: 15000 }),
    p.waitForSelector('input[name="confirm_similar"]', { state: 'attached', timeout: 15000 }),
  ]).catch(() => {});
  await p.waitForLoadState('load');
  if (!/\/documents\/\d+/.test(p.url()) && await p.locator('input[name="confirm_similar"]').count()) {
    await shot(p, `j-${DEV}-03b-similar`);
    await p.locator('form[data-similar-form] > .row button[type=submit]').tap();
  }
  await p.waitForURL(/\/documents\/\d+/, { timeout: 15000 });
  docId = Number(/\/documents\/(\d+)/.exec(p.url())[1]);
  const info = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('table tr')];
    const get = t => rows.find(r => r.querySelector('th')?.textContent.includes(t))?.querySelector('td')?.textContent.trim();
    return { barcode: get('بارکۆد'), no: get('ژمارەی هاتوو'), notice: document.querySelector('.notice')?.textContent.trim(), h1: document.querySelector('h1').textContent, h1Box: document.querySelector('h1').getBoundingClientRect().toJSON(), h1Scroll: [document.querySelector('h1').scrollHeight, document.querySelector('h1').clientHeight] };
  });
  barcode = info.barcode; incomingNo = info.no;
  await shot(p, `j-${DEV}-04-letter-top`);
  return { docId, similarLive, overflowForm: o, ...info, overflowLetter: await ov(p) };
});

// 4. Attach from the "camera": a wrong file first, removed, then the right one.
await step('attach-photo-remove-wrong', async () => {
  await p.goto(`/documents/${docId}#attachments`);
  await p.waitForTimeout(300);
  // Where is the #attachments card relative to the sticky bar?
  const anchor = await p.evaluate(() => {
    const c = document.querySelector('#attachments').getBoundingClientRect();
    const t = document.querySelector('.topbar').getBoundingClientRect();
    return { cardTop: Math.round(c.top), topbarBottom: Math.round(t.bottom), h2Top: Math.round(document.querySelector('#attachments h2').getBoundingClientRect().top) };
  });
  await shot(p, `j-${DEV}-05-anchor-attachments`);
  const input = p.locator('#attachments input[type=file]');
  await input.setInputFiles([{ name: 'wrong-receipt-photo.png', mimeType: 'image/png', buffer: inkPng(120) }]);
  await p.waitForTimeout(200);
  const picked = await p.locator('#attachments .file-picked li').count();
  const rm = p.locator('#attachments .file-picked .remove').first();
  const rmBox = await rm.boundingBox();
  const chooseBox = await p.locator('#attachments label.file-choose').boundingBox();
  await rm.scrollIntoViewIfNeeded();
  await shotAround(p, p.locator("#attachments form"), `j-${DEV}-06-picked`, { above: 10, height: 220 });
  await rm.tap();
  await p.waitForTimeout(200);
  const afterRemove = await p.evaluate(() => ({ files: document.querySelector('#attachments input[type=file]').files.length, li: document.querySelectorAll('#attachments .file-picked li').length, focused: document.activeElement?.outerHTML.slice(0, 80) }));
  await input.setInputFiles([{ name: `${M}-letter-photo.png`, mimeType: 'image/png', buffer: inkPng(300) }]);
  await p.selectOption('#attachments select[name=kind]', 'original_scan');
  const attachBtn = p.locator('#attachments form button[type=submit]');
  await attachBtn.tap();
  await p.waitForURL(/attached=1|error=/, { timeout: 20000 });
  const notice = await p.locator('.content > .notice').textContent().catch(() => null);
  return { anchor, picked, rmBox, chooseBox, afterRemove, url: p.url(), notice };
});

await step('attach-pdf', async () => {
  await p.goto(`/documents/${docId}`);
  await p.locator('#attachments input[type=file]').setInputFiles([{ name: `${M}-contract.pdf`, mimeType: 'application/pdf', buffer: inkPdf() }]);
  await p.selectOption('#attachments select[name=kind]', 'supporting');
  await p.locator('#attachments form button[type=submit]').tap();
  await p.waitForURL(/attached=1|error=/, { timeout: 20000 });
  return { url: p.url() };
});

// 5. View the PDF and the image.
await step('view-pdf-and-image', async () => {
  await p.goto(`/documents/${docId}`);
  const links = await p.$$eval('#attachments .attach-list li', lis => lis.map(li => ({ name: li.querySelector('.attach-name').textContent.trim(), href: li.querySelector('a.btn').getAttribute('href') })));
  const pdf = links.find(l => /pdf/i.test(l.name));
  const img = links.find(l => /png/i.test(l.name));
  const res = { links };
  // Tap "view" on the pdf row.
  await p.locator(`#attachments a.btn[href="${pdf.href}"]`).tap();
  await p.waitForURL(/\/view/);
  await p.waitForSelector('.pdf-page canvas', { timeout: 15000 });
  await p.waitForTimeout(800);
  res.pdf = await p.evaluate(() => {
    const c = document.querySelector('.pdf-page canvas');
    const r = c.getBoundingClientRect();
    const host = document.querySelector('.pdf-view').getBoundingClientRect();
    // ink check
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0; for (let i = 0; i < d.length; i += 40) if (d[i] < 60) dark++;
    const zoom = document.querySelector('[data-viewer-zoom]');
    const zb = [...document.querySelectorAll('[data-zoom]')].map(b => { const x = b.getBoundingClientRect(); return { t: b.textContent, w: Math.round(x.width), h: Math.round(x.height), name: b.getAttribute('aria-label') }; });
    return { canvasW: Math.round(r.width), canvasH: Math.round(r.height), hostW: Math.round(host.width), dark, zoomHidden: zoom?.hidden, zoomButtons: zb };
  });
  res.pdfOverflow = await ov(p);
  await shot(p, `j-${DEV}-07-pdf-view`);
  // zoom in twice with taps, check page can scroll sideways in the viewer, not the page.
  await p.locator('[data-zoom="1"]').tap();
  await p.waitForTimeout(700);
  await p.locator('[data-zoom="1"]').tap();
  await p.waitForTimeout(900);
  res.pdfZoomed = await p.evaluate(() => {
    const v = document.querySelector('.pdf-view');
    return { viewScrollW: v.scrollWidth, viewClientW: v.clientWidth, docSW: document.documentElement.scrollWidth, iw: innerWidth, canvasW: Math.round(document.querySelector('.pdf-page canvas').getBoundingClientRect().width) };
  });
  await shot(p, `j-${DEV}-08-pdf-zoomed`);
  // image
  await p.goto(img.href);
  await p.waitForSelector('.img-view img');
  await p.waitForFunction(() => document.querySelector('.img-view img').complete);
  res.img = await p.evaluate(() => { const i = document.querySelector('.img-view img'); const r = i.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), natural: i.naturalWidth, alt: i.alt }; });
  res.imgOverflow = await ov(p);
  await shot(p, `j-${DEV}-09-img-view`);
  // topbar on the viewer: title is a long file name
  res.viewerTopbar = await p.evaluate(() => { const t = document.querySelector('.topbar'); return { h: Math.round(t.getBoundingClientRect().height), h1: document.querySelector('h1').textContent }; });
  await shot(p, `j-${DEV}-09b-viewer-topbar`, { x: 0, y: 0, width: p.viewportSize().width, height: 200 });
  return res;
});

// 6. Add a note.
await step('add-note', async () => {
  await p.goto(`/documents/${docId}`);
  const ta = p.locator('#note_body');
  await ta.scrollIntoViewIfNeeded();
  await ta.tap();
  await p.keyboard.type(`تێبینی ${M}`);
  await p.locator('form[action$="/notes"] button[type=submit]').tap();
  await p.waitForURL(/done=note|error=/);
  // Where does the page land after the redirect? The note is far down; is the message visible?
  const n = await p.evaluate(() => ({ notice: document.querySelector('.content > .notice')?.textContent.trim(), scrollY }));
  return { url: p.url(), ...n };
});

// 7. Send the letter to legal.
await step('send-letter', async () => {
  await p.goto(`/documents/${docId}`);
  const legal = await p.$$eval('#to_room option', os => os.find(o => o.textContent.includes('یاسا'))?.value);
  const sel = p.locator('#to_room');
  await sel.scrollIntoViewIfNeeded();
  await p.selectOption('#to_room', legal);
  await p.tap('#note');
  await p.keyboard.type(`بۆ بیروڕا ${M}`);
  await shot(p, `j-${DEV}-10-send-form`);
  await p.locator('form[action$="/route"]:has(input[value=single]) button[type=submit]').tap();
  await p.waitForURL(/sent=1|error=/);
  return { url: p.url(), notice: await p.locator('.content > .notice').textContent().catch(() => null) };
});

// 8. Receipt and print on the phone; get the PIN for tracking.
let pin = null;
await step('receipt-and-print-on-phone', async () => {
  const r = {};
  const rp = await S.context.newPage();
  await rp.goto(`/documents/${docId}/receipt`);
  await rp.waitForTimeout(600);
  r.receipt = await ov(rp);
  pin = await rp.evaluate(() => document.querySelector('.pin b')?.textContent.trim());
  r.receiptLayout = await rp.evaluate(() => ({ slip: document.querySelector('.slip')?.getBoundingClientRect().toJSON(), sheet: document.querySelector('.sheet') && getComputedStyle(document.querySelector('.sheet')).display, sw: document.documentElement.scrollWidth, iw: innerWidth }));
  await shot(rp, `j-${DEV}-11-receipt`);
  await rp.goto(`/documents/${docId}/receipt?format=sheet`);
  await rp.waitForTimeout(600);
  r.receiptSheet = await ov(rp);
  await rp.screenshot({ path: join(HERE, 'shots', `j-${DEV}-11b-receipt-sheet.png`), fullPage: true, scale: 'css' });
  await rp.goto(`/documents/${docId}/print`);
  await rp.waitForTimeout(600);
  r.print = await ov(rp);
  await rp.screenshot({ path: join(HERE, 'shots', `j-${DEV}-12-print.png`), fullPage: true, scale: 'css' });
  await rp.close();
  r.pinFound = !!pin;
  return r;
});

// 9. As the legal room head on his phone: inbox, open letter, sign for the paper on the barcode screen.
const H = await ctxFor(browser, 'hemin', DEV);
await step('hemin-inbox-open-letter', async () => {
  const hp = H.page;
  await hp.goto('/inbox');
  const o = await ov(hp);
  // Find our row.
  const row = hp.locator('table tbody tr', { hasText: M });
  await row.first().scrollIntoViewIfNeeded();
  const rowInfo = await row.first().evaluate(tr => {
    const cells = [...tr.children].map(td => { const r = td.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), sticky: getComputedStyle(td).position }; });
    const wrap = tr.closest('.table-wrap');
    return { cells, wrapW: wrap.clientWidth, wrapSW: wrap.scrollWidth };
  });
  const y = (await row.first().boundingBox()).y;
  await shot(hp, `j-${DEV}-13-hemin-inbox-row`, { x: 0, y: Math.max(0, y - 60), width: hp.viewportSize().width, height: 220 });
  // Scroll the table sideways by touch-like scroll and see whether pinned column covers text.
  const covered = await row.first().evaluate(tr => {
    const wrap = tr.closest('.table-wrap');
    wrap.scrollLeft = -(wrap.scrollWidth - wrap.clientWidth) / 2; // RTL: negative
    const last = tr.lastElementChild.getBoundingClientRect();
    const hits = [...tr.children].slice(0, -1).filter(td => { const r = td.getBoundingClientRect(); return r.right > last.left && r.left < last.right; }).map(td => td.textContent.trim().slice(0, 20));
    return { scrollLeft: wrap.scrollLeft, lastL: Math.round(last.left), lastR: Math.round(last.right), underneath: hits };
  });
  await hp.waitForTimeout(200);
  const y2 = (await row.first().boundingBox()).y;
  await shot(hp, `j-${DEV}-13b-hemin-inbox-scrolled`, { x: 0, y: Math.max(0, y2 - 60), width: hp.viewportSize().width, height: 220 });
  await row.first().locator('a.btn').tap();
  await hp.waitForURL(/\/documents\/\d+/);
  return { inboxOverflow: o, rowInfo, covered, url: hp.url() };
});

await step('hemin-barcode-sign-paper', async () => {
  const hp = H.page;
  await hp.tap('.nav-toggle');
  await hp.waitForTimeout(350);
  const link = hp.locator('.sidebar .nav a[href="/barcode"]');
  await link.scrollIntoViewIfNeeded();
  await link.tap();
  await hp.waitForURL(/\/barcode/);
  const focusedOnLoad = await hp.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  await hp.tap('#q');
  await hp.keyboard.type(barcode || '');
  await hp.locator('form[action="/barcode"] button[type=submit]').tap();
  await hp.waitForURL(/q=/);
  const res = await hp.evaluate(() => {
    const svg = document.querySelector('.card svg');
    const r = svg?.getBoundingClientRect();
    return { svgW: r && Math.round(r.width), svgR: r && Math.round(r.right), svgL: r && Math.round(r.left), iw: innerWidth, found: !!document.querySelector('form[action$="/paper-received"]') };
  });
  const o = await ov(hp);
  await hp.screenshot({ path: join(HERE, 'shots', `j-${DEV}-14-barcode-result.png`), fullPage: true, scale: 'css' });
  const btn = hp.locator('form[action$="/paper-received"] button');
  await btn.scrollIntoViewIfNeeded();
  await btn.tap();
  await hp.waitForURL(/ok=|error=/);
  const notice = await hp.locator('.content > .notice').textContent().catch(() => null);
  return { focusedOnLoad, ...res, overflow: o, notice };
});

// 10. My day and chase, as shilan.
await step('myday-chase', async () => {
  await p.goto('/my-day');
  const o = await ov(p);
  const row = p.locator('tr', { hasText: M }).filter({ has: p.locator('form[action$="/chase"]') });
  const n = await row.count();
  if (!n) { await p.screenshot({ path: join(HERE, 'shots', `j-${DEV}-15-myday.png`), fullPage: true, scale: 'css' }); return { found: false, overflow: o }; }
  await row.first().scrollIntoViewIfNeeded();
  const bx = await row.first().locator('button').boundingBox();
  const y = (await row.first().boundingBox()).y;
  await shot(p, `j-${DEV}-15-myday-row`, { x: 0, y: Math.max(0, y - 80), width: p.viewportSize().width, height: 240 });
  await row.first().locator('button').tap();
  await p.waitForLoadState('load');
  const notice = await p.locator('.content > .notice').textContent().catch(() => null);
  return { found: true, btn: bx, url: p.url(), notice, overflow: o };
});

// 11. The scan tray, and claiming a scan.
await step('tray-upload-and-claim', async () => {
  await p.goto('/tray');
  const inp = p.locator('#file');
  await inp.setInputFiles([
    { name: `${M}-tray-page1.png`, mimeType: 'image/png', buffer: inkPng(220) },
  ]);
  await p.waitForTimeout(200);
  const chooseLbl = await p.locator('label.file-choose[for=file]').boundingBox();
  const cb = await p.locator('input[name=merge]').boundingBox();
  await shotAround(p, p.locator('form[action="/tray/upload"]'), `j-${DEV}-16-tray-form`, { above: 10, height: 460 });
  await p.locator('form[action="/tray/upload"] button[type=submit]').tap();
  await p.waitForLoadState('load');
  const afterUpload = { url: p.url(), notice: await p.locator('.content > .notice').textContent().catch(() => null) };
  const row = p.locator('tr', { hasText: M });
  const c = await row.count();
  if (!c) return { afterUpload, chooseLbl, cb, found: false };
  await row.first().locator('a.btn').tap();
  await p.waitForURL(/\/tray\/\d+/);
  await p.waitForTimeout(500);
  const o = await ov(p);
  await p.screenshot({ path: join(HERE, 'shots', `j-${DEV}-17-tray-item.png`), fullPage: true, scale: 'css' });
  const opt = await p.$$eval('#document_id option', (os, id) => os.find(o => o.value === String(id))?.value, docId);
  if (!opt) return { afterUpload, overflow: o, claimOption: false };
  await p.selectOption('#document_id', opt);
  await p.selectOption('#kind', 'supporting');
  await p.locator('form[action$="/claim"]:has(#document_id) button[type=submit]').tap();
  await p.waitForLoadState('load');
  return { afterUpload, overflow: o, claimedUrl: p.url(), notice: await p.locator('.content > .notice').textContent().catch(() => null) };
});

// 12. Tracking page (public), 2 requests.
await step('public-track', async () => {
  const T = await ctxFor(browser, null, DEV);
  const tp = T.page;
  await tp.goto('/track');
  const o = await ov(tp);
  await tp.tap('#barcode');
  await tp.keyboard.type(barcode || '');
  await tp.tap('#pin');
  await tp.keyboard.type(pin || '');
  await tp.tap('button[type=submit]');
  await tp.waitForLoadState('load');
  const r = await tp.evaluate(() => ({ status: document.querySelector('.card .pill')?.textContent.trim(), notice: document.querySelector('.notice')?.textContent.trim() }));
  const o2 = await ov(tp);
  await tp.screenshot({ path: join(HERE, 'shots', `j-${DEV}-18-track.png`), fullPage: true, scale: 'css' });
  await T.context.close();
  return { overflowForm: o, ...r, overflowResult: o2 };
});

// 13. Leave: bafrin files for an archive clerk (not a head, so no cover) 40+ days away, then approves on her phone.
if (!process.env.SKIP_LEAVE) await step('bafrin-leave-approve', async () => {
  const B = await ctxFor(browser, 'bafrin', DEV);
  const bp = B.page;
  await bp.goto('/leave');
  const zhyan = await bp.$$eval('#user_id option', os => os.find(o => o.textContent.includes('ژیان'))?.value);
  const d = n => { const x = new Date(Date.now() + n * 86400000); return x.toISOString().slice(0, 10); };
  if (zhyan) await bp.selectOption('#user_id', zhyan);
  await bp.fill('#start_date', d(45));
  await bp.fill('#end_date', d(47));
  await bp.tap('#note');
  await bp.keyboard.type(`${M} تاقیکردنەوە`);
  await bp.locator('form[action="/leave/new"] button[type=submit]').tap();
  await bp.waitForURL(/ok=1|error=/);
  const row = bp.locator('tr', { hasText: M });
  await row.first().scrollIntoViewIfNeeded();
  const y = (await row.first().boundingBox()).y;
  const btns = await row.first().locator('button').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; }));
  const o = await ov(bp);
  await shot(bp, `j-${DEV}-19-leave-row`, { x: 0, y: Math.max(0, y - 20), width: bp.viewportSize().width, height: Math.min(260, (await row.first().boundingBox()).height + 40) });
  await row.first().locator('button[value=approved]').tap();
  await bp.waitForURL(/ok=1|error=/);
  const status = await bp.locator('tr', { hasText: M }).first().locator('.pill').first().textContent();
  await B.context.close();
  return { zhyan: !!zhyan, btns, overflow: o, status };
});

// 14. Archive a map, as karwan.
await step('karwan-archive-map', async () => {
  const K = await ctxFor(browser, 'karwan', DEV);
  const kp = K.page;
  await kp.goto('/archive/new');
  const o = await ov(kp);
  const titleBox = await kp.locator('#title').boundingBox();
  const yearBox = await kp.locator('#year').boundingBox();
  const grid = await kp.evaluate(() => { const g = document.querySelector('#title').closest('.grid'); return { cols: getComputedStyle(g).gridTemplateColumns, w: Math.round(g.getBoundingClientRect().width) }; });
  await kp.screenshot({ path: join(HERE, 'shots', `j-${DEV}-20-archive-form.png`), fullPage: true, scale: 'css' });
  await kp.locator('#file').setInputFiles([{ name: `${M}-map.pdf`, mimeType: 'application/pdf', buffer: inkPdf() }]);
  await kp.tap('#plot_no'); await kp.keyboard.type(`9${Math.floor(Math.random() * 900 + 100)}/7`);
  await kp.tap('#title'); await kp.keyboard.type(`نەخشەی ${M}`);
  await kp.tap('#shelf'); await kp.keyboard.type('3');
  await kp.tap('#section'); await kp.keyboard.type('2');
  await kp.tap('#folder_no'); await kp.keyboard.type('11');
  const invalid = await kp.evaluate(() => [...document.querySelectorAll('form[action="/archive/new"] :invalid')].map(e => `${e.id || e.name}: ${e.validationMessage}`));
  await kp.locator('form[action="/archive/new"] > .row button[type=submit]').tap();
  await kp.waitForTimeout(1500);
  await kp.waitForLoadState('load');
  const url = kp.url();
  const knotice = await kp.locator('.content > .notice').textContent().catch(() => null);
  // Where did the browser's own "please fill in" bubble point, if anything is invalid?
  const focusedAfter = await kp.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { el: a.id || a.tagName, top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), cls: a.className }; });
  const o2 = await ov(kp);
  await kp.screenshot({ path: join(HERE, 'shots', `j-${DEV}-21-archive-record.png`), fullPage: true, scale: 'css' });
  await K.context.close();
  return { overflowForm: o, titleBox, yearBox, grid, invalid, url, knotice, focusedAfter, overflowRecord: o2 };
});

rec({ step: 'summary', docId, barcode, incomingNo, marker: M, problems: [...p.problems, ...H.page.problems].slice(0, 10) });
await browser.close();
