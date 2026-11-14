// Small proofs: header cell colours, muted sub-line sizes, pill sizes, date wrapping, nav highlight.
import { launch, ctxFor, settle } from './lib.mjs';
const browser = await launch();
const out = {};
const go = async (u, url, fn, arg) => {
  const ctx = await ctxFor(browser, u); const p = await ctx.newPage();
  await p.goto(url); await settle(p);
  const r = await p.evaluate(fn, arg); await p.close(); await ctx.close(); return r;
};
const thBg = () => [...document.querySelectorAll('main thead')].slice(0, 1).map(th => [...th.querySelectorAll('th')].map(x => `${x.textContent.trim() || '(actions)'}=${getComputedStyle(x).backgroundColor}`));
out.inboxTh = await go('hemin', '/inbox', thBg);
out.outgoingTh = await go('shilan', '/outgoing', thBg);
out.subLines = {
  inbox: await go('hemin', '/inbox', () => [...document.querySelectorAll('main tbody tr:first-child td .muted')].map(e => `${e.textContent.trim().slice(0, 20)}=${getComputedStyle(e).fontSize}`)),
  myday: await go('aram', '/my-day', () => [...document.querySelectorAll('main tbody tr:first-child td .muted')].map(e => `${e.textContent.trim().slice(0, 20)}=${getComputedStyle(e).fontSize}`)),
  tray: await go('shilan', '/tray', () => [...document.querySelectorAll('main tbody tr:first-child td .muted')].map(e => `${e.textContent.trim().slice(0, 20)}=${getComputedStyle(e).fontSize}`)),
  plot: await go('shilan', '/plots?p=240%2F612', () => [...document.querySelectorAll('main tbody tr:first-child td .muted')].map(e => `${e.textContent.trim().slice(0, 20)}=${getComputedStyle(e).fontSize}`)),
};
out.attachMetaPills = await go('sakar', '/documents/542', () => [...document.querySelectorAll('.attach-meta .pill, .attach-meta a')].map(e => `${e.textContent.trim()}=${getComputedStyle(e).fontSize}`));
out.dateWrap = {
  tray: await go('shilan', '/tray', () => { const td = document.querySelector('main tbody tr td:nth-child(4)'); return `${td.textContent.trim()} h=${Math.round(td.getBoundingClientRect().height)} w=${Math.round(td.getBoundingClientRect().width)} lines=${Math.round(td.querySelector ? td.getBoundingClientRect().height : 0)}`; }),
  manifestsNo: await go('sakar', '/manifests', () => { const a = document.querySelector('main tbody tr td:first-child a'); const r = a.getClientRects(); return `${a.textContent.trim()} rects=${r.length} font=${getComputedStyle(a).fontFamily.split(',')[0]}`; }),
  mydayDue: await go('hemin', '/my-day', () => [...document.querySelectorAll('main .card')].map(c => { const tr = c.querySelector('tbody tr'); if (!tr) return null; const td = [...tr.cells].find(x => /[٠-٩]{4}\//.test(x.textContent)); return td ? `${c.querySelector('h2').textContent.trim().slice(0, 20)}: ${td.textContent.trim().slice(0, 30)} w=${Math.round(td.getBoundingClientRect().width)} h=${Math.round(td.getBoundingClientRect().height)}` : null; })),
  trayMineNo: await go('shilan', '/tray', () => { const a = [...document.querySelectorAll('main .card')].pop().querySelector('tbody a'); return `${a.outerHTML} font=${getComputedStyle(a).fontFamily.split(',')[0]}`; }),
  manifestNoFont: await go('sakar', '/manifests/59', () => { const a = document.querySelector('main tbody a.mono'); const bc = document.querySelector('main tbody td.muted'); return `letterNo=${getComputedStyle(a).fontFamily.split(',')[0]} barcode=${getComputedStyle(bc).fontFamily.split(',')[0]}`; }),
};
out.navCurrent = {
  docFromInbox: await go('hemin', '/documents/544', () => document.querySelector('.nav a[aria-current]')?.textContent.trim()),
  photoSakar: await go('sakar', '/registry/photo', () => document.querySelector('.nav a[aria-current]')?.textContent.trim() ?? '(none)'),
  scan: await go('shilan', '/scan?to=tray', () => document.querySelector('.nav a[aria-current]')?.textContent.trim() ?? '(none)'),
};
out.kvTh = {
  letter: await go('shilan', '/documents/1519', () => { const t = document.querySelector('table.kv th'); return `${Math.round(t.getBoundingClientRect().width)}px of ${Math.round(t.closest('table').getBoundingClientRect().width)}`; }),
  barcode: await go('shilan', '/barcode?q=20260009665', () => { const t = document.querySelector('main tbody th'); return `${Math.round(t.getBoundingClientRect().width)}px of ${Math.round(t.closest('table').getBoundingClientRect().width)} status="${t.nextElementSibling.innerHTML.trim()}"`; }),
  place: await go('shilan', '/barcode?q=20260009665', () => [...document.querySelectorAll('main tbody tr')].map(r => r.textContent.trim().replace(/\s+/g, ' ')).join(' | ')),
  placeLetter: await go('shilan', '/documents/1519', () => [...document.querySelectorAll('table.kv tr')].filter(r => /شوێن/.test(r.textContent)).map(r => r.textContent.trim().replace(/\s+/g, ' ')).join(' | ')),
};
out.notifHead = await go('shilan', '/notifications', () => { const c = document.querySelector('main .card'); const h = c.querySelector('h2'); return `h2Top=${Math.round(h.getBoundingClientRect().top - c.getBoundingClientRect().top)}`; });
out.heights = await go('shilan', '/registry/new', () => `subject input=${Math.round(document.querySelector('#subject').getBoundingClientRect().height)} type select=${Math.round(document.querySelector('#doc_type_option_id').getBoundingClientRect().height)}`);
console.log(JSON.stringify(out, null, 1));
await browser.close();
