// The whole-system crawl.
//
// Signs in as every fixture account in turn and follows every link that person
// can reach, on a laptop screen and then on a phone screen. Nothing is clicked
// that changes anything: only links are followed, never forms.
//
// It does not pass or fail on what it finds. It writes what it saw to
// audit-output/, one JSON file per person, plus a screenshot of each kind of page
// per role, and `node audit/summarise.mjs` turns those into a report. A crash, a
// refused link or a page wider than the phone is a finding, not a failed test,
// because the point is to see all of them at once rather than the first.

import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { signIn } from '../tests/helpers.mjs';

const OUT = join(process.cwd(), 'audit-output');
const SHOTS = join(OUT, 'shots');
mkdirSync(SHOTS, { recursive: true });

const USERS = (process.env.AUDIT_USERS || 'aram,nabaz,shilan,ahang,hemin,sakar,dler,rebwar,bafrin,shne,karwan,zhyan,hersh,sozan,itadmin').split(',');
const PER_PATTERN = Number(process.env.AUDIT_PER_PATTERN || 2);
const MAX_PAGES = Number(process.env.AUDIT_MAX_PAGES || 160);

// Links that are not pages: files, streams, and the one that signs you out.
const SKIP = [
  /^\/logout/, /^\/events/, /^\/board\/(stream|data)/, /^\/notifications\/(poll|count)/,
  /^\/attachments\/\d+$/, /\/download/, /\/preview/, /[?&]download=1/, /^\/companies\/files\//,
  /^\/scan\/scanners\//, /^\/api\//, /\.(pdf|png|jpe?g|dwg|dxf|tif|zip|csv)$/i,
  /^\/vendor\//, /^\/icons\//, /^\/manifest/, /^\/sw\.js/,
];

const patternOf = url => {
  const u = new URL(url);
  const path = u.pathname.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/t\/[^/]+/, '/t/:code');
  const keys = [...new Set([...u.searchParams.keys()])].sort();
  return keys.length ? `${path}?${keys.join('&')}` : path;
};
const fileSafe = s => s.replace(/[^a-z0-9:_-]+/gi, '_').replace(/:/g, '').slice(0, 80) || 'root';

