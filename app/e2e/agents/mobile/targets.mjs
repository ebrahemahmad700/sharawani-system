// Touch targets: size and spacing of things tapped often, with clipped screenshots.
import { launch, ctxFor, shot, shotAround, inkPng, HERE } from './lib.mjs';
import { writeFileSync } from 'fs';
import { join } from 'path';

const DOC = process.env.DOC || '1230';
const OUT = [];
const rec = o => { OUT.push(o); console.log(JSON.stringify(o).slice(0, 1200)); };
const browser = await launch();

// Generic: every interactive element on the screen, and its nearest neighbour gap.
async function survey(page) {
  return page.evaluate(() => {
    const sel = 'a[href], button, input:not([type=hidden]):not(.file-native), select, textarea, summary, label.btn, [role=button]';
    const els = [...document.querySelectorAll(sel)].filter(el => {
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
      if (el.closest('.sidebar') && document.querySelector('.sidebar').getBoundingClientRect().left >= innerWidth - 1) return false;
      return true;
    });
    // A checkbox or radio inside a label: the label is the target.
    const box = el => {
      const lab = (el.type === 'checkbox' || el.type === 'radio') && el.closest('label');
      return (lab || el).getBoundingClientRect();
    };
    const d = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '') + (el.tagName === 'INPUT' ? `[${el.type}]` : '');
    const small = [];
    const rects = els.map(el => ({ el, r: box(el) }));
    for (const { el, r } of rects) {
      const cs = getComputedStyle(el);
      const inlineText = el.tagName === 'A' && cs.display === 'inline' && !el.classList.contains('btn') && el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length + 3;
      if (r.width >= 40 && r.height >= 40) continue;
      // nearest other target edge gap
      let gap = Infinity, near = null;
      for (const o of rects) {
        if (o.el === el || o.el.contains(el) || el.contains(o.el)) continue;
        const dx = Math.max(0, Math.max(o.r.left - r.right, r.left - o.r.right));
        const dy = Math.max(0, Math.max(o.r.top - r.bottom, r.top - o.r.bottom));
        const g = Math.hypot(dx, dy);
        if (g < gap) { gap = g; near = d(o.el) + ' «' + (o.el.getAttribute('aria-label') || o.el.textContent || '').trim().slice(0, 15) + '»'; }
      }
      small.push({ el: d(el), text: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 25), w: Math.round(r.width), h: Math.round(r.height), inlineText, gap: Math.round(gap), near, y: Math.round(r.top + scrollY) });
    }
    return small;
  });
}

