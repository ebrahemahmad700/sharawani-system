// Topbar height per page, read from --topbar-actual that app.js writes.
import { readFileSync } from 'fs';
const file = process.argv[2] || 'out/desktop-1366.jsonl';
const L = readFileSync(new URL(file, import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const by = {};
for (const r of L) {
  const s = (r.inlineDom || []).find(x => /--topbar-actual/.test(x.style));
  const h = s ? s.style.match(/(\d+)px/)[1] : '(none)';
  (by[h] ??= []).push(`${r.account}:${r.url}`);
}
for (const [h, pages] of Object.entries(by)) console.log(h, pages.length, pages.join(' '));
