// Page titles in the top bar on phones: clipped words, lost numbers.
import { launch, ctxFor, shot } from './lib.mjs';

const PLAN = {
  shilan: ['/registry', '/registry/new', '/inbox', '/tray', '/barcode', '/my-day', '/manifests', '/leave', '/documents/' + (process.env.DOC || '1')],
  aram: ['/dashboard', '/inbox', '/tray'],
  karwan: ['/archive', '/archive/new'],
};
const browser = await launch();
for (const size of ['s360', 'i390', 'a412']) {
  for (const [user, paths] of Object.entries(PLAN)) {
    const { context, page } = await ctxFor(browser, user, size);
    for (const path of paths) {
      await page.goto(path, { waitUntil: 'load' });
      const r = await page.evaluate(() => {
        const h = document.querySelector('.topbar h1');
        const b = h.getBoundingClientRect();
        // Measure the full title on one line in the same font, to see how much is lost.
        const probe = document.createElement('span');
        const cs = getComputedStyle(h);
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font}`;
        probe.textContent = h.textContent;
        document.body.appendChild(probe);
        const full = probe.getBoundingClientRect().width;
        // Widest single word
        let widest = 0;
        for (const w of h.textContent.split(/\s+/)) { probe.textContent = w; widest = Math.max(widest, probe.getBoundingClientRect().width); }
        probe.remove();
        const topbar = document.querySelector('.topbar').getBoundingClientRect();
        return { title: h.textContent.trim(), w: Math.round(b.width), h: Math.round(b.height), sh: h.scrollHeight, ch: h.clientHeight, sw: h.scrollWidth, cw: h.clientWidth, fullOneLine: Math.round(full), widestWord: Math.round(widest), topbarH: Math.round(topbar.height) };
      });
      const clipped = r.sh > r.ch + 1 || r.widestWord > r.cw + 1;
      console.log(size, user, path, clipped ? 'CLIPPED' : 'ok', JSON.stringify(r));
      if (clipped) await shot(page, `topbar-${size}-${user}-${path.replace(/[^a-z0-9]+/gi, '_')}`, { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(r.topbarH, 200) });
    }
    await context.close();
  }
}
await browser.close();
