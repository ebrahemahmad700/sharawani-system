// My day (ڕۆژی من).
//
// The question everybody in the building asks at eight in the morning, answered
// on one screen: what do I owe today, what am I already late on, and what have I
// sent to somebody else that has never come back.
//
// The inbox answers the first half well and has never answered the second half
// at all. A letter you sent to the legal room three weeks ago is invisible to
// you: it is not on your desk, so it is not on your screen, and the only way to
// find out it has been sitting there is to remember it and go and look. That is
// exactly the letter a citizen is standing at the counter asking about.
//
// So this screen has two halves. What is on my desk, and what I am waiting for.
//
// CHASING
//
// Every waiting row has one button. Pressing it writes a remark on the letter
// asking the room holding it to deal with it, and the room is told, because
// writing a remark already tells them. That is the whole mechanism, and using it
// rather than inventing a new kind of ping is the point:
//
//   the request is ON THE LETTER, where the next person to open it will see it,
//   not in a notification that is read once and gone;
//   it says who asked and when, so a room that is genuinely blocked has
//   something to answer rather than a silent counter going up;
//   and it is already in the activity log, already covered by row-level
//   security, already delivered by the existing bell. Nothing new had to be
//   built to make a chase permanent, which is how it should be.
//
// A second chase within the day is refused. A bell that cries wolf gets turned
// off, and the room that is being chased four times before lunch is not the room
// that will answer faster.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { notifyRoom } from '../lib/notify.mjs';
import { roomInbox } from '../lib/routing.mjs';
import { statusPill } from './registry.mjs';
import { page } from '../views/layout.mjs';
import { html, num, date, elapsed, ltr } from '../lib/html.mjs';

const router = Router();

const PRIORITY_PILL = {
  very_urgent: ['danger', 'زۆر پەلە'],
  urgent:      ['warn',   'پەلە'],
  normal:      [null,     null],
};

const priorityPill = p => {
  const [kind, label] = PRIORITY_PILL[p] ?? [null, null];
  return kind ? html`<span class="pill ${kind}">${label}</span>` : '';
};

/**
 * Letters this person sent that are still with somebody else.
 *
 * "Sent" means they pressed the button: assigned_by is them. Not their room,
 * them. A room head who sent forty letters last month wants their own list, and
 * a clerk who sent three wants those three; merging both into a room view makes
 * neither useful.
 *
 * Row-level security still applies on top, so this can never show a letter the
 * person may no longer see, even though they are the one who sent it.
 */
async function waitingOnOthers(q, userId, roomId = null, { limit = 100 } = {}) {
  // The first `limit` in the usual order (late first, then oldest), and every
  // letter sent in the last seven days on top of those. With more than a hundred
  // letters out, the mayor's list was the oldest hundred, so a letter sent a
  // minute ago was not on it and could not be chased from here, and the heading
  // said ١٠٠ when there were more (found re-running the audit, 13 September).
  const { rows } = await q(`
    SELECT * FROM (
    SELECT row_number() OVER (ORDER BY (s.due_at IS NOT NULL AND s.due_at < now()) DESC, s.sent_at) AS rn,
           count(*) OVER () AS total,
           d.id, d.incoming_no, d.subject, d.sender_name, d.status, d.priority,
           s.id AS step_id, s.sent_at, s.due_at, s.received_at, s.paper_received_at,
           (s.due_at IS NOT NULL AND s.due_at < now()) AS overdue,
           r.name AS room_name, r.room_number,
           u.full_name AS with_name,
           -- The last time I chased it: a note written by chasing, not any note.
           -- An ordinary remark used to count and block the chase button.
           (SELECT max(l.occurred_at) FROM activity_log l
             WHERE l.document_id = d.id AND l.user_id = $1 AND l.action = 'note.added'
               AND l.detail->>'chase' = 'true') AS my_last_note
      FROM routing_step s
      JOIN document d ON d.id = s.document_id
      LEFT JOIN room r ON r.id = s.to_room_id
      LEFT JOIN app_user u ON u.id = s.assigned_to
     WHERE s.assigned_by = $1
       AND s.status = 'active'
       AND d.status NOT IN ('closed', 'cancelled')
       -- Not letters on my own desk (one that came back to me), and not one I
       -- sent back as not ours: neither is waiting on another room.
       AND s.to_room_id IS DISTINCT FROM $3
       AND s.kind <> 'bounce'
    ) x
     WHERE x.rn <= $2 OR x.sent_at > now() - interval '7 days'
     ORDER BY x.rn`, [userId, limit, roomId]);
  return rows;
}

