// A toast arriving on a phone: what it covers, whether it can be dismissed, how long it stays.
import { launch, ctxFor, shot, mark } from './lib.mjs';
const M = mark();
const browser = await launch();
const H = await ctxFor(browser, 'hemin', 'i390');
const hp = H.page;
await hp.goto('/documents/1240');
// Put the "finish step" button near the bottom of the screen, where a thumb is.
const btn = hp.locator('form[action$="/complete"] button[type=submit]');
await btn.evaluate(b => { const r = b.getBoundingClientRect(); window.scrollBy(0, r.bottom - innerHeight + 30); });
await hp.waitForTimeout(1500); // let the stream connect
const S = await ctxFor(browser, 'shilan', 'd1366');
await S.page.goto('/documents/1240');
await S.page.fill('#note_body', `تێبینی ${M}`);
await S.page.locator('form[action$="/notes"] button[type=submit]').click();
await S.page.waitForURL(/done=note/);
const t0 = Date.now();
const got = await hp.waitForSelector('.toast', { timeout: 30000 }).then(() => true, () => false);
const tArrive = Date.now() - t0;
let r = null;
if (got) {
  await hp.waitForTimeout(300);
  r = await hp.evaluate(() => {
    const t = document.querySelector('.toast').getBoundingClientRect();
    const b = document.querySelector('form[action$="/complete"] button[type=submit]').getBoundingClientRect();
    const overlap = !(t.right < b.left || t.left > b.right || t.bottom < b.top || t.top > b.bottom);
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { toast: { l: Math.round(t.left), r: Math.round(t.right), t: Math.round(t.top), b: Math.round(t.bottom) }, button: { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }, overlap, centreHits: hit.className || hit.tagName, closeButton: !!document.querySelector('.toast button'), text: document.querySelector('.toast').textContent.trim().slice(0, 60), href: document.querySelector('.toast').getAttribute('href') };
  });
  await shot(hp, 'toast-i390-over-button', { x: 0, y: 844 - 260, width: 390, height: 260 });
  // Hover / focus does not keep it
  await hp.focus('.toast');
  await hp.waitForTimeout(7600);
  r.stillThereAfter7s = await hp.locator('.toast').count();
}
console.log(JSON.stringify({ got, tArrive, ...r }));
await browser.close();
