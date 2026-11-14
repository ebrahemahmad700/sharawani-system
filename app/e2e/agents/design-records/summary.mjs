// Print a compact comparison from crawl-both.json. node summary.mjs <section> [view]
import { readFileSync } from 'fs';
import { join } from 'path';
import { HERE } from './lib.mjs';

const data = JSON.parse(readFileSync(join(HERE, 'crawl-both.json'), 'utf8'));
const section = process.argv[2] || 'cards';
const view = process.argv[3] || 'desk';

for (const [k, m] of Object.entries(data)) {
  if (!k.startsWith(view)) continue;
  const v = m[section];
  if (v === undefined) continue;
  console.log(`\n== ${k}  [h1: ${m.h1?.text} ${m.h1?.fs}] scrollW=${m.scrollW}`);
  if (section === 'cards') {
    for (const c of v) console.log(`  card ${JSON.stringify(c.rect)} pad=${c.pad} mb=${c.mb} maxW=${c.maxW} r=${c.radius} :: ${c.head ? `${c.head.tag} "${c.head.text}" ${c.head.fs}/${c.head.fw} mt=${c.head.mt} mb=${c.head.mb} parentMb=${c.head.parentMb} inline=${c.head.inline} color=${c.head.color} beside=${JSON.stringify(c.head.beside)}` : '(no heading)'}`);
  } else if (Array.isArray(v)) {
    for (const x of v) console.log('  ' + (typeof x === 'string' ? x : JSON.stringify(x)));
  } else console.log('  ' + JSON.stringify(v));
}
