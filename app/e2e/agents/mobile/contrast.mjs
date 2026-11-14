// Colour contrast from computed styles, against WCAG AA.
import { launch, ctxFor, HERE, shotAround } from './lib.mjs';
import { writeFileSync } from 'fs';
import { join } from 'path';

const browser = await launch();
const PLAN = [
  [null, '/login'], [null, '/track'],
  ['shilan', '/inbox'], ['shilan', '/documents/1230'], ['shilan', '/documents/1230?done=note'], ['shilan', '/registry/new'], ['shilan', '/my-day'],
  ['shilan', '/manifests'], ['shilan', '/notifications'], ['shilan', '/barcode?q=20260007099'], ['shilan', '/tray'],
  ['bafrin', '/leave'], ['aram', '/dashboard'], ['karwan', '/archive'], ['hemin', '/log'], ['shilan', '/documents/1230/receipt'],
];

const measure = () => {
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  function bgOf(el) {
    const stack = [];
    let e = el, opacity = 1;
    while (e && e.nodeType === 1) {
      const cs = getComputedStyle(e);
      opacity *= Number(cs.opacity);
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) stack.push(bg);
      if (bg && bg.a === 1) break;
      e = e.parentElement;
    }
    let c = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) c = blend(stack[i], c);
    return { c, opacity };
  }
  const rows = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden], script, style, noscript, svg, option, select')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (el.closest('.sidebar') && document.querySelector('.sidebar').getBoundingClientRect().left >= innerWidth - 1) continue;
    const fg0 = parse(cs.color);
    const { c: bg, opacity } = bgOf(el);
    const fg = blend({ ...fg0, a: fg0.a * opacity }, bg);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const cr = ratio(fg, bg);
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    rows.push({ el: el.tagName.toLowerCase() + cls, text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30), fg: hex(fg), bg: hex(bg), size, weight: cs.fontWeight, ratio: Math.round(cr * 100) / 100, need, fail: cr < need, opacity });
  }
  // Placeholders
  for (const inp of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    const cs = getComputedStyle(inp);
    if (cs.display === 'none' || inp.classList.contains('file-native')) continue;
    const pc = parse(getComputedStyle(inp, '::placeholder').color);
    const { c: bg } = bgOf(inp);
    const fg = blend(pc, bg);
    const cr = ratio(fg, bg);
    rows.push({ el: `placeholder ${inp.tagName.toLowerCase()}${inp.id ? '#' + inp.id : ''}${inp.name ? '[name=' + inp.name + ']' : ''}`, text: inp.placeholder.slice(0, 30), fg: hex(fg), bg: hex(bg), size: parseFloat(cs.fontSize), ratio: Math.round(cr * 100) / 100, need: 4.5, fail: cr < 4.5, labelled: !!(inp.labels && inp.labels.length) });
  }
  // A disabled button, measured on a copy.
  const b = document.querySelector('.content .btn:not(.secondary)') || document.querySelector('.btn');
  if (b) {
    const copy = b.cloneNode(true); copy.disabled = true; copy.setAttribute('disabled', ''); b.after(copy);
    const cs = getComputedStyle(copy); const fg0 = parse(cs.color); const { c: bg, opacity } = bgOf(copy);
    // opacity applies to both the button's own background and text over the page.
    const own = parse(cs.backgroundColor);
    const parentBg = bgOf(copy.parentElement).c;
    const btnBg = blend({ ...own, a: own.a * opacity }, parentBg);
    const fg = blend({ ...fg0, a: fg0.a * opacity }, btnBg);
    rows.push({ el: 'disabled ' + copy.className, text: copy.textContent.trim().slice(0, 20), fg: hex(fg), bg: hex(btnBg), ratio: Math.round(ratio(fg, btnBg) * 100) / 100, need: 4.5, fail: ratio(fg, btnBg) < 4.5, note: 'disabled controls are exempt from 1.4.3' });
    copy.remove();
  }
  return rows;
};

const all = [];
for (const size of ['d1366', 'i390']) {
  for (const [user, path] of PLAN) {
    if (size === 'i390' && !user) continue; // keep public page requests low
    const { context, page } = await ctxFor(browser, user, size);
    await page.goto(path, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    let rows = await page.evaluate(measure);
    if (size === 'i390' && path === '/inbox') {
      await page.tap('.nav-toggle'); await page.waitForTimeout(350);
      rows = rows.concat((await page.evaluate(measure)).filter(r => /nav|whoami|officer|brand|role|count|name/.test(r.el)).map(r => ({ ...r, el: 'drawer ' + r.el })));
    }
    for (const r of rows) all.push({ size, user, path, ...r });
    await context.close();
  }
}
writeFileSync(join(HERE, 'contrast.json'), JSON.stringify(all, null, 1));
// Summarise failures by fg/bg/size/el
const g = {};
for (const r of all.filter(r => r.fail)) {
  const k = `${r.el} ${r.fg} on ${r.bg} ${r.size}px w${r.weight ?? ''} = ${r.ratio} (need ${r.need})${r.note ? ' [' + r.note + ']' : ''}`;
  (g[k] ||= { n: 0, pages: new Set(), ex: r.text }).n++;
  g[k].pages.add(r.path);
}
for (const [k, v] of Object.entries(g).sort((a, b) => b[1].n - a[1].n)) console.log(`${v.n}x ${k} «${v.ex}» on ${[...v.pages].slice(0, 6).join(', ')}`);
await browser.close();
