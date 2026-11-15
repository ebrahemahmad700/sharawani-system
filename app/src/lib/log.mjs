// The activity log.
//
// One rule governs everything in this file: the log records WHAT HAPPENED, never
// WHAT THE LETTER SAID. Ids, numbers, room names, statuses, search terms. Never
// subject text, never a citizen's name copied out of a document, never file
// contents. This is what lets IT read the whole log for security work without
// being able to read the municipality's correspondence.
//
// The table is append-only at the database level. There is no update function
// here and there never will be, because the database would refuse it anyway.
//
// See BUILD-PLAN.md section 2.9 for the table and 2.13 for the action codes.

// The closed list. A typo in an action code would create a category nobody ever
// searches, so the code is checked against this set before the insert.
export const ACTIONS = new Set([
  // auth
  'auth.login', 'auth.login_failed', 'auth.login_throttled', 'auth.logout', 'auth.password_changed', 'auth.session_revoked',
  // documents
  'document.registered', 'document.updated', 'document.viewed', 'document.printed',
  'document.closed', 'document.cancelled', 'document.legacy_imported',
  // marked confidential or not, or the applicant's reply-by date set (migration 0600)
  'document.flags_changed',
  // a letter or an attachment asked for and not shown: not there, or not yours.
  // Watched by migration 0530, which tells the mayor when IT asks, or anyone asks
  // many times.
  'access.refused',
  // the whole case on one screen, and the two scans side by side
  'case.viewed', 'compare.viewed',
  // the handwritten instruction (migration 0550)
  'margin.written',
  // the arrival and dispatch marks drawn onto a scan (migration 0590)
  'stamp.applied',
  // the code and QR that prove a letter is genuine (migration 0540)
  'verify.issued', 'verify.hit', 'verify.miss', 'verify.throttled',
  // routing
  'step.sent', 'step.sequence_sent', 'step.activated', 'step.received', 'step.completed',
  'step.forwarded', 'step.returned', 'step.recalled', 'step.reassigned', 'step.skipped', 'step.cancelled',
  // the paper itself, which moves separately from the record of it (migration 0300)
  'step.paper_received',
  'manifest.created', 'manifest.received', 'manifest.cancelled', 'manifest.printed',
  'barcode.scanned', 'barcode.miss',
  // remarks that belong to the letter rather than to one hand-off (migration 0330)
  'note.added',
  // the company register (migration 0350)
  'company.created', 'company.updated', 'company.linked', 'company.unlinked',
  'company.file_added', 'company.file_withdrawn', 'company.viewed',
  // the transaction type catalogue (migration 0340)
  'doc_type.created', 'doc_type.updated',
  // the bell (migration 0400). Raising a notification is not logged separately:
  // the event that caused it already is, and a second row per recipient would
  // treble the log to say nothing new. What is logged is what the person did
  // about it, and which browsers they asked to be rung on.
  'notify.read_all', 'push.subscribed', 'push.removed',
  // the public tracking page, which is the only door with no password on it
  'track.hit', 'track.miss', 'track.throttled', 'receipt.printed',
  // attachments
  'attachment.added', 'attachment.viewed', 'attachment.downloaded', 'attachment.printed',
  'attachment.rejected_virus',
  // the drawing archive
  'archive.uploaded', 'archive.updated', 'archive.viewed', 'archive.downloaded', 'archive.verified',
  'archive.linked', 'archive.unlinked', 'archive.location_changed', 'archive.batch_opened', 'archive.batch_qc',
  // a file leaving its room's archive and coming back (migration 0600)
  'archive.lent', 'archive.returned',
  // a register downloaded as a spreadsheet: who took a copy of what, and how many rows
  'export.registry', 'export.outgoing', 'export.archive',
  // scan tray
  'tray.detected', 'tray.claimed', 'tray.archived',
  // network scanners (migration 0470). Scanning itself is logged as what it
  // produced: attachment.added or tray.detected, with source 'scanner'.
  'scanner.added', 'scanner.changed',
  // templates
  'template.created', 'template.updated', 'template.filled', 'template.printed', 'template.deactivated',
  // leave and delegation
  'leave.requested', 'leave.approved', 'leave.rejected', 'leave.cancelled',
  'delegation.started', 'delegation.ended', 'delegation.ended_early',
  // external sends
  'send.queued', 'send.sent', 'send.failed', 'send.response_linked',
  // administration
  'user.created', 'user.updated', 'user.password_reset', 'user.deactivated',
  'room.created', 'room.updated', 'directorate.updated',
  'route_template.created', 'route_template.updated',
  'system.locked', 'system.unlocked', 'system.setting_changed',
  // what the mayor watches (migrations 0520, 0530, 0560)
  'report.viewed', 'report.printed', 'alert.seen',
  'plot.located', 'plot.moved', 'map.viewed',
  // the assistant
  'assistant.question', 'assistant.tool_call', 'assistant.answer', 'assistant.no_rows',
  'assistant.error', 'assistant.fallback', 'assistant.search_archive',
  // operations
  'ops.backup_completed', 'ops.backup_failed', 'ops.backup_verified', 'ops.migration_applied',
  // search. Added beyond the original plan; see migration 0012.
  'search.documents', 'search.archive', 'search.rooms', 'search.people',
]);

