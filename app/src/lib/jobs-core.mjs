// The timed jobs themselves, with no opinion about what starts them.
//
// Two things start them. On a server with its own hardware, src/jobs.mjs runs a
// long-lived process with a scheduler, which is the right shape: the process is
// there all night and systemd keeps it up. On a serverless host there is no
// process to keep up, so the platform's cron calls src/routes/cron.mjs over HTTP
// instead and that runs exactly the same code from here.
//
// Splitting them out is not tidiness. If the two entry points held two copies of
// the seal logic, the hash chain would eventually be computed two different ways
// and nobody would notice until a verification failed for no reason.
//
// Every job takes a query function and a `say` for its output, so the daemon can
// print to the console while the HTTP endpoint collects the same lines into a
// response body.

import { readFile } from 'fs/promises';
import { join } from 'path';
import { deliver as ringBrowsers } from './push.mjs';
import { readScan, canRead, isAvailable } from './ocr.mjs';
import { INVARIANTS, checkInvariants } from './invariants.mjs';

export const JOB_NAMES = ['seal', 'verify', 'invariants', 'purge-sessions', 'deadlines', 'ocr'];

/**
 * The bytes of a stored file, whichever backend holds them.
 *
 * Not lib/storage.mjs, deliberately: that module reads as a signed-in user
 * through the application pool, which is exactly right for a web request and
 * exactly wrong here. This runs on the jobs role, which bypasses row-level
 * security because its whole purpose is to read every scan in the building.
 */
async function storedBytes(query, relPath) {
  if ((process.env.FILE_STORAGE || 'disk').toLowerCase() === 'pg') {
    const { rows } = await query('SELECT bytes FROM file_blob WHERE stored_path = $1', [relPath]);
    if (!rows.length) throw new Error('no stored bytes');
    return rows[0].bytes;
  }
  const root = process.env.FILES_DIR || join(process.cwd(), 'files');
  return readFile(join(root, relPath));
}

