// Crawl menu pages and one level down for several accounts, measure every
// component on each page at 1366x768. GET only.
//
// Safety: opening a letter in the room that holds it marks it received. A letter
// page is only opened by an account for which the letter is NOT an unopened row
// in that account's own inbox (inbox lists every unopened letter).

import { chromium } from '@playwright/test';
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { measurePage } from './measure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3111';
const PASSWORD = 'guhare-2026';
const W = Number(process.env.W || 1366), H = Number(process.env.H || 768);
const OUTFILE = join(OUT, `desktop-${W}.jsonl`);
writeFileSync(OUTFILE, '');
const MAX_PAGES = 122;

const ACCOUNTS = ['aram', 'shilan', 'hemin', 'sakar', 'karwan', 'bafrin', 'itadmin'];
const LETTERS_PER = { aram: 2, shilan: 1, hemin: 2, sakar: 1, karwan: 1, bafrin: 1 };
const NAV_CAP = 3;
const MUST = {
  karwan: ['/archive', '/inbox', '/my-day'],
  bafrin: ['/leave', '/templates', '/inbox'],
  sakar: ['/inbox', '/my-day', '/outgoing'],
};
const CAPS = {
  '/documents/:id/reply': 2,
  '/documents/:id/print': 1, '/documents/:id/receipt': 1, '/documents/:id/reply/print': 1,
  '/manifests/:id/print': 1, '/fills/:id/print': 1,
  '/archive/:id': 3, '/archive/new': 2, '/archive/:id/edit': 1,
  '/companies/:id': 3, '/companies/:id/edit': 1, '/companies/new': 1,
  '/templates/:id': 2, '/templates/:id/edit': 1, '/templates/new': 1,
  '/manifests/:id': 3, '/tray/:id': 2, '/attachments/:id/view': 1,
  '/registry/new': 2, '/registry/photo': 1, '/scan': 1, '/password': 1,
};
const QUERY_TOTAL = 10;

function classify(href, here) {
  let url;
  try { url = new URL(href, here); } catch { return null; }
  if (url.origin !== BASE) return null;
  const p = url.pathname;
  if (/^\/(logout|board|events|login|api|t\/|track|find|assistant\/ask)/.test(p)) return null;
  if (/^\/notifications\/(\d+\/go|poll|count)/.test(p)) return null;
  if (/^\/attachments\/\d+(\/text)?$/.test(p)) return null;
  if (/\/(download|preview)$/.test(p)) return null;
  if (/^\/companies\/files\//.test(p)) return null;
  if (/^\/(registry\/similar|scan\/scanners)/.test(p)) return null;
  if (/\.[a-z0-9]{2,5}$/i.test(p)) return null;
  if (p === '/barcode' && url.search) return null;
  const pattern = p.replace(/\/\d+/g, '/:id');
  const qkeys = [...url.searchParams.keys()].sort().join('&');
  return { url: p + url.search, path: p, pattern, qkeys };
}

async function signIn(ctx, username) {
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', PASSWORD);
  await Promise.all([page.waitForURL(u => !/^\/(login)?$/.test(new URL(u).pathname), { timeout: 20000 }), page.click('button[type=submit]')]);
  return page;
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.fonts && document.fonts.ready.then(() => true)).catch(() => {});
  await page.waitForTimeout(350);
}

let visited = 0;
const seenUrl = new Set();       // account|url
const navCount = {};             // pattern -> accounts measured
const patCount = {};             // pattern -> count
let queryCount = 0;

