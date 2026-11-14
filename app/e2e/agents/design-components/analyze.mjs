// Aggregate the measurements: majority value per role and property, outliers
// with page and sample. Usage: node analyze.mjs out/desktop-1366.jsonl [section]
import { readFileSync } from 'fs';

const file = process.argv[2];
const only = process.argv[3] || 'all';
const recs = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const isPrint = r => r.kind === 'print' || (!r.shell && !['/login', '/track'].includes(r.url));
const app = recs.filter(r => !isPrint(r));
const prints = recs.filter(isPrint);
const pageName = r => `${r.account}:${r.url}`;

function roleTable(set, groupFilter) {
  // group -> role -> prop -> value -> {n, pages:Set, samples}
  const T = {};
  for (const r of set) {
    for (const [g, roles] of Object.entries(r.groups || {})) {
      if (groupFilter && !groupFilter.includes(g)) continue;
      for (const [role, sigs] of Object.entries(roles)) {
        for (const s of Object.values(sigs)) {
          for (const [p, v] of Object.entries(s.v)) {
            const e = ((((T[g] ??= {})[role] ??= {})[p] ??= {})[v] ??= { n: 0, pages: new Set(), samples: [] });
            e.n += s.n; e.pages.add(pageName(r));
            if (e.samples.length < 3) e.samples.push(`${pageName(r)} ${s.samples[0]?.path} «${s.samples[0]?.text}»`);
          }
        }
      }
    }
  }
  return T;
}

function printRoles(T, { skipProps = [], maxOut = 5 } = {}) {
  for (const [g, roles] of Object.entries(T)) {
    console.log(`\n######## ${g}`);
    for (const [role, props] of Object.entries(roles).sort()) {
      const pagesAll = new Set(); let total = 0;
      const first = Object.values(props)[0];
      for (const e of Object.values(first)) { total += e.n; e.pages.forEach(p => pagesAll.add(p)); }
      const lines = [];
      for (const [p, vals] of Object.entries(props)) {
        if (skipProps.includes(p)) continue;
        const arr = Object.entries(vals).sort((a, b) => b[1].pages.size - a[1].pages.size || b[1].n - a[1].n);
        if (arr.length === 1) { lines.push(`    ${p}: ${arr[0][0]}  (all)`); continue; }
        lines.push(`    ${p}: MAJ ${arr[0][0]}  [${arr[0][1].n} el / ${arr[0][1].pages.size} pg]`);
        for (const [v, e] of arr.slice(1, 1 + maxOut)) {
          lines.push(`       ≠ ${v}  [${e.n} el / ${e.pages.size} pg] e.g. ${e.samples.slice(0, 2).join(' | ')}`);
        }
        if (arr.length > 1 + maxOut) lines.push(`       … ${arr.length - 1 - maxOut} more values`);
      }
      console.log(`  == ${role}  (${total} el on ${pagesAll.size} pages)`);
      console.log(lines.join('\n'));
    }
  }
}

function bumpAgg(set, key) {
  const A = {};
  for (const r of set) for (const [v, e] of Object.entries(r[key] || {})) {
    const a = (A[v] ??= { n: 0, pages: new Set(), roles: {} });
    a.n += e.n; a.pages.add(pageName(r));
    for (const [role, k] of Object.entries(e.roles)) a.roles[role] = (a.roles[role] || 0) + k;
  }
  return Object.entries(A).sort((a, b) => b[1].n - a[1].n);
}
function printAgg(title, arr, nroles = 5) {
  console.log(`\n######## ${title}`);
  for (const [v, a] of arr) {
    const roles = Object.entries(a.roles).sort((x, y) => y[1] - x[1]).slice(0, nroles).map(([r, k]) => `${r}×${k}`).join(', ');
    console.log(`  ${v.padEnd(26)} ${String(a.n).padStart(6)} el ${String(a.pages.size).padStart(3)} pg   ${roles}`);
  }
}

if (only === 'all' || only === 'roles') printRoles(roleTable(app));
if (only === 'fonts') {
  printAgg('font sizes (app pages)', bumpAgg(app, 'fontSizes'), 8);
  printAgg('font sizes (print pages)', bumpAgg(prints, 'fontSizes'), 8);
}
if (only === 'colors') {
  printAgg('text colours (app pages)', bumpAgg(app, 'colors'), 5);
  printAgg('backgrounds (app pages)', bumpAgg(app, 'backgrounds'), 5);
  printAgg('border colours (app pages)', bumpAgg(app, 'borderColors'), 5);
  printAgg('radii (app pages)', bumpAgg(app, 'radii'), 6);
}
if (only === 'inline') {
  const A = {};
  for (const r of recs) for (const s of r.inlineHtml || []) {
    const k = s.style.replace(/\s+/g, ' ').trim();
    const a = (A[k] ??= { n: 0, pages: new Set(), els: {} });
    a.n++; a.pages.add(r.url + (isPrint(r) ? ' (print)' : ''));
    const el = `${s.tag}${s.cls ? '.' + s.cls.split(/\s+/).join('.') : ''}`;
    a.els[el] = (a.els[el] || 0) + 1;
  }
  const arr = Object.entries(A).sort((a, b) => b[1].pages.size - a[1].pages.size || b[1].n - a[1].n);
  console.log(`distinct inline style strings: ${arr.length}`);
  for (const [k, a] of arr) {
    console.log(`  [${a.pages.size} pg, ${a.n}×] ${k}\n      on: ${Object.entries(a.els).map(([e, c]) => `${e}×${c}`).join(', ').slice(0, 200)}\n      pages: ${[...a.pages].slice(0, 8).join(' ')}`);
  }
  // DOM-only inline styles (set by scripts)
  const D = {};
  for (const r of app) for (const s of r.inlineDom || []) {
    if (!s.visible) continue;
    (D[s.style] ??= new Set()).add(r.url + ' ' + s.el);
  }
  const serverStyles = new Set(Object.keys(A));
  console.log('\nDOM inline styles not in server HTML (script-set, visible):');
  for (const [k, set] of Object.entries(D)) if (!serverStyles.has(k.replace(/\s+/g, ' ').trim())) console.log(`  ${k}  ← ${[...set].slice(0, 3).join(' | ')}`);
}
if (only === 'latin') {
  const A = {};
  for (const r of recs) for (const t of r.latin || []) {
    const k = `${t.el.split(' > ').slice(-2).join(' > ')} :: ${t.text}`;
    (A[k] ??= new Set()).add(r.url);
  }
  for (const [k, s] of Object.entries(A).sort()) console.log(`  [${s.size}] ${k}   @ ${[...s].slice(0, 4).join(' ')}`);
  console.log('\nattributes:');
  const B = {};
  for (const r of recs) for (const t of r.latinAttr || []) (B[`${t.el} :: ${t.attr}`] ??= new Set()).add(r.url);
  for (const [k, s] of Object.entries(B)) console.log(`  [${s.size}] ${k}  @ ${[...s].slice(0, 4).join(' ')}`);
}
if (only === 'print') {
  for (const r of prints) {
    console.log(`\n== ${r.url} styleBlocks=${r.styleBlocks}`);
    console.log('  fonts:', Object.entries(r.fontSizes).sort((a, b) => b[1].n - a[1].n).map(([v, e]) => `${v}×${e.n}`).join(' '));
    printRoles(roleTable([r], ['headings', 'tables', 'buttons']), { maxOut: 3 });
  }
}
if (only === 'pages') {
  for (const r of recs) console.log(r.account, r.url, r.kind, r.shell, r.docWidth);
}
