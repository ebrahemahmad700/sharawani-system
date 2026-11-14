// Migration runner. Applies db/migrations/*.sql in filename order, once each.
//
//   node db/migrate.mjs            apply everything pending
//   node db/migrate.mjs --status   list what is applied and what is pending
//   node db/migrate.mjs --dry      print what would run, change nothing
//
// Connects as docsys_owner (DATABASE_URL_OWNER), never as the application role.
// 0000_roles.sql is excluded: it creates roles and the database itself, so it is
// run once by hand as the postgres superuser. See the deployment runbook.
//
// Each migration runs inside its own transaction. A failure rolls that file back
// and stops; earlier files stay applied.

import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'migrations');
const args = new Set(process.argv.slice(2));

const url = process.env.DATABASE_URL_OWNER;
if (!url) {
  console.error('DATABASE_URL_OWNER is not set.');
  console.error('Example: postgres://docsys_owner:PASSWORD@localhost:5432/docsys');
  process.exit(2);
}

const files = readdirSync(dir)
  .filter(f => f.endsWith('.sql') && f !== '0000_roles.sql')
  .sort();

const client = new pg.Client({ connectionString: url });
await client.connect();

// Defined by BUILD-PLAN.md section 2.9. Created here rather than in a migration
// because the runner needs it before the first migration runs.
await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migration (
    version     text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    checksum    text NOT NULL
  )`);

const { rows: done } = await client.query('SELECT version, checksum FROM schema_migration');
const applied = new Map(done.map(r => [r.version, r.checksum]));

// A cheap checksum so an edited-after-applying file is caught rather than ignored.
const sum = s => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
};

let changed = 0, drifted = [];
for (const f of files) {
  const sql = readFileSync(join(dir, f), 'utf8');
  const cs = sum(sql);

  if (applied.has(f)) {
    if (applied.get(f) !== cs) drifted.push(f);
    if (args.has('--status')) console.log(`  applied  ${f}${applied.get(f) !== cs ? '   *** EDITED SINCE APPLIED ***' : ''}`);
    continue;
  }

  if (args.has('--status') || args.has('--dry')) { console.log(`  pending  ${f}`); continue; }

  process.stdout.write(`  applying ${f} ... `);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migration (version, checksum) VALUES ($1, $2)', [f, cs]);
    await client.query('COMMIT');
    console.log('ok');
    changed++;
  } catch (err) {
    await client.query('ROLLBACK');
    console.log('FAILED');
    console.error(`\n${f} failed and was rolled back:\n${err.message}\n`);
    if (err.position) {
      const upto = sql.slice(0, +err.position);
      console.error(`  at line ${upto.split('\n').length}`);
    }
    await client.end();
    process.exit(1);
  }
}

if (drifted.length) {
  console.error('\nThese files changed after they were applied:');
  for (const f of drifted) console.error(`  ${f}`);
  console.error('Applied migrations are history. Write a new migration instead of editing one.');
}

if (!args.has('--status') && !args.has('--dry')) {
  console.log(changed ? `\n${changed} migration(s) applied.` : '\nNothing to apply, database is up to date.');
}
await client.end();
process.exit(drifted.length ? 1 : 0);
