// Database access.
//
// The one rule this file exists to enforce: every query runs as a known person.
//
// Row-level security decides what a user may see, and it reads the actor from
// the `app.user_id` setting. That setting is applied here, inside the connection
// helper, so a route handler cannot obtain a connection without naming an actor.
// SET LOCAL is transaction-scoped, so it cannot leak from one request to the
// next through the pool, and it disappears on COMMIT or ROLLBACK.
//
// See BUILD-PLAN.md section 5.2.

import pg from 'pg';

// Numerics: return bigint columns as JS numbers. Safe here because every id in
// this schema is a serial that will not pass 2^53 in the lifetime of a municipality.
pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));
// Keep numeric/decimal as strings rather than lose precision silently.

const appPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL_APP,
  max: 10,
  idleTimeoutMillis: 30_000,
  application_name: 'docsys-web',
});

const readonlyPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL_READONLY,
  max: 4,
  idleTimeoutMillis: 30_000,
  application_name: 'docsys-assistant',
});

appPool.on('error', err => console.error('[db] idle client error:', err.message));
readonlyPool.on('error', err => console.error('[db] idle readonly client error:', err.message));

/**
 * Run a function inside one transaction, acting as a given user.
 *
 * @param {{id: number}|null} actor  the signed-in user, or null for the login path
 * @param {(q: (sql: string, params?: any[]) => Promise<any>) => Promise<T>} fn
 * @returns {Promise<T>}
 */
// Fuzzy search depends on this, and getting it from the environment turned out to
// be unreliable. 0000_roles.sql sets it on the database, which a managed provider
// refuses. Putting it on the connection string instead works on a direct
// connection and is rejected outright by a pooled one, which is how the live
// deployment failed: "unsupported startup parameter in options".
//
// So it is set per transaction, where nothing can refuse it. The cost is nothing:
// it rides along in the same round trip that sets the actor.
const SIMILARITY = process.env.PG_TRGM_THRESHOLD || '0.25';

/** One round trip that sets the trigram threshold and, when there is one, the actor. */
// "Today" in the database is Rania's today: leave that ends today, deadlines,
// the delegation in force. The database runs in UTC, where today starts three
// hours late. Transaction-local, like the actor.
const TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Baghdad';

function sessionSetup(actor) {
  const params = [TIME_ZONE];
  const calls = [`set_config('pg_trgm.similarity_threshold', '${SIMILARITY}', true)`, `set_config('TimeZone', $1, true)`];
  // Parameterised, so a forged id cannot become SQL. The threshold is a constant
  // in this file and never comes from a request.
  if (actor && actor.id) { params.push(String(actor.id)); calls.push(`set_config('app.user_id', $2, true)`); }
  return { sql: `SELECT ${calls.join(', ')}`, params };
}

export async function withActor(actor, fn) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    const setup = sessionSetup(actor);
    await client.query(setup.sql, setup.params);
    const q = (sql, params) => client.query(sql, params);
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The unauthenticated path: login, the health check, and nothing else.
 * Row-level security still applies, so these queries see only what the policies
 * allow with no actor set, which is deliberately almost nothing.
 */
export async function withoutActor(fn) {
  return withActor(null, fn);
}

/**
 * The assistant's connection. A separate role that is read-only at the database
 * level, cannot read password hashes, and has an eight second statement timeout.
 * It may INSERT only into the log and the conversation tables.
 */
export async function withReadonly(actor, fn) {
  const client = await readonlyPool.connect();
  try {
    // The role's default is default_transaction_read_only = on, which forbids
    // every write including the INSERTs the plan grants this role on the log and
    // the conversation tables (guard rail 6: every question and answer is logged
    // in the same transaction). The two settings contradict each other, so the
    // transaction is opened READ WRITE and the grants remain the real boundary:
    // this role holds SELECT everywhere, INSERT on exactly three tables, UPDATE
    // on one column, and nothing else. It cannot write a letter no matter what
    // the transaction mode says.
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ WRITE');
    const setup = sessionSetup(actor);
    await client.query(setup.sql, setup.params);
    const result = await fn((sql, params) => client.query(sql, params));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function healthy() {
  try {
    const r = await appPool.query('SELECT 1 AS ok');
    return r.rows[0].ok === 1;
  } catch {
    return false;
  }
}

export async function shutdown() {
  await Promise.allSettled([appPool.end(), readonlyPool.end()]);
}