// Keys that must never appear in a detail object, because they would copy letter
// contents into the log. Checked at runtime so a careless call site fails loudly
// in development instead of quietly leaking for a year.
const FORBIDDEN_DETAIL_KEYS = new Set([
  'subject', 'body', 'text', 'content', 'sender_name', 'recipient_name',
  'note', 'reply_note', 'opinion', 'file_content',
]);

/**
 * Write one log row. Call inside the same transaction as the thing being logged,
 * so that a rolled-back action leaves no log entry claiming it happened.
 *
 * @param {Function} q          the query function from withActor
 * @param {object}   e
 * @param {string}   e.action   one of ACTIONS
 * @param {object}   [e.detail] ids, counts, statuses. Never letter text.
 * @param {object}   [e.req]    the express request, for ip / session / user agent
 */
export async function logEvent(q, e) {
  if (!ACTIONS.has(e.action)) {
    throw new Error(`unknown log action "${e.action}". Add it to ACTIONS and to BUILD-PLAN.md section 2.13 in the same change.`);
  }
  const detail = e.detail ?? {};
  for (const k of Object.keys(detail)) {
    if (FORBIDDEN_DETAIL_KEYS.has(k)) {
      throw new Error(`log detail may not contain "${k}": the activity log records what happened, not what the letter said.`);
    }
  }

  await q(
    `INSERT INTO activity_log
       (user_id, room_id, document_id, archive_file_id, action, detail, ip_address, user_agent, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      e.userId ?? e.req?.user?.id ?? null,
      e.roomId ?? null,
      e.documentId ?? null,
      e.archiveFileId ?? null,
      e.action,
      JSON.stringify(detail),
      clientIp(e.req) ,
      e.req?.get?.('user-agent')?.slice(0, 500) ?? null,
      e.sessionId ?? e.req?.sessionId ?? null,
    ],
  );
}

/**
 * Log a search. Separate from logEvent because the shape is fixed and because
 * getting it wrong is the difference between being able to investigate a leak
 * and not. See migration 0012 for why searches are logged at all.
 *
 * @param {Function} q
 * @param {object}   s
 * @param {'documents'|'archive'|'rooms'|'people'} s.area
 * @param {string}   s.raw        exactly what the person typed
 * @param {string}   s.normalised the result of kuNormalize on it
 * @param {number}   s.hits       how many rows came back
 * @param {object}   [s.filters]  any filters applied alongside the text
 * @param {number}   [s.ms]       how long it took
 */
export async function logSearch(q, s) {
  // A blank search is a page load, not a search. Do not fill the log with them.
  if (!s.raw || s.raw.trim() === '') return;

  return logEvent(q, {
    action: `search.${s.area}`,
    req: s.req,
    userId: s.userId,
    roomId: s.roomId ?? null,
    detail: {
      q: s.normalised ?? null,
      raw: s.raw.slice(0, 200),
      hits: s.hits ?? 0,
      filters: s.filters ?? {},
      ms: s.ms ?? null,
    },
  });
}

export function clientIp(req) {
  if (!req) return null;
  // Behind nginx on the LAN. Trust the proxy header only because the only thing
  // in front of this server is our own nginx; see the deployment runbook.
  const fwd = req.get?.('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0] : req.ip || '').trim();
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;   // unwrap IPv4-mapped IPv6
}
