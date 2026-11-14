// Visual proof for the measured outliers. GET only, screenshots under shots/.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://localhost:3111';

const browser = await chromium.launch({ channel: 'chrome' });
async function as(user, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, baseURL: BASE, ...opts });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.fill('#username', user);
  await page.fill('#password', 'guhare-2026');
  await Promise.all([page.waitForURL(u => !/^\/(login)?$/.test(new URL(u).pathname), { timeout: 20000 }), page.click('button[type=submit]')]);
  return { ctx, page };
}
const settle = async p => { await p.evaluate(() => document.fonts.ready.then(() => 1)); await p.waitForTimeout(400); };
const boxes = (page, sel) => page.$$eval(sel, els => els.filter(e => e.getBoundingClientRect().height > 0).map(e => {
  const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
  return `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} h=${Math.round(r.height * 10) / 10} top=${Math.round(r.top)} fs=${cs.fontSize} pad=${cs.padding}`;
}));

// 1. Topbar: control heights, and the two-row bar on the mayor's inbox.
{
  const { ctx, page } = await as('aram');
  for (const url of ['/inbox', '/documents']) {
    await page.goto(url); await settle(page);
    const tb = await page.$eval('.topbar', e => Math.round(e.getBoundingClientRect().height));
    console.log(`topbar ${url}: ${tb}px`, await boxes(page, '.topbar h1, .topbar input, .topbar select, .topbar .btn'));
    await page.locator('.topbar').screenshot({ path: join(SHOTS, `topbar-aram${url.replace(/\//g, '-')}.png`) });
  }
  // 2. A filter row: box, dropdown and button side by side.
  await page.goto('/log'); await settle(page);
  console.log('log filter row', await boxes(page, 'main form.row input, main form.row select, main form.row .btn'));
  await page.locator('main form.row').first().screenshot({ path: join(SHOTS, 'log-filter-row.png') });
  // 3. Doc types: the deactivated row's style attribute.
  await page.goto('/admin/doc-types'); await settle(page);
  console.log('doc-types styled rows', await page.$$eval('tbody tr[style]', trs => trs.map(t => `style=[${t.getAttribute('style')}] opacity=${getComputedStyle(t).opacity} «${t.innerText.replace(/\s+/g, ' ').slice(0, 40)}»`)));
  await page.goto('/outgoing'); await settle(page);
  const row = page.locator('main tbody tr').first();
  console.log('outgoing row', await boxes(page, 'main tbody tr:first-child .btn'));
  await row.screenshot({ path: join(SHOTS, 'row-outgoing.png') });
  await page.goto('/inbox'); await settle(page);
  console.log('inbox row', await boxes(page, 'main tbody tr:first-child .btn'));
  await page.locator('main tbody tr').first().screenshot({ path: join(SHOTS, 'row-inbox.png') });
  await ctx.close();
}
{
  const { ctx, page } = await as('itadmin');
  await page.goto('/admin/users'); await settle(page);
  console.log('users rows opacity', await page.$$eval('tbody tr[style]', trs => [...new Set(trs.map(t => `style=[${t.getAttribute('style')}] opacity=${getComputedStyle(t).opacity}`))]));
  await ctx.close();
}
// 4. Phone: which rule wins for .card, .btn and a text field.
{
  const { ctx, page } = await as('hemin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto('/registry/new'); await settle(page);
  const r = await page.evaluate(() => {
    const card = document.querySelector('main .card'); const btn = document.querySelector('main button.btn'); const inp = document.querySelector('main input[type=text]');
    const c = getComputedStyle(card), b = getComputedStyle(btn), i = getComputedStyle(inp);
    return { card: `${c.padding} r=${c.borderRadius} mb=${c.marginBottom}`, btn: `${b.padding} h=${btn.getBoundingClientRect().height}`, input: `fs=${i.fontSize} h=${inp.getBoundingClientRect().height}`, body: getComputedStyle(document.body).fontSize };
  });
  console.log('phone /registry/new', r);
  await page.screenshot({ path: join(SHOTS, 'phone-registry-new.png'), clip: { x: 0, y: 0, width: 390, height: 700 } });
  await ctx.close();
}
await browser.close();
