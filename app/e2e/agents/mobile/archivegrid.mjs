import { launch, ctxFor, shotAround } from './lib.mjs';
const browser = await launch();
const { context, page } = await ctxFor(browser, 'karwan', 's360');
await page.goto('/archive/new');
const r = await page.evaluate(() => ['#plot_no', '#title', '#year', '#owner_names'].map(s => { const b = document.querySelector(s).getBoundingClientRect(); return { s, l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; }));
console.log(JSON.stringify(r));
await shotAround(page, page.locator('#title').locator('xpath=ancestor::div[contains(@class,"card")]'), 'archive-grid-s360', { above: 0, height: 420 });
await context.close();
await browser.close();
