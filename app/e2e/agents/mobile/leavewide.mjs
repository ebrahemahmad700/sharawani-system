import { launch, ctxFor, shot, shotAround } from './lib.mjs';
const browser = await launch();
for (const [size, vp] of [['t1024', null], ['d1366', null], ['d1366', { width: 1280, height: 800 }], ['t768', null], ['i390', null]]) {
  const { context, page } = await ctxFor(browser, 'bafrin', size, vp ? { viewport: vp } : {});
  await page.goto('/leave', { waitUntil: 'load' });
  const r = await page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap.kv');
    const t = wrap.querySelector('table');
    const cells = [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => Math.round(td.getBoundingClientRect().width)));
    // widest min-content cell
    let widest = null;
    for (const td of t.querySelectorAll('td')) {
      const clone = td.cloneNode(true);
      clone.style.cssText = 'position:absolute;visibility:hidden;width:min-content;display:block';
      document.body.appendChild(clone);
      const w = clone.getBoundingClientRect().width;
      clone.remove();
      if (!widest || w > widest.w) widest = { w: Math.round(w), text: td.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) };
    }
    const btn = wrap.querySelector('form[action$="/decide"] button');
    const b = btn?.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    return { iw: innerWidth, wrapW: wrap.clientWidth, wrapSW: wrap.scrollWidth, btnLeft: b && Math.round(b.left), wrapLeft: Math.round(wr.left), btnVisible: b ? b.left >= wr.left && b.right <= wr.right : null, widest, firstRowCells: cells[0], pinned: btn ? getComputedStyle(btn.closest('td')).position : null };
  });
  console.log(size, vp ? JSON.stringify(vp) : '', JSON.stringify(r));
  const f = page.locator('form[action$="/decide"]').first();
  if (await f.count()) await shotAround(page, page.locator('.table-wrap.kv tr').filter({ has: f }).first(), `leave-decide-${vp ? vp.width : size}`, { above: 10, height: 140 });
  await context.close();
}
await browser.close();
