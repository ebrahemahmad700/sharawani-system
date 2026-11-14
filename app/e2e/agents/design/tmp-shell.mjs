import { launch, ctxFor, settle } from './lib.mjs';
const browser = await launch();
const ctx = await ctxFor(browser, 'shilan', { width: 1366, height: 768 });
const page = await ctx.newPage();
await page.goto('/tray/242'); await settle(page);
console.log(await page.evaluate(() => ['.shell','.sidebar','.main','.viewer','.viewer > aside','.viewer-main'].map(s => { const b = document.querySelector(s).getBoundingClientRect(); return `${s} L=${Math.round(b.left)} W=${Math.round(b.width)}`; })));
await browser.close();