router.get('/my-day', requireAuth, async (req, res, next) => {
  try {
    const data = await withActor(req.user, async q => {
      const mine = req.user.roomId ? await roomInbox(q, req.user.roomId, { limit: 300 }) : [];
      const waiting = await waitingOnOthers(q, req.user.id, req.user.roomId);
      return { mine, waiting };
    });

    const { mine, waiting } = data;
    const now = new Date();
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

    const late = mine.filter(r => r.overdue);
    const today = mine.filter(r => !r.overdue && r.due_at && new Date(r.due_at) <= endOfDay);
    const rest = mine.filter(r => !r.overdue && !(r.due_at && new Date(r.due_at) <= endOfDay));
    const paperWaiting = mine.filter(r => !r.paper_received_at);
    const lateOut = waiting.filter(w => w.overdue);

    const notice = req.query.chased ? { kind: 'ok', text: 'داواکاری بەدواداچوونەکەت نووسرا.' }
                 : req.query.error  ? { kind: 'error', text: String(req.query.error) }
                 : null;

    // A deadline and, when it has passed, by how much. One way on the whole
    // screen, for the letters on my desk and the letters I am waiting for.
    const dueCell = x => x.due_at
      ? html`${date(x.due_at)}${x.overdue ? html` <span class="pill danger">${elapsed(x.due_at)} دواکەوتوو</span>` : ''}`
      : html`<span class="muted">—</span>`;

    const deskRow = r => html`<tr class="${r.overdue ? 'late' : ''}">
      <td class="mono">${ltr(r.incoming_no)}</td>
      <td><a href="/documents/${r.document_id}">${r.subject}</a> ${priorityPill(r.priority)}</td>
      <td>${r.sender_name}</td>
      <td>${dueCell(r)}</td>
      <td>${r.paper_received_at ? html`<span class="pill ok">وەرگیراوە</span>` : html`<span class="pill warn">نەگەیشتووە</span>`}</td>
    </tr>`;

    res.send(page({
      user: req.user,
      title: 'ڕۆژی من',
      current: '/my-day',
      notice,
      body: html`
        <div class="grid cols-4 stats">
          <div class="stat"><div class="n">${num(mine.length)}</div><div class="k">لەسەر مێزی من</div></div>
          <div class="stat"><div class="n${late.length ? ' danger' : ''}">${num(late.length)}</div><div class="k">دواکەوتوو</div></div>
          <div class="stat"><div class="n">${num(today.length)}</div><div class="k">کۆتایی کاتیان ئەمڕۆیە</div></div>
          <div class="stat"><div class="n${lateOut.length ? ' danger' : ''}">${num(waiting[0]?.total ?? 0)}</div><div class="k">چاوەڕوانی ژوورەکانی تر</div></div>
        </div>

        ${late.length ? html`
          <div class="card attention">
            <h2>دواکەوتوو <span class="pill muted">${num(late.length)}</span></h2>
            <div class="table-wrap"><table>
              <thead><tr><th>ژمارە</th><th>بابەت</th><th>نێردەر</th><th>کۆتا کات</th><th>کاغەز</th></tr></thead>
              <tbody>${late.map(deskRow)}</tbody>
            </table></div>
          </div>` : ''}

        ${today.length ? html`
          <div class="card">
            <h2>کۆتایی کاتیان ئەمڕۆیە <span class="pill muted">${num(today.length)}</span></h2>
            <div class="table-wrap"><table>
              <thead><tr><th>ژمارە</th><th>بابەت</th><th>نێردەر</th><th>کۆتا کات</th><th>کاغەز</th></tr></thead>
              <tbody>${today.map(deskRow)}</tbody>
            </table></div>
          </div>` : ''}

        <div class="card">
          <div class="card-head">
            <h2>چاوەڕوانی ژوورەکانی تر <span class="pill muted">${num(waiting[0]?.total ?? 0)}</span></h2>
            ${lateOut.length ? html`<div class="end"><span class="pill danger">${num(lateOut.length)} دواکەوتوو</span></div>` : ''}
          </div>
          <p class="card-sub">
            ئەم کتابانە تۆ ناردوتنە بۆ ژوورێکی تر و هێشتا نەگەڕاونەتەوە.
            ${Number(waiting[0]?.total ?? 0) > waiting.length ? html`
              دواکەوتووەکان، کۆنترینەکان و هەموو ئەوانەی ئەم هەفتەیە ناردووتن لێرەن؛
              ${num(Number(waiting[0].total) - waiting.length)} کتابی تر لە <a href="/documents">گەڕان</a> دەدۆزرێنەوە.` : ''}
          </p>
          ${waiting.length === 0 ? html`
            <div class="empty">هیچ کتابێکت لای کەس نییە. ڕۆژێکی باش.</div>` : html`
            <div class="table-wrap"><table>
              <thead><tr>
                <th>ژمارە</th><th>بابەت</th><th>ئێستا لای</th><th>ماوە</th><th>کۆتا کات</th><th class="actions"><span class="sr-only">کردار</span></th>
              </tr></thead>
              <tbody>
                ${waiting.map(w => {
                  // One chase a day, and the button says so rather than failing
                  // when it is pressed.
                  const chasedToday = w.my_last_note
                    && new Date(w.my_last_note).toDateString() === now.toDateString();
                  return html`<tr>
                    <td class="mono">${ltr(w.incoming_no)}</td>
                    <td><a href="/documents/${w.id}">${w.subject}</a> ${priorityPill(w.priority)}</td>
                    <td>${w.room_name ?? '—'}${w.room_number ? html` <span class="muted">(${num(w.room_number)})</span>` : ''}
                        ${w.with_name ? html`<span class="cell-sub">${w.with_name}</span>` : ''}
                        ${w.received_at ? '' : html`<span class="cell-sub">هێشتا نەیکردۆتەوە</span>`}</td>
                    <td>${elapsed(w.sent_at)}<span class="cell-sub">${date(w.sent_at)}</span></td>
                    <td>${dueCell(w)}</td>
                    <td>
                      ${chasedToday ? html`<span class="muted">ئەمڕۆ داوات کردووە</span>` : html`
                        <form method="post" action="/documents/${w.id}/chase" style="margin:0">
                          <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                          <input type="hidden" name="back" value="/my-day">
                          <button class="btn small secondary" type="submit">بیریان بخەرەوە</button>
                        </form>`}
                    </td>
                  </tr>`;
                })}
              </tbody>
            </table></div>`}
        </div>

        ${rest.length ? html`
          <div class="card">
            <h2>ئەوانی تر لەسەر مێزی من <span class="pill muted">${num(rest.length)}</span></h2>
            <div class="table-wrap"><table>
              <thead><tr><th>ژمارە</th><th>بابەت</th><th>نێردەر</th><th>کۆتا کات</th><th>کاغەز</th></tr></thead>
              <tbody>${rest.map(deskRow)}</tbody>
            </table></div>
          </div>` : ''}

        ${paperWaiting.length ? html`
          <div class="card">
            <h2>کاغەزەکەیان نەگەیشتووە <span class="pill muted">${num(paperWaiting.length)}</span></h2>
            <p class="card-sub">
              تۆمارەکە گەیشتووە بەڵام پەڕگەی کاغەزی هێشتا وەرنەگیراوە.
            </p>
            <div class="table-wrap"><table>
              <thead><tr><th>ژمارە</th><th>بابەت</th><th>ماوە</th></tr></thead>
              <tbody>${paperWaiting.map(r => html`<tr>
                <td class="mono">${ltr(r.incoming_no)}</td>
                <td><a href="/documents/${r.document_id}">${r.subject}</a></td>
                <td class="muted">${elapsed(r.sent_at)}</td>
              </tr>`)}</tbody>
            </table></div>
          </div>` : ''}
      `,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Chasing
// ---------------------------------------------------------------------------

const CHASE_TEXT = 'تکایە بەدواداچوون بۆ ئەم کتابە بکرێت. لە ڕۆژی من داوا کرا.';

router.post('/documents/:id(\\d+)/chase', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  const back = req.body.back === '/my-day' ? '/my-day' : `/documents/${id}`;
  try {
    const outcome = await withActor(req.user, async q => {
      const { rows: [doc] } = await q(`
        SELECT d.id, d.current_room_id, d.status,
               s.assigned_by, s.from_room_id
          FROM document d
          LEFT JOIN routing_step s ON s.id = d.current_step_id AND s.status = 'active'
         WHERE d.id = $1`, [id]);
      if (!doc) return { error: 'ئەم کتابە نەدۆزرایەوە.' };
      if (['closed', 'cancelled'].includes(doc.status)) return { error: 'ئەم کتابە داخراوە.' };
      if (!doc.current_room_id) return { error: 'ئەم کتابە لای هیچ ژوورێک نییە.' };
      // Nothing is waiting, so there is nobody to ask. Said before the
      // permission check below, because "only the sender may chase" is a
      // baffling thing to be told about a letter that has already come back.
      if (!doc.assigned_by && !doc.from_room_id) {
        return { error: 'ئەم کتابە لە چاوەڕوانی هیچ ژوورێک نییە.' };
      }
      if (doc.current_room_id === req.user.roomId) return { error: 'ئەم کتابە لەسەر مێزی خۆتە.' };

      // Chasing belongs to whoever is waiting for the letter, not to everybody
      // who can read it.
      //
      // Checked here and not only by hiding the button. The button is hidden for
      // everyone else, and a hidden button is a decoration: anything that is
      // actually a rule has to be refused by the thing that does the work. The
      // first version of this only hid it, and the mayor, who can read every
      // letter in the building, could chase any of them by posting at it.
      //
      // The room that sent it counts, not only the person: a head chasing on
      // behalf of a clerk who is on leave is the ordinary case, and telling them
      // to wait for the clerk to come back would be absurd.
      const sentByMe = doc.assigned_by === req.user.id;
      const sentByMyRoom = doc.from_room_id && doc.from_room_id === req.user.roomId;
      if (!sentByMe && !sentByMyRoom) {
        return { error: 'تەنها ئەو کەسە یان ئەو ژوورەی ناردوویەتی دەتوانێت داوای بەدواداچوون بکات.' };
      }

      // Once a day, per person, per letter. Checked against this person's own
      // notes rather than a counter, so it survives a restart and reads as what
      // it is: you already asked today.
      const { rows: [recent] } = await q(`
        SELECT 1 FROM activity_log
         WHERE document_id = $1 AND user_id = $2 AND action = 'note.added'
           AND detail->>'chase' = 'true' AND occurred_at > now() - interval '20 hours'
         LIMIT 1`, [id, req.user.id]);
      if (recent) return { error: 'ئەمڕۆ پێشتر داوات کردووە. جارێکی تر سبەینێ.' };

      const body = (req.body.note ?? '').toString().trim() || CHASE_TEXT;
      const { rows: [n] } = await q(
        `INSERT INTO document_note (document_id, room_id, author_id, body)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [id, req.user.roomId, req.user.id, body.slice(0, 2000)]);

      await logEvent(q, {
        action: 'note.added', req, userId: req.user.id, roomId: req.user.roomId,
        documentId: id, detail: { note_id: n.id, length: body.length, chase: true },
      });

      // The same delivery a remark always gets. The room holding the letter is
      // told; the text stays on the letter and is read there, under its rules.
      await notifyRoom(q, {
        roomId: doc.current_room_id, kind: 'note.added', documentId: id,
        actorId: req.user.id, req, detail: { note_id: n.id, chase: true },
      });
      return { ok: true };
    });

    if (outcome.error) {
      return res.redirect(303, `${back}?error=${encodeURIComponent(outcome.error)}`);
    }
    res.redirect(303, `${back}?chased=1`);
  } catch (err) { next(err); }
});

export default router;
