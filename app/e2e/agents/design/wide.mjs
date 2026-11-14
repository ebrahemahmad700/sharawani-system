// node wide.mjs user path [WxH] — which elements stick out of the viewport or their parent.
import { launch, ctxFor, settle } from './lib.mjs';
const [user, path, size = '1366x768'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const browser = await launch();
const ctx = await ctxFor(browser, user, { width: W, height: H });
const page = await ctx.newPage();
await page.goto(path); await settle(page); await page.waitForTimeout(1200);
const r = await page.evaluate(() => {
  const out = { scrollWidth: document.documentElement.scrollWidth, inner: innerWidth, items: [] };
  for (const e of document.querySelectorAll('body *')) {
    const b = e.getBoundingClientRect();
    if (!b.width) continue;
    const p = e.parentElement?.getBoundingClientRect();
    const outViewport = b.left < -1 || b.right > innerWidth + 1;
    const outParent = p && (b.left < p.left - 1 || b.right > p.right + 1) && getComputedStyle(e.parentElement).overflow === 'visible';
    if (outViewport || outParent) out.items.push(`${e.tagName}.${String(e.className).slice(0, 30)} w=${Math.round(b.width)} L=${Math.round(b.left)} R=${Math.round(b.right)} ${outViewport ? 'VIEWPORT' : 'PARENT'} "${(e.textContent || '').trim().slice(0, 40)}"`);
  }
  out.items = out.items.slice(0, 25);
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
