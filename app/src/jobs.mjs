// Timed jobs. Runs as a separate process from the web server, on the jobs role.
//
//   node src/jobs.mjs            run the scheduler (foreground; systemd keeps it up)
//   node src/jobs.mjs seal       run one job now and exit
//   node src/jobs.mjs verify
//   node src/jobs.mjs purge-sessions
//
// The jobs role bypasses row-level security and has only the grants the plan
// lists. No web request ever runs on it. Everything here writes an ops.* log
// row on failure so that a job that silently stopped running is visible on the
// dashboard rather than discovered a month later.
//
// The jobs themselves live in lib/jobs-core.mjs, because a serverless host has no
// process to keep running and calls them over HTTP instead. This file is the
// scheduler and nothing more.
//
// Deliberately not here: leave rollover. Delegations carry their own date range
// and the routing engine checks the dates at the moment a letter is sent, so
// there is nothing to roll over. The plan's 06:00 job became unnecessary once
// the delegation table held dates rather than a flag.

import pg from 'pg';
import { runJob, JOB_NAMES } from './lib/jobs-core.mjs';

const url = process.env.DATABASE_URL_JOBS;
if (!url) { console.error('DATABASE_URL_JOBS is not set'); process.exit(2); }
const pool = new pg.Pool({ connectionString: url, max: 2, application_name: 'docsys-jobs' });

const query = (sql, params) => pool.query(sql, params);

async function runOnce(name) {
  // tray-watch lives here rather than in jobs-core because it reads a folder, and
  // the serverless entry point that shares jobs-core has no folder to read.
  if (name === 'tray-watch') {
    try { await trayWatch(); return true; }
    catch (err) { console.error('[tray-watch] FAILED:', err.message); return false; }
  }
  const { ok, unknown, lines } = await runJob(query, name, console.log);
  if (unknown) { console.error(lines.join('\n')); process.exit(2); }
  return ok;
}

// A plain scheduler: check every minute whether anything is due. Times are in
// the server's local zone, which the runbook sets to Asia/Baghdad.
const SCHEDULE = [
  { name: 'seal',           when: d => d.getHours() === 23 && d.getMinutes() === 45 },
  { name: 'verify',         when: d => d.getHours() === 23 && d.getMinutes() === 50 },
  { name: 'invariants',     when: d => d.getHours() === 2  && d.getMinutes() === 0 },
  // Half past seven, so the warning is waiting when people sit down rather than
  // arriving in the middle of the night and being buried by morning.
  { name: 'deadlines',      when: d => d.getHours() === 7  && d.getMinutes() === 30 },
  { name: 'purge-sessions', when: d => d.getMinutes() === 15 },
  // Every two minutes, so a scan uploaded during a conversation at the counter
  // is searchable before the conversation is over.
  { name: 'ocr',            when: d => d.getMinutes() % 2 === 0 },
  { name: 'tray-watch',     when: () => true },                  // every minute
];

// --- the scan tray's watched folder -----------------------------------------
//
// The office scanner writes into TRAY_DIR and this puts what it finds into the
// tray, so nobody uploads anything: the paper is scanned and it appears on the
// screen. Unset TRAY_DIR and it does nothing, which is the right behaviour on a
// host with no durable disk, where the upload form on /tray is the way in.
//
// An imported file is moved into TRAY_DIR/imported rather than deleted. A
// scanner that writes a file twice is common; a job that deletes the only copy of
// a scanned letter because it misread something is not recoverable.

const TRAY_DIR = process.env.TRAY_DIR || null;
const TRAY_TYPES = { '%PDF': 'pdf', '\x89PNG': 'png', '\xff\xd8\xff': 'jpg', 'II*\0': 'tif', 'MM\0*': 'tif' };

async function trayWatch() {
  if (!TRAY_DIR) return;
  const { readdir, readFile, mkdir, rename, writeFile, stat } = await import('fs/promises');
  const { join, dirname, extname } = await import('path');
  const { createHash, randomUUID } = await import('crypto');

  const importedDir = join(TRAY_DIR, 'imported');
  await mkdir(importedDir, { recursive: true });

  let entries;
  try { entries = await readdir(TRAY_DIR, { withFileTypes: true }); }
  catch (err) { console.error(`[tray-watch] cannot read ${TRAY_DIR}: ${err.message}`); return; }

  const filesRoot = process.env.FILES_DIR || join(process.cwd(), 'files');
  let found = 0;

  for (const e of entries) {
    if (!e.isFile()) continue;
    const src = join(TRAY_DIR, e.name);

    // Skip anything still being written. A scanner that is halfway through a page
    // would otherwise be imported as a truncated file with a hash of nothing.
    const before = await stat(src);
    await new Promise(r => setTimeout(r, 400));
    const after = await stat(src);
    if (before.size !== after.size || after.size === 0) continue;

    const bytes = await readFile(src);
    const head = bytes.slice(0, 8).toString('latin1');
    const type = Object.entries(TRAY_TYPES).find(([sig]) => head.startsWith(sig))?.[1];
    if (!type) { console.error(`[tray-watch] ${e.name}: not a scan we accept, left alone`); continue; }

    const sha = createHash('sha256').update(bytes).digest('hex');
    const now = new Date();
    const rel = `files/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}.${type}`;
    const abs = join(filesRoot, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes, { flag: 'wx' });

    try {
      await pool.query(
        // The room is the scanner's, when the scanner has been named on the
        // scanners screen. Otherwise NULL, which is the registry's tray: the
        // building scanner stands at the counter (migration 0460).
        `INSERT INTO scan_tray_item (scanner_code, tray_path, original_name, size_bytes, sha256, room_id)
         VALUES ($1, $2, $3, $4, $5, (SELECT room_id FROM scanner WHERE code = $1 AND is_active))`,
        [process.env.TRAY_SCANNER_CODE || 'SCANNER', rel, e.name.slice(0, 255), bytes.length, sha]);
      await pool.query(
        `INSERT INTO activity_log (user_id, action, detail) VALUES (NULL, 'tray.detected', $1)`,
        [JSON.stringify({ source: 'folder', size_bytes: bytes.length, sha256: sha })]);
      await rename(src, join(importedDir, e.name));
      found++;
    } catch (err) {
      console.error(`[tray-watch] ${e.name}: ${err.message}`);
    }
  }
  if (found) console.log(`[tray-watch] took ${found} scan(s) into the tray`);
}

async function scheduler() {
  console.log('[jobs] scheduler running:', SCHEDULE.map(s => s.name).join(', '));
  let lastMinute = -1;
  setInterval(async () => {
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    if (minute === lastMinute) return;
    lastMinute = minute;
    for (const s of SCHEDULE) if (s.when(now)) await runOnce(s.name);
  }, 20_000);
}

const arg = process.argv[2];
if (arg) {
  const ok = await runOnce(arg);
  await pool.end();
  process.exit(ok ? 0 : 1);
} else {
  scheduler();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await pool.end(); process.exit(0); });
}

export { JOB_NAMES };
