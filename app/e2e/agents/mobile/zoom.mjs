// Reduced motion, and a 1280px screen at 200% zoom (640 CSS px at deviceScaleFactor 2).
import { launch, ctxFor, overflow, shot, HERE } from './lib.mjs';
import { writeFileSync } from 'fs';
import { join } from 'path';

const browser = await launch();
const OUT = [];
const rec = o => { OUT.push(o); console.log(JSON.stringify(o).slice(0, 1200)); };

// Reduced motion
{
  const { context, page } = await ctxFor(browser, 'shilan', 'i390', { reducedMotion: 'reduce' });
  await page.goto('/inbox');
  const before = await page.evaluate(() => ({ media: matchMedia('(prefers-reduced-motion: reduce)').matches, sidebarTransition: getComputedStyle(document.querySelector('.sidebar')).transitionDuration }));
  await page.tap('.nav-toggle');
  const t0 = Date.now();
  await page.waitForFunction(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().left) < innerWidth - 200, null, { timeout: 2000 });
  // Any running animations anywhere?
  const anims = await page.evaluate(() => document.getAnimations().map(a => `${a.constructor.name}:${a.animationName || a.transitionProperty}`));
  rec({ check: 'reduced-motion app', ...before, drawerOpenedMs: Date.now() - t0, runningAnimations: anims });
  await context.close();
}
{
  const { context, page } = await ctxFor(browser, 'aram', 'd1366', { reducedMotion: 'reduce' });
  await page.goto('/board');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ media: matchMedia('(prefers-reduced-motion: reduce)').matches, animations: document.getAnimations().length }));
  rec({ check: 'reduced-motion board', ...r });
  await context.close();
}

// 640 x 360 and 640 x 512 at dsf 2
const SCREENS = {
  shilan: ['/registry', '/registry/new', '/inbox', '/my-day', '/documents/1230', '/tray', '/barcode?q=20260007099', '/manifests', '/notifications', '/documents?q=MOB'],
  bafrin: ['/leave'],
  karwan: ['/archive', '/archive/new'],
  aram: ['/dashboard'],
};
for (const vp of [{ width: 640, height: 360 }, { width: 640, height: 512 }]) {
  for (const [user, paths] of Object.entries(SCREENS)) {
    const { context, page } = await ctxFor(browser, user, 'd1366', { viewport: vp, deviceScaleFactor: 2 });
    for (const path of paths) {
      await page.goto(path, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const o = await overflow(page);
      const r = await page.evaluate(() => {
        const tb = document.querySelector('.topbar').getBoundingClientRect();
        const h1 = document.querySelector('.topbar h1');
        const firstCard = document.querySelector('.content > *');
        const hiddenActions = [...document.querySelectorAll('.content .table-wrap')].reduce((n, w) => { const sr = w.getBoundingClientRect(); return n + [...w.querySelectorAll('tbody .btn, tbody button')].filter(b => { const q = b.getBoundingClientRect(); return q.left < sr.left - 1 || q.right > sr.right + 1; }).length; }, 0);
        return { topbarH: Math.round(tb.height), pctOfHeight: Math.round(tb.height / innerHeight * 100), h1: h1.textContent.trim(), h1W: Math.round(h1.getBoundingClientRect().width), h1Clipped: h1.scrollHeight > h1.clientHeight + 4 || h1.scrollWidth > h1.clientWidth + 1, contentStartsAt: Math.round(firstCard?.getBoundingClientRect().top ?? 0), hiddenActions, drawer: getComputedStyle(document.querySelector('.nav-toggle')).display !== 'none' };
      });
      rec({ check: '200%', vp: `${vp.width}x${vp.height}`, user, path, sw: o.sw, iw: o.iw, offenders: o.offenders.slice(0, 3), ...r });
      if (vp.height === 360 && ['/documents/1230', '/inbox', '/registry/new', '/leave'].includes(path)) await shot(page, `zoom200-${vp.width}x${vp.height}-${path.replace(/[^a-z0-9]+/gi, '_')}`);
    }
    await context.close();
  }
}
// The same laptop at 100%, for comparison of the letter page's first screen
{
  const { context, page } = await ctxFor(browser, 'shilan', 'd1366', { viewport: { width: 1280, height: 720 } });
  await page.goto('/documents/1230');
  rec({ check: '100% comparison', topbarH: await page.evaluate(() => Math.round(document.querySelector('.topbar').getBoundingClientRect().height)) });
  await context.close();
}
// Sticky bar scrolled on 640x360: how much of the letter can be read at once?
{
  const { context, page } = await ctxFor(browser, 'shilan', 'd1366', { viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
  await page.goto('/documents/1230');
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ topbarH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height), ih: innerHeight }));
  rec({ check: '640x360 scrolled letter', ...r, readable: r.ih - r.topbarH });
  await shot(page, 'zoom200-640x360-letter-scrolled');
  await context.close();
}
writeFileSync(join(HERE, 'zoom.json'), JSON.stringify(OUT, null, 1));
await browser.close();
