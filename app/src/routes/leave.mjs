// Leave (مۆڵەت) and the deputy cover that follows from it.
//
// Screen: the leave panel of design/Admin.dc.html.
//
// Leave matters to routing, not just to personnel. When a room head is away,
// letters sent to that room must reach someone. Approving leave here creates the
// delegation that the routing engine consults, so cover is a consequence of the
// approval rather than a separate thing someone has to remember to set up.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { notifyUser, deliver as deliverPushes } from '../lib/notify.mjs';
import { page } from '../views/layout.mjs';
import { html, num, date, initials, dateInput, readDay, DAY_FORMAT } from '../lib/html.mjs';

const router = Router();

const APPROVERS = ['hr', 'mayor', 'deputy_mayor', 'directorate_head'];

const LEAVE_TYPE = { annual: 'ساڵانە', sick: 'نەخۆشی', necessity: 'پێویستی', unpaid: 'بێ مووچە' };
const LEAVE_STATUS = {
  requested: ['warn', 'چاوەڕوانی بڕیار'], approved: ['ok', 'پەسەندکراوە'],
  rejected: ['danger', 'ڕەتکراوە'], cancelled: ['muted', 'هەڵوەشێنراوە'],
};

/**
 * Where an approved leave stands today. It used to count to the end date from
 * today even before the leave began, so leave from 1 to 3 October showed
 * "٢٠ ڕۆژ ماوە" on 13 September (browser audit, 13 September).
 */
function leaveWhen(l) {
  const toStart = Number(l.days_to_start), left = Number(l.days_left);
  if (toStart > 0) return ` · ${toStart === 1 ? 'سبەی دەست پێدەکات' : `${num(toStart)} ڕۆژ ماوە بۆ دەستپێکردن`}`;
  if (left > 0) return ` · لە مۆڵەتدایە، ${num(left)} ڕۆژ ماوە`;
  if (left === 0) return ' · ئەمڕۆ کۆتایی دێت';
  return '';
}

// The green line after a form says which thing happened. It said «تۆمارکرا.»
// for asking, approving, refusing and cancelling alike (design rules, 13
// September). ?ok=1 stays in the address beside ?done=, because scripts look for it.
const DONE = {
  requested: 'داواکارییەکە نێردرا.', approved: 'پەسەندکرا.',
  rejected: 'ڕەتکرایەوە.', cancelled: 'هەڵوەشێنرایەوە.',
};
const doneText = d => (typeof d === 'string' && Object.hasOwn(DONE, d) ? DONE[d] : DONE.requested);

