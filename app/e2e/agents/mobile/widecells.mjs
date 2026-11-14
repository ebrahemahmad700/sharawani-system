import { launch, ctxFor } from './lib.mjs';
const browser = await launch();
for (const [user, path, dev] of [['shilan', '/tray', 'd1366'], ['karwan', '/archive', 'd1366'], ['hemin', '/inbox', 't1024'], ['shilan', '/my-day', 't1024'], ['bafrin', '/leave', 't1024']]) {
  const { context, page } = await ctxFor(browser, user, dev);
  await page.goto(path, { waitUntil: 'load' });
  const r = await page.evaluate(() => {
    const wrap = [...document.querySelectorAll('.content .table-wrap')].find(w => w.scrollWidth > w.clientWidth + 1);
    if (!wrap) return null;
    const cols = {};
    for (const tr of wrap.querySelectorAll('tbody tr')) {
      [...tr.children].forEach((td, i) => {
        const w = td.getBoundingClientRect().width;
        if (!cols[i] || w > cols[i].w) cols[i] = { w: Math.round(w), text: td.textContent.trim().replace(/\s+/g, ' ').slice(0, 70) };
      });
    }
    const heads = [...wrap.querySelectorAll('thead th')].map(th => th.textContent.trim());
    return { wrapW: wrap.clientWidth, sw: wrap.scrollWidth, heads, cols };
  });
  console.log(dev, user, path, JSON.stringify(r));
  await context.close();
}
await browser.close();
