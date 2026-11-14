// Public tracking page: one GET and one POST (the briefing allows 10).
import { launch, shotPath, settle, BASE } from './lib.mjs';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ckb', baseURL: BASE });
const page = await ctx.newPage();
await page.goto('/track'); await settle(page);
await page.screenshot({ path: shotPath('batch', 'track-form.png'), fullPage: true });
await page.fill('#barcode', '20260006745');
await page.fill('#pin', '700293');
await page.click('button[type=submit]');
await page.waitForLoadState('domcontentloaded'); await settle(page);
await page.screenshot({ path: shotPath('batch', 'track-result.png'), fullPage: true });
console.log(page.url(), await page.evaluate(() => document.documentElement.scrollHeight));
await browser.close();