router.get('/leave', requireAuth, async (req, res, next) => {
  try {
    const { rows, people } = await withActor(req.user, async q => {
      const { rows } = await q(`
        SELECT l.*, u.full_name, u.role, r.name AS room_name, r.head_user_id, r.deputy_user_id,
               d.full_name AS deputy_name,
               (l.end_date - current_date) AS days_left,
               (l.start_date - current_date) AS days_to_start
          FROM leave_record l
          JOIN app_user u ON u.id = l.user_id
          LEFT JOIN room r ON r.id = u.room_id
          LEFT JOIN app_user d ON d.id = r.deputy_user_id
         ORDER BY (l.status = 'requested') DESC, l.start_date DESC
         LIMIT 100`);
      const { rows: people } = APPROVERS.includes(req.user.role)
        ? await q(`SELECT id, full_name FROM app_user WHERE is_active AND role <> 'sysadmin' ORDER BY ku_sort_key(full_name)`)
        : { rows: [] };
      return { rows, people };
    });

    const canApprove = APPROVERS.includes(req.user.role);
    const pending = rows.filter(r => r.status === 'requested');

    // The request form's fields, laid out in rows the fields fill: five for
    // somebody who may ask on another's behalf, four for everybody else.
    const forWhom = html`<div class="field">
      <label for="user_id">بۆ کێ</label>
      <select id="user_id" name="user_id">
        <option value="${req.user.id}">خۆم</option>
        ${people.filter(p => p.id !== req.user.id).map(p => html`<option value="${p.id}">${p.full_name}</option>`)}
      </select></div>`;
    const from = html`<div class="field"><label for="start_date" class="required">لە</label>${dateInput({ id: 'start_date', required: true })}</div>`;
    const to = html`<div class="field"><label for="end_date" class="required">تا</label>${dateInput({ id: 'end_date', required: true, after: 'start_date' })}</div>`;
    const kind = html`<div class="field"><label for="leave_type">جۆر</label>
      <select id="leave_type" name="leave_type">${Object.entries(LEAVE_TYPE).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></div>`;
    const note = html`<div class="field"><label for="note">تێبینی</label><input id="note" name="note" type="text" maxlength="300"></div>`;

    res.send(page({
      user: req.user, title: 'مۆڵەتەکان', current: '/leave',
      counts: { leave: pending.length },
      notice: req.query.ok ? { kind: 'ok', text: doneText(req.query.done) } : req.query.error ? { kind: 'error', text: String(req.query.error) } : null,
      body: html`
        <div class="card">
          <h2>داواکاری مۆڵەتی نوێ</h2>
          <form method="post" action="/leave/new">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            ${canApprove
              ? html`<div class="grid cols-3">${forWhom}${from}${to}</div><div class="grid cols-2">${kind}${note}</div>`
              : html`<div class="grid cols-4">${from}${to}${kind}${note}</div>`}
            <button class="btn" type="submit">ناردنی داواکاری</button>
          </form>
        </div>

        <div class="card">
          <h2>${canApprove ? 'هەموو مۆڵەتەکان' : 'مۆڵەتەکانم'}</h2>
          ${rows.length === 0 ? html`<div class="empty">هیچ مۆڵەتێک نییە.</div>` : html`
            <div class="table-wrap kv"><table><thead class="sr-only"><tr><th></th><th>کەس و ماوە</th><th>دۆخ</th><th>کردار</th></tr></thead><tbody>${rows.map(l => {
              const [pk, pl] = LEAVE_STATUS[l.status];
              const isHead = l.head_user_id === l.user_id;
              return html`<tr>
                  <td style="width:34px"><span class="avatar">${initials(l.full_name)}</span></td>
                  <td>
                    <strong>${l.full_name}</strong> <span class="muted">· ${l.room_name ?? ''}</span>
                    <span class="cell-sub">
                      ${date(l.start_date)} — ${date(l.end_date)} · ${LEAVE_TYPE[l.leave_type]}
                      ${l.status === 'approved' ? leaveWhen(l) : ''}
                    </span>
                    ${l.note ? html`<div class="leave-note">${l.note}</div>` : ''}
                    ${isHead && l.status === 'requested' ? html`<span class="cell-sub">
                      ${l.deputy_name ? html`جێگر: <strong>${l.deputy_name}</strong> کتابەکان وەردەگرێت.`
                        : html`<span class="pill danger">جێگری نییە</span> کتابەکان لای بەرپرس دەمێننەوە.`}
                    </span>` : ''}
                  </td>
                  <td><span class="pill ${pk}">${pl}</span></td>
                  <td>${canApprove && l.status === 'requested' && Number(l.user_id) !== Number(req.user.id) ? html`
                    <form method="post" action="/leave/${l.id}/decide" class="row">
                      <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                      <button class="btn small" type="submit" name="decision" value="approved">پەسەندکردن</button>
                      <button class="btn small secondary" type="submit" name="decision" value="rejected">ڕەتکردنەوە</button>
                    </form>` : ''}
                    ${['requested', 'approved'].includes(l.status) && (canApprove || [l.user_id, l.requested_by].map(Number).includes(Number(req.user.id))) ? html`
                    <form method="post" action="/leave/${l.id}/cancel" style="margin-top:6px">
                      <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                      <button class="btn small danger-outline" type="submit">هەڵوەشاندنەوە</button>
                    </form>` : ''}</td>
                </tr>`;
              })}</tbody></table></div>`}
        </div>`,
    }));
  } catch (err) { next(err); }
});

