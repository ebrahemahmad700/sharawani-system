// Print the visual left-to-right order of the characters in elements matching a selector.
// node bidi.mjs user path selector
import { launch, ctxFor, settle } from './lib.mjs';
const [user, path, sel] = process.argv.slice(2);
const browser = await launch();
const ctx = await ctxFor(browser, user);
const page = await ctx.newPage();
await page.goto(path); await settle(page);
const res = await page.evaluate(sel => [...document.querySelectorAll(sel)].slice(0, 12).map(el => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const chars = [];
  let n;
  while ((n = walker.nextNode())) {
    for (let i = 0; i < n.data.length; i++) {
      const ch = n.data[i];
      if (/\s|[⁦-⁩]/.test(ch)) continue;
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
      const b = r.getBoundingClientRect();
      if (b.width) chars.push({ ch, x: b.left, y: Math.round(b.top / 4) });
    }
  }
  chars.sort((a, b) => a.y - b.y || a.x - b.x);
  const logical = el.textContent.replace(/\s+/g, ' ').trim();
  return { logical, visualLTR: chars.map(c => c.ch).join('') };
}), sel);
for (const r of res) console.log('logical:', JSON.stringify(r.logical.slice(0, 120)), '\n visual L→R:', r.visualLTR.slice(0, 120));
await browser.close();
