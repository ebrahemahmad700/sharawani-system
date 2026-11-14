// The timed jobs, reachable over HTTP, for hosts that have no process to run.
//
// On a municipal server src/jobs.mjs runs all night and this file is never used.
// On a serverless host there is nothing to keep running, so the platform's cron
// calls these paths instead. Both run the identical code from lib/jobs-core.mjs.
//
// Two deliberate exceptions to the rules the rest of the application follows:
//
//   1. These are GET requests that change state, which everywhere else in this
//      codebase is forbidden. Vercel Cron issues GET and offers no choice. The
//      secret below is what stands in for the CSRF token a POST would carry.
//
//   2. There is no signed-in user. The jobs run as nobody, on the jobs role,
//      exactly as the daemon does, and every log row they write has a null
//      user_id. That is why CRON_SECRET is required and why a request without it
//      is refused before the database is touched at all.
//
// If CRON_SECRET is not set, every request here is refused. There is no
// development shortcut: an unprotected endpoint that seals the tamper-evidence
// chain would let anyone on the internet decide what the log says happened.

import { Router } from 'express';
import pg from 'pg';
import { timingSafeEqual } from 'crypto';
import { runJob, JOB_NAMES } from '../lib/jobs-core.mjs';

const router = Router();

// A pool of its own, on the jobs role, made on first use. The web application's
// pools are on roles that are subject to row-level security; sealing the log has
// to see every row.
let pool = null;
function jobsPool() {
  const url = process.env.DATABASE_URL_JOBS || process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error('neither DATABASE_URL_JOBS nor DATABASE_URL_OWNER is set');
  if (!pool) pool = new pg.Pool({ connectionString: url, max: 1, application_name: 'docsys-cron' });
  return pool;
}

function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Vercel Cron sends the secret as a bearer token.
  const given = String(req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

router.get('/api/cron/:job', async (req, res) => {
  if (!authorised(req)) {
    // Deliberately says nothing about whether the job name exists, and nothing
    // about whether a secret is configured at all.
    return res.status(404).type('text/plain').send('not found\n');
  }

  const name = String(req.params.job);
  if (!JOB_NAMES.includes(name)) {
    return res.status(400).type('text/plain').send(`unknown job. known: ${JOB_NAMES.join(', ')}\n`);
  }

  try {
    const p = jobsPool();
    const { ok, lines } = await runJob((sql, params) => p.query(sql, params), name, console.log);
    // 500 on failure so the platform's cron dashboard shows it red rather than
    // reporting a cheerful 200 over a seal that did not verify.
    res.status(ok ? 200 : 500).type('text/plain').send(lines.join('\n') + '\n');
  } catch (err) {
    console.error(`[cron] ${name} could not run:`, err.message);
    res.status(500).type('text/plain').send(`could not run: ${err.message}\n`);
  }
});

export default router;
