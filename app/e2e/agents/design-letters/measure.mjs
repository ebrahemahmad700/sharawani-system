// Visit every screen in the brief and record computed styles of the repeated pieces.
// Usage: node measure.mjs [width] [height]
import { launch, ctxFor, save, settle, shot } from './lib.mjs';

const W = Number(process.argv[2] || 1366), H = Number(process.argv[3] || 768);
const tag = `${W}`;

const PAGES = [
  ['aram', '/inbox?room=6', 'inbox-aram-legal'],
  ['hemin', '/inbox', 'inbox-hemin'],
  ['hemin', '/my-day', 'myday-hemin'],
  ['aram', '/my-day', 'myday-aram'],
  ['shilan', '/outgoing', 'outgoing'],
  ['shilan', '/documents', 'search-empty'],
  ['shilan', '/documents?q=' + encodeURIComponent('داواکاری'), 'search-q'],
  ['shilan', '/documents?q=zzqqxx', 'search-none'],
  ['shilan', '/registry', 'registry'],
  ['shilan', '/registry/new', 'new-shilan'],
  ['sakar', '/registry/new', 'new-sakar'],
  ['shilan', '/registry/photo', 'photo'],
  ['hemin', '/documents/544', 'doc-hemin-holder'],
  ['sakar', '/documents/542', 'doc-sakar-holder'],
  ['shilan', '/documents/1519', 'doc-closed-notes'],
  ['shilan', '/documents/1504', 'doc-cancelled'],
  ['shilan', '/documents/1515', 'doc-ready'],
  ['shilan', '/documents/1528/reply', 'reply'],
  ['shilan', '/barcode', 'barcode'],
  ['shilan', '/barcode?q=20260009665', 'barcode-hit'],
  ['shilan', '/barcode?q=20260009666', 'barcode-bad'],
  ['shilan', '/manifests', 'manifests-shilan'],
  ['sakar', '/manifests', 'manifests-sakar'],
  ['shilan', '/manifests/61', 'manifest-61'],
  ['sakar', '/manifests/59', 'manifest-59'],
  ['shilan', '/tray', 'tray'],
  ['shilan', '/tray/312', 'tray-312'],
  ['shilan', '/scan?to=tray', 'scan'],
  ['shilan', '/notifications', 'notifications'],
  ['shilan', '/plots', 'plots'],
  ['shilan', '/plots?p=240', 'plots-matches'],
  ['shilan', '/plots?p=240%2F612', 'plot-file'],
];

