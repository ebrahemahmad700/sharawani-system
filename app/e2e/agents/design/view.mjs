// Ad-hoc viewing: node view.mjs user path [WxH] [segments] [name] [selector|x,y,w,h] [scale]
// Takes viewport-sized screenshots down the page, or one clip.
import { launch, ctxFor, shotPath, settle } from './lib.mjs';

const [user, path, size = '1366x768', segs = '1', name = null, clipArg = null, scaleArg = '1'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const scale = Number(scaleArg);
const browser = await launch();
const ctx = user === 'anon'
  ? await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale, locale: 'ckb', baseURL: 'http://localhost:3111' })
  : await ctxFor(browser, user, { width: W, height: H, scale });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('pageerror', String(e)));
page.on('dialog', d => d.dismiss());
const r = await page.goto(path);
await settle(page);
console.log(r?.status(), page.url(), 'scrollHeight', await page.evaluate(() => document.documentElement.scrollHeight));
const slug = name || (path.replace(/[\/?=&]/g, '_').replace(/^_/, '') || 'root');
if (clipArg) {
  const file = shotPath('view', size, user, `${slug}.png`);
  if (/^\d+,\d+,\d+,\d+$/.test(clipArg)) {
    const [x, y, w, h] = clipArg.split(',').map(Number);
    await page.screenshot({ path: file, clip: { x, y, width: w, height: h }, fullPage: true });
  } else {
    const loc = page.locator(clipArg).first();
    await loc.scrollIntoViewIfNeeded();
    await loc.screenshot({ path: file });
  }
  console.log(file);
} else {
  const n = Number(segs);
  for (let i = 0; i < n; i++) {
    await page.evaluate(y => window.scrollTo(0, y), i * (H - 60));
    await page.waitForTimeout(150);
    const file = shotPath('view', size, user, `${slug}-${i}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
}
await browser.close();
