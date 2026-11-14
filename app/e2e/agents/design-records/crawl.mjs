// Visit every screen in scope at desk and phone width, measure, screenshot.
// GET only (plus nothing else). Usage: node crawl.mjs [desk|phone|both]
import { writeFileSync } from 'fs';
import { join } from 'path';
import { launch, signedIn, shot, HERE, BASE } from './lib.mjs';
import { measure } from './measure.mjs';

const which = process.argv[2] || 'both';
const VIEWS = { desk: { viewport: { width: 1366, height: 768 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } };

const PLAN = {
  aram: ['/dashboard', '/rooms', '/log', '/assistant', '/companies', '/companies/new', 'COMPANY', 'COMPANY/edit', '/password', '/documents/99999999'],
  karwan: ['/archive', '/archive/new', 'ARCHIVE_V', 'ARCHIVE_U'],
  bafrin: ['/templates', '/templates/new', '/templates/4', '/templates/4/edit', 'FILL', '/leave'],
  sakar: ['/leave', '/dashboard', '/templates'],
  itadmin: ['/admin/users', '/admin/rooms', '/admin/doc-types', '/admin/scanners'],
};

const browser = await launch();
const results = {};
const slug = u => u.replace(/^\//, '').replace(/[\/?=&]/g, '_') || 'root';

async function visit(page, user, view, url) {
  const resp = await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const m = await page.evaluate(measure);
  m.status = resp?.status();
  const name = `${view}-${user}-${slug(url)}.png`;
  await page.screenshot({ path: shot(name), fullPage: true });
  m.shot = name;
  results[`${view} ${user} ${url}`] = m;
  console.log(view, user, url, m.status, m.h1?.text);
}

for (const [view, opts] of Object.entries(VIEWS)) {
  if (which !== 'both' && which !== view) continue;
  const ids = {};
  for (const [user, urls] of Object.entries(PLAN)) {
    const c2 = await signedIn(browser, user, opts);
    const page = await c2.newPage();
    for (let url of urls) {
      if (url.startsWith('COMPANY')) {
        if (!ids.company) {
          await page.goto('/companies');
          ids.company = await page.$$eval('table tbody tr', trs => {
            for (const tr of trs) { const tds = tr.querySelectorAll('td'); if (tds.length >= 6 && /[1-9١-٩]/.test(tds[4].textContent)) return tr.querySelector('a').getAttribute('href'); }
            return trs.map(tr => tr.querySelector('a')?.getAttribute('href')).filter(Boolean).pop();
          });
        }
        url = url.replace('COMPANY', ids.company);
      }
      if (url.startsWith('ARCHIVE')) {
        if (!ids.archV) {
          await page.goto('/archive');
          const rows = await page.$$eval('table tbody tr', trs => trs.map(tr => ({ href: tr.querySelector('a[href^="/archive/"]')?.getAttribute('href'), ok: !!tr.querySelector('.pill.ok') })));
          ids.archV = rows.find(x => x.ok)?.href; ids.archU = rows.find(x => !x.ok)?.href;
        }
        url = url === 'ARCHIVE_V' ? ids.archV : ids.archU;
      }
      if (url === 'FILL') {
        await page.goto('/templates');
        url = await page.$eval('a[href^="/fills/"]', a => a.getAttribute('href'));
      }
      if (!url) continue;
      try { await visit(page, user, view, url); } catch (e) { console.log('ERR', url, e.message); }
    }
    await c2.close();
  }
  // Signed out.
  const ctx = await browser.newContext({ ...opts, baseURL: BASE });
  const page = await ctx.newPage();
  await visit(page, 'anon', view, '/login');
  await visit(page, 'anon', view, '/documents/99999999');
  await ctx.close();
}

writeFileSync(join(HERE, `crawl-${which}.json`), JSON.stringify(results, null, 1));
await browser.close();