router.post('/leave/new', requireAuth, async (req, res, next) => {
  try {
    const b = req.body;
    const forUser = APPROVERS.includes(req.user.role) && b.user_id ? Number(b.user_id) : req.user.id;
    // Typed as ساڵ/مانگ/ڕۆژ in either kind of digit; the database gets YYYY-MM-DD.
    const start = readDay(b.start_date), end = readDay(b.end_date);
    if (start === null || end === null) {
      return res.redirect(303, '/leave?error=' + encodeURIComponent(`بەروارەکان دروست نین. ${DAY_FORMAT}`));
    }
    if (!start || !end) {
      return res.redirect(303, '/leave?error=' + encodeURIComponent('بەروارەکان دروست نین: هەردوو بەروار پێویستن.'));
    }
    if (end < start) {
      return res.redirect(303, '/leave?error=' + encodeURIComponent('بەروارەکان دروست نین: بەرواری «تا» دەبێت هەمان ڕۆژ یان دوای بەرواری «لە» بێت.'));
    }
    const clash = await withActor(req.user, async q => {
      // The same person cannot ask for, or already have, leave on the same days.
      // Identical and overlapping requests were all accepted, and two approvals made
      // two deputy covers for the same dates (records test, 13 September).
      const { rows: [c] } = await q(`
        SELECT 1 FROM leave_record
         WHERE user_id = $1 AND status IN ('requested', 'approved')
           AND start_date <= $3::date AND end_date >= $2::date LIMIT 1`, [forUser, start, end]);
      return Boolean(c);
    });
    if (clash) {
      return res.redirect(303, '/leave?error=' + encodeURIComponent('ئەم کەسە پێشتر داواکاری یان مۆڵەتێکی لەم ڕۆژانەدا هەیە.'));
    }
    await withActor(req.user, async q => {
      const { rows: [l] } = await q(`
        INSERT INTO leave_record (user_id, leave_type, start_date, end_date, working_days, status, note, requested_by)
        VALUES ($1, $2, $3, $4, ($4::date - $3::date) + 1, 'requested', $5, $6) RETURNING id`,
        [forUser, b.leave_type || 'annual', start, end, b.note || null, req.user.id]);
      await logEvent(q, { action: 'leave.requested', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { leave_id: l.id, for_user_id: forUser, from: start, to: end } });

      // Everyone who can decide it is told. A leave request that nobody has been
      // told about is the commonest reason one sits unanswered until the day it
      // was meant to start.
      // A directorate head is told only about people in their own directorate: the
      // others' requests are not on their leave screen, and they were being told
      // about requests they could not open (records test, 13 September).
      const { rows: approvers } = await q(`
        SELECT a.id FROM app_user a
         WHERE a.is_active AND a.id <> $2
           AND (a.role IN ('hr', 'mayor', 'deputy_mayor')
                OR (a.role = 'directorate_head'
                    AND (SELECT directorate_id FROM room WHERE id = a.room_id) IS NOT NULL
                    AND (SELECT directorate_id FROM room WHERE id = a.room_id)
                        = (SELECT r.directorate_id FROM app_user u JOIN room r ON r.id = u.room_id WHERE u.id = $1)))`,
        [forUser, req.user.id]);
      for (const a of approvers) {
        await notifyUser(q, { userId: a.id, kind: 'leave.requested', actorId: req.user.id, req,
          detail: { leave_id: l.id } });
      }
    });
    await deliverPushes(req);
    res.redirect(303, '/leave?ok=1&done=requested');
  } catch (err) { next(err); }
});

/**
 * Cancel a leave, asked for or already approved. A leave entered with the wrong
 * dates otherwise stood for ever, and since the same days cannot be asked for
 * twice (records test, 13 September) it would also block the corrected request.
 * The person themselves, whoever asked for it, or an approver may cancel it. A
 * deputy cover it started ends today.
 */
