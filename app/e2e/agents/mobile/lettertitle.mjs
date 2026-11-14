import { launch, ctxFor, shot } from './lib.mjs';
const browser = await launch();
for (const size of ['s360', 'i390', 'a412']) {
  const { context, page } = await ctxFor(browser, 'shilan', size);
  await page.goto('/documents/1240');
  const r = await page.evaluate(() => {
    const h = document.querySelector('.topbar h1');
    const num = h.querySelector('[dir=ltr]') || h;
    // Range rects of the number: which parts lie inside the h1 box?
    const hb = h.getBoundingClientRect();
    const range = document.createRange();
    const tn = [...h.childNodes].map(n => n.nodeType === 3 ? n : n.firstChild).filter(Boolean);
    const out = [];
    const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode;
      for (let i = 0; i < t.length; i++) {
        range.setStart(t, i); range.setEnd(t, i + 1);
        const rc = range.getBoundingClientRect();
        if (!rc.width) continue;
        const inside = rc.left >= hb.left - 0.5 && rc.right <= hb.right + 0.5 && rc.top >= hb.top - 0.5 && rc.bottom <= hb.bottom + 0.5;
        out.push({ ch: t.data[i], inside });
      }
    }
    return { text: h.textContent, h1W: Math.round(hb.width), hidden: out.filter(o => !o.inside).map(o => o.ch).join(''), shown: out.filter(o => o.inside).map(o => o.ch).join('') };
  });
  console.log(size, JSON.stringify(r));
  await shot(page, `lettertitle-${size}`, { x: 0, y: 0, width: page.viewportSize().width, height: 170 });
  await context.close();
}
await browser.close();
