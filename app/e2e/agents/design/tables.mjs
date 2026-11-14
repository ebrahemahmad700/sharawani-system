// node tables.mjs WxH user path... — table-wrap overflow per page
import { launch, ctxFor, settle } from './lib.mjs';
const [size, user, ...paths] = process.argv.slice(2);
const [W,H] = size.split('x').map(Number);
const browser = await launch();
const ctx = await ctxFor(browser, user, { width: W, height: H });
const page = await ctx.newPage();
for (const p of paths) {
  await page.goto(p); await settle(page);
  const r = await page.evaluate(() => [...document.querySelectorAll('.table-wrap')].map(t => {
    const ths = [...t.querySelectorAll('thead th')].map(th => `${th.textContent.trim()}:${Math.round(th.getBoundingClientRect().width)}`);
    return { client: t.clientWidth, scroll: t.scrollWidth, ths: ths.join(' | ') };
  }).filter(x => x.scroll > x.client + 1));
  console.log(size, user, p, JSON.stringify(r));
}
await browser.close();
