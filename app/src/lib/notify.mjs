// Raising and reading notifications.
//
// The database side is migration 0400. This file is the part route handlers
// touch, and it exists mainly to keep three habits in one place:
//
//   1. Nothing here ever writes letter text into a notification. The raise
//      functions take ids. The read functions get the subject by joining to
//      document under row-level security, so the subject shown is the one the
//      reader is entitled to see at the moment they look, not a copy taken when
//      the letter moved. If they lose access, the line goes quiet by itself.
//
//   2. A push is sent after the transaction commits, never inside it. Both raise
//      functions return the browser endpoints to ring and also park them on the
//      request; the route calls deliver(req) once it has committed. Ringing
//      inside the transaction would mean a rolled-back send still buzzed
//      somebody's phone.
//
//   3. Nobody is notified of their own action. That is enforced in the SQL
//      function rather than here, so it holds for the nightly jobs too.

import { deliver as ringBrowsers } from './push.mjs';

/** Kurdish label and destination for each kind. The database stores neither. */
export const KINDS = {
  'step.arrived':       { text: 'کتابێکی نوێ گەیشتە ژوورەکەت',         icon: 'inbox',    sound: 'received' },
  'step.returned':      { text: 'کتابێک گەڕایەوە بۆ لات',              icon: 'outgoing', sound: 'received' },
  'step.recalled':      { text: 'کتابێک لە ژوورەکەت وەرگیرایەوە',      icon: 'outgoing', sound: 'click' },
  'step.completed':     { text: 'کتابێکی ناردووت تەواو بوو',           icon: 'inbox',    sound: 'received' },
  'step.due_soon':      { text: 'کاتی کتابێک لە نزیکەوە بەسەردەچێت',   icon: 'log',      sound: 'error' },
  'step.overdue':       { text: 'کتابێک لە کاتی خۆی دواکەوتووە',       icon: 'log',      sound: 'error' },
  'paper.received':     { text: 'پەڕگەی کاغەزی وەرگیرا',               icon: 'manifest', sound: 'scan' },
  'note.added':         { text: 'تێبینییەکی نوێ لەسەر کتابێک',         icon: 'templates',sound: 'click' },
  'manifest.incoming':  { text: 'لیستێکی گەیاندن بەرەو ژوورەکەت',      icon: 'manifest', sound: 'batch' },
  'manifest.received':  { text: 'لیستی گەیاندنەکەت وەرگیرا',           icon: 'manifest', sound: 'batch' },
  'leave.requested':    { text: 'داواکاری مۆڵەتێکی نوێ',               icon: 'leave',    sound: 'click' },
  'leave.decided':      { text: 'وەڵامی داواکاری مۆڵەتەکەت هات',       icon: 'leave',    sound: 'received' },
  'delegation.started': { text: 'لە ماوەی مۆڵەتی بەرپرسدا، کتابەکانی ژوورەکە بۆ تۆ دێن', icon: 'people', sound: 'received' },
  // A letter the room held was cancelled or closed. It vanished from the inbox
  // without a word before (letters test, 13 September). Migration 0490.
  'document.cancelled': { text: 'کتابێک لە ژوورەکەت هەڵوەشێنرایەوە',     icon: 'outgoing', sound: 'click' },
  'document.closed':    { text: 'کتابێک لە ژوورەکەت داخرا',               icon: 'outgoing', sound: 'click' },
  // The escalation ladder (migration 0520): the holder, then the head, then the mayor.
  'step.late_reminder':   { text: 'بیرخستنەوە: کتابێک لای تۆ دواکەوتووە',          icon: 'log',    sound: 'error' },
  'step.escalated_head':  { text: 'کتابێک لە ژوورەکەت چەند ڕۆژە دواکەوتووە',       icon: 'log',    sound: 'error' },
  'step.escalated_mayor': { text: 'کتابێک ئەوەندە دواکەوتووە کە گەیشتە لای سەرۆک', icon: 'log',    sound: 'error' },
  'report.weekly':        { text: 'ڕاپۆرتی هەفتانەی ژوورەکان ئامادەیە',            icon: 'report', sound: 'click' },
  'security.alert':       { text: 'ئاگادارییەکی ئەمنی لە تۆماری چالاکیدا',          icon: 'shield', sound: 'error' },
  'margin.written':       { text: 'هامشێکی دەستنووس لەسەر کتابێک نووسرا',          icon: 'pen',    sound: 'received' },
};

// What each security alert is about, for the bell and the alerts page.
export const ALERT_KINDS = {
  bulk_open:           'کەسێک لە کاتژمێرێکدا کتابێکی زۆری کردەوە',
  night_login:         'چوونەژوورەوە لە کاتی شەودا',
  it_letter:           'هەژماری IT هەوڵی کردنەوەی کتابێکی دا',
  refusals:            'هەوڵی دووبارەی کردنەوەی کتابی ڕێگەپێنەدراو',
  other_room_download: 'داگرتنی هاوپێچی کتابێک کە لە ژوورێکی ترە',
};

/**
 * The sentence for one notification. Most kinds say one thing; a leave decision
 * says which decision, which «وەڵامی داواکاری مۆڵەتەکەت هات» did not (records test).
 */
