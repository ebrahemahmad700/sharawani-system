import { launch, ctxFor, settle } from './lib.mjs';
const [user, path, sel] = process.argv.slice(2);
const browser = await launch();
const ctx = await ctxFor(browser, user);
const page = await ctx.newPage();
await page.goto(path); await settle(page);
console.log(await page.evaluate(sel => [...document.querySelectorAll(sel)].map(td => {
  const c = td.cloneNode(true); c.style.cssText = 'position:absolute;width:min-content;visibility:hidden'; document.body.appendChild(c);
  const w = c.getBoundingClientRect().width; c.remove(); return [Math.round(w), td.textContent.trim().slice(0, 90)];
}).sort((a, b) => b[0] - a[0]).slice(0, 5), sel));
await browser.close();
