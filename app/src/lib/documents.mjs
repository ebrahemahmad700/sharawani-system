// Registering letters in and out, and searching for them.
//
// The number is the thing that matters here. An auditor compares the system's
// numbers against the paper register, and a gap or a repeat is what they look
// for. So numbers are issued inside the same transaction that writes the row,
// never before it, and never reused.

import { logEvent, logSearch } from './log.mjs';
import { ensureVerifyCode } from './verify.mjs';
import { notifyRoom } from './notify.mjs';
import { kuNormalize, plotKey, parseNumber, unifyDigits, foldDigits } from './ku.mjs';

class DocumentError extends Error {
  constructor(message, code) { super(message); this.code = code; this.expected = true; }
}
const fail = (code, message) => { throw new DocumentError(message, code); };

/**
 * Register an incoming letter. This is the front door: every letter that enters
 * the building passes through here and gets a number.
 *
 * The number is issued by the database function, which holds a row lock until
 * this transaction commits. Two clerks pressing save at the same instant get
 * consecutive numbers, never the same one.
 */
export async function registerIncoming(q, {
  subject, docType, senderKind, senderName, senderContact = null,
  priority = 'normal', plotNo = null, neighbourhood = null,
  physicalShelf = null, physicalFolder = null, physicalSection = null,
  incomingDate = null, docTypeOptionId = null, companyId = null,
  relatedDocumentId = null, originRoomId = undefined, byUser, req,
  isConfidential = false, replyBy = null,
}) {
  if (!subject || !String(subject).trim()) fail('subject_required', 'بابەت پێویستە.');
  if (!senderName || !String(senderName).trim()) fail('sender_required', 'ناوی نێردەر پێویستە.');

  // The clerk picks a catalogue row; the enum the rules are written against comes
  // from that row rather than from the form. So a new transaction type invented
  // by the office on Tuesday still lands in one of the nine classes the system
  // reasons about, and cannot be made to land outside them.
  if (docTypeOptionId) {
    const { rows } = await q(
      `SELECT base_kind FROM doc_type_option WHERE id = $1 AND is_active`, [docTypeOptionId]);
    if (!rows[0]) fail('bad_doc_type', 'ئەم جۆرەی مامەڵە بوونی نییە یان ناچالاکە.');
    docType = rows[0].base_kind;
  }

  // Identifiers are stored in one kind of digit. A plot typed half on the number
  // row of a Kurdish keyboard and half on the keypad arrives as "2٤0/4", and was
  // stored and shown exactly like that. plot_key already matched either way; the
  // screen did not. Names and subjects are left exactly as typed.
  const digits = v => (v == null || v === '' ? null : unifyDigits(String(v)).trim() || null);
  plotNo = digits(plotNo);
  physicalShelf = digits(physicalShelf);
  physicalFolder = digits(physicalFolder);
  physicalSection = digits(physicalSection);
  senderContact = digits(senderContact);

  // The room the letter is started in: the person's own (migration 0450). The
  // database refuses any other, so passing a different one here would only turn
  // a registration into an error.
  const origin = originRoomId === undefined ? (byUser.roomId ?? null) : originRoomId;

  // Migration 0600: the front desk and the mayor's office may mark a letter
  // confidential and write down the date the applicant was promised an answer.
  // Anyone else registering simply does not get the two fields; the form does not
  // offer them and nothing sent is used.
  const deskRole = ['registry_clerk', 'mayor', 'deputy_mayor'].includes(byUser.role);
  isConfidential = deskRole && Boolean(isConfidential);
  replyBy = deskRole ? parseReplyBy(replyBy) : null;
  if (replyBy) {
    const { rows: [ok] } = await q(`SELECT $1::date >= coalesce($2::date, current_date) AS ok`, [replyBy, incomingDate]);
    if (!ok.ok) fail('bad_reply_by', 'بەرواری وەڵامدانەوە نابێت پێش بەرواری هاتن بێت.');
  }

  const year = incomingDate ? new Date(incomingDate).getFullYear() : new Date().getFullYear();

  const { rows: [{ seq }] } = await q(`SELECT issue_number('incoming', $1) AS seq`, [year]);
  const { rows: [{ no }] } = await q(`SELECT format_doc_number('incoming', $1, $2) AS no`, [year, seq]);

  const { rows: [doc] } = await q(
    `INSERT INTO document
       (incoming_seq, incoming_year, incoming_no, incoming_date, incoming_registered_by,
        subject, doc_type, sender_kind, sender_name, sender_contact, priority, status,
        plot_no, neighbourhood, physical_shelf, physical_folder, physical_section,
        doc_type_option_id, origin_room_id, is_confidential, reply_by)
     VALUES ($1, $2, $3, coalesce($4::date, current_date), $5,
             $6, $7, $8, $9, $10, $11, 'registered',
             $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING *`,
    [seq, year, no, incomingDate, byUser.id,
     String(subject).trim(), docType, senderKind, String(senderName).trim(), senderContact, priority,
     plotNo, neighbourhood, physicalShelf, physicalFolder, physicalSection, docTypeOptionId, origin,
     isConfidential, replyBy]);

  // The applicant's receipt needs a PIN, and issuing it here rather than at print
  // time means the number exists from the moment the letter does. Reprinting does
  // not change it, so a receipt handed over today is still valid next month.
  await q(`SELECT issue_track_pin($1)`, [doc.id]);

  if (companyId) {
    await q(`INSERT INTO company_document (company_id, document_id, linked_by)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [companyId, doc.id, byUser.id]);
  }

  // The letter this one follows on from, when the clerk said so at the counter.
  //
  // Set after the insert rather than in it, because the target has to be a letter
  // this person can actually see. Without that check the field would answer a
  // question nobody may ask: point a new registration at any id and the earlier
  // number comes back on the screen. So it is looked up under row-level security
  // first, and silently left null if it is not theirs to link to.
  if (relatedDocumentId) {
    const { rows: [ok] } = await q(
      `SELECT id FROM document WHERE id = $1 AND id <> $2`, [relatedDocumentId, doc.id]);
    if (ok) {
      await q(`UPDATE document SET related_document_id = $2 WHERE id = $1`, [doc.id, ok.id]);
      doc.related_document_id = ok.id;
    }
  }

  await logEvent(q, {
    action: 'document.registered', req, userId: byUser.id, documentId: doc.id, roomId: byUser.roomId,
    detail: {
      incoming_no: no, year, seq, doc_type: docType, priority,
      related_document_id: doc.related_document_id ?? null,
    },
  });

  return doc;
}

/**
 * Letters already on file that look like the one being registered.
 *
 * Citizens re-submit. They come back a month later with the same request because
 * nobody told them it was already moving, or because the first copy was mislaid,
 * or because somebody advised them to try again. Today each attempt gets its own
 * number and its own file, the two drift apart, and two rooms end up answering
 * the same question differently.
 *
 * This is a warning and never a refusal. Two genuinely different letters about
 * the same plot from the same person in the same week are completely ordinary,
 * and a system that refused them would be wrong and would be worked around
 * within a day. The clerk sees what it found and decides.
 *
 * THE RULES, WEAKEST TO STRONGEST
 *
 *   the same plot, from anybody              worth showing, plots are the unit
 *   a similar subject from a similar sender  the actual duplicate
 *   the same plot AND a similar subject      almost certainly the same request
 *
 * Similarity is trigram word-similarity over the normalised columns the search
 * already uses, so ڕەنووس and رەنوس match, and so do the Arabic-keyboard
 * spellings people type. Cancelled letters are excluded: a cancelled number is
 * kept for the auditor, not offered as a duplicate.
 */
export async function findSimilar(q, {
  subject = null, senderName = null, plotNo = null, withinMonths = 18, limit = 6,
}) {
  const key = plotKey(plotNo);
  let subjectNorm = subject ? kuNormalize(subject) : null;
  let senderNorm = senderName ? kuNormalize(senderName) : null;

  // A subject too short to be distinctive is not used to match on.
  //
  // "وەڵام" is a subject. So is "داواکاری". Matched by similarity they are every
  // letter in the building, and a panel that fires on every registration is a
  // panel the office learns to click past without reading, which is worse than
  // not having one. Twelve characters after normalising is about three Kurdish
  // words, which is where a subject starts saying something.
  //
  // The plot number needs no such rule: it is exact, and two letters about the
  // same plot are worth a glance however they are worded.
  if (subjectNorm && subjectNorm.length < 12) subjectNorm = null;
  if (senderNorm && senderNorm.length < 4) senderNorm = null;

  if (!key && !subjectNorm) return [];

  const { rows } = await q(`
    SELECT d.id, d.incoming_no, d.incoming_date, d.subject, d.sender_name, d.status,
           d.plot_no, d.outgoing_no, r.name AS room_name,
           (d.plot_key IS NOT NULL AND d.plot_key = $1)                        AS same_plot,
           ($2::text IS NOT NULL AND $2 <% d.subject_search)                   AS like_subject,
           ($3::text IS NOT NULL AND $3 <% d.sender_search)                    AS like_sender
      FROM document d
      LEFT JOIN room r ON r.id = d.current_room_id
     WHERE d.status <> 'cancelled'
       AND d.incoming_date > current_date - ($4 || ' months')::interval
       AND (
             (d.plot_key IS NOT NULL AND d.plot_key = $1)
             OR ($2::text IS NOT NULL AND $3::text IS NOT NULL
                 AND $2 <% d.subject_search AND $3 <% d.sender_search)
           )
     ORDER BY d.incoming_date DESC, d.id DESC
     LIMIT $5`, [key, subjectNorm, senderNorm, String(withinMonths), limit]);

  // Ranked here rather than in SQL, because the ordering is a judgement about
  // what a clerk should look at first and is easier to read and change here.
  const score = d => (d.same_plot ? 2 : 0) + (d.like_subject ? 2 : 0) + (d.like_sender ? 1 : 0);
  return rows
    .map(d => ({ ...d, score: score(d) }))
    .sort((a, b) => b.score - a.score || new Date(b.incoming_date) - new Date(a.incoming_date));
}

/**
 * Register the outgoing number and close the file. This is the last thing that
 * happens to a letter, and it is what the registry does, not the room that did
 * the work.
 */
export async function registerOutgoingAndClose(q, {
  documentId, recipient, summary, channel = 'hand', outgoingDate = null, byUser, req,
}) {
  if (!recipient || !String(recipient).trim()) fail('recipient_required', 'وەرگر پێویستە.');

  const { rows: [doc] } = await q(`SELECT * FROM document WHERE id = $1 FOR UPDATE`, [documentId]);
  if (!doc) fail('not_found', 'ئەم کتابە نەدۆزرایەوە.');
  if (doc.outgoing_no) fail('already_out', 'ئەم کتابە پێشتر ژمارەی دەرچووی پێدراوە.');
  if (doc.status === 'cancelled') fail('cancelled', 'ئەم کتابە هەڵوەشێنراوەتەوە.');
  if (!['ready_to_close', 'in_flow', 'registered'].includes(doc.status)) {
    fail('bad_status', 'ئەم کتابە لە دۆخێکدا نییە کە بتوانرێت بخرێتەوە.');
  }

  const year = outgoingDate ? new Date(outgoingDate).getFullYear() : new Date().getFullYear();
  const { rows: [{ seq }] } = await q(`SELECT issue_number('outgoing', $1) AS seq`, [year]);
  const { rows: [{ no }] } = await q(`SELECT format_doc_number('outgoing', $1, $2) AS no`, [year, seq]);

  // Anything still open is closed off, so no step is left active on a closed file,
  // and the room that was holding it is told.
  const { rows: [open] } = await q(
    `SELECT to_room_id FROM routing_step WHERE document_id = $1 AND status = 'active'`, [documentId]);
  await q(`UPDATE routing_step SET status = 'cancelled', completed_at = now(), completed_by = $2
            WHERE document_id = $1 AND status IN ('active', 'waiting')`, [documentId, byUser.id]);
  if (open && Number(open.to_room_id) !== Number(byUser.roomId)) {
    await notifyRoom(q, { roomId: open.to_room_id, kind: 'document.closed', documentId, actorId: byUser.id, req });
  }

  const { rows: [updated] } = await q(
    `UPDATE document
        SET outgoing_seq = $2, outgoing_year = $3, outgoing_no = $4,
            outgoing_date = coalesce($5::date, current_date),
            outgoing_registered_by = $6, outgoing_recipient = $7,
            -- An empty summary keeps the reply saved in the composer. The close
            -- form on the letter page used to send an empty box and wipe it, so
            -- the printed reply had a letterhead, a number and no body (letters
            -- test, 13 September).
            outgoing_summary = coalesce($8, outgoing_summary), outgoing_channel = $9,
            status = 'closed', closed_at = now(),
            current_room_id = NULL, current_step_id = NULL, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [documentId, seq, year, no, outgoingDate, byUser.id,
     String(recipient).trim(), (summary && String(summary).trim()) || null, channel]);

  await logEvent(q, {
    action: 'document.closed', req, userId: byUser.id, documentId, roomId: byUser.roomId,
    detail: { outgoing_no: no, year, seq, channel },
  });

  // The code a receiver checks the letter with (migration 0540), issued the
  // moment it has an outgoing number, so it is there whichever sheet is printed.
  await ensureVerifyCode(q, documentId, req ?? { user: byUser });

  return updated;
}

/**
 * Cancel a letter. The number stays consumed forever. An auditor looking for a
 * gap in the register must find the cancelled entry, not a missing one.
 */
/**
 * The letter a person means by what they typed: its barcode, or its number in any
 * of the ways people write it (ه/2026/25, ه/٢٠٢٦/٢٥, 2026/25, 25 for this year).
 * Returns up to two ids under the caller's row-level security; the caller treats
 * anything but exactly one as "not found, or not clear which".
 *
 * Shared by the company register and the template form. The template form used
 * to ask for the database's internal id, a number that appears nowhere a person
 * can see it (browser audit, 13 September).
 */
export async function findByReference(q, reference) {
  const raw = foldDigits(String(reference ?? '')).trim();
  if (!raw) return [];
  const digits = raw.replace(/\D/g, '');
  if (!raw.includes('/') && /^\d{11}$/.test(digits)) {
    const { rows } = await q(`SELECT id FROM document WHERE barcode = $1`, [digits]);
    if (rows.length) return rows;
  }
  const p = parseNumber(raw);
  if (!p) return [];
  const year = p.year ?? new Date().getFullYear();
  const { rows } = await q(`
    SELECT id FROM document
     WHERE ($1::text IS DISTINCT FROM 'outgoing' AND incoming_year = $2 AND incoming_seq = $3)
        OR ($1::text IS DISTINCT FROM 'incoming' AND outgoing_year = $2 AND outgoing_seq = $3)
     LIMIT 2`, [p.kind, year, p.serial]);
  return rows;
}

/** Whether this person may cancel this letter. Shared by the button and the action. */
export function mayCancel(user, doc) {
  if (!user || !doc || ['closed', 'cancelled'].includes(doc.status)) return false;
  if (['mayor', 'deputy_mayor', 'registry_clerk'].includes(user.role)) return true;
  return doc.status === 'registered'
      && ['room_head', 'directorate_head'].includes(user.role)
      && doc.origin_room_id != null && Number(doc.origin_room_id) === Number(user.roomId);
}

export async function cancelDocument(q, { documentId, reason, byUser, req }) {
  if (!reason || !String(reason).trim()) fail('reason_required', 'هۆکاری هەڵوەشاندنەوە پێویستە.');

  const { rows: [doc] } = await q(`SELECT * FROM document WHERE id = $1 FOR UPDATE`, [documentId]);
  if (!doc) fail('not_found', 'ئەم کتابە نەدۆزرایەوە.');
  if (doc.status === 'closed') fail('closed', 'کتابی داخراو ناتوانرێت هەڵبوەشێندرێتەوە.');
  if (doc.status === 'cancelled') fail('cancelled', 'ئەم کتابە پێشتر هەڵوەشێنراوەتەوە.');

  // Who may. Row-level security only asks whether the person can see the letter,
  // and until 13 September that was the whole check, hidden only by there being
  // no button: any room clerk who could see a letter could cancel it with a
  // hand-made request. The register's own people and the mayor's office may
  // cancel any open letter; a room head may cancel a letter their own room started
  // and has not yet sent anywhere, which is the "typed it twice" case.
  if (!mayCancel(byUser, doc)) fail('not_allowed', 'هەڵوەشاندنەوەی ئەم کتابە بۆ تۆ نییە.');

  const { rows: [open] } = await q(
    `SELECT to_room_id FROM routing_step WHERE document_id = $1 AND status = 'active'`, [documentId]);
  await q(`UPDATE routing_step SET status = 'cancelled', completed_at = now(), completed_by = $2
            WHERE document_id = $1 AND status IN ('active', 'waiting')`, [documentId, byUser.id]);
  if (open && Number(open.to_room_id) !== Number(byUser.roomId)) {
    await notifyRoom(q, { roomId: open.to_room_id, kind: 'document.cancelled', documentId, actorId: byUser.id, req });
  }

  const { rows: [updated] } = await q(
    `UPDATE document
        SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3,
            current_room_id = NULL, current_step_id = NULL, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [documentId, byUser.id, String(reason).trim()]);

  await logEvent(q, {
    action: 'document.cancelled', req, userId: byUser.id, documentId,
    detail: { incoming_no: doc.incoming_no },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Finding things
// ---------------------------------------------------------------------------

/**
 * The search a clerk actually performs. Ranked in tiers so that typing a number
 * finds that number rather than every letter mentioning it:
 *
 *   100  the document number, however it was typed
 *    90  the plot number
 *    70  the subject or sender contains the words
 *    50  a fuzzy match on subject or sender
 *    40  the words are printed inside a scan attached to the letter
 *
 * The last tier is the one that changes what the system is for. Everything above
 * it searches what a clerk typed; that one searches what the paper actually
 * says, read off the scan by the reader in lib/ocr.mjs. It sits below the typed
 * tiers on purpose: a subject somebody wrote is a deliberate description of the
 * letter, and a word that happens to appear in the middle of page three is not.
 */
export async function searchDocuments(q, { text, filters = {}, limit = 50, byUser, req }) {
  const started = Date.now();
  const raw = String(text ?? '').trim();
  const norm = kuNormalize(raw);
  const parsed = parseNumber(raw);
  const pkey = plotKey(raw);

  const where = [];
  const params = [];
  const add = (sql, ...vals) => { params.push(...vals); where.push(sql); };

  if (filters.status)   add(`d.status = $${params.length + 1}`, filters.status);
  if (filters.docType)  add(`d.doc_type = $${params.length + 1}`, filters.docType);
  if (filters.roomId)   add(`d.current_room_id = $${params.length + 1}`, filters.roomId);
  if (filters.from)     add(`d.incoming_date >= $${params.length + 1}`, filters.from);
  if (filters.to)       add(`d.incoming_date <= $${params.length + 1}`, filters.to);

  const filterSql = where.length ? ' AND ' + where.join(' AND ') : '';

  let rows;
  if (!norm) {
    ({ rows } = await q(
      `SELECT d.*, r.name AS current_room_name, 0 AS tier, 0 AS score
         FROM document d LEFT JOIN room r ON r.id = d.current_room_id
        WHERE true ${filterSql}
        ORDER BY d.incoming_date DESC, d.incoming_seq DESC
        LIMIT ${Number(limit)}`, params));
  } else {
    const p = params.length;
    ({ rows } = await q(
      `SELECT d.*, r.name AS current_room_name, x.tier,
              similarity(d.subject_search, $${p + 1}) AS score
         FROM document d
         LEFT JOIN room r ON r.id = d.current_room_id
         JOIN LATERAL (
           SELECT CASE
             -- The prefix decides which register: ه/2026/79 is the incoming
             -- letter 79, not also the letter whose outgoing number is 79. And
             -- the year belongs to the same register as the number.
             WHEN $${p + 2}::int IS NOT NULL
                  AND (($${p + 5}::text IS DISTINCT FROM 'outgoing' AND d.incoming_seq = $${p + 2}::int
                        AND ($${p + 3}::int IS NULL OR d.incoming_year = $${p + 3}::int))
                    OR ($${p + 5}::text IS DISTINCT FROM 'incoming' AND d.outgoing_seq = $${p + 2}::int
                        AND ($${p + 3}::int IS NULL OR d.outgoing_year = $${p + 3}::int)))
               THEN 100
             WHEN $${p + 4}::text IS NOT NULL AND d.plot_key = $${p + 4}::text THEN 90
             WHEN d.subject_search LIKE '%' || $${p + 1} || '%'
                  OR d.sender_search LIKE '%' || $${p + 1} || '%' THEN 70
             WHEN d.subject_search % $${p + 1} OR d.sender_search % $${p + 1} THEN 50
             WHEN EXISTS (
                    SELECT 1 FROM attachment a
                      JOIN attachment_text t ON t.attachment_id = a.id
                     WHERE a.document_id = d.id
                       AND (t.text_search LIKE '%' || $${p + 1} || '%'
                            -- Word similarity, not plain containment. A reader
                            -- looking at a photograph of paper gets a letter
                            -- wrong here and there, and an exact match would
                            -- fail on exactly the documents this feature exists
                            -- to find. <% asks whether the search words appear
                            -- approximately somewhere in the page, which is the
                            -- question being asked.
                            OR $${p + 1} <% t.text_search)
                  ) THEN 40
             ELSE 0 END AS tier
         ) x ON x.tier > 0
        WHERE true ${filterSql}
        ORDER BY x.tier DESC, similarity(d.subject_search, $${p + 1}) DESC, d.incoming_date DESC
        LIMIT ${Number(limit)}`,
      [...params, norm, parsed?.serial ?? null, parsed?.year ?? null, pkey, parsed?.kind ?? null]));
  }

  if (byUser) {
    await logSearch(q, {
      area: 'documents', raw, normalised: norm, hits: rows.length,
      filters, ms: Date.now() - started, userId: byUser.id, roomId: byUser.roomId, req,
    });
  }
  return rows;
}

/** One document with everything the screen needs. */
/**
 * A reply-by date from a form: YYYY-MM-DD in either kind of digit, or empty.
 * Anything else is refused in words rather than reaching the database.
 */
export function parseReplyBy(v) {
  const s = String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
                           .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) {
    fail('bad_reply_by', 'بەرواری وەڵامدانەوە بە شێوەی ساڵ-مانگ-ڕۆژ بنووسە.');
  }
  return s;
}

/**
 * Mark a letter confidential or not, and set or clear its reply-by date
 * (migration 0600). The front desk and the mayor's office only; the database
 * refuses anyone else too (trg_document_flags_guard).
 */
export async function setDocumentFlags(q, { documentId, isConfidential, replyBy, byUser, req }) {
  if (!['registry_clerk', 'mayor', 'deputy_mayor'].includes(byUser.role)) {
    fail('not_allowed', 'تەنها ژووری هات و دەرچوو و ژووری سەرۆک دەتوانن ئەمە بگۆڕن.');
  }
  const when = parseReplyBy(replyBy);
  const { rows: [d] } = await q(
    `SELECT id, is_confidential, reply_by, incoming_date, status FROM document WHERE id = $1`, [documentId]);
  if (!d) fail('not_found', 'ئەم کتابە نەدۆزرایەوە.');
  if (d.status === 'cancelled') fail('cancelled', 'کتابێکی هەڵوەشێنراو ناگۆڕدرێت.');
  if (when) {
    const { rows: [ok] } = await q(`SELECT $1::date >= $2::date AS ok`, [when, d.incoming_date]);
    if (!ok.ok) fail('bad_reply_by', 'بەرواری وەڵامدانەوە نابێت پێش بەرواری هاتن بێت.');
  }
  const conf = Boolean(isConfidential);
  await q(`UPDATE document SET is_confidential = $2, reply_by = $3::date WHERE id = $1`, [documentId, conf, when]);
  await logEvent(q, {
    action: 'document.flags_changed', req, userId: byUser.id, roomId: byUser.roomId, documentId,
    detail: { confidential: conf, was_confidential: d.is_confidential, reply_by_set: Boolean(when) },
  });
}

export async function getDocument(q, documentId) {
  const { rows } = await q(
    `SELECT d.*,
            (d.reply_by - current_date) AS reply_days_left, to_char(d.reply_by, 'YYYY-MM-DD') AS reply_by_iso,
            r.name AS current_room_name, r.room_number AS current_room_number,
            ri.full_name AS registered_by_name,
            ro.full_name AS closed_by_name,
            -- The earlier letter this one follows on from, when the clerk linked
            -- them at the counter. Joined rather than fetched separately so that
            -- a link to a letter this person may not see comes back null, which
            -- is the correct answer and not an error.
            rel.incoming_no AS related_incoming_no,
            rel.subject     AS related_subject,
            -- The kind of transaction the clerk chose, with what it brings: where
            -- it usually goes, in how many days, and whether it needs the seal.
            -- All of it was stored and none of it used (records test).
            o.name AS type_name, o.default_room_id AS type_room_id,
            o.default_due_days AS type_due_days, o.requires_seal AS type_requires_seal
       FROM document d
       LEFT JOIN doc_type_option o ON o.id = d.doc_type_option_id
       LEFT JOIN room     r   ON r.id  = d.current_room_id
       LEFT JOIN app_user ri  ON ri.id = d.incoming_registered_by
       LEFT JOIN app_user ro  ON ro.id = d.outgoing_registered_by
       LEFT JOIN document rel ON rel.id = d.related_document_id
      WHERE d.id = $1`, [documentId]);
  return rows[0] ?? null;
}

export { DocumentError };