async function visit(page, account, url, kind) {
  if (visited >= MAX_PAGES) return null;
  const key = `${account}|${url}`;
  if (seenUrl.has(key)) return null;
  seenUrl.add(key);
  let resp, html = '';
  try {
    resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    html = resp ? await resp.text().catch(() => '') : '';
  } catch (e) { console.log('  goto failed', url, e.message.slice(0, 80)); return null; }
  const ct = resp?.headers()['content-type'] || '';
  if (!ct.includes('text/html')) { console.log('  not html', url, ct); return null; }
  await settle(page);
  visited++;
  const m = await page.evaluate(measurePage).catch(e => ({ error: String(e) }));
  // inline styles in the server HTML
  const inlineHtml = [];
  const re = /<([a-zA-Z0-9]+)\b([^>]*?)\sstyle="([^"]*)"/g;
  let mm;
  while ((mm = re.exec(html))) {
    const cls = /class="([^"]*)"/.exec(mm[2])?.[1] || '';
    inlineHtml.push({ tag: mm[1].toLowerCase(), cls, style: mm[3] });
  }
  const styleBlocks = (html.match(/<style[\s>]/g) || []).length;
  const links = await page.$$eval('main a[href], .topbar-tools a[href], .content a[href], body a[href]', as => as
    .filter(a => !a.hasAttribute('download') && !a.closest('.sidebar'))
    .map(a => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 40), row: a.closest('tr')?.innerText?.replace(/\s+/g, ' ').slice(0, 200) || '' }))).catch(() => []);
  const nav = await page.$$eval('.sidebar .nav a[href]', as => as.map(a => a.getAttribute('href'))).catch(() => []);
  const rec = { account, url: page.url().replace(BASE, ''), requested: url, status: resp?.status(), kind, viewport: `${W}x${H}`, styleBlocks, inlineHtml, ...m };
  appendFileSync(OUTFILE, JSON.stringify(rec) + '\n');
  console.log(`${String(visited).padStart(3)} ${account.padEnd(8)} ${kind.padEnd(6)} ${resp?.status()} ${url}  «${(m.h1 || '').slice(0, 30)}»`);
  return { links, nav, html };
}

const browser = await chromium.launch({ channel: 'chrome' });

// Signed-out pages, once.
{
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, baseURL: BASE });
  const page = await ctx.newPage();
  await visit(page, '(anon)', '/login', 'nav');
  await visit(page, '(anon)', '/track', 'nav');
  await ctx.close();
}