function collect() {
  const cs = el => getComputedStyle(el);
  const r = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top + scrollY), w: Math.round(b.width), h: Math.round(b.height) }; };
  const txt = el => (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
  const where = el => el.closest('.topbar') ? 'topbar' : el.closest('td') ? 'td' : el.closest('th') ? 'th' : el.closest('.notice') ? 'notice' : el.closest('form') ? 'form' : el.closest('.card') ? 'card' : 'other';
  const out = {};
  out.url = location.pathname + location.search;
  out.h1 = txt(document.querySelector('.topbar h1'));
  out.h1lines = (() => { const h = document.querySelector('.topbar h1'); return h ? Math.round(h.getBoundingClientRect().height / parseFloat(cs(h).lineHeight || 1)) : 0; })();
  out.overflowX = document.documentElement.scrollWidth - innerWidth;
  const content = document.querySelector('main.content');
  out.content = content ? { ...r(content), pad: cs(content).padding } : null;
  out.cards = [...document.querySelectorAll('main .card')].map(c => {
    const hd = c.querySelector(':scope > h2, :scope > .row > h2, :scope > div > h2, :scope > h3, :scope > summary, :scope > form > h2');
    const s = cs(c);
    return {
      rect: r(c), pad: s.padding, mb: s.marginBottom, border: s.borderColor, style: c.getAttribute('style'), cls: c.className,
      head: hd ? {
        tag: hd.tagName, text: txt(hd).slice(0, 80), fs: cs(hd).fontSize, fw: cs(hd).fontWeight, ff: cs(hd).fontFamily.split(',')[0],
        mt: cs(hd).marginTop, mb: cs(hd).marginBottom, style: hd.getAttribute('style'),
        wrapper: hd.parentElement.classList.contains('row') ? 'row' : hd.parentElement === c ? 'card' : hd.parentElement.tagName + '.' + hd.parentElement.className,
        wrapperMb: cs(hd.parentElement).marginBottom,
        inner: [...hd.querySelectorAll('.pill, span, a')].map(p => ({ tag: p.tagName, cls: p.className, text: txt(p).slice(0, 30) })),
        siblings: hd.parentElement.classList.contains('row') ? [...hd.parentElement.children].filter(x => x !== hd).map(x => ({ tag: x.tagName, cls: x.className, text: txt(x).slice(0, 30) })) : [],
        next: hd.nextElementSibling ? { tag: hd.nextElementSibling.tagName, cls: hd.nextElementSibling.className, fs: cs(hd.nextElementSibling).fontSize, mt: cs(hd.nextElementSibling).marginTop, style: hd.nextElementSibling.getAttribute('style'), text: txt(hd.nextElementSibling).slice(0, 50) } : null,
      } : null,
    };
  });
  out.btns = [...document.querySelectorAll('main .btn, .topbar-tools > .btn, .topbar-tools > a.btn')].filter(b => !b.closest('.topbar-search') && !b.classList.contains('bell') && !b.classList.contains('sound-toggle'))
    .map(b => { const s = cs(b); const bb = b.getBoundingClientRect(); return {
      cls: b.className.replace(/\s+/g, ' '), text: txt(b).slice(0, 50), where: where(b), fs: s.fontSize, pad: s.padding, h: Math.round(bb.height), w: Math.round(bb.width), bg: s.backgroundColor, visible: bb.width > 0,
      x: Math.round(bb.left), right: Math.round(bb.right), tag: b.tagName,
    }; });
  out.topActions = [...document.querySelectorAll('.topbar-tools > a.btn, .topbar-tools > .btn')].filter(b => !b.classList.contains('bell') && !b.classList.contains('sound-toggle')).map(b => ({ cls: b.className, text: txt(b) }));
  out.tables = [...document.querySelectorAll('main table')].map(t => {
    const th = t.querySelector('th'); const td = t.querySelector('tbody td');
    const rows = [...t.querySelectorAll('tbody tr')].slice(0, 4).map(tr => Math.round(tr.getBoundingClientRect().height));
    return {
      cls: t.className, thead: !!t.querySelector('thead'), heads: [...t.querySelectorAll('thead th')].map(txt),
      rowHeads: [...t.querySelectorAll('tbody th')].slice(0, 12).map(x => ({ text: txt(x), style: x.getAttribute('style'), w: Math.round(x.getBoundingClientRect().width) })),
      th: th ? { fs: cs(th).fontSize, bg: cs(th).backgroundColor, fw: cs(th).fontWeight, color: cs(th).color, pad: cs(th).padding } : null,
      td: td ? { fs: cs(td).fontSize, pad: cs(td).padding } : null, rows,
      firstRow: [...(t.querySelector('tbody tr')?.cells ?? [])].map(c => ({ text: txt(c).slice(0, 40), cls: c.className, fs: cs(c).fontSize, inner: c.innerHTML.length < 400 ? c.innerHTML.replace(/\s+/g, ' ').slice(0, 300) : '(long)' })),
      width: Math.round(t.getBoundingClientRect().width), wrapW: Math.round(t.parentElement.getBoundingClientRect().width), scrollW: t.parentElement.scrollWidth,
    };
  });
  out.empties = [...document.querySelectorAll('main .empty')].map(e => ({ text: txt(e).slice(0, 90), pad: cs(e).padding, fs: cs(e).fontSize, align: cs(e).textAlign }));
  out.mutedEmpties = [...document.querySelectorAll('main p.muted')].filter(p => /هیچ|هێشتا/.test(txt(p))).map(e => ({ text: txt(e).slice(0, 90), fs: cs(e).fontSize, style: e.getAttribute('style') }));
  out.muted = [...document.querySelectorAll('main .muted, main .hint, main .note-meta, main .attach-meta, main .when')].map(e => ({ tag: e.tagName, cls: e.className, fs: cs(e).fontSize, style: e.getAttribute('style'), text: txt(e).slice(0, 40), where: where(e) }));
  out.hints = [...document.querySelectorAll('main .hint')].map(e => ({ tag: e.tagName, fs: cs(e).fontSize, mt: cs(e).marginTop, text: txt(e).slice(0, 40) }));
  out.intros = [...document.querySelectorAll('main .card > p.muted, main .card p.muted')].map(e => ({ fs: cs(e).fontSize, mt: cs(e).marginTop, mb: cs(e).marginBottom, style: e.getAttribute('style'), text: txt(e).slice(0, 50) }));
  out.notices = [...document.querySelectorAll('main .notice')].map(n => ({ cls: n.className, tag: n.tagName, text: txt(n).slice(0, 120), fs: cs(n).fontSize, pad: cs(n).padding, mb: cs(n).marginBottom, style: n.getAttribute('style') }));
  out.pills = [...document.querySelectorAll('main .pill')].map(p => ({ cls: p.className, text: txt(p), fs: cs(p).fontSize, style: p.getAttribute('style') }));
  out.labels = [...document.querySelectorAll('main label')].filter(l => !l.classList.contains('btn')).map(l => ({ text: txt(l).slice(0, 50), cls: l.className, fs: cs(l).fontSize, color: cs(l).color, after: getComputedStyle(l, '::after').content, display: cs(l).display }));
  out.legends = [...document.querySelectorAll('main legend')].map(l => ({ text: txt(l), cls: l.className, fs: cs(l).fontSize, after: getComputedStyle(l, '::after').content }));
  out.fields = [...document.querySelectorAll('main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), main select, main textarea')].filter(f => f.getBoundingClientRect().width > 0).map(f => ({
    tag: f.tagName, id: f.id, name: f.name, ph: f.placeholder, w: Math.round(f.getBoundingClientRect().width), h: Math.round(f.getBoundingClientRect().height), fs: cs(f).fontSize, dir: f.dir, required: f.required,
    label: f.id ? txt(document.querySelector(`label[for="${f.id}"]`)).slice(0, 40) : (f.getAttribute('aria-label') ?? ''),
  }));
  out.submits = [...document.querySelectorAll('main form')].map(f => {
    const b = f.querySelector('button[type=submit]:not([name=related_document_id])'); if (!b) return null;
    const card = f.closest('.card') ?? f; const cb = card.getBoundingClientRect(); const bb = b.getBoundingClientRect();
    return { action: f.getAttribute('action'), text: txt(b), cls: b.className, inRow: !!b.closest('.row'), distRight: Math.round(cb.right - bb.right), distLeft: Math.round(bb.left - cb.left), w: Math.round(bb.width) };
  }).filter(Boolean);
  // Text of every date-looking thing.
  const dates = new Set();
  const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { const m = walker.currentNode.textContent.match(/[0-9٠-٩]{1,4}[\/:\-.][0-9٠-٩]{1,2}([\/:\-.][0-9٠-٩]{1,4})?/g); if (m) m.forEach(x => dates.add(x)); }
  out.dateish = [...dates].slice(0, 30);
  out.grids = [...document.querySelectorAll('main .grid')].map(g => ({ cls: g.className, cols: cs(g).gridTemplateColumns, gap: cs(g).gap, style: g.getAttribute('style'),
    kids: [...g.children].map(k => { const b = k.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width), x: Math.round(b.left) }; }) }));
  out.detailsSummaries = [...document.querySelectorAll('main summary')].map(s => ({ text: txt(s).slice(0, 40), cls: s.className, fs: cs(s).fontSize, color: cs(s).color, fw: cs(s).fontWeight }));
  out.inlineStyles = [...document.querySelectorAll('main [style]')].map(e => `${e.tagName.toLowerCase()}.${e.className}: ${e.getAttribute('style')}`);
  out.widths = [...document.querySelectorAll('main .card')].map(c => Math.round(c.getBoundingClientRect().width));
  out.wide = [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.table-wrap') && !e.closest('table') && getComputedStyle(e).position !== 'fixed').slice(0, 10).map(e => `${e.tagName}.${e.className} right=${Math.round(e.getBoundingClientRect().right)}`);
  return out;
}

const browser = await launch();
const ctxs = {};
const results = {};
for (const [u, url, name] of PAGES) {
  ctxs[u] ??= await ctxFor(browser, u, { width: W, height: H });
  const p = await ctxs[u].newPage();
  try {
    const resp = await p.goto(url);
    await settle(p);
    await p.waitForTimeout(400);
    const data = await p.evaluate(collect);
    data.status = resp.status();
    data.finalUrl = p.url();
    results[name] = data;
    await p.screenshot({ path: shot(tag, `${name}.png`), fullPage: true });
    console.log(name, data.status, data.h1, 'cards', data.cards.length, 'ovx', data.overflowX);
  } catch (e) { console.log('ERR', name, e.message); }
  await p.close();
}
save(`measure-${tag}.json`, results);
await browser.close();
