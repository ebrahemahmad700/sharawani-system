// First pass: every menu item for every role, full-page shots at 1366x768 and a
// structured dump of what is on each page (titles, headings, pills, buttons,
// empty states, odd characters).
import { launch, ctxFor, shotPath, saveJson, settle } from './lib.mjs';

const USERS = (process.argv[2] || 'aram,shilan,ahang,hemin,sakar,bafrin,karwan,dana,itadmin,hersh').split(',');
const W = Number(process.argv[3] || 1366), H = Number(process.argv[4] || 768);

const browser = await launch();
const out = {};
for (const u of USERS) {
  const ctx = await ctxFor(browser, u, { width: W, height: H });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/');
  await settle(page);
  const nav = await page.$$eval('.sidebar nav a', as => as.map(a => ({ href: a.getAttribute('href'), label: a.querySelector('span').textContent.trim() })));
  out[u] = { landing: new URL(page.url()).pathname, nav, pages: [] };
  for (const item of nav) {
    if (item.href === '/board') continue;
    const resp = await page.goto(item.href);
    await settle(page);
    const slug = item.href.replace(/\//g, '_').replace(/^_/, '') || 'root';
    await page.screenshot({ path: shotPath('crawl', `${W}`, u, `${slug}.png`), fullPage: true });
    const info = await page.evaluate(() => {
      const t = document.body.innerText;
      const arabic = [...t.matchAll(/[^\s]*[يكةھى][^\s]*/g)].map(m => m[0]);
      const latin = [...t.matchAll(/[A-Za-z][A-Za-z.\-]{2,}/g)].map(m => m[0]);
      const mixed = [...t.matchAll(/[^\s]*(?:[0-9][^\s]*[٠-٩]|[٠-٩][^\s]*[0-9])[^\s]*/g)].map(m => m[0]);
      const cs = el => getComputedStyle(el);
      const h1 = document.querySelector('.topbar h1')?.textContent.trim();
      const h2s = [...document.querySelectorAll('.content h2')].map(h => ({ text: h.textContent.trim().slice(0, 60), fs: cs(h).fontSize }));
      const pills = [...document.querySelectorAll('.pill')].map(p => `${p.className}|${p.textContent.trim()}`);
      const btns = [...document.querySelectorAll('.content .btn, .topbar .btn')].map(b => `${b.className}|${b.textContent.trim().slice(0, 40)}`);
      const empties = [...document.querySelectorAll('.empty, .content p.muted')].map(e => `${e.className}|${e.textContent.trim().slice(0, 90)}`);
      const overflowX = document.documentElement.scrollWidth > window.innerWidth;
      const wide = [...document.querySelectorAll('.content *')].filter(e => {
        const r = e.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > window.innerWidth + 1);
      }).slice(0, 5).map(e => `${e.tagName}.${e.className}`);
      return { h1, h2s, pills: [...new Set(pills)], btns: [...new Set(btns)], empties, arabic: [...new Set(arabic)], latin: [...new Set(latin)], mixed: [...new Set(mixed)], overflowX, wide, title: document.title };
    });
    out[u].pages.push({ href: item.href, label: item.label, status: resp?.status(), ...info });
    console.log(u, item.href, resp?.status(), info.h1, info.overflowX ? 'OVERFLOW' : '');
  }
  out[u].errors = errors;
  await ctx.close();
}
saveJson(`crawl-${W}.json`, out);
await browser.close();
