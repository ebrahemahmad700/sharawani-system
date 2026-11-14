// axe-core on many screens, plus a few structural checks of my own.
import { launch, ctxFor, HERE } from './lib.mjs';
import { writeFileSync } from 'fs';
import { join } from 'path';

const AXE = join(HERE, 'node_modules', 'axe-core', 'axe.min.js');
const DOC = process.env.DOC || '1230';
const SIZE = process.env.SIZE || 'd1366';
const browser = await launch();

const PLAN = [
  [null, '/login'],
  [null, '/track'],
  ['shilan', '/registry'],
  ['shilan', '/registry/new'],
  ['shilan', '/inbox'],
  ['shilan', `/documents/${DOC}`],
  ['shilan', 'ATTACH_VIEW'],
  ['shilan', '/my-day'],
  ['shilan', '/tray'],
  ['shilan', 'TRAY_ITEM'],
  ['shilan', '/barcode?q=20260007099'],
  ['shilan', '/manifests'],
  ['shilan', '/notifications'],
  ['shilan', '/documents?q=MOB'],
  ['shilan', '/registry/photo'],
  ['shilan', '/companies'],
  ['shilan', '/templates'],
  ['shilan', '/plots'],
  ['shilan', `/documents/${DOC}/receipt`],
  ['shilan', `/documents/${DOC}/print`],
  ['bafrin', '/leave'],
  ['karwan', '/archive'],
  ['karwan', '/archive/new'],
  ['karwan', '/archive/224'],
  ['aram', '/dashboard'],
  ['hemin', '/log'],
  ['itadmin', '/admin/users'],
];

const results = [];
const ctxs = {};
async function pageFor(user) {
  const k = user || 'anon';
  if (!ctxs[k]) ctxs[k] = await ctxFor(browser, user, SIZE, { bypassCSP: true });
  return ctxs[k].page;
}

for (const [user, path0] of PLAN) {
  if (process.env.SKIP_PUBLIC && !user) continue;
  const page = await pageFor(user);
  let path = path0;
  if (path0 === 'ATTACH_VIEW') {
    await page.goto(`/documents/${DOC}`);
    path = await page.$eval('#attachments .attach-list li a.btn', a => a.getAttribute('href'));
  }
  if (path0 === 'TRAY_ITEM') {
    await page.goto('/tray');
    path = await page.$eval('a[href^="/tray/"].btn', a => a.getAttribute('href')).catch(() => '/tray');
  }
  await page.goto(path, { waitUntil: 'load' });
  await page.waitForTimeout(path.includes('/view') ? 2000 : 400);
  await page.addScriptTag({ path: AXE });
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 6).map(n => ({ t: n.target.join(' '), html: n.html.slice(0, 160), msg: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 220) })) }));
  });
  const own = await page.evaluate(() => {
    const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h => h.offsetParent !== null || getComputedStyle(h).position === 'fixed');
    const levels = hs.map(h => Number(h.tagName[1]));
    const skips = [];
    for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) skips.push(`${hs[i - 1].tagName}→${hs[i].tagName} «${hs[i].textContent.trim().slice(0, 30)}»`);
    const unnamedButtons = [...document.querySelectorAll('button, a.btn, [role=button]')].filter(b => !(b.getAttribute('aria-label') || b.textContent.trim() || b.getAttribute('title'))).map(b => b.outerHTML.slice(0, 100));
    const titleOnly = [...document.querySelectorAll('button, a')].filter(b => !b.getAttribute('aria-label') && !b.textContent.trim() && b.getAttribute('title')).map(b => b.outerHTML.slice(0, 100));
    const symbolOnly = [...document.querySelectorAll('button')].filter(b => !b.getAttribute('aria-label') && /^[−+×✕\-]$/.test(b.textContent.trim())).map(b => `${b.textContent.trim()} title=${b.title}`);
    const imgs = [...document.querySelectorAll('img')].map(i => ({ src: i.getAttribute('src'), alt: i.getAttribute('alt') }));
    const svgsNoHidden = [...document.querySelectorAll('svg')].filter(s => !s.closest('[aria-hidden=true]') && s.getAttribute('aria-hidden') !== 'true' && !s.getAttribute('role') && !s.querySelector('title')).length;
    const tables = [...document.querySelectorAll('table')].map(t => ({ th: t.querySelectorAll('th').length, thead: !!t.querySelector('thead'), scopeOrHeaders: t.querySelectorAll('th[scope]').length, caption: !!t.querySelector('caption'), emptyTh: [...t.querySelectorAll('th')].filter(th => !th.textContent.trim() && !th.getAttribute('aria-label')).length }));
    const live = [...document.querySelectorAll('[aria-live], [role=status], [role=alert]')].map(e => `${e.className || e.tagName}:${e.getAttribute('aria-live') || e.getAttribute('role')}`);
    const notices = [...document.querySelectorAll('.notice')].map(n => ({ cls: n.className, role: n.getAttribute('role') }));
    const landmarks = { main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length, header: document.querySelectorAll('header').length };
    return { lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title, h1: document.querySelectorAll('h1').length, levels: levels.join(''), skips, unnamedButtons, titleOnly, symbolOnly, imgs, svgsNoHidden, tables, live, notices, landmarks };
  });
  results.push({ user, path, axe, own });
  console.log(`${user} ${path}: ${axe.map(v => `${v.id}(${v.nodes})`).join(', ') || 'no violations'} | h1=${own.h1} levels=${own.levels} skips=${own.skips.length} lang=${own.lang} dir=${own.dir} imgs=${JSON.stringify(own.imgs).slice(0, 120)} svg=${own.svgsNoHidden} sym=${own.symbolOnly.join(';')}`);
}
writeFileSync(join(HERE, `axe-${SIZE}.json`), JSON.stringify(results, null, 1));
for (const c of Object.values(ctxs)) await c.context.close();
await browser.close();