for (const account of ACCOUNTS) {
  if (visited >= MAX_PAGES) break;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, baseURL: BASE, locale: 'ckb' });
  const page = await signIn(ctx, account);
  page.on('dialog', d => d.dismiss().catch(() => {}));
  const landing = page.url().replace(BASE, '');
  const navLinks = await page.$$eval('.sidebar .nav a[href]', as => as.map(a => a.getAttribute('href')));
  navLinks.push('/password');
  const candidates = [];   // {url, pattern, qkeys, from, row, text}
  const unsafeLetters = new Set();
  const inboxOpened = new Set();

  for (const href of navLinks) {
    const c = classify(href, BASE + '/');
    if (!c) continue;
    const isInbox = c.path === '/inbox';
    const cap = c.pattern === '/password' ? 1 : NAV_CAP;
    const must = (MUST[account] || []).includes(c.path);
    let links = [];
    if ((navCount[c.pattern] || 0) >= cap && !must) {
      // Not measured again, but read for links (and the inbox for unsafe letters).
      await page.goto(c.url, { waitUntil: 'domcontentloaded' });
      links = await page.$$eval('main a[href], .topbar-tools a[href]', as => as
        .filter(a => !a.hasAttribute('download'))
        .map(a => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 40), row: '' }))).catch(() => []);
    } else {
      navCount[c.pattern] = (navCount[c.pattern] || 0) + 1;
      patCount[c.pattern] = (patCount[c.pattern] || 0) + 1;
      const r = await visit(page, account, c.url, 'nav');
      if (!r) continue;
      links = r.links;
    }
    for (const l of links) {
      const k = classify(l.href, BASE + c.path);
      if (k) candidates.push({ ...k, from: c.path, row: l.row, text: l.text });
    }
    if (isInbox) {
      const rows = await page.$$eval('main table tbody tr', trs => trs.map(tr => ({
        id: (tr.querySelector('a[href^="/documents/"]')?.getAttribute('href') || '').match(/\/documents\/(\d+)/)?.[1],
        opened: !!tr.querySelector('.pill.info'),
      })));
      for (const r of rows) if (r.id) { if (r.opened) inboxOpened.add(r.id); else unsafeLetters.add(r.id); }
      console.log(`     inbox of ${account}: ${rows.length} rows, ${unsafeLetters.size} unopened/unsafe`);
    }
  }

  // Children: letters first (limited, safe), then other one-level-down pages.
  const letterIds = [];
  const seenIds = new Set();
  // Variety: take letters from different source pages in turn.
  const bySource = {};
  for (const c of candidates) {
    if (c.pattern !== '/documents/:id' || c.qkeys) continue;
    const id = c.path.split('/')[2];
    if (unsafeLetters.has(id) || seenIds.has(id)) continue;
    seenIds.add(id);
    (bySource[c.from] ??= []).push({ ...c, id });
  }
  const sources = Object.keys(bySource);
  for (let i = 0; letterIds.length < (LETTERS_PER[account] || 0) && sources.some(s => bySource[s].length); i++) {
    const s = sources[i % sources.length];
    const next = bySource[s].shift();
    if (next) letterIds.push(next);
  }
  const children = [...letterIds.map(l => ({ ...l, kind: 'letter' }))];
  for (const c of candidates) {
    if (c.pattern === '/documents/:id' && !c.qkeys) continue;
    if (c.qkeys) {
      if (queryCount >= QUERY_TOTAL) continue;
      const qp = `${c.pattern}?${c.qkeys}`;
      if (patCount[qp]) continue;
      if (/^(done|sent|ok|saved|error)$/.test(c.qkeys)) continue;
      patCount[qp] = 1; queryCount++;
      children.push({ ...c, kind: 'query' });
      continue;
    }
    if (navCount[c.pattern]) continue; // a menu page, already covered
    const cap = CAPS[c.pattern] ?? 1;
    if ((patCount[c.pattern] || 0) >= cap) continue;
    patCount[c.pattern] = (patCount[c.pattern] || 0) + 1;
    children.push({ ...c, kind: /print$|receipt$/.test(c.pattern) ? 'print' : 'child' });
  }

  for (const ch of children) {
    if (visited >= MAX_PAGES) break;
    const r = await visit(page, account, ch.url, ch.kind);
    // One more level only for print sheets, reply and the viewer, found on child pages.
    if (r && ch.kind === 'letter') {
      for (const l of r.links) {
        const k = classify(l.href, BASE + ch.path);
        if (!k || k.qkeys && k.pattern !== '/documents/:id/receipt') continue;
        if (!/(print|receipt|reply|attachments\/:id\/view)$/.test(k.pattern)) continue;
        const cap = CAPS[k.pattern] ?? 0;
        if ((patCount[k.pattern] || 0) >= cap) continue;
        patCount[k.pattern] = (patCount[k.pattern] || 0) + 1;
        await visit(page, account, k.url, /print|receipt/.test(k.pattern) ? 'print' : 'child');
      }
    }
    if (r && ch.kind === 'child' && /^\/(manifests|templates)\/:id$/.test(ch.pattern)) {
      for (const l of r.links) {
        const k = classify(l.href, BASE + ch.path);
        if (!k || !/print$/.test(k.pattern)) continue;
        if ((patCount[k.pattern] || 0) >= (CAPS[k.pattern] ?? 0)) continue;
        patCount[k.pattern] = (patCount[k.pattern] || 0) + 1;
        await visit(page, account, k.url, 'print');
      }
    }
  }
  console.log(`== ${account}: landing ${landing}, ${children.length} children queued, total ${visited}`);
  await ctx.close();
}

await browser.close();
console.log('pages measured:', visited);
