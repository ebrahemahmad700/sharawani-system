// The routing engine.
//
// One table, routing_step, carries the whole life of a letter. The trail on the
// document screen, every room's inbox, the overdue report and the elapsed times
// all fall out of it. Nothing else records where a letter is.
//
// Implements the events in BUILD-PLAN.md section 3. Each exported function is
// one event and must be called inside a transaction, with the query function
// from withActor so that row-level security knows who is acting.
//
// Two rules hold everywhere in this file:
//
//   1. Read the document row FOR UPDATE before deciding anything. Two people
//      acting on the same letter at the same instant is normal in an office;
//      the second must see the first's result, not the state from before it.
//   2. Re-check the state here even though the route already checked permission.
//      The route guards the door. This guards the invariant.

import { logEvent } from './log.mjs';
import { notifyRoom, notifyUser } from './notify.mjs';

class RoutingError extends Error {
  constructor(message, code) { super(message); this.code = code; this.expected = true; }
}
const fail = (code, message) => { throw new RoutingError(message, code); };

/** Lock the document and return it with its active step, or throw. */
async function lockDocument(q, documentId) {
  const { rows } = await q(
    `SELECT d.*, r.name AS current_room_name
       FROM document d LEFT JOIN room r ON r.id = d.current_room_id
      WHERE d.id = $1 FOR UPDATE OF d`, [documentId]);
  if (!rows[0]) fail('not_found', 'ئەم کتابە نەدۆزرایەوە.');
  return rows[0];
}

async function activeStep(q, documentId) {
  const { rows } = await q(
    `SELECT * FROM routing_step WHERE document_id = $1 AND status = 'active'`, [documentId]);
  return rows[0] ?? null;
}

/**
 * Whether this person acts for this room today: it is their room, or they are
 * covering it as the deputy of a head on leave.
 */
async function actsFor(q, byUser, roomId) {
  if (roomId == null || !byUser) return false;
  if (byUser.roomId != null && Number(byUser.roomId) === Number(roomId)) return true;
  const { rows } = await q(
    `SELECT 1 FROM room_delegation
      WHERE room_id = $1 AND delegate_user_id = $2 AND ended_early_at IS NULL
        AND current_date BETWEEN starts_on AND ends_on`, [roomId, byUser.id]);
  return rows.length > 0;
}

/** Whether this person holds the active step: their room has the letter, or it was put in their hands. */
export async function holdsStep(q, byUser, step) { return holds(q, byUser, step); }
async function holds(q, byUser, step) {
  if (!step || !byUser) return false;
  if (step.assigned_to != null && Number(step.assigned_to) === Number(byUser.id)) return true;
  return actsFor(q, byUser, step.to_room_id);
}

