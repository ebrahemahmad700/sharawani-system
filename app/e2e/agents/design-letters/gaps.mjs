// Distance from a card heading to the line under it, and heading-to-content distance.
import { launch, ctxFor, settle } from './lib.mjs';
const PAGES = [
  ['shilan', '/outgoing'], ['shilan', '/tray'], ['shilan', '/barcode'], ['shilan', '/registry/photo'],
  ['sakar', '/documents/542'], ['sakar', '/manifests'], ['shilan', '/plots'], ['shilan', '/notifications'],
  ['aram', '/my-day'], ['shilan', '/documents?q=' + encodeURIComponent('داواکاری')], ['sakar', '/registry/new'],
  ['shilan', '/documents/1515'], ['shilan', '/documents/1528/reply'], ['sakar', '/manifests/59'], ['shilan', '/plots?p=240%2F612'],
  ['shilan', '/scan?to=tray'], ['shilan', '/tray/312'],
];
const browser = await launch();
const ctxs = {};
for (const [u, url] of PAGES) {
  ctxs[u] ??= await ctxFor(browser, u);
  const p = await ctxs[u].newPage();
  await p.goto(url); await settle(p);
  const rows = await p.evaluate(() => [...document.querySelectorAll('main .card')].map(card => {
    const h = card.querySelector('h2');
    const cb = card.getBoundingClientRect();
    if (!h) {
      const first = card.firstElementChild; const fb = first?.getBoundingClientRect();
      return `  (no h2) first=${first?.tagName}.${first?.className} topGap=${fb ? Math.round(fb.top - cb.top) : '-'}`;
    }
    const hb = h.getBoundingClientRect();
    // the first element after the heading (or after its row)
    const holder = h.parentElement.classList.contains('row') || h.parentElement.tagName === 'DIV' && h.parentElement !== card && h.parentElement.parentElement === card ? h.parentElement : h;
    let next = holder.nextElementSibling; while (next && (next.tagName === 'INPUT' && next.type === 'hidden')) next = next.nextElementSibling;
    const nb = next?.getBoundingClientRect();
    const nfs = next ? getComputedStyle(next).fontSize : '';
    return `  [${h.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)}] headTop=${Math.round(hb.top - cb.top)} gapToNext=${nb ? Math.round(nb.top - holder.getBoundingClientRect().bottom) : '-'} next=${next?.tagName}.${next?.className} fs=${nfs}`;
  }));
  console.log(url); rows.slice(0, 6).forEach(r => console.log(r));
  await p.close();
}
await browser.close();
