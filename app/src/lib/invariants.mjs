// The invariants the state machine promises.
//
// One definition, two callers, for the same reason the seal logic lives in one
// place: the nightly job checks these against the live database, and the restore
// rehearsal checks the very same list against a database rebuilt from a backup.
// Two copies would drift, and the day they drifted nobody would notice, because
// both would still be printing "invariants hold".
//
// Each is a query returning one count. Zero means the invariant holds. Written
// as a count rather than as EXISTS so that a violation says how bad it is: one
// document in a strange state is a bug to chase, four hundred is a restore that
// went wrong.
//
// These are deliberately about SHAPE, not about content. They are the statements
// that must be true of any healthy copy of this database, which is exactly what
// makes them the right questions to ask of a backup.

export const INVARIANTS = [
  {
    name: 'a document in flow has exactly one active step',
    sql: `SELECT count(*) FROM document d WHERE d.status = 'in_flow'
            AND (SELECT count(*) FROM routing_step s WHERE s.document_id = d.id AND s.status = 'active') <> 1`,
  },
  {
    name: 'no closed or cancelled document has an open step',
    sql: `SELECT count(*) FROM routing_step s JOIN document d ON d.id = s.document_id
           WHERE d.status IN ('closed', 'cancelled') AND s.status IN ('active', 'waiting')`,
  },
  {
    name: 'every document number is unique within its year',
    sql: `SELECT count(*) - count(DISTINCT (incoming_year, incoming_seq)) AS count FROM document`,
  },
  {
    name: 'no room has its head as its own deputy',
    sql: `SELECT count(*) FROM room WHERE deputy_user_id IS NOT NULL AND deputy_user_id = head_user_id`,
  },
  {
    // Not about letters, and here anyway, because this is the list that runs
    // every night and the thing it guards against is invisible until the day it
    // is catastrophic.
    //
    // A function whose search path is not pinned cannot be restored from a
    // backup: pg_dump sets search_path to nothing, and an unqualified call
    // inside a function body then resolves to nothing. Everything works
    // perfectly right up until somebody needs the backup. Migration 0430 has the
    // long version and the error it produced.
    //
    // So a function added next year without the setting is reported the next
    // morning rather than on the worst day. Extension-owned functions are not
    // ours and are skipped.
    name: 'every function pins its search path, or the database cannot be restored',
    sql: `SELECT count(*) FROM pg_proc p
            JOIN pg_namespace ns ON ns.oid = p.pronamespace
           WHERE ns.nspname = 'public' AND p.prokind IN ('f', 'p')
             AND p.proconfig IS NULL
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
  },
];

/**
 * Run the whole list and return only what failed.
 *
 * Takes a query function rather than a connection, so the nightly job can pass
 * the pool it already has and anything else can pass its own. An empty array
 * means every invariant holds.
 */
export async function checkInvariants(query) {
  const failures = [];
  for (const { name, sql } of INVARIANTS) {
    const { rows: [{ count }] } = await query(sql);
    if (Number(count) !== 0) failures.push({ name, count: Number(count) });
  }
  return failures;
}
