// In-page measurement: the things compared across screens.
export function measure() {
  const cs = el => getComputedStyle(el);
  const r = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top + scrollY), w: Math.round(b.width), h: Math.round(b.height) }; };
  const txt = el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const visible = el => { const b = el.getBoundingClientRect(); const s = cs(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const main = document.querySelector('main.content') || document.body;
  const out = { url: location.pathname + location.search, vw: innerWidth };

  const h1 = document.querySelector('.topbar h1, h1');
  if (h1) out.h1 = { text: txt(h1), fs: cs(h1).fontSize, fw: cs(h1).fontWeight, ff: cs(h1).fontFamily.split(',')[0] };
  out.docTitle = document.title;
  out.scrollW = document.documentElement.scrollWidth;
  out.pageH = document.documentElement.scrollHeight;

  out.cards = [...main.querySelectorAll('.card, .login-card')].filter(visible).map(c => {
    const s = cs(c);
    const head = c.querySelector(':scope > h2, :scope > h3, :scope > div > h2, :scope > .row > h2, :scope > div > div > h2');
    const hs = head ? cs(head) : null;
    let beside = null;
    if (head && head.parentElement !== c) {
      beside = [...head.parentElement.children].filter(x => x !== head).map(x => ({ tag: x.tagName, cls: x.className, text: txt(x), fs: cs(x).fontSize, fw: cs(x).fontWeight, color: cs(x).color }));
    }
    return {
      rect: r(c), pad: s.padding, radius: s.borderRadius, border: s.borderTopWidth + ' ' + s.borderTopColor, mb: s.marginBottom, maxW: s.maxWidth,
      head: head ? { text: txt(head), tag: head.tagName, fs: hs.fontSize, fw: hs.fontWeight, mt: hs.marginTop, mb: hs.marginBottom, color: hs.color, parentMb: head.parentElement !== c ? cs(head.parentElement).marginBottom : null, inline: head.getAttribute('style'), beside } : null,
    };
  });

  out.buttons = [...document.querySelectorAll('.btn, button')].filter(visible).map(b => {
    const s = cs(b);
    const inTop = !!b.closest('.topbar');
    const inSide = !!b.closest('.sidebar');
    if (inSide) return null;
    const form = b.closest('form');
    let pos = null;
    if (form && !inTop) {
      const fr = form.getBoundingClientRect(), br = b.getBoundingClientRect();
      pos = { fromRight: Math.round(fr.right - br.right), fromLeft: Math.round(br.left - fr.left), fullWidth: Math.round(br.width) >= Math.round(fr.width) - 2, formW: Math.round(fr.width) };
    }
    return { text: txt(b) || b.getAttribute('aria-label'), cls: b.className, bg: s.backgroundColor, color: s.color, fs: s.fontSize, pad: s.padding, h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width), top: inTop, pos };
  }).filter(Boolean);

  out.tables = [...main.querySelectorAll('table')].filter(visible).map(t => {
    const th = t.querySelector('thead th:not(.sr-only)');
    const kvth = t.querySelector('tbody th');
    const td = t.querySelector('tbody td');
    const heads = [...t.querySelectorAll('thead th')].map(x => txt(x));
    const trs = [...t.querySelectorAll('tbody tr')];
    const dim = trs.filter(tr => tr.getAttribute('style')?.includes('opacity')).map(tr => tr.getAttribute('style'));
    return {
      heads, rows: trs.length, theadHidden: !!t.querySelector('thead.sr-only'),
      th: th ? { fs: cs(th).fontSize, fw: cs(th).fontWeight, color: cs(th).color, bg: cs(th).backgroundColor, pad: cs(th).padding } : null,
      kvth: kvth ? { text: txt(kvth), fs: cs(kvth).fontSize, color: cs(kvth).color, bg: cs(kvth).backgroundColor, w: Math.round(kvth.getBoundingClientRect().width), inlineW: kvth.getAttribute('style') } : null,
      td: td ? { fs: cs(td).fontSize, pad: cs(td).padding } : null,
      dimmed: [...new Set(dim)], rect: r(t),
    };
  });

  out.empties = [...main.querySelectorAll('.empty')].filter(visible).map(e => ({ text: txt(e), fs: cs(e).fontSize, pad: cs(e).padding, color: cs(e).color, inTable: !!e.closest('table') }));
  out.pills = [...main.querySelectorAll('.pill')].filter(visible).map(p => ({ text: txt(p), cls: p.className, bg: cs(p).backgroundColor, color: cs(p).color, fs: cs(p).fontSize }));
  out.notices = [...main.querySelectorAll('.notice')].filter(visible).map(n => ({ text: txt(n), cls: n.className, fs: cs(n).fontSize }));

  out.labels = [...main.querySelectorAll('label')].filter(visible).map(l => {
    const f = l.htmlFor && document.getElementById(l.htmlFor);
    let rel = null;
    if (f && visible(f)) {
      const lr = l.getBoundingClientRect(), fr = f.getBoundingClientRect();
      rel = { above: lr.bottom <= fr.top + 2, fieldW: Math.round(fr.width), fieldH: Math.round(fr.height) };
    }
    return { text: txt(l), fs: cs(l).fontSize, color: cs(l).color, req: l.classList.contains('required'), rel, for: l.htmlFor };
  });
  out.hints = [...main.querySelectorAll('.hint')].filter(visible).map(h => ({ text: txt(h).slice(0, 50), fs: cs(h).fontSize, color: cs(h).color, mt: cs(h).marginTop }));

  // Small muted text: every element whose own text is non-empty and is smaller than body.
  const small = new Map();
  for (const el of main.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    if (!own) continue;
    const fs = cs(el).fontSize;
    if (parseFloat(fs) >= 13.5) continue;
    const key = `${fs} ${el.tagName.toLowerCase()}.${String(el.className).replace(/\s+/g, '.')}${el.getAttribute('style') ? ' [' + el.getAttribute('style') + ']' : ''}`;
    if (!small.has(key)) small.set(key, own.slice(0, 40));
  }
  out.small = [...small].map(([k, v]) => `${k} :: ${v}`);

  // Grids: columns and holes.
  out.grids = [...main.querySelectorAll('.grid')].filter(visible).map(g => {
    const kids = [...g.children].filter(visible);
    const rects = kids.map(k => k.getBoundingClientRect());
    const cols = cs(g).gridTemplateColumns;
    const gr = g.getBoundingClientRect();
    return { cls: g.className, cols, n: kids.length, h: Math.round(gr.height), kids: rects.map(b => ({ x: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height), y: Math.round(b.top - gr.top) })) };
  });

  // Latin digits in visible Kurdish text, outside ltr/mono/inputs.
  const latin = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode; const t = n.textContent.trim();
    if (!/[0-9]/.test(t)) continue;
    const el = n.parentElement;
    if (!visible(el) || el.closest('[dir=ltr], .mono, script, style, option, textarea')) continue;
    latin.push(t.slice(0, 50));
  }
  out.latinDigits = latin.slice(0, 20);

  // Inline style font sizes in main: a catalogue.
  out.inlineFs = [...new Set([...main.querySelectorAll('[style*="font-size"]')].map(e => (e.getAttribute('style').match(/font-size:\s*[\d.]+px/) || [''])[0] + ' ' + e.tagName.toLowerCase() + '.' + e.className))];

  // Field rows: .row containing .field, widths.
  out.fieldRows = [...main.querySelectorAll('.row')].filter(x => x.querySelector(':scope > .field') && visible(x)).map(row => ({
    w: Math.round(row.getBoundingClientRect().width),
    fields: [...row.children].filter(c => c.classList.contains('field')).map(f => Math.round(f.getBoundingClientRect().width)),
  }));
  return out;
}
