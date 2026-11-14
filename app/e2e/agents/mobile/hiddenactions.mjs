// Buttons inside table rows that sit in the scrolled-out part of their table.
import { launch, ctxFor, shotAround } from './lib.mjs';
const PLAN = {
  shilan: ['/registry', '/inbox', '/my-day', '/outgoing', '/tray', '/manifests', '/companies', '/templates', '/leave', '/admin/doc-types', '/plots?p=247/5', '/documents/1230'],
  hemin: ['/inbox', '/log', '/my-day', '/templates'],
  bafrin: ['/leave', '/inbox', '/templates'],
  aram: ['/dashboard', '/rooms', '/admin/scanners', '/inbox', '/leave'],
  karwan: ['/archive', '/tray'],
  itadmin: ['/admin/users', '/admin/rooms', '/admin/doc-types'],
};
const browser = await launch();
for (const vp of [{ width: 1024, height: 768 }, { width: 1366, height: 768 }]) {
  for (const [user, paths] of Object.entries(PLAN)) {
    const { context, page } = await ctxFor(browser, user, vp.width === 1024 ? 't1024' : 'd1366');
    for (const path of paths) {
      await page.goto(path, { waitUntil: 'load' });
      const r = await page.evaluate(() => {
        const out = [];
        for (const wrap of document.querySelectorAll('.content .table-wrap, .content .card table')) {
          const scroller = wrap.classList.contains('table-wrap') ? wrap : (getComputedStyle(wrap).overflowX !== 'visible' ? wrap : null);
          if (!scroller) continue;
          if (scroller.scrollWidth <= scroller.clientWidth + 1) continue;
          const sr = scroller.getBoundingClientRect();
          let hidden = 0, total = 0, sample = null;
          for (const b of scroller.querySelectorAll('tbody .btn, tbody button')) {
            total++;
            const q = b.getBoundingClientRect();
            if (q.left < sr.left - 1 || q.right > sr.right + 1) { hidden++; sample ||= b.textContent.trim().slice(0, 30); }
          }
          out.push({ wrapW: scroller.clientWidth, sw: scroller.scrollWidth, buttons: total, hidden, sample, heading: scroller.closest('.card')?.querySelector('h2')?.textContent.trim().slice(0, 40) });
        }
        return out;
      });
      const bad = r.filter(x => x.hidden);
      if (r.length) console.log(vp.width, user, path, JSON.stringify(r));
      if (bad.length) {
        const wraps = page.locator('.content .table-wrap');
        const n = await wraps.count();
        for (let i = 0; i < n; i++) {
          const w = wraps.nth(i);
          const hid = await w.evaluate(s => { if (s.scrollWidth <= s.clientWidth + 1) return false; const sr = s.getBoundingClientRect(); return [...s.querySelectorAll('tbody .btn, tbody button')].some(b => { const q = b.getBoundingClientRect(); return q.left < sr.left - 1 || q.right > sr.right + 1; }); });
          if (hid) { await shotAround(page, w, `hidden-actions-${vp.width}-${user}-${path.replace(/[^a-z0-9]+/gi, '_')}-${i}`, { above: 50, height: 260 }); break; }
        }
      }
    }
    await context.close();
  }
}
await browser.close();
