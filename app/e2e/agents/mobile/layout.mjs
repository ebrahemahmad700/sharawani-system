// Layout details on phones and tablets: sticky bar size, anchors, clipped text,
// tables and their pinned action column, drawer scroll lock, keyboard covering fields,
// orientation.
import { launch, ctxFor, shot, shotAround, HERE } from './lib.mjs';
import { writeFileSync } from 'fs';
import { join } from 'path';

const DOC = process.env.DOC || '1240';
const OUT = [];
const rec = o => { OUT.push(o); console.log(JSON.stringify(o).slice(0, 900)); };
const browser = await launch();

const SCREENS = {
  shilan: ['/registry', '/registry/new', '/inbox', '/my-day', '/outgoing', `/documents/${DOC}`, '/tray', '/barcode', '/manifests', '/companies', '/leave', '/notifications', '/templates', '/plots'],
  hemin: ['/inbox', '/log'],
  aram: ['/dashboard', '/rooms', '/inbox'],
  karwan: ['/archive', '/archive/new'],
  itadmin: ['/admin/users', '/admin/rooms'],
};

// --- A. per screen: top bar, clipped text, tables ------------------------------
for (const size of ['s360', 'i390', 't768']) {
  for (const [user, paths] of Object.entries(SCREENS)) {
    const { context, page } = await ctxFor(browser, user, size);
    for (const path of paths) {
      await page.goto(path, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const tb = document.querySelector('.topbar').getBoundingClientRect();
        const clipped = [];
        for (const el of document.querySelectorAll('.content *, .topbar *')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (!['hidden', 'clip'].includes(cs.overflowX) && !['hidden', 'clip'].includes(cs.overflowY) && cs.textOverflow !== 'ellipsis') continue;
          if (['SELECT', 'INPUT', 'TEXTAREA', 'svg', 'CANVAS', 'IMG'].includes(el.tagName)) continue;
          if (el.matches('.file-native, .table-wrap, .card, .pdf-view, .img-view')) continue;
          const over = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2;
          if (over && el.textContent.trim()) clipped.push({ el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).join('.') : ''), text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
        }
        // Tables
        const tables = [...document.querySelectorAll('.content table')].map(t => {
          const wrap = t.closest('.table-wrap');
          const scroller = wrap || (getComputedStyle(t).display === 'block' ? t : null);
          const overflowing = scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false;
          const hasThead = !!t.querySelector('thead');
          const rows = [...t.querySelectorAll('tbody tr')];
          const withActions = rows.filter(tr => tr.querySelector('.btn, button'));
          let actionNotLast = 0, lastNotPinned = 0, actionOffscreen = 0;
          const iw = innerWidth;
          for (const tr of withActions) {
            const cells = [...tr.children];
            cells.forEach((td, i) => {
              if (!td.querySelector('.btn, button')) return;
              if (i !== cells.length - 1) actionNotLast++;
              else if (getComputedStyle(td).position !== 'sticky') lastNotPinned++;
              const b = td.querySelector('.btn, button').getBoundingClientRect();
              if (b.right < 0 || b.left > iw || (scroller && (b.left < scroller.getBoundingClientRect().left - 1 || b.right > scroller.getBoundingClientRect().right + 1))) actionOffscreen++;
            });
          }
          const thLast = t.querySelector('thead tr th:last-child');
          const thPinned = thLast ? getComputedStyle(thLast).position : null;
          return { in: wrap ? 'table-wrap' : (t.closest('.card') ? 'card' : 'other'), display: getComputedStyle(t).display, overflowing, hasThead, rows: rows.length, withActions: withActions.length, actionNotLast, lastNotPinned, actionOffscreen, thPinned, thLastEmpty: thLast ? thLast.textContent.trim() === '' : null, headers: t.querySelectorAll('th').length, firstRowText: (rows[0]?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) };
        });
        return { topbarH: Math.round(tb.height), ih: innerHeight, pct: Math.round(tb.height / innerHeight * 100), clipped: clipped.slice(0, 8), tables };
      });
      rec({ kind: 'screen', size, user, path, ...r });
    }
    await context.close();
  }
}

