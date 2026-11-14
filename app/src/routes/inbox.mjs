// A room's inbox (کتابە هاتووەکان).
//
// Screen: design/Inbox.dc.html.
//
// What is sitting on this room's desk right now, oldest first, with anything
// past its deadline pushed to the top. This is the screen most staff will have
// open all day, so it says one thing: what do I owe, and how late am I.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, roomContext } from '../lib/auth.mjs';
import { roomInbox } from '../lib/routing.mjs';
import { page } from '../views/layout.mjs';
import { html, num, date, elapsed, ltr, initials } from '../lib/html.mjs';

const router = Router();

const PRIORITY_PILL = {
  very_urgent: ['danger', 'زۆر پەلە'],
  urgent:      ['warn',   'پەلە'],
  normal:      [null,     null],
};

router.get('/inbox', requireAuth, async (req, res, next) => {
  try {
    // A room head or clerk sees their own room. The mayor and his deputy can
    // look into any room, which is what "sees every room as if it were open on
    // his own desk" means in practice.
    const asksFor = req.query.room ? Number(req.query.room) : null;
    const showAll = req.query.all === '1';
    const canLookAnywhere = ['mayor', 'deputy_mayor', 'directorate_head'].includes(req.user.role);
    // Only into a room the database lets this person see. A directorate head
    // could open any room's inbox by number and was shown it empty, a room with a
    // hundred and forty open letters as "clean" (letters test, 13 September).
    const { rooms: visible } = await roomContext(req.user);
    const roomId = (asksFor && canLookAnywhere && visible.some(r => Number(r.id) === asksFor)) ? asksFor : req.user.roomId;

    if (!roomId) {
      return res.send(page({
        user: req.user, title: 'کتابە هاتووەکان', current: '/inbox',
        body: html`<div class="card"><div class="empty">
          تۆ سەر بە هیچ ژوورێک نیت، بۆیە سندوقی هاتوو نییە.
        </div></div>`,
      }));
    }

    // The rooms this person may look into, from the same function row-level
    // security uses. For almost everyone it is one room and no switcher appears.
    const rooms = visible;

    const { rows, room, stats, unsent } = await withActor(req.user, async q => {
      // A hundred is the right length for a screen somebody reads. A room that
      // is further behind than that can ask for the lot, and then gets the lot.
      const rows = await roomInbox(q, roomId, { limit: showAll ? 2000 : 100 });
      const { rows: [room] } = await q(`SELECT id, name, room_number FROM room WHERE id = $1`, [roomId]);

      // How this room is doing, in the four numbers a room head actually asks
      // about. Thirty days, because a month is the unit people compare against.
      const { rows: [stats] } = await q(`
        SELECT
          count(*) FILTER (WHERE status = 'active')                                      AS open,
          count(*) FILTER (WHERE status = 'active' AND due_at < now())                    AS late,
          count(*) FILTER (WHERE status = 'active' AND paper_received_at IS NULL)          AS paper_waiting,
          count(*) FILTER (WHERE status = 'done' AND completed_at > now() - interval '30 days')
                                                                                          AS done_30d,
          avg(extract(epoch FROM (completed_at - sent_at)) / 3600)
            FILTER (WHERE status = 'done' AND completed_at > now() - interval '30 days')   AS avg_hours
          FROM routing_step WHERE to_room_id = $1`, [roomId]);

      // Letters this room started and has not sent anywhere yet (migration 0450).
      // They are on nobody's inbox, because nobody has been sent them, so without
      // this list a memo typed on Sunday is found again on Thursday by accident.
      const { rows: unsent } = await q(`
        SELECT d.id, d.incoming_no, d.subject, d.incoming_registered_at, u.full_name AS registered_by_name
          FROM document d
          LEFT JOIN app_user u ON u.id = d.incoming_registered_by
         WHERE d.origin_room_id = $1 AND d.status = 'registered'
         ORDER BY d.id DESC
         LIMIT 50`, [roomId]);

      return { rows, room, stats, unsent };
    });

    // The tabs above the list (design/Inbox.dc.html): the same rows, narrowed.
    // Links rather than scripts, so a tab survives a reload and can be bookmarked.
    const TABS = [
      ['all',     'هەمووی',       () => true],
      ['new',     'نوێ',          r => !r.received_at],
      ['working', 'لەژێر کاردا',  r => r.received_at && !r.overdue],
      ['late',    'دواکەوتوو',    r => r.overdue],
      ['urgent',  'پەلە',         r => r.priority === 'urgent' || r.priority === 'very_urgent'],
    ];
    const tab = TABS.find(t => t[0] === req.query.show) ?? TABS[0];
    const shown = rows.filter(tab[2]);
    const tabHref = key => {
      const p = new URLSearchParams();
      if (Number(roomId) !== Number(req.user.roomId)) p.set('room', roomId);
      if (showAll) p.set('all', '1');
      if (key !== 'all') p.set('show', key);
      const s = p.toString();
      return s ? `/inbox?${s}` : '/inbox';
    };

    const late = rows.filter(r => r.overdue).length;
    // The room's whole count, the same as the tile, not the length of this list.
    const paperWaiting = Number(stats.paper_waiting);
    // roomInbox stops at a hundred. A room that is that far behind was showing
    // its oldest hundred and saying nothing about the rest, so the letters that
    // arrived most recently were invisible on the one screen meant to show what
    // the room owes. Say so instead.
    const hidden = Math.max(0, Number(stats.open) - rows.length);
    const unopenedBeyond = rows.filter(r => Number(r.rn) > 100).length;

    res.send(page({
      user: req.user,
      title: room ? `کتابە هاتووەکان — ${room.name}${room.room_number ? ` (${num(room.room_number)})` : ''}` : 'کتابە هاتووەکان',
      current: '/inbox',
      // The room's real number of open letters, not the length of the list on the
      // screen: the badge said ١٠٠ beside a tile saying ١١٣.
      counts: { inbox: Number(stats.open) },
      actions: req.user.role !== 'sysadmin' ? html`<a class="btn" href="/registry/new">کتابی نوێ</a>` : null,
      // The switcher lives in the page shell now, so every screen that can look
      // into more than one room offers the same control in the same place.
      rooms, viewingRoomId: roomId,
      body: html`
        ${hidden > 0 ? html`<div class="notice warn">
          ${num(hidden)} کتابی کراوەی کۆنتر لێرە نیشان نەدراون${unopenedBeyond ? html`؛ هەموو کتابە نەکراوەکان
          (${num(unopenedBeyond)} لەوانە نوێن) لە لیستەکەدان` : ''}.
          <a href="/inbox?room=${roomId}&all=1">هەموویان پیشان بدە</a>
        </div>` : ''}

        ${late > 0 ? html`<div class="notice warn">
          ${num(late)} کتاب لە کاتی دیاریکراو تێپەڕیوە.
        </div>` : ''}

        ${paperWaiting > 0 ? html`<div class="notice info">
          ${num(paperWaiting)} پەڕگەی کاغەزی هێشتا نەگەیشتووەتە ژوورەکە.
          <a href="/manifests">لیستی گەیاندن</a>
        </div>` : ''}

        <!-- The same tiles as the dashboard and my day, rather than cards rebuilt
             with their own sizes. Two to a row on a phone (app.css), so the
             letters are not four screens down. -->
        <div class="grid cols-4 stats">
          <div class="stat"><div class="n">${num(stats.open)}</div><div class="k">کراوە</div></div>
          <div class="stat"><div class="n${Number(stats.late) ? ' danger' : ''}">${num(stats.late)}</div><div class="k">دواکەوتوو</div></div>
          <div class="stat"><div class="n">${num(stats.paper_waiting)}</div><div class="k">پەڕگەی نەگەیشتوو</div></div>
          <div class="stat"><div class="n">${num(stats.done_30d)}</div><div class="k">تەواوکراو (٣٠ ڕۆژ)${stats.avg_hours
            ? html` · بە ناوەند ${num(Math.round(Number(stats.avg_hours) / 24 * 10) / 10)} ڕۆژ` : ''}</div></div>
        </div>

        ${unsent.length ? html`
          <div class="card">
            <h2>کتابە نوێیەکانی ئەم ژوورە کە هێشتا نەنێردراون <span class="pill muted">${num(unsent.length)}</span></h2>
            <div class="table-wrap"><table>
              <thead><tr>
                <th>ژمارە</th><th>بابەت</th><th>تۆمارکرا لەلایەن</th><th>ماوە</th><th class="actions"><span class="sr-only">کردار</span></th>
              </tr></thead>
              <tbody>
                ${unsent.map(d => html`<tr>
                  <td class="mono">${ltr(d.incoming_no)}</td>
                  <td><a href="/documents/${d.id}">${d.subject}</a></td>
                  <td>${d.registered_by_name ?? '—'}</td>
                  <td class="muted">${elapsed(d.incoming_registered_at)}</td>
                  <td><a class="btn small secondary" href="/documents/${d.id}">کردنەوە</a></td>
                </tr>`)}
              </tbody>
            </table></div>
          </div>` : ''}

        <div class="card">
          ${rows.length ? html`<nav class="tabs" aria-label="بەشەکانی لیست">
            ${TABS.map(([key, label, test]) => html`<a class="tab" href="${tabHref(key)}"
              ${key === tab[0] ? html`aria-current="page"` : ''}>${label} <span class="tab-count">${num(rows.filter(test).length)}</span></a>`)}
          </nav>` : ''}
          ${rows.length === 0
            ? html`<div class="empty">هیچ کتابێکی چاوەڕوان نییە. ژوورەکە پاکە.</div>`
            : shown.length === 0
            ? html`<div class="empty">لەم بەشەدا هیچ کتابێک نییە. <a href="${tabHref('all')}">هەمووی پیشان بدە</a></div>`
            : html`<div class="table-wrap"><table>
                <thead><tr>
                  <th>ژمارە</th><th>بابەت</th><th>لە</th><th>ماوە</th><th>کاغەز</th><th>دۆخ</th><th class="actions"><span class="sr-only">کردار</span></th>
                </tr></thead>
                <tbody>
                  ${shown.map(r => {
                    const [pk, pl] = PRIORITY_PILL[r.priority] ?? [];
                    return html`<tr>
                      <td class="mono">${ltr(r.incoming_no)}</td>
                      <td>
                        <a href="/documents/${r.document_id}">${r.subject}</a>
                        ${pl ? html` <span class="pill ${pk}">${pl}</span>` : ''}
                        ${r.group_size > 1 ? html`
                          <span class="pill muted">${num(r.group_position)} لە ${num(r.group_size)}</span>` : ''}
                        ${r.note ? html`<span class="cell-sub">${r.note}</span>` : ''}
                      </td>
                      <td>
                        ${r.from_room_name ?? '—'}
                        ${r.assigned_by_name ? html`<span class="cell-sub">${r.assigned_by_name}</span>` : ''}
                      </td>
                      <td class="muted">${elapsed(r.sent_at)}</td>
                      <td>
                        ${r.paper_received_at
                          ? html`<span class="pill ok">وەرگیراوە</span>`
                          : html`<span class="pill warn">نەگەیشتووە</span>`}
                      </td>
                      <td>
                        ${r.overdue
                          ? html`<span class="pill danger">دواکەوتوو</span>`
                          : r.received_at
                            ? html`<span class="pill warn">لەژێر کاردا</span>`
                            : html`<span class="pill info">نوێ</span>`}
                      </td>
                      <td><a class="btn small secondary" href="/documents/${r.document_id}">کردنەوە</a></td>
                    </tr>`;
                  })}
                </tbody>
              </table></div>`}
        </div>`,
    }));
  } catch (err) { next(err); }
});

export default router;