const PLAN = [
  ['shilan', `/documents/${DOC}`], ['shilan', '/manifests'], ['shilan', '/inbox'], ['shilan', '/my-day'], ['shilan', '/barcode?q=20260007099'],
  ['shilan', '/tray'], ['shilan', '/notifications'], ['hemin', '/log'], ['aram', '/dashboard'], ['bafrin', '/leave'], ['karwan', '/archive/new'],
];
for (const size of ['i390', 't1024']) {
  for (const [user, path] of PLAN) {
    const { context, page } = await ctxFor(browser, user, size);
    await page.goto(path, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const s = await survey(page);
    // Group by element kind
    const g = {};
    for (const x of s) { const k = `${x.el} ${x.w}x${x.h}${x.inlineText ? ' (inline text link)' : ''} gap${x.gap}`; (g[k] ||= { n: 0, ex: x.text, near: x.near }).n++; }
    rec({ size, user, path, small: g });
    await context.close();
  }
}

// Specific evidence shots on the phone.
{
  const { context, page } = await ctxFor(browser, 'shilan', 'i390');
  // Manifests checkboxes
  await page.goto('/manifests', { waitUntil: 'load' });
  const cb = page.locator('form[action="/manifests/new"] input[type=checkbox]').first();
  if (await cb.count()) {
    await cb.scrollIntoViewIfNeeded();
    const info = await cb.evaluate(el => { const r = el.getBoundingClientRect(); const td = el.closest('td').getBoundingClientRect(); return { cb: [Math.round(r.width), Math.round(r.height)], cell: [Math.round(td.width), Math.round(td.height)], label: el.labels.length, aria: el.getAttribute('aria-label') }; });
    // Tap at the cell but 12px off the box: does it toggle?
    const bb = await cb.boundingBox();
    const before = await cb.isChecked();
    await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height + 8);
    const afterNearTap = await cb.isChecked();
    rec({ evidence: 'manifest-checkbox', ...info, before, afterTap8pxBelow: afterNearTap });
    await shotAround(page, cb.locator('xpath=ancestor::tr'), 'tgt-i390-manifest-checkbox', { above: 50, height: 160 });
  }
  // Attachment row: remove button in the chooser, "more" summary, text link
  await page.goto(`/documents/${DOC}`, { waitUntil: 'load' });
  await page.locator('#attachments input[type=file]').setInputFiles([{ name: 'IMG_20260913_wrong.jpg', mimeType: 'image/png', buffer: inkPng(60) }, ]);
  const rm = page.locator('#attachments .file-picked .remove');
  await rm.scrollIntoViewIfNeeded();
  const rmb = await rm.boundingBox();
  await shotAround(page, page.locator('#attachments .file-picked'), 'tgt-i390-remove-file', { above: 60, height: 130 });
  const sum = page.locator('#attachments details.attach-more summary').first();
  await sum.scrollIntoViewIfNeeded();
  const sb = await sum.boundingBox();
  await shotAround(page, page.locator('#attachments .attach-list li').first(), 'tgt-i390-attach-row', { above: 6, height: 150 });
  rec({ evidence: 'attachments', removeBtn: rmb, moreSummary: sb });
  // Viewer zoom buttons
  const href = await page.$eval('#attachments .attach-list li a.btn', a => a.getAttribute('href'));
  await page.goto(href, { waitUntil: 'load' });
  await page.waitForSelector('[data-viewer-zoom]:not([hidden])', { timeout: 15000 });
  const zb = await page.$$eval('[data-zoom]', bs => bs.map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent, x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; }));
  await shotAround(page, page.locator('[data-viewer-zoom]'), 'tgt-i390-viewer-zoom', { above: 20, height: 90 });
  rec({ evidence: 'viewer-zoom', zb });
  await context.close();
}
{
  // Tablet landscape: desktop sizes under a finger
  const { context, page } = await ctxFor(browser, 'shilan', 't1024');
  await page.goto(`/documents/${DOC}`, { waitUntil: 'load' });
  const tb = await page.evaluate(() => [...document.querySelectorAll('.topbar a, .topbar button, .topbar input, .sidebar .logout-btn, .sidebar .whoami-link')].map(e => { const r = e.getBoundingClientRect(); return { el: e.className || e.tagName, text: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 15), w: Math.round(r.width), h: Math.round(r.height) }; }));
  rec({ evidence: 'tablet-1024-topbar', tb, pointerCoarse: await page.evaluate(() => matchMedia('(pointer: coarse)').matches) });
  await shot(page, 'tgt-t1024-topbar', { x: 0, y: 0, width: 1024, height: 70 });
  await page.goto('/leave', { waitUntil: 'load' });
  await context.close();
}
{
  const { context, page } = await ctxFor(browser, 'bafrin', 't1024');
  await page.goto('/leave', { waitUntil: 'load' });
  const b = page.locator('form[action$="/decide"]').first();
  if (await b.count()) {
    const r = await b.evaluate(f => [...f.querySelectorAll('button')].map(x => { const q = x.getBoundingClientRect(); return { t: x.textContent.trim(), w: Math.round(q.width), h: Math.round(q.height), l: Math.round(q.left), r: Math.round(q.right) }; }));
    rec({ evidence: 'tablet-1024-leave-decide', r });
    await shotAround(page, b, 'tgt-t1024-leave-decide', { above: 30, height: 100 });
  }
  await context.close();
}
writeFileSync(join(HERE, 'targets.json'), JSON.stringify(OUT, null, 1));
await browser.close();