// --- B. anchors under the sticky top bar ---------------------------------------
for (const size of ['s360', 'i390', 'a412', 't768', 't1024']) {
  const { context, page } = await ctxFor(browser, 'shilan', size);
  for (const hash of ['close', 'attachments']) {
    await page.goto(`/documents/${DOC}#${hash}`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const r = await page.evaluate(h => {
      const t = document.getElementById(h);
      if (!t) return { missing: true };
      const tb = document.querySelector('.topbar').getBoundingClientRect();
      const heading = t.querySelector('h2').getBoundingClientRect();
      return { targetTop: Math.round(t.getBoundingClientRect().top), headingTop: Math.round(heading.top), headingBottom: Math.round(heading.bottom), topbarBottom: Math.round(tb.bottom), headingHidden: heading.bottom <= tb.bottom, scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop };
    }, hash);
    rec({ kind: 'anchor', size, hash, ...r });
    if (r.headingHidden) await shot(page, `anchor-${size}-${hash}`, { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(page.viewportSize().height, 360) });
  }
  await context.close();
}

// --- C. the drawer: scroll behind it, sizes, landscape phone --------------------
for (const size of ['s360', 'i390', 'a412', 't768']) {
  const { context, page } = await ctxFor(browser, 'shilan', size);
  await page.goto('/inbox', { waitUntil: 'load' });
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.tap('.nav-toggle');
  await page.waitForTimeout(350);
  const y0 = await page.evaluate(() => scrollY);
  // Swipe on the backdrop (left strip) upward.
  const vp = page.viewportSize();
  await page.mouse.move(20, vp.height - 100);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  const y1 = await page.evaluate(() => scrollY);
  const drawer = await page.evaluate(() => {
    const s = document.querySelector('.sidebar').getBoundingClientRect();
    const nav = document.querySelector('.nav');
    return { left: Math.round(s.left), w: Math.round(s.width), navScroll: nav.scrollHeight > nav.clientHeight, expanded: document.querySelector('.nav-toggle').getAttribute('aria-expanded') };
  });
  await shot(page, `drawer-${size}`);
  rec({ kind: 'drawer', size, pageScrollBehindDrawer: { before: y0, afterWheel: y1 }, ...drawer });
  await context.close();
}
// Landscape phone
{
  const { context, page } = await ctxFor(browser, 'shilan', 'i390', { viewport: { width: 844, height: 390 } });
  for (const path of ['/inbox', `/documents/${DOC}`, '/registry/new', '/barcode']) {
    await page.goto(path, { waitUntil: 'load' });
    const r = await page.evaluate(() => ({ topbarH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height), ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    rec({ kind: 'landscape-phone', path, ...r, pct: Math.round(r.topbarH / r.ih * 100) });
    await shot(page, `landscape-844-${path.replace(/[^a-z0-9]+/gi, '_')}`);
  }
  // drawer in landscape: can the last item be reached?
  await page.tap('.nav-toggle');
  await page.waitForTimeout(350);
  const d = await page.evaluate(() => {
    const nav = document.querySelector('.nav');
    const who = document.querySelector('.whoami').getBoundingClientRect();
    return { navScrollH: nav.scrollHeight, navClientH: nav.clientHeight, whoTop: Math.round(who.top), whoBottom: Math.round(who.bottom), ih: innerHeight };
  });
  rec({ kind: 'landscape-drawer', ...d });
  await shot(page, 'landscape-844-drawer');
  await context.close();
}
// Rotation of the same page: portrait -> landscape -> portrait keeps working
{
  const { context, page } = await ctxFor(browser, 'shilan', 'i390');
  await page.goto(`/documents/${DOC}`, { waitUntil: 'load' });
  await page.tap('.nav-toggle');
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  const a = await page.evaluate(() => ({ open: document.querySelector('#nav-toggle').checked, sb: Math.round(document.querySelector('.sidebar').getBoundingClientRect().left), sw: document.documentElement.scrollWidth, iw: innerWidth }));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => ({ open: document.querySelector('#nav-toggle').checked, backdrop: getComputedStyle(document.querySelector('.nav-backdrop')).display, sw: document.documentElement.scrollWidth }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const c = await page.evaluate(() => ({ open: document.querySelector('#nav-toggle').checked, sbLeft: Math.round(document.querySelector('.sidebar').getBoundingClientRect().left), backdrop: getComputedStyle(document.querySelector('.nav-backdrop')).display }));
  rec({ kind: 'rotate-with-drawer-open', landscape: a, tablet: b, backToPortrait: c });
  await context.close();
}

// --- D. on-screen keyboard: viewport 400px tall while a field is focused -------
const FIELDS = [
  ['shilan', `/documents/${DOC}`, '#note_body'],
  ['shilan', `/documents/${DOC}`, '#recipient'],
  ['shilan', '/registry/new', '#physical_folder'],
  ['shilan', '/registry/new', '#subject'],
  ['karwan', '/archive/new', '#folder_no'],
  ['shilan', '/barcode', '#q'],
];
for (const size of ['s360', 'i390']) {
  for (const [user, path, sel] of FIELDS) {
    const { context, page } = await ctxFor(browser, user, size);
    await page.goto(path, { waitUntil: 'load' });
    const loc = page.locator(sel);
    await loc.scrollIntoViewIfNeeded();
    await loc.tap();
    const vp = page.viewportSize();
    await page.setViewportSize({ width: vp.width, height: 400 });
    await page.waitForTimeout(300);
    const measure = () => page.evaluate(s => {
      const f = document.querySelector(s).getBoundingClientRect();
      const tb = document.querySelector('.topbar').getBoundingClientRect();
      return { focused: document.activeElement === document.querySelector(s), fieldTop: Math.round(f.top), fieldBottom: Math.round(f.bottom), topbarBottom: Math.round(tb.bottom), ih: innerHeight, visibleRows: Math.max(0, Math.min(f.bottom, innerHeight) - Math.max(f.top, tb.bottom)), fieldH: Math.round(f.height) };
    }, sel);
    const raw = await measure();
    // What the browser does when the keyboard appears: bring the focused field into view.
    await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
    await page.waitForTimeout(150);
    const centred = await measure();
    await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'nearest' }), sel);
    await page.waitForTimeout(150);
    const nearest = await measure();
    const covered = centred.fieldTop < centred.topbarBottom || nearest.fieldTop < nearest.topbarBottom;
    rec({ kind: 'keyboard', size, user, path, sel, raw, centred, nearest, covered });
    await shot(page, `kbd-${size}-${user}-${path.replace(/[^a-z0-9]+/gi, '_')}-${sel.slice(1)}`);
    await context.close();
  }
}

writeFileSync(join(HERE, 'layout.json'), JSON.stringify(OUT, null, 1));
await browser.close();