// The mayor's office can take a letter from wherever it is and send it elsewhere.
// Nobody else can move a letter their room does not hold (letters audit, 13
// September: a room head two places down a sequence could send it on before his
// turn, closing another room's step in that room's name).
const OVERSEERS = ['mayor', 'deputy_mayor'];
// Who may send a letter onward from the room holding it. The same list the
// letter page uses to offer the sending card.
export const FORWARDERS = ['mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'registry_clerk'];

/**
 * A page opened before the letter moved must not act on where it is now.
 *
 * The forms carry the id of the step they were drawn for. Two people in the same
 * room pressing "complete" together, or an old tab pressed after the letter had
 * gone on, used to complete the next room's step with the first room's note
 * (letters audit, 13 September). Callers that do not pass a step id (the tests,
 * the assistant) are checked by room alone.
 */
function sameStep(step, expectedStepId) {
  if (expectedStepId === undefined) return;
  const want = expectedStepId === '' || expectedStepId === null ? null : Number(expectedStepId);
  const have = step ? Number(step.id) : null;
  if (want !== have) {
    fail('moved', 'ئەم کتابە لەو کاتەوەی پەڕەکەت کردەوە جوڵاوە. پەڕەکە نوێ بکەرەوە و دووبارە سەیری بکە.');
  }
}

/**
 * Whether this person may send this letter, with the step it holds (or null).
 * Exported so the letter page offers the sending card to exactly these people.
 */
export async function maySend(q, byUser, doc, current) {
  if (!byUser || byUser.role === 'sysadmin') return false;
  if (OVERSEERS.includes(byUser.role)) return true;
  if (current) return FORWARDERS.includes(byUser.role) && await holds(q, byUser, current);
  // Nobody holds a step. A new letter is sent by the room that started it (the
  // front desk, for everything handed in at the counter), or by the front desk
  // for letters registered before rooms were recorded; a finished one by the room
  // it finished in.
  if (doc.status === 'registered') {
    return doc.origin_room_id == null
      ? byUser.role === 'registry_clerk'
      : await actsFor(q, byUser, doc.origin_room_id);
  }
  return FORWARDERS.includes(byUser.role) && doc.current_room_id != null && await actsFor(q, byUser, doc.current_room_id);
}

async function nextSeqNo(q, documentId) {
  const { rows } = await q(
    `SELECT coalesce(max(seq_no), 0) + 1 AS n FROM routing_step WHERE document_id = $1`, [documentId]);
  return rows[0].n;
}

/**
 * Who actually receives a letter sent to a room.
 *
 * Normally the room's head. If the head is on approved leave today and the room
 * has a deputy, the deputy receives it and the delegation is recorded on the
 * step, so the trail shows why it went to someone else. If there is no deputy it
 * still goes to the head, and the room shows as at risk on the mayor's dashboard
 * rather than the letter silently stalling.
 */
async function resolveRecipient(q, roomId) {
  const { rows } = await q(
    `SELECT r.head_user_id, r.deputy_user_id, r.name,
            d.id AS delegation_id
       FROM room r
       LEFT JOIN room_delegation d
              ON d.room_id = r.id
             AND d.starts_on <= current_date AND d.ends_on >= current_date
             AND d.ended_early_at IS NULL
      WHERE r.id = $1`, [roomId]);
  const r = rows[0];
  if (!r) fail('no_room', 'ئەم ژوورە نەدۆزرایەوە.');
  if (r.delegation_id && r.deputy_user_id) {
    return { userId: r.deputy_user_id, delegationId: r.delegation_id, roomName: r.name };
  }
  return { userId: r.head_user_id, delegationId: null, roomName: r.name };
}

/** Deadline from a due-day count, honouring the working week setting. */
async function dueAt(q, days) {
  const { rows } = await q(
    `SELECT coalesce(
       (SELECT value FROM system_setting WHERE key = 'due_days_are_working_days'), 'false')::text = 'true' AS working`);
  // Q7 is still open. Until it is answered, calendar days, which is the plan's
  // assumed default and the shorter of the two, so nothing is quietly late.
  if (!rows[0].working) return { sql: `now() + make_interval(days => $DAYS)`, days };
  return { sql: `now() + make_interval(days => $DAYS)`, days };
}

// ---------------------------------------------------------------------------
// E1 / E5  Send to one room, and forward
// ---------------------------------------------------------------------------

/**
 * Send a document to a single room.
 *
 * The same event covers the mayor's first assignment and a room forwarding a
 * letter onward, because they are the same thing: close the step I hold if I
 * hold one, open a step on the room I am sending to.
 */
export async function sendSingle(q, {
  documentId, toRoomId, byUser, note = null, dueDays = null,
  returnToAssigner = false, action = 'forwarded', stepId, req,
}) {
  const doc = await lockDocument(q, documentId);
  if (!['registered', 'in_flow', 'ready_to_close'].includes(doc.status)) {
    fail('bad_status', 'ئەم کتابە لە دۆخێکدا نییە کە بتوانرێت بنێردرێت.');
  }

  const current = await activeStep(q, documentId);
  sameStep(current, stepId);
  if (!(await maySend(q, byUser, doc, current))) {
    fail('not_holder', current
      ? 'ئەم کتابە لای ژوورێکی ترە. تەنها ئەو ژوورە، یان سەرۆکایەتی، دەتوانێت بینێرێت.'
      : 'ناردنی ئەم کتابە بۆ تۆ نییە.');
  }
  // Where the new step comes from, worked out once: the room holding it, the room
  // it was last in, or the sender's own room for a fresh letter.
  const fromRoom = current?.to_room_id ?? doc.current_room_id ?? byUser.roomId;
  if (fromRoom != null && Number(fromRoom) === Number(toRoomId)) {
    // Sending a fresh letter to your own room: a constraint violation and an error
    // page until the letters audit of 13 September.
    fail('same_room', 'کتاب پێشتر لای هەمان ژوورە. ژوورێکی تر هەڵبژێرە.');
  }
  if (current && current.to_room_id === toRoomId) {
    fail('same_room', 'کتاب پێشتر لای هەمان ژوورە.');
  }
  // No active step, but the letter is still sitting with that room: a finished
  // letter stays assigned to the room that finished it, because the paper is on
  // that desk. Sending it there again is the same mistake as above, and without
  // this it reached the database and came back as a constraint violation and a
  // five hundred.
  if (!current && doc.current_room_id === toRoomId) {
    fail('same_room', 'کتاب پێشتر لای هەمان ژوورە.');
  }

  // Close the step being held, if any. This is what makes forwarding one event.
  // Taken by the mayor's office from a room that still held it, the step is
  // withdrawn rather than marked done: that room did not finish it, and the trail
  // must not say it did.
  if (current) {
    const heldBySender = await holds(q, byUser, current);
    if (heldBySender) {
      await q(`UPDATE routing_step
                  SET status = 'done', action_taken = $2, completed_at = now(), completed_by = $3, reply_note = $4
                WHERE id = $1`,
              [current.id, action, byUser.id, note]);
    } else {
      await q(`UPDATE routing_step SET status = 'cancelled', completed_at = now(), completed_by = $2
                WHERE id = $1`, [current.id, byUser.id]);
      if (current.sequence_group_id) {
        await q(`UPDATE routing_step SET status = 'cancelled'
                  WHERE sequence_group_id = $1 AND status = 'waiting'`, [current.sequence_group_id]);
      }
      await notifyRoom(q, {
        roomId: current.to_room_id, kind: 'step.recalled', documentId, actorId: byUser.id, req,
        detail: { step_id: current.id, taken_by_overseer: true },
      });
    }
    await logEvent(q, {
      action: 'step.forwarded', req, userId: byUser.id, documentId,
      roomId: current.to_room_id,
      detail: { step_id: current.id, to_room_id: toRoomId, action_taken: heldBySender ? action : 'withdrawn' },
    });
  }

  const recipient = await resolveRecipient(q, toRoomId);
  // The transaction type's days when it has them, then the room's.
  const typeDays = doc.doc_type_option_id
    ? (await q(`SELECT default_due_days AS d FROM doc_type_option WHERE id = $1`, [doc.doc_type_option_id])).rows[0]?.d
    : null;
  const days = dueDays ?? typeDays ?? (await q(`SELECT default_due_days AS d FROM room WHERE id = $1`, [toRoomId])).rows[0].d;
  const seqNo = await nextSeqNo(q, documentId);

  const { rows: [step] } = await q(
    `INSERT INTO routing_step
       (document_id, seq_no, kind, from_room_id, to_room_id, assigned_by, assigned_to,
        assigned_via_delegation_id, status, note, due_days, return_to_assigner,
        sent_at, due_at)
     VALUES ($1, $2, 'single', $3, $4, $5, $6, $7, 'active', $8, $9, $10,
             now(), now() + make_interval(days => $9))
     RETURNING *`,
    // Where it came from: the room holding it, or the room it was last in, or
    // failing both the room of the person sending it. That last case is the
    // common one — the mayor assigning a freshly registered letter — and without
    // it a returned letter would have nowhere to go back to.
    [documentId, seqNo, fromRoom, toRoomId,
     byUser.id, recipient.userId, recipient.delegationId, note, days, returnToAssigner]);

  await q(`UPDATE document SET status = 'in_flow', current_room_id = $2, current_step_id = $3, updated_at = now()
            WHERE id = $1`, [documentId, toRoomId, step.id]);

  await logEvent(q, {
    action: 'step.sent', req, userId: byUser.id, documentId, roomId: toRoomId,
    detail: { step_id: step.id, seq_no: seqNo, due_days: days, via_delegation: !!recipient.delegationId },
  });

  // Tell the room it has arrived, rather than leaving it to be noticed. The
  // pushes this returns are rung by the route after the transaction commits; a
  // rolled-back send must not buzz anybody's phone. See lib/notify.mjs.
  await notifyRoom(q, {
    roomId: toRoomId, kind: 'step.arrived', documentId, actorId: byUser.id, req,
    detail: { step_id: step.id },
  });

  return step;
}

// ---------------------------------------------------------------------------
// E2  Send by sequence (ڕیزبەندی)
// ---------------------------------------------------------------------------

/**
 * Send to several rooms in order.
 *
 * Every step is written now, in one transaction: the first active, the rest
 * waiting. That is what lets the trail show the whole planned journey before it
 * has happened, and what lets the mayor see step 3 of 5 without guessing.
 *
 * @param {number[]} roomIds in the order they should act
 */
export async function sendSequence(q, {
  documentId, roomIds, byUser, note = null, dueDaysPerRoom = null,
  returnToAssigner = false, stepId, req,
}) {
  if (!Array.isArray(roomIds) || roomIds.length < 2) {
    fail('too_few', 'ڕیزبەندی پێویستی بە لانیکەم دوو ژوورە.');
  }
  if (new Set(roomIds).size !== roomIds.length) {
    fail('duplicate_room', 'ناتوانیت هەمان ژوور دوو جار لە ڕیزبەندیدا دابنێیت.');
  }

  const doc = await lockDocument(q, documentId);
  if (!['registered', 'in_flow', 'ready_to_close'].includes(doc.status)) {
    fail('bad_status', 'ئەم کتابە لە دۆخێکدا نییە کە بتوانرێت بنێردرێت.');
  }
  const current = await activeStep(q, documentId);
  sameStep(current, stepId);
  if (!(await maySend(q, byUser, doc, current))) {
    fail('not_holder', current
      ? 'ئەم کتابە لای ژوورێکی ترە. تەنها ئەو ژوورە، یان سەرۆکایەتی، دەتوانێت بینێرێت.'
      : 'ناردنی ئەم کتابە بۆ تۆ نییە.');
  }
  const fromRoom = current?.to_room_id ?? doc.current_room_id ?? byUser.roomId;
  if (fromRoom != null && Number(fromRoom) === Number(roomIds[0])) {
    fail('same_room', 'یەکەم ژووری ڕیزبەندی هەمان ئەو ژوورەیە کە کتابەکەی لایە. ژوورێکی تر هەڵبژێرە.');
  }
  // A letter on my own desk can be sent on in sequence. It used to be refused with
  // "finish that step first", and finishing it told the sender the journey was
  // over (letters audit, 13 September). The step I hold is closed as forwarded,
  // as sending to one room already did.
  if (current) {
    const heldBySender = await holds(q, byUser, current);
    await q(heldBySender
      ? `UPDATE routing_step SET status = 'done', action_taken = 'forwarded', completed_at = now(), completed_by = $2 WHERE id = $1`
      : `UPDATE routing_step SET status = 'cancelled', completed_at = now(), completed_by = $2 WHERE id = $1`,
      [current.id, byUser.id]);
    if (current.sequence_group_id) {
      await q(`UPDATE routing_step SET status = 'cancelled'
                WHERE sequence_group_id = $1 AND status = 'waiting'`, [current.sequence_group_id]);
    }
    await logEvent(q, {
      action: 'step.forwarded', req, userId: byUser.id, documentId, roomId: current.to_room_id,
      detail: { step_id: current.id, action_taken: heldBySender ? 'forwarded' : 'withdrawn', to_sequence: true },
    });
  }

  const { rows: [{ gid }] } = await q(`SELECT gen_random_uuid() AS gid`);
  let seqNo = await nextSeqNo(q, documentId);
  const created = [];

  for (let i = 0; i < roomIds.length; i++) {
    const roomId = roomIds[i];
    const isFirst = i === 0;
    const days = dueDaysPerRoom?.[i]
      ?? (await q(`SELECT default_due_days AS d FROM room WHERE id = $1`, [roomId])).rows[0].d;

    // Only the first step resolves a recipient now. The later ones resolve when
    // they activate, because who is on leave three days from now is not knowable
    // today and guessing it would send the letter to the wrong person.
    const recipient = isFirst ? await resolveRecipient(q, roomId) : { userId: null, delegationId: null };

    const { rows: [step] } = await q(
      `INSERT INTO routing_step
         (document_id, seq_no, kind, sequence_group_id, group_position, group_size,
          from_room_id, to_room_id, assigned_by, assigned_to, assigned_via_delegation_id,
          status, note, due_days, return_to_assigner, sent_at, due_at)
       VALUES ($1, $2, 'sequence', $3, $4, $5, $6, $7, $8, $9, $10,
               $11::step_status, $12, $13::int, $14,
               CASE WHEN $11::step_status = 'active' THEN now() END,
               CASE WHEN $11::step_status = 'active' THEN now() + make_interval(days => $13::int) END)
       RETURNING *`,
      [documentId, seqNo++, gid, i + 1, roomIds.length,
       isFirst ? fromRoom : roomIds[i - 1], roomId,
       byUser.id, recipient.userId, recipient.delegationId,
       isFirst ? 'active' : 'waiting', isFirst ? note : null, days,
       // Only the last leg returns to the assigner; the ones in between go on
       // to the next room, which is the whole point of a sequence.
       i === roomIds.length - 1 ? returnToAssigner : false]);
    created.push(step);
  }

  await q(`UPDATE document SET status = 'in_flow', current_room_id = $2, current_step_id = $3, updated_at = now()
            WHERE id = $1`, [documentId, roomIds[0], created[0].id]);

  await logEvent(q, {
    action: 'step.sequence_sent', req, userId: byUser.id, documentId, roomId: roomIds[0],
    detail: { group: gid, rooms: roomIds, size: roomIds.length },
  });

  // Only the first room is told. The rooms further down the sequence are told
  // when their step activates, because being warned three days early about a
  // letter you cannot act on yet is how people learn to ignore the bell.
  await notifyRoom(q, {
    roomId: roomIds[0], kind: 'step.arrived', documentId, actorId: byUser.id, req,
    detail: { step_id: created[0].id, position: 1, of: roomIds.length },
  });

  return created;
}

// ---------------------------------------------------------------------------
// E3  Receive  (opening the letter in your room)
// ---------------------------------------------------------------------------

export async function receive(q, { documentId, byUser, req }) {
  const step = await activeStep(q, documentId);
  if (!step) fail('no_active_step', 'هیچ هەنگاوێکی چالاک نییە.');
  if (step.received_at) return step;                 // already opened; not an error

  const { rows: [updated] } = await q(
    `UPDATE routing_step SET received_at = now() WHERE id = $1 RETURNING *`, [step.id]);
  await logEvent(q, {
    action: 'step.received', req, userId: byUser.id, documentId, roomId: step.to_room_id,
    detail: { step_id: step.id },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// E4  Complete  (I have done my part)
// ---------------------------------------------------------------------------

/**
 * Finish the step this room holds.
 *
 * What happens next is decided here, not by the caller:
 *   - another room is waiting in the same sequence  -> promote it
 *   - the step was marked return to assigner        -> open a leg back to them
 *   - neither                                       -> the document is ready to close
 */
export async function complete(q, { documentId, byUser, action = 'no_action', replyNote = null, stepId, req }) {
  await lockDocument(q, documentId);
  const step = await activeStep(q, documentId);
  sameStep(step, stepId);
  if (!step) fail('no_active_step', 'هیچ هەنگاوێکی چالاک نییە بۆ تەواوکردن.');
  // Only the room holding the step finishes it. This was not checked: whoever
  // could see the letter could finish whichever step was active, another room's
  // included (letters audit, 13 September).
  if (!(await holds(q, byUser, step))) {
    fail('not_holder', 'ئەم هەنگاوە لای ژوورێکی ترە. تەنها ئەو ژوورە دەتوانێت تەواوی بکات.');
  }

  await q(`UPDATE routing_step
              SET status = 'done', action_taken = $2, reply_note = $3,
                  completed_at = now(), completed_by = $4,
                  received_at = coalesce(received_at, now())
            WHERE id = $1`, [step.id, action, replyNote, byUser.id]);

  await logEvent(q, {
    action: 'step.completed', req, userId: byUser.id, documentId, roomId: step.to_room_id,
    detail: { step_id: step.id, action_taken: action },
  });

  // Next in the same sequence?
  if (step.sequence_group_id) {
    const { rows: [next] } = await q(
      `SELECT * FROM routing_step
        WHERE sequence_group_id = $1 AND status = 'waiting'
        ORDER BY group_position LIMIT 1`, [step.sequence_group_id]);

    if (next) {
      const recipient = await resolveRecipient(q, next.to_room_id);
      const { rows: [activated] } = await q(
        `UPDATE routing_step
            SET status = 'active', sent_at = now(),
                due_at = now() + make_interval(days => due_days),
                assigned_to = $2, assigned_via_delegation_id = $3
          WHERE id = $1 RETURNING *`,
        [next.id, recipient.userId, recipient.delegationId]);

      await q(`UPDATE document SET current_room_id = $2, current_step_id = $3, updated_at = now()
                WHERE id = $1`, [documentId, activated.to_room_id, activated.id]);
      await logEvent(q, {
        action: 'step.activated', req, userId: byUser.id, documentId, roomId: activated.to_room_id,
        detail: { step_id: activated.id, position: activated.group_position, of: activated.group_size },
      });
      await notifyRoom(q, {
        roomId: activated.to_room_id, kind: 'step.arrived', documentId, actorId: byUser.id, req,
        detail: { step_id: activated.id, position: activated.group_position, of: activated.group_size },
      });
      return { outcome: 'next_in_sequence', step: activated };
    }
  }

  // A leg back to whoever assigned it?
  if (step.return_to_assigner) {
    const { rows: [assigner] } = await q(`SELECT room_id FROM app_user WHERE id = $1`, [step.assigned_by]);
    if (assigner?.room_id && assigner.room_id !== step.to_room_id) {
      const recipient = await resolveRecipient(q, assigner.room_id);
      const seqNo = await nextSeqNo(q, documentId);

      // The schema requires kind 'return_leg' to carry the sequence group fields,
      // because a return leg is the last stage of a journey rather than a new one.
      // So a leg that closes a sequence joins that sequence as one more position,
      // and the group grows by one. A leg that closes a plain single send has no
      // group to join, and is written as an ordinary step back to the sender.
      let leg;
      if (step.sequence_group_id) {
        // The leg gets a group of its own rather than joining the sequence it
        // follows. Joining would mean rewriting group_size on steps that are
        // already finished, and the guard trigger refuses to touch a finished
        // step — correctly, because the trail is a record of what happened, not
        // a plan that can be revised after the fact.
        //
        // A group of one also reads better. The trail shows the sequence as
        // 1 of 3, 2 of 3, 3 of 3, and then the way back as its own leg, which is
        // what it is.
        ({ rows: [leg] } = await q(
          `INSERT INTO routing_step
             (document_id, seq_no, kind, sequence_group_id, group_position, group_size,
              from_room_id, to_room_id, assigned_by, assigned_to,
              assigned_via_delegation_id, status, due_days, sent_at, due_at)
           VALUES ($1, $2, 'return_leg', gen_random_uuid(), 1, 1, $3, $4, $5, $6, $7,
                   'active', 2, now(), now() + make_interval(days => 2))
           RETURNING *`,
          [documentId, seqNo, step.to_room_id, assigner.room_id, step.assigned_by,
           recipient.userId, recipient.delegationId]));
      } else {
        ({ rows: [leg] } = await q(
          `INSERT INTO routing_step
             (document_id, seq_no, kind, from_room_id, to_room_id, assigned_by, assigned_to,
              assigned_via_delegation_id, status, due_days, sent_at, due_at)
           VALUES ($1, $2, 'single', $3, $4, $5, $6, $7, 'active', 2, now(), now() + make_interval(days => 2))
           RETURNING *`,
          [documentId, seqNo, step.to_room_id, assigner.room_id, step.assigned_by,
           recipient.userId, recipient.delegationId]));
      }

      await q(`UPDATE document SET current_room_id = $2, current_step_id = $3, updated_at = now()
                WHERE id = $1`, [documentId, leg.to_room_id, leg.id]);
      await logEvent(q, {
        action: 'step.activated', req, userId: byUser.id, documentId, roomId: leg.to_room_id,
        detail: { step_id: leg.id, kind: leg.kind },
      });
      await notifyRoom(q, {
        roomId: leg.to_room_id, kind: 'step.returned', documentId, actorId: byUser.id, req,
        detail: { step_id: leg.id },
      });
      return { outcome: 'returned_to_assigner', step: leg };
    }
  }

  // Nothing left to do. It waits for the registry to register the outgoing
  // number and close it.
  //
  // The document stays assigned to the room that just finished, and the schema
  // insists on that. The paper is physically on that desk until the registry
  // collects it, so a system that showed the letter as belonging to nobody would
  // be describing a state that does not exist in the building. Only the step is
  // cleared, because no one owes an action any more.
  await q(`UPDATE document SET status = 'ready_to_close', current_step_id = NULL, updated_at = now()
            WHERE id = $1`, [documentId]);

  // The journey is over, so the person who started it is told. One notification
  // to one person, not to their whole room: it answers a question only they
  // asked.
  await notifyUser(q, {
    userId: step.assigned_by, kind: 'step.completed', documentId,
    roomId: step.to_room_id, actorId: byUser.id, req,
    detail: { step_id: step.id, action_taken: action },
  });

  return { outcome: 'ready_to_close', step: null };
}

// ---------------------------------------------------------------------------
// E6  Return  (this is not for my room, or I need more from you)
// ---------------------------------------------------------------------------

export async function returnStep(q, { documentId, byUser, reason, stepId, req }) {
  if (!reason || !String(reason).trim()) {
    fail('reason_required', 'هۆکاری گەڕاندنەوە پێویستە.');
  }
  // The database wants at least three characters; «نا» used to reach it and come
  // back as the error page.
  if (String(reason).trim().length < 3) {
    fail('reason_short', 'هۆکارەکە بە چەند وشەیەک بنووسە، بۆ ئەوەی ژووری نێردەر بزانێت بۆچی گەڕایەوە.');
  }
  await lockDocument(q, documentId);
  const step = await activeStep(q, documentId);
  sameStep(step, stepId);
  if (!step) fail('no_active_step', 'هیچ هەنگاوێکی چالاک نییە.');
  if (!(await holds(q, byUser, step))) {
    fail('not_holder', 'ئەم کتابە لای ژوورێکی ترە. تەنها ئەو ژوورە دەتوانێت بیگەڕێنێتەوە.');
  }

  await q(`UPDATE routing_step
              SET status = 'returned', reply_note = $2, completed_at = now(), completed_by = $3,
                  received_at = coalesce(received_at, now())
            WHERE id = $1`, [step.id, String(reason).trim(), byUser.id]);

  // Everything still waiting in this sequence is cancelled. The plan the mayor
  // made no longer applies, and leaving the rows waiting would show a journey
  // that will never happen.
  if (step.sequence_group_id) {
    await q(`UPDATE routing_step SET status = 'cancelled'
              WHERE sequence_group_id = $1 AND status = 'waiting'`, [step.sequence_group_id]);
  }

  // Back to the room that sent it.
  const backTo = step.from_room_id;
  await logEvent(q, {
    action: 'step.returned', req, userId: byUser.id, documentId, roomId: step.to_room_id,
    detail: { step_id: step.id, to_room_id: backTo },
  });

  if (!backTo) {
    await q(`UPDATE document SET status = 'registered', current_room_id = NULL, current_step_id = NULL, updated_at = now()
              WHERE id = $1`, [documentId]);
    return { outcome: 'back_to_registry', step: null };
  }

  const recipient = await resolveRecipient(q, backTo);
  const seqNo = await nextSeqNo(q, documentId);
  const { rows: [bounce] } = await q(
    `INSERT INTO routing_step
       (document_id, seq_no, kind, from_room_id, to_room_id, assigned_by, assigned_to,
        assigned_via_delegation_id, status, note, due_days, sent_at, due_at)
     VALUES ($1, $2, 'bounce', $3, $4, $5, $6, $7, 'active', $8, 2, now(), now() + make_interval(days => 2))
     RETURNING *`,
    [documentId, seqNo, step.to_room_id, backTo, byUser.id,
     recipient.userId, recipient.delegationId, String(reason).trim()]);

  await q(`UPDATE document SET current_room_id = $2, current_step_id = $3, updated_at = now()
            WHERE id = $1`, [documentId, backTo, bounce.id]);

  await notifyRoom(q, {
    roomId: backTo, kind: 'step.returned', documentId, actorId: byUser.id, req,
    detail: { step_id: bounce.id },
  });

  return { outcome: 'bounced', step: bounce };
}

// ---------------------------------------------------------------------------
// E7  Recall  (I sent it to the wrong room; nobody has opened it yet)
// ---------------------------------------------------------------------------

export async function recall(q, { documentId, byUser, stepId, req }) {
  await lockDocument(q, documentId);
  const step = await activeStep(q, documentId);
  sameStep(step, stepId);
  if (!step) fail('no_active_step', 'هیچ هەنگاوێکی چالاک نییە.');
  if (step.assigned_by !== byUser.id) {
    fail('not_yours', 'تەنها ئەو کەسەی ناردوویەتی دەتوانێت بیگەڕێنێتەوە.');
  }
  if (step.received_at) {
    fail('already_opened', 'ژوورەکە کتابەکەی کردۆتەوە. ناتوانرێت بگەڕێندرێتەوە.');
  }

  await q(`UPDATE routing_step SET status = 'cancelled', completed_at = now(), completed_by = $2
            WHERE id = $1`, [step.id, byUser.id]);
  if (step.sequence_group_id) {
    await q(`UPDATE routing_step SET status = 'cancelled'
              WHERE sequence_group_id = $1 AND status = 'waiting'`, [step.sequence_group_id]);
  }

  const { rows: [prev] } = await q(
    `SELECT to_room_id FROM routing_step
      WHERE document_id = $1 AND status = 'done' ORDER BY seq_no DESC LIMIT 1`, [documentId]);

  if (!prev) {
    // It had never been anywhere: back to a registered letter nobody holds.
    await q(`UPDATE document
                SET status = 'registered', current_room_id = NULL, current_step_id = NULL, updated_at = now()
              WHERE id = $1`, [documentId]);
  } else {
    // It had been through a room before. It comes back to the person who recalled
    // it, as a step on their room, so it is on their desk to send again. Setting
    // the letter "in flow" with no step, as this did, is refused by the database
    // and came back as the error page (letters audit, 13 September).
    const backTo = byUser.roomId ?? step.from_room_id;
    const recipient = await resolveRecipient(q, backTo);
    const seqNo = await nextSeqNo(q, documentId);
    const { rows: [back] } = await q(
      `INSERT INTO routing_step
         (document_id, seq_no, kind, from_room_id, to_room_id, assigned_by, assigned_to,
          assigned_via_delegation_id, status, note, due_days, sent_at, received_at, due_at)
       VALUES ($1, $2, 'single', $3, $4, $5, $6, $7, 'active', $8, 2, now(), now(), now() + make_interval(days => 2))
       RETURNING *`,
      [documentId, seqNo, step.to_room_id, backTo, byUser.id, recipient.userId, recipient.delegationId,
       'ناردنەکە گەڕێندرایەوە']);
    await q(`UPDATE document
                SET status = 'in_flow', current_room_id = $2, current_step_id = $3, updated_at = now()
              WHERE id = $1`, [documentId, backTo, back.id]);
  }

  await logEvent(q, {
    action: 'step.recalled', req, userId: byUser.id, documentId, roomId: step.to_room_id,
    detail: { step_id: step.id },
  });

  // The room is told it has gone. Nobody opened it, so nobody would otherwise
  // notice, and a letter silently vanishing from a queue is how people stop
  // trusting the queue.
  await notifyRoom(q, {
    roomId: step.to_room_id, kind: 'step.recalled', documentId, actorId: byUser.id, req,
    detail: { step_id: step.id },
  });

  return { outcome: 'recalled' };
}

// ---------------------------------------------------------------------------
// E7  The paper arrives  (migration 0300)
// ---------------------------------------------------------------------------

/**
 * Sign for the physical folder.
 *
 * Deliberately not the same event as opening the letter on screen. A step can be
 * completed on screen without the paper ever having been signed for, and that is
 * a real situation worth being able to see rather than one to prevent: the head
 * read the scan and gave an opinion while the folder was still in a tray
 * downstairs. Both facts are true and the system now records both.
 *
 * Idempotent. Two clerks reaching for the same trolley is not an error.
 */
export async function paperReceive(q, { documentId, byUser, courier = null, req }) {
  const step = await activeStep(q, documentId);
  if (!step) fail('no_active_step', 'هیچ هەنگاوێکی چالاک نییە.');
  if (step.paper_received_at) return step;
  // Signed for by the room it was sent to, which is where the folder has to be.
  if (!(await holds(q, byUser, step))) {
    fail('not_holder', 'ئەم پەڕگەیە بۆ ژوورێکی تر نێردراوە. ئەو ژوورە وەری دەگرێت.');
  }

  const { rows: [updated] } = await q(
    `UPDATE routing_step
        SET paper_received_at = now(), paper_received_by = $2,
            paper_handed_by = coalesce($3, paper_handed_by)
      WHERE id = $1 RETURNING *`,
    [step.id, byUser.id, courier]);

  await logEvent(q, {
    action: 'step.paper_received', req, userId: byUser.id, documentId, roomId: step.to_room_id,
    detail: { step_id: step.id, by_manifest: false },
  });

  // The room that let the folder out of its hands is the one waiting to hear
  // that it arrived.
  await notifyRoom(q, {
    roomId: step.from_room_id, kind: 'paper.received', documentId, actorId: byUser.id, req,
    detail: { step_id: step.id },
  });

  return updated;
}

/** The steps in a room whose folder has not turned up, oldest first. */
export async function paperPending(q, roomId, { limit = 100 } = {}) {
  const { rows } = await q(
    `SELECT s.id AS step_id, s.sent_at,
            extract(epoch FROM (now() - s.sent_at)) / 3600 AS hours_waiting,
            d.id AS document_id, d.incoming_no, d.barcode, d.subject, d.priority,
            fr.name AS from_room_name,
            m.manifest_no
       FROM routing_step s
       JOIN document d ON d.id = s.document_id
       LEFT JOIN room fr ON fr.id = s.from_room_id
       LEFT JOIN dispatch_item di ON di.routing_step_id = s.id
       LEFT JOIN dispatch_manifest m ON m.id = di.manifest_id AND m.received_at IS NULL
      WHERE s.to_room_id = $1 AND s.status = 'active' AND s.paper_received_at IS NULL
      ORDER BY s.sent_at
      LIMIT $2`, [roomId, limit]);
  return rows;
}

// ---------------------------------------------------------------------------
// E8  The folder trolley  (migration 0320)
// ---------------------------------------------------------------------------

/**
 * Create a delivery manifest: several folders, one courier, one signature.
 *
 * Every letter on it must currently be on an active step running to the same
 * receiving room, because that is what makes one signature meaningful. A folder
 * for a different room in the same armful is a different manifest.
 */
export async function createManifest(q, { fromRoomId, toRoomId, documentIds, courier, note = null, byUser, req }) {
  if (!documentIds?.length) fail('empty_manifest', 'هیچ کتابێک هەڵنەبژێردراوە.');
  if (fromRoomId === toRoomId) fail('same_room', 'ناتوانرێت بۆ هەمان ژوور بنێردرێت.');
  if (!courier || String(courier).trim().length < 2) fail('no_courier', 'ناوی گەیەنەر پێویستە.');

  // One query decides what may travel, so a letter that moved on between the
  // clerk ticking the box and pressing the button is simply not on the manifest.
  const { rows: steps } = await q(
    `SELECT s.id, s.document_id
       FROM routing_step s
      WHERE s.document_id = ANY ($1::bigint[])
        AND s.status = 'active'
        AND s.to_room_id = $2
        AND s.paper_received_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM dispatch_item di
                         JOIN dispatch_manifest dm ON dm.id = di.manifest_id
                        WHERE di.routing_step_id = s.id AND dm.cancelled_at IS NULL)
      FOR UPDATE OF s`,
    [documentIds, toRoomId]);

  if (steps.length === 0) {
    fail('nothing_to_send', 'هیچ کتابێک لەمانە ئێستا بۆ ئەم ژوورە لە ڕێگەدا نییە.');
  }

  const year = new Date().getFullYear();
  const { rows: [{ seq }] } = await q(`SELECT issue_number('manifest', $1) AS seq`, [year]);
  const { rows: [{ no }] } = await q(`SELECT format_doc_number('manifest', $1, $2) AS no`, [year, seq]);

  const { rows: [manifest] } = await q(
    `INSERT INTO dispatch_manifest
       (manifest_seq, manifest_year, manifest_no, from_room_id, to_room_id, courier_name, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [seq, year, no, fromRoomId, toRoomId, String(courier).trim(), note, byUser.id]);

  for (const s of steps) {
    await q(`INSERT INTO dispatch_item (manifest_id, document_id, routing_step_id) VALUES ($1, $2, $3)`,
      [manifest.id, s.document_id, s.id]);
  }

  await logEvent(q, {
    action: 'manifest.created', req, userId: byUser.id, roomId: fromRoomId,
    detail: { manifest_no: no, to_room_id: toRoomId, items: steps.length },
  });

  await notifyRoom(q, {
    roomId: toRoomId, kind: 'manifest.incoming', actorId: byUser.id, req,
    detail: { manifest_id: manifest.id, items: steps.length },
  });

  return { ...manifest, item_count: steps.length, skipped: documentIds.length - steps.length };
}

/**
 * Sign for a whole manifest.
 *
 * This is the reason the table exists: one action stamps paper_received_at on
 * every step in it, so twelve folders are accounted for by one signature instead
 * of by twelve that nobody has time to give.
 *
 * A step that moved on since the manifest was written is skipped rather than
 * forced, and the count of those is returned so the screen can say so.
 */
export async function receiveManifest(q, { manifestId, byUser, req }) {
  const { rows: [m] } = await q(
    `SELECT * FROM dispatch_manifest WHERE id = $1 FOR UPDATE`, [manifestId]);
  if (!m) fail('not_found', 'ئەم لیستەی گەیاندن نەدۆزرایەوە.');
  if (m.cancelled_at) fail('cancelled', 'ئەم لیستە هەڵوەشێنراوەتەوە.');
  if (m.received_at) return { ...m, stamped: 0, already: true };
  // The room at the far end signs. The sender could sign for their own trolley
  // and mark folders received that had not left the desk (letters audit).
  if (!(await actsFor(q, byUser, m.to_room_id))) {
    fail('not_receiver', 'ئەم لیستە بۆ ژوورێکی ترە. ژووری وەرگر وەری دەگرێت.');
  }

  const { rows: stamped } = await q(
    `UPDATE routing_step s
        SET paper_received_at = now(), paper_received_by = $2, paper_handed_by = $3
       FROM dispatch_item di
      WHERE di.manifest_id = $1
        AND di.routing_step_id = s.id
        AND s.status = 'active'
        AND s.paper_received_at IS NULL
      RETURNING s.id, s.document_id`,
    [manifestId, byUser.id, m.courier_name]);

  const { rows: [updated] } = await q(
    `UPDATE dispatch_manifest SET received_at = now(), received_by = $2
      WHERE id = $1 RETURNING *`, [manifestId, byUser.id]);

  await logEvent(q, {
    action: 'manifest.received', req, userId: byUser.id, roomId: m.to_room_id,
    detail: { manifest_no: m.manifest_no, stamped: stamped.length },
  });
  for (const s of stamped) {
    await logEvent(q, {
      action: 'step.paper_received', req, userId: byUser.id,
      documentId: s.document_id, roomId: m.to_room_id,
      detail: { step_id: s.id, by_manifest: true },
    });
  }

  await notifyRoom(q, {
    roomId: m.from_room_id, kind: 'manifest.received', actorId: byUser.id, req,
    detail: { manifest_id: m.id, stamped: stamped.length },
  });

  return { ...updated, stamped: stamped.length, already: false };
}

/** Withdraw a manifest that was written by mistake. Only before it is signed for. */
export async function cancelManifest(q, { manifestId, byUser, req }) {
  const { rows: [m] } = await q(
    `SELECT * FROM dispatch_manifest WHERE id = $1 FOR UPDATE`, [manifestId]);
  if (!m) fail('not_found', 'ئەم لیستەی گەیاندن نەدۆزرایەوە.');
  if (m.received_at) fail('already_received', 'وەرگیراوە، ناتوانرێت هەڵبوەشێنرێتەوە.');
  if (m.cancelled_at) return m;
  // Withdrawn by the room that wrote it, not by the room waiting for it.
  if (Number(m.created_by) !== Number(byUser.id) && !(await actsFor(q, byUser, m.from_room_id))) {
    fail('not_sender', 'تەنها ژووری نێردەر دەتوانێت ئەم لیستە هەڵبوەشێنێتەوە.');
  }

  await q(`DELETE FROM dispatch_item WHERE manifest_id = $1`, [manifestId]);
  const { rows: [updated] } = await q(
    `UPDATE dispatch_manifest SET cancelled_at = now(), cancelled_by = $2
      WHERE id = $1 RETURNING *`, [manifestId, byUser.id]);

  await logEvent(q, {
    action: 'manifest.cancelled', req, userId: byUser.id, roomId: m.from_room_id,
    detail: { manifest_no: m.manifest_no },
  });
  return updated;
}

/** One manifest with its letters, for the screen and the printed sheet. */
/** Whether this person may sign for, or withdraw, a manifest: for the buttons on its page. */
export async function manifestRights(q, byUser, m) {
  return {
    receive: !m.received_at && !m.cancelled_at && await actsFor(q, byUser, m.to_room_id),
    cancel: !m.received_at && !m.cancelled_at
      && (Number(m.created_by) === Number(byUser.id) || await actsFor(q, byUser, m.from_room_id)),
  };
}

export async function manifestWithItems(q, manifestId) {
  const { rows: [m] } = await q(
    `SELECT m.*, fr.name AS from_room_name, fr.room_number AS from_room_number,
            tr.name AS to_room_name, tr.room_number AS to_room_number,
            cb.full_name AS created_by_name, rb.full_name AS received_by_name
       FROM dispatch_manifest m
       LEFT JOIN room fr ON fr.id = m.from_room_id
       LEFT JOIN room tr ON tr.id = m.to_room_id
       LEFT JOIN app_user cb ON cb.id = m.created_by
       LEFT JOIN app_user rb ON rb.id = m.received_by
      WHERE m.id = $1`, [manifestId]);
  if (!m) return null;

  const { rows: items } = await q(
    `SELECT d.id AS document_id, d.incoming_no, d.barcode, d.subject, d.priority,
            s.paper_received_at
       FROM dispatch_item di
       JOIN document d ON d.id = di.document_id
       JOIN routing_step s ON s.id = di.routing_step_id
      WHERE di.manifest_id = $1
      ORDER BY d.incoming_year, d.incoming_seq`, [manifestId]);

  return { ...m, items };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The whole trail for the document screen, in order, with names resolved. */
export async function trail(q, documentId) {
  const { rows } = await q(
    `SELECT s.*,
            tr.name AS to_room_name,   tr.room_number AS to_room_number,
            fr.name AS from_room_name,
            ab.full_name AS assigned_by_name,
            at.full_name AS assigned_to_name,
            cb.full_name AS completed_by_name,
            (s.status = 'active' AND s.due_at < now()) AS overdue
       FROM routing_step s
       LEFT JOIN room     tr ON tr.id = s.to_room_id
       LEFT JOIN room     fr ON fr.id = s.from_room_id
       LEFT JOIN app_user ab ON ab.id = s.assigned_by
       LEFT JOIN app_user at ON at.id = s.assigned_to
       LEFT JOIN app_user cb ON cb.id = s.completed_by
      WHERE s.document_id = $1
      ORDER BY s.seq_no`, [documentId]);
  return rows;
}

/** One room's inbox: everything active in it, oldest first, overdue flagged. */
export async function roomInbox(q, roomId, { limit = 100 } = {}) {
  // The first `limit` in the usual order, and every letter nobody in the room has
  // opened yet on top of those, wherever it falls. A room with more than a hundred
  // open letters used to see its oldest hundred only, so a letter sent a minute
  // ago was not on the screen meant to show what had just arrived (browser audit,
  // 13 September). The unopened ones are the ones that must never be cut off.
  const { rows } = await q(
    `SELECT * FROM (
     SELECT row_number() OVER (ORDER BY (s.due_at < now()) DESC, d.priority DESC, s.sent_at) AS rn,
            s.id AS step_id, s.sent_at, s.due_at, s.received_at, s.note, s.kind,
            s.group_position, s.group_size,
            s.paper_received_at,
            (s.due_at < now()) AS overdue,
            d.id AS document_id, d.incoming_no, d.barcode, d.subject, d.priority, d.doc_type,
            d.sender_name, d.plot_no,
            fr.name AS from_room_name,
            ab.full_name AS assigned_by_name
       FROM routing_step s
       JOIN document d  ON d.id = s.document_id
       LEFT JOIN room     fr ON fr.id = s.from_room_id
       LEFT JOIN app_user ab ON ab.id = s.assigned_by
      WHERE s.to_room_id = $1 AND s.status = 'active'
     ) x
      WHERE x.rn <= $2 OR x.received_at IS NULL
      ORDER BY x.rn`, [roomId, limit]);
  return rows;
}

/**
 * Everything past its deadline, for the mayor's dashboard, highest rung of the
 * escalation ladder first (migration 0520): the letters the mayor has been told
 * about come before the ones still with their room head.
 */
export async function overdue(q, { limit = 50 } = {}) {
  const { rows } = await q(
    `SELECT l.step_id, l.sent_at, l.due_at, l.rung, l.head_days, l.mayor_days,
            l.days_late AS days_over,
            d.id AS document_id, d.incoming_no, d.subject, d.priority,
            r.name AS room_name, r.room_number,
            u.full_name AS holder_name, h.full_name AS head_name
       FROM late_step l
       JOIN document d ON d.id = l.document_id
       JOIN room     r ON r.id = l.to_room_id
       LEFT JOIN app_user u ON u.id = l.assigned_to
       LEFT JOIN app_user h ON h.id = r.head_user_id
      ORDER BY l.rung DESC, l.due_at
      LIMIT $1`, [limit]);
  return rows;
}

export { RoutingError };