export function textFor(n) {
  if (n.kind === 'security.alert' && ALERT_KINDS[n.detail?.alert]) {
    return `ئاگاداری ئەمنی: ${ALERT_KINDS[n.detail.alert]}`;
  }
  if (n.kind === 'leave.decided') {
    return n.detail?.decision === 'approved' ? 'داواکاری مۆڵەتەکەت پەسەندکرا'
         : n.detail?.decision === 'rejected' ? 'داواکاری مۆڵەتەکەت ڕەتکرایەوە'
         : KINDS[n.kind].text;
  }
  return KINDS[n.kind]?.text ?? n.kind;
}

/** Where clicking one should take you. Ids only; the page re-checks access. */
export function linkFor(n) {
  if (n.kind === 'security.alert') return '/alerts';
  if (n.kind === 'report.weekly') return `/reports/weekly${n.detail?.week ? `?week=${encodeURIComponent(n.detail.week)}` : ''}`;
  if (n.document_id) return `/documents/${n.document_id}`;
  if (n.detail?.manifest_id) return `/manifests/${n.detail.manifest_id}`;
  if (n.kind.startsWith('leave.')) return '/leave';
  if (n.kind === 'delegation.started') return '/inbox';
  return '/notifications';
}

function park(req, rows) {
  const endpoints = rows.map(r => r.endpoint).filter(Boolean);
  if (req && endpoints.length) (req._pushQueue ??= []).push(...endpoints);
  return endpoints;
}

/**
 * Tell one person.
 *
 * @param {Function} q        the query function from withActor, inside the transaction
 * @param {object}   o
 * @param {number}   o.userId       who to tell
 * @param {string}   o.kind         one of KINDS
 * @param {number}   [o.documentId]
 * @param {number}   [o.roomId]
 * @param {number}   [o.actorId]    who caused it; they are never told
 * @param {object}   [o.detail]     ids and counts. Never letter text; the
 *                                  database CHECK refuses the usual mistakes.
 * @param {object}   [o.req]        to park the pushes on, for deliver() later
 */
export async function notifyUser(q, { userId, kind, documentId = null, roomId = null, actorId = null, detail = {}, req = null }) {
  if (!KINDS[kind]) throw new Error(`unknown notification kind "${kind}". Add it to KINDS and to the CHECK in migration 0400 in the same change.`);
  const { rows } = await q(
    `SELECT * FROM notify_user($1, $2, $3, $4, $5, $6::jsonb)`,
    [userId, kind, documentId, roomId, actorId, JSON.stringify(detail ?? {})]);
  return park(req, rows);
}

/** Tell a room: whoever sits in it, its head, and anyone covering it today. */
export async function notifyRoom(q, { roomId, kind, documentId = null, actorId = null, detail = {}, req = null }) {
  if (!KINDS[kind]) throw new Error(`unknown notification kind "${kind}". Add it to KINDS and to the CHECK in migration 0400 in the same change.`);
  const { rows } = await q(
    `SELECT * FROM notify_room($1, $2, $3, $4, $5::jsonb)`,
    [roomId, kind, documentId, actorId, JSON.stringify(detail ?? {})]);
  return park(req, rows);
}

/**
 * Ring the browsers parked during this request. Call after the transaction has
 * committed. Never throws: a push service being unreachable is not a reason for
 * a letter to fail to send.
 */
export async function deliver(req) {
  const queue = req?._pushQueue;
  if (!queue?.length) return 0;
  req._pushQueue = [];
  return ringBrowsers([...new Set(queue)]);
}

// --- reading ----------------------------------------------------------------

// The subject comes from the join, not from the notification. Row-level security
// decides whether that join returns anything, so a person who no longer has the
// letter sees the event without its subject rather than a stale copy of it.
const LIST_SQL = `
  SELECT n.id, n.kind, n.document_id, n.room_id, n.created_at, n.read_at, n.detail,
         d.incoming_no, d.subject, d.barcode,
         r.name  AS room_name,
         a.full_name AS actor_name
    FROM notification n
    LEFT JOIN document d ON d.id = n.document_id
    LEFT JOIN room     r ON r.id = n.room_id
    LEFT JOIN app_user a ON a.id = n.actor_id
   WHERE n.user_id = $1`;

/** The notification list, newest first. */
export async function list(q, userId, { limit = 50, unreadOnly = false } = {}) {
  const { rows } = await q(
    `${LIST_SQL} ${unreadOnly ? 'AND n.read_at IS NULL' : ''} ORDER BY n.id DESC LIMIT $2`,
    [userId, Math.min(Number(limit) || 50, 200)]);
  return rows;
}

/** Anything newer than a watermark. Used by the live stream and the fallback poll. */
export async function since(q, userId, afterId, { limit = 20 } = {}) {
  const { rows } = await q(
    `${LIST_SQL} AND n.id > $2 ORDER BY n.id DESC LIMIT $3`,
    [userId, Number(afterId) || 0, Math.min(Number(limit) || 20, 50)]);
  return rows;
}

/** Unread count and the highest id, which together are the whole badge. */
export async function summary(q, userId) {
  const { rows: [row] } = await q(
    `SELECT count(*) FILTER (WHERE read_at IS NULL)::int AS unread,
            coalesce(max(id), 0)::int                    AS latest
       FROM notification WHERE user_id = $1`, [userId]);
  return row ?? { unread: 0, latest: 0 };
}

/** Mark everything read. Returns how many changed. */
export async function markAllRead(q, userId) {
  const { rowCount } = await q(
    `UPDATE notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  return rowCount;
}

/** Mark one read. Silently does nothing for somebody else's row: the policy hides it. */
export async function markRead(q, userId, id) {
  const { rowCount } = await q(
    `UPDATE notification SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [Number(id) || 0, userId]);
  return rowCount;
}
