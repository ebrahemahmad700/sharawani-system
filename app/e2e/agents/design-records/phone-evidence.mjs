// Phone computed styles that the phone block of app.css intends to change.
import { launch, signedIn, shot } from './lib.mjs';

const browser = await launch();
const ctx = await signedIn(browser, 'aram', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('/companies/new');
const m = await page.evaluate(() => {
  const cs = s => getComputedStyle(document.querySelector(s));
  const card = cs('.card'), btn = cs('form .btn'), inp = cs('#name'), sel = cs('#status'), ta = cs('#note');
  return {
    matches900: matchMedia('(max-width: 900px)').matches,
    card: { padding: card.padding, marginBottom: card.marginBottom, radius: card.borderRadius },
    btn: { padding: btn.padding, minHeight: btn.minHeight },
    input: inp.fontSize, select: sel.fontSize, textarea: ta.fontSize, body: getComputedStyle(document.body).fontSize,
    rows: [...document.querySelectorAll('form .row .field')].map(f => [f.querySelector('label').textContent.trim(), Math.round(f.getBoundingClientRect().width), Math.round(f.getBoundingClientRect().left)]),
    single: [...document.querySelectorAll('form > .field')].map(f => [f.querySelector('label').textContent.trim(), Math.round(f.getBoundingClientRect().width)]),
  };
});
console.log(JSON.stringify(m, null, 1));
await page.screenshot({ path: shot('p-companies-new.png'), fullPage: true });

await page.goto('/archive');
await ctx.close();
const k = await signedIn(browser, 'karwan', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p2 = await k.newPage();
await p2.goto('/archive/new');
const a = await p2.evaluate(() => [...document.querySelectorAll('.field')].slice(0, 6).map(f => [f.querySelector('label')?.textContent.trim(), Math.round(f.getBoundingClientRect().left), Math.round(f.getBoundingClientRect().width)]));
console.log('archive/new fields [label, left, width]', JSON.stringify(a));
const t = await p2.locator('.card').first();
await t.screenshot({ path: shot('p-archive-new-card1.png') });
await browser.close();