export function makeJobs(query, say = console.log) {
  const err = say;
  const log = (action, detail) =>
    query(`INSERT INTO activity_log (user_id, action, detail) VALUES (NULL, $1, $2)`, [action, JSON.stringify(detail)])
      .catch(e => err(`[jobs] could not write log row: ${e.message}`));

  return {
    // Nightly, after the backup. Seals the day's log rows into the tamper-evidence chain.
    async seal() {
      const { rows: [r] } = await query(`SELECT * FROM seal_log()`);
      if (!r || r.id === null) { say('[seal] nothing new to seal'); return; }
      say(`[seal] sealed log rows ${r.from_log_id}..${r.to_log_id} (${r.row_count} rows) as seal ${r.id}`);
      say(`[seal] hash for the weekly printout: ${Buffer.from(r.seal_hash).toString('hex')}`);
    },

    // Nightly, after seal. Recomputes every seal from live content.
    async verify() {
      const { rows } = await query(`SELECT * FROM verify_log()`);
      const bad = rows.filter(r => !r.ok);
      if (bad.length === 0) { say(`[verify] ${rows.length} seal(s) verified, log intact`); return; }
      for (const b of bad) err(`[verify] SEAL ${b.seal_id} FAILED: ${b.note} (rows ${b.from_log_id}..${b.to_log_id})`);
      await log('ops.backup_failed', { job: 'verify_log', failed_seals: bad.map(b => ({ seal: b.seal_id, note: b.note })) });
      throw new Error(`${bad.length} seal(s) failed verification`);
    },

    // Hourly. The only DELETE the system performs, and only on sessions long expired.
    async 'purge-sessions'() {
      const { rowCount } = await query(`DELETE FROM user_session WHERE expires_at < now() - interval '30 days'`);
      say(`[purge-sessions] removed ${rowCount} session row(s) expired more than 30 days ago`);
    },

    // Nightly. The invariants the state machine promises; a violation means a bug.
    //
    // The list itself is in lib/invariants.mjs, because the restore rehearsal
    // asks a database rebuilt from a backup the same questions. A backup that
    // restores but restores something incoherent is worse than one that fails
    // loudly, and the only way to tell them apart is to ask.
    async invariants() {
      const failures = await checkInvariants(query);
      if (failures.length === 0) { say(`[invariants] ${INVARIANTS.length} invariant(s) hold`); return; }
      for (const f of failures) err(`[invariants] VIOLATED: ${f.name} (${f.count})`);
      await log('ops.backup_failed', { job: 'invariants', failures });
      throw new Error(`${failures.length} invariant(s) violated`);
    },

    // Every few minutes. Reads the words out of scans that have not been read
    // yet, so that a letter can be found by what is printed inside it.
    //
    // Here rather than at upload time on purpose. Reading a page takes seconds,
    // a feeder pass is a dozen pages, and a clerk pressing upload should not
    // wait for any of it. An attachment exists the moment it is stored; its text
    // arrives a minute later, or never, and nothing else depends on it.
    async ocr() {
      const have = await isAvailable();
      if (!have.ok) {
        say('[ocr] no reader on this host; scans stay labelled as not read');
        return;
      }

      const batch = Number(process.env.OCR_BATCH || 20);
      const { rows } = await query(
        `SELECT id, stored_path, mime_type, size_bytes FROM attachment_unread LIMIT $1`, [batch]);
      if (rows.length === 0) { say('[ocr] nothing new to read'); return; }

      let read = 0, skipped = 0, failed = 0;
      for (const a of rows) {
        let result;
        if (!canRead(a.mime_type)) {
          result = { status: 'unsupported', text: null, pages: 0, chars: 0,
                     confidence: null, engine: null, ms: 0 };
          skipped++;
        } else {
          let bytes = null;
          try { bytes = await storedBytes(query, a.stored_path); }
          catch (e) { err(`[ocr] could not read ${a.stored_path}: ${e.message}`); }

          if (!bytes) {
            result = { status: 'failed', text: null, pages: 0, chars: 0,
                       confidence: null, engine: null, ms: 0 };
            failed++;
          } else {
            result = await readScan(bytes, a.mime_type);
            if (result.status === 'failed') failed++; else read++;
          }
        }

        // ON CONFLICT, because two readers running at once on a large backlog
        // must not turn into a primary key violation that stops the batch.
        await query(
          `INSERT INTO attachment_text
             (attachment_id, status, text, pages, chars, confidence, engine, ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (attachment_id) DO UPDATE
             SET status = excluded.status, text = excluded.text, pages = excluded.pages,
                 chars = excluded.chars, confidence = excluded.confidence,
                 engine = excluded.engine, ms = excluded.ms, read_at = now()`,
          [a.id, result.status, result.text, result.pages, result.chars,
           result.confidence, result.engine, result.ms]);
      }

      say(`[ocr] ${read} read, ${skipped} not a readable kind, ${failed} failed, of ${rows.length}`);
    },

    // Each morning. Tells a room its deadline is tomorrow, and tells it again
    // once when the deadline has gone.
    //
    // Exactly once each, ever. The dedupe is a NOT EXISTS against the
    // notifications already raised for that step, not a "since yesterday" window,
    // because a job that is run twice by hand after a power cut must not send the
    // building the same warning twice. A bell that cries wolf is worse than no
    // bell: people turn it off, and then they miss the one that mattered.
    async deadlines() {
      const kinds = [
        ['step.due_soon', `s.due_at >= now() AND s.due_at < now() + interval '1 day'`],
        ['step.overdue',  `s.due_at < now()`],
      ];
      let total = 0;
      for (const [kind, when] of kinds) {
        const { rows } = await query(`
          SELECT s.id, s.document_id, s.to_room_id
            FROM routing_step s
            JOIN document d ON d.id = s.document_id
           WHERE s.status = 'active'
             AND s.due_at IS NOT NULL
             AND d.status NOT IN ('closed', 'cancelled')
             AND ${when}
             AND NOT EXISTS (
                   SELECT 1 FROM notification n
                    WHERE n.kind = $1
                      AND n.document_id = s.document_id
                      AND n.detail ->> 'step_id' = s.id::text)
           ORDER BY s.due_at`, [kind]);

        const ring = new Set();
        for (const r of rows) {
          // No actor: nobody did this, a date passed. notify_room takes null and
          // therefore excludes nobody, which is right, because the whole room
          // should hear including whoever last touched the letter.
          const { rows: told } = await query(
            `SELECT endpoint FROM notify_room($1, $2, $3, NULL, $4::jsonb)`,
            [r.to_room_id, kind, r.document_id, JSON.stringify({ step_id: r.id })]);
          for (const t of told) if (t.endpoint) ring.add(t.endpoint);
        }

        // Half past seven is precisely the hour when nobody has the system open,
        // so the doorbell matters more here than anywhere else in the
        // application. The bookkeeping is handed this job's own connection,
        // because this process has no application pool.
        if (ring.size) {
          const rung = await ringBrowsers([...ring], {
            touch: (e, ok) => query(`SELECT push_touch($1, $2)`, [e, ok]),
            forget: e => query(`SELECT push_forget($1)`, [e]),
          });
          say(`[deadlines] rang ${rung} of ${ring.size} browser(s)`);
        }
        if (rows.length) say(`[deadlines] ${rows.length} ${kind}`);
        total += rows.length;
      }
      if (total === 0) say('[deadlines] nothing due or overdue that has not already been mentioned');

      // The escalation ladder (migration 0520). Lateness climbs: the person
      // holding the letter, then the head of the room, then the mayor and the
      // deputy. late_step says which rung each step has reached; each rung is
      // announced once per step, by the same NOT EXISTS as above. A job that did
      // not run for a week announces every rung passed in that week, once each.
      const ladder = new Set();
      const { rows: bosses } = await query(
        `SELECT id FROM app_user WHERE is_active AND role IN ('mayor', 'deputy_mayor')`);
      const RUNGS = [[1, 'step.late_reminder'], [2, 'step.escalated_head'], [3, 'step.escalated_mayor']];
      for (const [rung, kind] of RUNGS) {
        const { rows } = await query(`
          SELECT l.step_id, l.document_id, l.to_room_id, l.assigned_to, r.head_user_id,
                 floor(l.days_late)::int AS days_late
            FROM late_step l
            JOIN room r ON r.id = l.to_room_id
           WHERE l.rung >= $1
             AND NOT EXISTS (
                   SELECT 1 FROM notification n
                    WHERE n.kind = $2
                      AND n.document_id = l.document_id
                      AND n.detail ->> 'step_id' = l.step_id::text)
           ORDER BY l.due_at`, [rung, kind]);

        for (const r of rows) {
          const detail = JSON.stringify({ step_id: r.step_id, rung, days_late: r.days_late });
          const tell = userId => query(
            `SELECT endpoint FROM notify_user($1, $2, $3, $4, NULL, $5::jsonb)`,
            [userId, kind, r.document_id, r.to_room_id, detail]);
          let told = [];
          if (rung === 1) {
            // Whoever the step is with; the room when nobody is named on it.
            told = r.assigned_to
              ? (await tell(r.assigned_to)).rows
              : (await query(`SELECT endpoint FROM notify_room($1, $2, $3, NULL, $4::jsonb)`,
                             [r.to_room_id, kind, r.document_id, detail])).rows;
          } else if (rung === 2) {
            if (r.head_user_id) told = (await tell(r.head_user_id)).rows;
          } else {
            for (const b of bosses) told.push(...(await tell(b.id)).rows);
          }
          for (const t of told) if (t.endpoint) ladder.add(t.endpoint);
        }
        if (rows.length) say(`[deadlines] ladder rung ${rung}: ${rows.length} ${kind}`);
      }

      // Saturday morning: the week that ended yesterday is ready to read. Once per
      // person per week, whoever ran the job and however often.
      const { rows: [today] } = await query(`
        SELECT extract(dow FROM (now() AT TIME ZONE 'Asia/Baghdad'))::int AS dow,
               to_char((now() AT TIME ZONE 'Asia/Baghdad')::date - 7, 'YYYY-MM-DD') AS last_week`);
      if (today.dow === 6) {
        const { rows: readers } = await query(`
          SELECT u.id FROM app_user u
           WHERE u.is_active AND u.role IN ('mayor', 'deputy_mayor', 'directorate_head', 'room_head')
             AND NOT EXISTS (SELECT 1 FROM notification n
                              WHERE n.user_id = u.id AND n.kind = 'report.weekly'
                                AND n.detail ->> 'week' = $1)`, [today.last_week]);
        for (const u of readers) {
          const { rows: told } = await query(
            `SELECT endpoint FROM notify_user($1, 'report.weekly', NULL, NULL, NULL, $2::jsonb)`,
            [u.id, JSON.stringify({ week: today.last_week })]);
          for (const t of told) if (t.endpoint) ladder.add(t.endpoint);
        }
        if (readers.length) say(`[deadlines] weekly report announced to ${readers.length} reader(s)`);
      }

      if (ladder.size) {
        const rung = await ringBrowsers([...ladder], {
          touch: (e, ok) => query(`SELECT push_touch($1, $2)`, [e, ok]),
          forget: e => query(`SELECT push_forget($1)`, [e]),
        });
        say(`[deadlines] ladder rang ${rung} of ${ladder.size} browser(s)`);
      }
    },
  };
}

/**
 * Run one job by name. Never throws: returns whether it succeeded, plus the lines
 * it produced, so an HTTP caller can report the outcome and a daemon can print it.
 */
export async function runJob(query, name, say) {
  const lines = [];
  const collect = line => { lines.push(String(line)); if (say) say(line); };
  const jobs = makeJobs(query, collect);
  if (!jobs[name]) return { ok: false, unknown: true, lines: [`unknown job "${name}". Known: ${JOB_NAMES.join(', ')}`] };

  const started = Date.now();
  try {
    await jobs[name]();
    collect(`[${name}] done in ${Date.now() - started} ms`);
    return { ok: true, lines };
  } catch (e) {
    collect(`[${name}] FAILED: ${e.message}`);
    return { ok: false, lines };
  }
}