// Everything measured on a page, in the page. Returns plain data.
function inspect(viewportName) {
  const vw = document.documentElement.clientWidth;
  const out = { viewport: viewportName };
  const visible = el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const describe = el => {
    const bits = [];
    for (let e = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      let b = e.tagName.toLowerCase();
      if (e.id) b += '#' + e.id;
      else if (typeof e.className === 'string' && e.className.trim()) b += '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.');
      bits.unshift(b);
    }
    return bits.join(' > ');
  };
  const drawerClosed = !document.getElementById('nav-toggle')?.checked;
  const inSidebar = el => !!el.closest('.sidebar, .nav-backdrop');

  out.title = document.title;
  out.h1 = document.querySelector('h1')?.textContent.trim() ?? null;
  out.scrollWidth = document.documentElement.scrollWidth;
  out.clientWidth = vw;
  out.pageOverflowX = document.documentElement.scrollWidth > vw + 1;
  out.scrollHeight = document.documentElement.scrollHeight;

  // Elements poking past the side of the screen that are not inside something
  // that scrolls sideways on purpose.
  const scrollsX = el => {
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
    }
    return false;
  };
  const offscreen = [];
  for (const el of document.querySelectorAll('.content *, .topbar *, .topbar, .auth *')) {
    if (drawerClosed && inSidebar(el)) continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 2 || r.left < -2) && !scrollsX(el)) offscreen.push({ el: describe(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) });
  }
  // Keep the outermost offenders only.
  out.offscreen = offscreen.slice(0, 12);
  out.offscreenCount = offscreen.length;

  // Tables that are wider than their box (scroll sideways on a phone).
  out.wideTables = [...document.querySelectorAll('table')].filter(visible).map(t => {
    const box = t.parentElement;
    return { el: describe(t), table: Math.round(t.getBoundingClientRect().width), box: Math.round(box.getBoundingClientRect().width), boxScrolls: ['auto', 'scroll'].includes(getComputedStyle(box).overflowX) };
  }).filter(t => t.table > t.box + 2);

  const text = document.body.innerText;
  out.textLength = text.length;
  out.badWords = [...new Set((text.match(/\b(undefined|null|NaN|Infinity|true|false|\[object [A-Za-z]+\]|Invalid Date|TODO|FIXME|lorem)\b|\$\{[^}]*\}/g) || []))];
  out.mixedDigits = [...new Set((text.match(/[^\s]*(?:[0-9][٠-٩]|[٠-٩][0-9])[^\s]*/g) || []))].slice(0, 10);
  out.latinWords = [...new Set((text.match(/[A-Za-z][A-Za-z.'-]{2,}/g) || []))].slice(0, 40);
  out.persianDigits = [...new Set((text.match(/[^\s]*[۰-۹][^\s]*/g) || []))].slice(0, 5);
  out.arabicYehKaf = /[يك]/.test(text);   // Arabic ي/ك instead of Kurdish ی/ک
  out.serverErrorPage = /داواکارییەکەت تەواو نەبوو/.test(text);
  out.notices = [...document.querySelectorAll('.notice')].filter(visible).map(n => ({ kind: n.className, text: n.textContent.trim().slice(0, 140) }));

  out.brokenImages = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && visible(i)).map(i => i.src);
  const ids = {}; for (const e of document.querySelectorAll('[id]')) ids[e.id] = (ids[e.id] || 0) + 1;
  out.duplicateIds = Object.entries(ids).filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`);

  const hasName = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.querySelector('img[alt]')?.alt || '').trim().length > 0;
  out.unnamedControls = [...document.querySelectorAll('button, a[href], [role=button]')].filter(visible).filter(el => !hasName(el) && !(el.tagName === 'INPUT')).map(describe).slice(0, 8);
  out.unlabelled = [...document.querySelectorAll('input, select, textarea')].filter(el => {
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(el.type)) return false;
    if (el.id === 'nav-toggle') return false;
    if (!visible(el) && el.type !== 'file') return false;
    if (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('aria-labelledby')) return false;
    if (el.closest('label')) return false;
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
    return true;
  }).map(el => `${describe(el)}[name=${el.name}]`).slice(0, 8);
  out.emptyLinks = [...document.querySelectorAll('a')].filter(a => ['', '#'].includes(a.getAttribute('href') ?? '')).map(describe).slice(0, 5);
  out.emptyTables = [...document.querySelectorAll('table')].filter(visible).filter(t => t.tBodies.length && ![...t.tBodies].some(b => b.rows.length)).map(describe);
  out.requiredWithoutMark = [...document.querySelectorAll('input[required], select[required], textarea[required]')].filter(visible).filter(el => {
    const l = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return l && !l.classList.contains('required') && !/\*/.test(l.textContent);
  }).map(el => `${el.name}`).slice(0, 8);

  // Small tap targets on the phone.
  if (viewportName === 'phone') {
    out.smallTargets = [...document.querySelectorAll('.content a[href], .content button, .content input:not([type=hidden]), .content select, .topbar a, .topbar button, .topbar label')]
      .filter(visible).map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => (r.height < 28 || r.width < 28) && !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
      .map(({ el, r }) => `${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}`).slice(0, 10);
  }

  // Style samples, to compare one screen with the next.
  const pick = (sel, props) => [...document.querySelectorAll(sel)].filter(visible).slice(0, 30).map(el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const o = { cls: (typeof el.className === 'string' ? el.className : '').trim(), h: Math.round(r.height) };
    for (const p of props) o[p] = s[p];
    return o;
  });
  out.styles = {
    btn: pick('.content .btn, .content button', ['fontSize', 'fontFamily', 'fontWeight', 'borderRadius', 'paddingTop', 'paddingLeft', 'backgroundColor', 'color']),
    input: pick('.content input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), .content select', ['fontSize', 'fontFamily', 'borderRadius', 'paddingTop', 'borderTopColor']),
    card: pick('.content .card', ['paddingTop', 'borderRadius', 'boxShadow', 'backgroundColor', 'borderTopWidth']),
    h2: pick('.content h2', ['fontSize', 'fontFamily', 'fontWeight', 'color', 'marginBottom']),
    h3: pick('.content h3', ['fontSize', 'fontFamily', 'fontWeight', 'color']),
    th: pick('.content th', ['fontSize', 'fontWeight', 'color', 'backgroundColor', 'textAlign', 'paddingTop']),
    td: pick('.content td', ['fontSize', 'color', 'paddingTop', 'textAlign']),
    badge: pick('.content .badge, .content .pill, .content .status, .content .tag, .content .chip', ['fontSize', 'borderRadius', 'backgroundColor', 'color', 'paddingTop']),
    p: pick('.content p', ['fontSize', 'color', 'lineHeight']),
    label: pick('.content label', ['fontSize', 'fontWeight', 'color']),
  };
  out.inlineStyles = [...document.querySelectorAll('.content [style]')].length;
  out.fonts = [...new Set([...document.querySelectorAll('body, h1, h2, .btn, input, td, .nav a')].map(e => getComputedStyle(e).fontFamily))];
  out.classesUsed = [...new Set([...document.querySelectorAll('[class]')].flatMap(e => typeof e.className === 'string' ? e.className.split(/\s+/) : []).filter(Boolean))];
  out.csp = window.__cspViolations || [];
  return out;
}

for (const username of USERS) {
  test(`crawl as ${username}`, async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const log = { user: username, pages: [], console: [], pageErrors: [], badResponses: [], failedRequests: [], slow: [], started: new Date().toISOString() };
    let current = '(sign-in)';

    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.console.push({ at: current, type: m.type(), text: m.text().slice(0, 300) }); });
    page.on('pageerror', e => log.pageErrors.push({ at: current, text: String(e).slice(0, 300) }));
    page.on('response', r => {
      const u = new URL(r.url());
      if (r.status() >= 400 && !/fonts\.g/.test(u.host)) log.badResponses.push({ at: current, url: u.pathname + u.search, status: r.status(), type: r.request().resourceType() });
    });
    page.on('requestfailed', r => {
      const u = new URL(r.url());
      const why = r.failure()?.errorText ?? '';
      if (/ERR_ABORTED/.test(why) && /\/events|\/board\/stream/.test(u.pathname)) return;
      log.failedRequests.push({ at: current, url: u.origin === new URL(page.url() || 'http://x').origin ? u.pathname + u.search : r.url(), why });
    });
    page.on('dialog', d => { log.console.push({ at: current, type: 'dialog', text: `${d.type()}: ${d.message()}` }); d.dismiss().catch(() => {}); });

    await page.setViewportSize({ width: 1366, height: 768 });
    await signIn(page, username);
    const origin = new URL(page.url()).origin;
    const role = await page.evaluate(() => document.querySelector('.whoami .role')?.textContent.trim());
    log.role = role;
    log.landing = new URL(page.url()).pathname;
    log.nav = await page.$$eval('.sidebar nav a', as => as.map(a => ({ href: a.getAttribute('href'), label: a.textContent.trim() })));

    const queue = [log.landing, ...log.nav.map(n => n.href)];
    const seenUrl = new Set(), perPattern = new Map(), linkFrom = new Map();
    for (const u of queue) linkFrom.set(u, '(sidebar)');

    while (queue.length && log.pages.length < MAX_PAGES) {
      const path = queue.shift();
      if (seenUrl.has(path)) continue;
      seenUrl.add(path);
      if (SKIP.some(re => re.test(path))) continue;
      const pat = patternOf(origin + path);
      if ((perPattern.get(pat) || 0) >= PER_PATTERN) continue;
      perPattern.set(pat, (perPattern.get(pat) || 0) + 1);

      current = path;
      const t0 = Date.now();
      let status = null, finalPath = null, err = null;
      try {
        const resp = await page.goto(path, { waitUntil: 'load', timeout: 30_000 });
        status = resp?.status() ?? null;
        finalPath = new URL(page.url()).pathname + new URL(page.url()).search;
      } catch (e) { err = String(e).split('\n')[0]; }
      const ms = Date.now() - t0;
      const record = { path, pattern: pat, from: linkFrom.get(path), status, finalPath, ms, err };
      if (ms > 2500) log.slow.push({ path, ms });
      if (err || !page.url().startsWith(origin)) { log.pages.push(record); continue; }

      await page.waitForTimeout(250);
      const ct = await page.evaluate(() => document.contentType);
      if (ct !== 'text/html') { record.contentType = ct; log.pages.push(record); continue; }

      record.desktop = await page.evaluate(inspect, 'desktop');
      const shotKey = `${fileSafe(pat)}__${username}`;
      const firstOfPattern = perPattern.get(pat) === 1;
      if (firstOfPattern) {
        const h = Math.min(record.desktop.scrollHeight, 2600);
        await page.screenshot({ path: join(SHOTS, `${shotKey}__desktop.png`), fullPage: true, clip: { x: 0, y: 0, width: 1366, height: h } }).catch(() => {});
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      record.phone = await page.evaluate(inspect, 'phone');
      if (firstOfPattern) {
        const h = Math.min(record.phone.scrollHeight, 3200);
        await page.screenshot({ path: join(SHOTS, `${shotKey}__phone.png`), fullPage: true, clip: { x: 0, y: 0, width: 390, height: h } }).catch(() => {});
      }
      await page.setViewportSize({ width: 1366, height: 768 });

      // Follow the links on this page.
      const links = await page.$$eval('a[href]', as => as.filter(a => !a.hasAttribute('download') && !a.closest('.sidebar')).map(a => a.getAttribute('href')));
      for (const href of links) {
        let u;
        try { u = new URL(href, page.url()); } catch { continue; }
        if (u.origin !== origin) continue;
        const p = u.pathname + u.search;
        if (!seenUrl.has(p) && !linkFrom.has(p)) { linkFrom.set(p, path); queue.push(p); }
      }
      log.pages.push(record);
    }

    log.finished = new Date().toISOString();
    log.patterns = Object.fromEntries(perPattern);
    writeFileSync(join(OUT, `crawl-${username}.json`), JSON.stringify(log, null, 1));
  });
}
