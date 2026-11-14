// Runs test/ku_corpus.tsv against src/lib/ku.mjs.
//
// Only the expectations that need no database run here: EQ, EQ_PLOT, EQ_NUM,
// NEG_PLOT and MISS. FUZZY(n) and NEG_RANK are ranking questions and run in
// test/ku_rank.test.sql once the fixtures are loaded.
//
//   node test/ku.test.mjs
//
// Exit code 1 on any failure, so it can gate a merge.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { kuNormalize, plotKey, parseNumber } from '../src/lib/ku.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rows = readFileSync(join(here, 'ku_corpus.tsv'), 'utf8')
  .split(/\r?\n/)
  .filter(l => l.trim() !== '' && !l.startsWith('#'))
  .slice(1)                                  // drop the header line
  .map(l => {
    const [id, typed, stored, expect, why] = l.split('\t');
    return { id, typed, stored, expect, why };
  });

const CURRENT_YEAR = 2026;                   // the corpus rows are written against this
let pass = 0, fail = 0, skip = 0;
const failures = [];

const numbersAgree = (typed, stored) => {
  const a = parseNumber(typed), b = parseNumber(stored);
  if (!a || !b) return false;
  if (a.serial !== b.serial) return false;
  if (a.year !== null && a.year !== b.year) return false;
  if (a.year === null && b.year !== CURRENT_YEAR) return false;
  if (a.kind !== null && a.kind !== b.kind) return false;
  return true;
};

for (const r of rows) {
  let ok, got, want;
  switch (true) {
    case r.expect === 'EQ':
      got = kuNormalize(r.typed); want = kuNormalize(r.stored); ok = got === want; break;
    case r.expect === 'EQ_PLOT':
      got = plotKey(r.typed); want = plotKey(r.stored); ok = got === want; break;
    case r.expect === 'NEG_PLOT':
      got = plotKey(r.typed); want = 'anything but ' + plotKey(r.stored); ok = plotKey(r.typed) !== plotKey(r.stored); break;
    case r.expect === 'EQ_NUM':
      got = JSON.stringify(parseNumber(r.typed)); want = r.stored; ok = numbersAgree(r.typed, r.stored); break;
    case r.expect === 'MISS':
      got = kuNormalize(r.typed); want = 'NOT ' + kuNormalize(r.stored);
      ok = kuNormalize(r.typed) !== kuNormalize(r.stored); break;
    default:
      skip++; continue;                       // FUZZY(n), NEG_RANK: need the database
  }
  if (ok) pass++;
  else { fail++; failures.push({ ...r, got, want }); }
}

for (const f of failures) {
  console.log(`FAIL row ${f.id}  [${f.expect}]  ${f.why}`);
  console.log(`     typed  ${f.typed}`);
  console.log(`     stored ${f.stored}`);
  console.log(`     got    ${f.got}`);
  console.log(`     want   ${f.want}\n`);
}

const miss = rows.filter(r => r.expect === 'MISS').length;
console.log(`corpus ${rows.length} rows: ${pass} passed, ${fail} failed, ${skip} need the database`);
if (miss) console.log(`(${miss} of those passes are MISS rows: they pass by correctly NOT matching, and are known gaps)`);
process.exit(fail ? 1 : 0);
