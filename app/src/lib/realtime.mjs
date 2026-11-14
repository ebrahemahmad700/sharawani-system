// Knowing the instant something lands, without asking.
//
// The event-stream route holds a connection open per signed-in browser and has
// to decide how often to look. Two answers, and this file picks whichever is
// available:
//
//   listen   One dedicated connection runs LISTEN docsys_notify. The trigger in
//            migration 0400 fires pg_notify on every new row, so a waiting
//            request wakes within milliseconds and the database is queried once,
//            for the person it actually concerns.
//
//   poll     No LISTEN. Each waiting request sleeps a couple of seconds and asks
//            again. Two seconds is still "instant" to somebody sitting at a
//            desk, and it is the only thing that works on hosting where nothing
//            stays open between requests.
//
// Poll is not a degraded mode to be ashamed of, it is the correct mode for
// serverless and for a pooled connection at a managed provider — pgbouncer in
// transaction mode does not carry LISTEN, and a connection that silently never
// delivers is far worse than a timer. So this detects rather than assumes, and
// falls back permanently the moment LISTEN misbehaves.

import pg from 'pg';

const SERVERLESS = Boolean(process.env.VERCEL || process.env.SERVERLESS);
const DISABLED   = process.env.PG_NO_LISTEN === '1';
const URL_APP    = process.env.DATABASE_URL_APP || '';

// A managed provider's pooled endpoint. Neon spells it "-pooler"; both of the
// others spell it "pgbouncer". LISTEN on any of them connects, accepts the
// command and then delivers nothing at all, which is the one failure this file
// exists to avoid.
const POOLED = /-pooler\.|pgbouncer/i.test(URL_APP);

const waiters = new Map();     // user id (string) -> Set<() => void>
let client = null;
let mode = (SERVERLESS || DISABLED || POOLED || !URL_APP) ? 'poll' : 'listen';
let connecting = null;
let backoff = 1000;

/** Which of the two arrangements is in use. Shown on the notifications screen. */
export const currentMode = () => mode;

function wake(userId) {
  const set = waiters.get(String(userId));
  if (!set) return;
  for (const resolve of [...set]) resolve();
}

async function ensureListening() {
  if (mode !== 'listen' || client) return;
  if (connecting) return connecting;

  connecting = (async () => {
    const c = new pg.Client({ connectionString: URL_APP, application_name: 'docsys-listen' });
    c.on('notification', msg => { if (msg.channel === 'docsys_notify') wake(msg.payload); });
    c.on('error', err => {
      console.error('[realtime] listen connection lost:', err.message);
      client = null;
      // Everyone waiting is woken rather than left hanging: they re-query, find
      // whatever arrived while the connection was down, and wait again. Losing
      // the connection must not lose a notification.
      for (const set of waiters.values()) for (const r of [...set]) r();
      setTimeout(() => { ensureListening().catch(() => {}); }, backoff).unref?.();
      backoff = Math.min(backoff * 2, 30_000);
    });
    await c.connect();
    await c.query('LISTEN docsys_notify');
    client = c;
    backoff = 1000;
    console.log('[realtime] listening on docsys_notify');
  })().catch(err => {
    // Refused outright: no permission, a pooler that rejects it, an old server.
    // Fall back for good rather than retrying something that cannot work.
    console.error('[realtime] LISTEN unavailable, falling back to polling:', err.message);
    mode = 'poll';
    client = null;
  }).finally(() => { connecting = null; });

  return connecting;
}

/**
 * Wait until this user probably has something new, or until the slice is up.
 *
 * Returns quickly and often on purpose. The caller re-queries on every return,
 * so a spurious wake costs one small indexed query and a missed wake costs
 * nothing worse than the next slice.
 *
 * @param {number|string} userId
 * @param {number} maxMs  the longest this should block
 */
export function waitForChange(userId, maxMs) {
  // In poll mode the slice is short, because the timer is the only signal there
  // is. In listen mode it is long but not unbounded: a periodic re-query is what
  // covers a notification raised while the listen connection was reconnecting.
  const slice = mode === 'listen' ? Math.min(maxMs, 15_000) : Math.min(maxMs, 2_500);

  if (mode === 'listen') ensureListening().catch(() => {});

  return new Promise(resolve => {
    const key = String(userId);
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const set = waiters.get(key);
      if (set) { set.delete(finish); if (!set.size) waiters.delete(key); }
      resolve();
    };

    const timer = setTimeout(finish, slice);
    timer.unref?.();

    if (!waiters.has(key)) waiters.set(key, new Set());
    waiters.get(key).add(finish);
  });
}

/** Close the dedicated connection. Called from the server's shutdown path. */
export async function stop() {
  const c = client;
  client = null;
  if (c) await c.end().catch(() => {});
}
