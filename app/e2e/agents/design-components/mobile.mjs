// Phone pass: the same measurement at 390x844 (touch) on pages already visited
// at desk width. GET only; letter pages only those already opened safely.
import { chromium } from '@playwright/test';
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { measurePage } from './measure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const OUTFILE = join(OUT, 'mobile-390.jsonl');
writeFileSync(OUTFILE, '');
const BASE = 'http://localhost:3111';

const PLAN = {
  '(anon)': ['/login'],
  aram: ['/dashboard', '/documents', '/documents/613', '/documents/613/reply', '/archive/237', '/archive/new', '/companies', '/companies/103', '/companies/new', '/templates/new', '/log', '/tray/316', '/admin/scanners'],
  shilan: ['/registry', '/manifests/61', '/barcode', '/notifications'],
  hemin: ['/inbox', '/my-day', '/registry/new'],
  karwan: ['/archive'],
  bafrin: ['/leave', '/templates'],
  itadmin: ['/admin/users', '/admin/rooms'],
};

const browser = await chromium.launch({ channel: 'chrome' });
let n = 0;
for (const [account, urls] of Object.entries(PLAN)) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, baseURL: BASE, locale: 'ckb' });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));
  if (account !== '(anon)') {
    await page.goto('/login');
    await page.fill('#username', account);
    await page.fill('#password', 'guhare-2026');
    await Promise.all([page.waitForURL(u => !/^\/(login)?$/.test(new URL(u).pathname), { timeout: 20000 }), page.click('button[type=submit]')]);
  }
  for (const url of urls) {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts && document.fonts.ready.then(() => true)).catch(() => {});
    await page.waitForTimeout(350);
    const m = await page.evaluate(measurePage);
    appendFileSync(OUTFILE, JSON.stringify({ account, url, status: resp?.status(), viewport: '390x844', ...m }) + '\n');
    console.log(++n, account, url, resp?.status(), m.docWidth);
  }
  await ctx.close();
}
await browser.close();
