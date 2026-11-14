// One GET of the public tracking page, looked at desk and phone width.
import { writeFileSync } from 'fs';
import { join } from 'path';
import { launch, shot, HERE, BASE } from './lib.mjs';
import { measure } from './measure.mjs';

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, baseURL: BASE });
const p = await ctx.newPage();
const r = await p.goto('/track');
await p.evaluate(() => document.fonts.ready);
const desk = await p.evaluate(measure);
await p.screenshot({ path: shot('desk-anon-track.png'), fullPage: true });
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(300);
const phone = await p.evaluate(measure);
await p.screenshot({ path: shot('phone-anon-track.png'), fullPage: true });
const extra = await p.evaluate(() => {
  const lc = document.querySelector('.login-card');
  const h1 = lc.querySelector('h1'); const sub = lc.querySelector('.sub'); const btn = lc.querySelector('.btn');
  return { card: [getComputedStyle(lc).maxWidth, getComputedStyle(lc).padding], h1: [h1.textContent, getComputedStyle(h1).fontSize], btnW: btn.getBoundingClientRect().width, labels: [...lc.querySelectorAll('label')].map(l => [l.textContent, l.className]) };
});
writeFileSync(join(HERE, 'track.json'), JSON.stringify({ status: r.status(), desk, phone, extra }, null, 1));
console.log(r.status(), JSON.stringify(extra));
await browser.close();
