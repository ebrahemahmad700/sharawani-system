// Checks that the SQL normaliser and the JavaScript one agree, character for
// character, on every row of the corpus.
//
// This is the test that matters most in this project. The database owns the
// indexed *_search columns; the browser and server normalise the query before
// sending it. If the two implementations drift apart by even one character, a
// clerk types a name, the query is folded one way, the stored text was folded
// another, and the record is simply not found. Nothing errors. It just silently
// stops working.
//
//   DATABASE_URL_OWNER=... node test/ku_sql.test.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import { kuNormalize, plotKey, foldDigits } from '../src/lib/ku.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL_APP;
if (!url) { console.error('set DATABASE_URL_OWNER'); process.exit(2); }

const rows = readFileSync(join(here, 'ku_corpus.tsv'), 'utf8')
  .split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).slice(1)
  .map(l => { const [id, typed, stored, expect, why] = l.split('\t'); return { id, typed, stored, expect, why }; });

const client = new pg.Client({ connectionString: url });
await client.connect();

// Every distinct string in the corpus, both sides of every row.
const strings = [...new Set(rows.flatMap(r => [r.typed, r.stored]))];

let mismatches = 0;
for (const s of strings) {
  const { rows: [db] } = await client.query(
    'SELECT ku_normalize($1) AS norm, plot_key($1) AS pkey, fold_digits($1) AS digits', [s]);

  const checks = [
    ['ku_normalize', db.norm,   kuNormalize(s)],
    ['plot_key',     db.pkey,   plotKey(s)],
    ['fold_digits',  db.digits, foldDigits(s)],
  ];
  for (const [fn, sql, js] of checks) {
    if (sql !== js) {
      mismatches++;
      console.log(`MISMATCH ${fn}`);
      console.log(`  input ${JSON.stringify(s)}`);
      console.log(`  sql   ${JSON.stringify(sql)}`);
      console.log(`  js    ${JSON.stringify(js)}\n`);
    }
  }
}

// Now the corpus expectations, evaluated by the database rather than by JS.
let pass = 0, fail = 0, skip = 0;
for (const r of rows) {
  let ok;
  if (r.expect === 'EQ') {
    const { rows: [x] } = await client.query('SELECT ku_normalize($1) = ku_normalize($2) AS ok', [r.typed, r.stored]);
    ok = x.ok;
  } else if (r.expect === 'EQ_PLOT') {
    const { rows: [x] } = await client.query('SELECT plot_key($1) = plot_key($2) AS ok', [r.typed, r.stored]);
    ok = x.ok;
  } else if (r.expect === 'NEG_PLOT') {
    const { rows: [x] } = await client.query('SELECT plot_key($1) IS DISTINCT FROM plot_key($2) AS ok', [r.typed, r.stored]);
    ok = x.ok;
  } else if (r.expect === 'MISS') {
    const { rows: [x] } = await client.query('SELECT ku_normalize($1) <> ku_normalize($2) AS ok', [r.typed, r.stored]);
    ok = x.ok;
  } else { skip++; continue; }

  if (ok) pass++;
  else { fail++; console.log(`FAIL row ${r.id} [${r.expect}] ${r.why}\n     typed ${r.typed}\n     stored ${r.stored}`); }
}

console.log(`\nSQL vs JS on ${strings.length} distinct strings, 3 functions each: ${mismatches ? mismatches + ' MISMATCHES' : 'identical'}`);
console.log(`corpus in the database: ${pass} passed, ${fail} failed, ${skip} need fixtures`);
await client.end();
process.exit(mismatches || fail ? 1 : 0);