router.post('/leave/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const refusal = await withActor(req.user, async q => {
      const { rows: [l] } = await q(`SELECT id, user_id, requested_by, status FROM leave_record WHERE id = $1`, [id]);
      if (!l || !['requested', 'approved'].includes(l.status)) return 'ئەم مۆڵەتە نەدۆزرایەوە یان پێشتر کۆتایی هاتووە.';
      const mine = [l.user_id, l.requested_by].map(Number).includes(Number(req.user.id));
      if (!mine && !APPROVERS.includes(req.user.role)) return 'هەڵوەشاندنەوەی ئەم مۆڵەتە بۆ تۆ نییە.';
      await q(`UPDATE leave_record SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [id]);
      await q(`UPDATE room_delegation SET ended_early_at = now() WHERE leave_record_id = $1 AND ended_early_at IS NULL`, [id]);
      await logEvent(q, { action: 'leave.cancelled', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { leave_id: id, for_user_id: l.user_id, was: l.status } });
      return null;
    });
    if (refusal) return res.redirect(303, '/leave?error=' + encodeURIComponent(refusal));
    res.redirect(303, '/leave?ok=1&done=cancelled');
  } catch (err) { next(err); }
});

/**
 * Approve or reject. Approval of a room head's leave creates the delegation
 * that makes the deputy receive the room's letters for those dates. If the room
 * has no deputy, the leave is still approved and the risk is logged and shown,
 * rather than the request being blocked. BUILD-PLAN.md section 3.6.
 */
router.post('/leave/:id/decide', requireAuth, requireRole(...APPROVERS), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const decision = req.body.decision === 'approved' ? 'approved' : 'rejected';
    const refusal = await withActor(req.user, async q => {
      const { rows: [pending] } = await q(`SELECT user_id, start_date, end_date FROM leave_record WHERE id = $1 AND status = 'requested'`, [id]);
      if (!pending) return null;
      // Nobody decides their own leave (records test: HR approved her own).
      if (Number(pending.user_id) === Number(req.user.id)) return 'ناتوانیت بڕیار لەسەر مۆڵەتی خۆت بدەیت. کەسێکی تر لە ڕێگەپێدەران دەبێت بیکات.';
      if (decision === 'approved') {
        const { rows: [c] } = await q(`
          SELECT 1 FROM leave_record WHERE user_id = $1 AND id <> $2 AND status = 'approved'
             AND start_date <= $4 AND end_date >= $3 LIMIT 1`, [pending.user_id, id, pending.start_date, pending.end_date]);
        if (c) return 'ئەم کەسە پێشتر مۆڵەتێکی پەسەندکراوی لەم ڕۆژانەدا هەیە.';
      }
      const { rows: [l] } = await q(`
        UPDATE leave_record SET status = $2, decided_by = $3, decided_at = now()
         WHERE id = $1 AND status = 'requested' RETURNING *`, [id, decision, req.user.id]);
      if (!l) return null;

      let reasonCode = null;
      if (decision === 'approved') {
        const { rows: [room] } = await q(`SELECT id, deputy_user_id FROM room WHERE head_user_id = $1`, [l.user_id]);
        if (room && room.deputy_user_id) {
          const { rows: [d] } = await q(`
            INSERT INTO room_delegation (room_id, absent_user_id, delegate_user_id, starts_on, ends_on, leave_record_id, reason, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, 'leave', $7) RETURNING id`,
            [room.id, l.user_id, room.deputy_user_id, l.start_date, l.end_date, l.id, req.user.id]);
          await logEvent(q, { action: 'delegation.started', req, userId: req.user.id, roomId: room.id,
            detail: { delegation_id: d.id, leave_id: l.id, from: l.start_date, to: l.end_date } });
          // The deputy finds out from the system rather than from the letters
          // beginning to arrive.
          await notifyUser(q, { userId: room.deputy_user_id, kind: 'delegation.started',
            roomId: room.id, actorId: req.user.id, req,
            detail: { delegation_id: d.id, from: l.start_date, to: l.end_date } });
        } else if (room) {
          reasonCode = 'no_deputy';
        }
      }
      await logEvent(q, { action: `leave.${decision}`, req, userId: req.user.id, roomId: req.user.roomId,
        detail: { leave_id: l.id, for_user_id: l.user_id, ...(reasonCode ? { reason_code: reasonCode } : {}) } });

      await notifyUser(q, { userId: l.user_id, kind: 'leave.decided', actorId: req.user.id, req,
        detail: { leave_id: l.id, decision } });
      return null;
    });
    if (refusal) return res.redirect(303, '/leave?error=' + encodeURIComponent(refusal));
    await deliverPushes(req);
    res.redirect(303, `/leave?ok=1&done=${decision}`);
  } catch (err) { next(err); }
});

export default router;
