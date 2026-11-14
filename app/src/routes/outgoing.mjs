// The outgoing register (ناردراوەکان).
//
// Screen: design/Outgoing.dc.html.
//
// Two lists. Letters that are finished and waiting for the registry to give them
// an outgoing number, and letters that have already gone out. The first list is
// the registry clerk's work queue for the day.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { page } from '../views/layout.mjs';
import { html, num, date, elapsed, ltr } from '../lib/html.mjs';
import { CHANNELS } from './registry.mjs';

const router = Router();

const channelName = c => CHANNELS.find(x => x[0] === c)?.[1] ?? c ?? '';

router.get('/outgoing', requireAuth, async (req, res, next) => {
  try {
    const { ready, sent } = await withActor(req.user, async q => {
      const { rows: ready } = await q(`
        SELECT d.id, d.incoming_no, d.subject, d.sender_name, d.updated_at, r.name AS room_name
          FROM document d LEFT JOIN room r ON r.id = d.current_room_id
         WHERE d.status = 'ready_to_close'
         ORDER BY d.updated_at`);
      const { rows: sent } = await q(`
        SELECT d.id, d.incoming_no, d.outgoing_no, d.outgoing_date, d.subject,
               d.outgoing_recipient, d.outgoing_channel, u.full_name AS by_name
          FROM document d LEFT JOIN app_user u ON u.id = d.outgoing_registered_by
         WHERE d.status = 'closed'
         ORDER BY d.outgoing_year DESC, d.outgoing_seq DESC
         LIMIT 100`);
      return { ready, sent };
    });

    res.send(page({
      user: req.user, title: 'ناردراوەکان', current: '/outgoing',
      body: html`
        <div class="card">
          <h2>ئامادەی داخستن <span class="pill muted">${num(ready.length)}</span></h2>
          <p class="card-sub">کارەکەیان تەواوبووە و چاوەڕوانی ژمارەی دەرچوون.</p>
          ${ready.length === 0 ? html`<div class="empty">هیچ کتابێک چاوەڕوانی داخستن نییە.</div>` : html`
            <div class="table-wrap"><table>
              <thead><tr><th>ژمارە</th><th>بابەت</th><th>نێردەر</th><th>کاغەزەکە لای</th><th>ماوە</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
              <tbody>${ready.map(d => html`<tr>
                <td class="mono">${ltr(d.incoming_no)}</td>
                <td><a href="/documents/${d.id}">${d.subject}</a></td>
                <td>${d.sender_name}</td>
                <td class="muted">${d.room_name ?? '—'}</td>
                <td class="muted">${elapsed(d.updated_at)}</td>
                <td><a class="btn small" href="/documents/${d.id}#close">داخستن</a></td>
              </tr>`)}</tbody>
            </table></div>`}
        </div>

        <div class="card">
          <h2>دوایین کتابە دەرچووەکان</h2>
          ${sent.length === 0 ? html`<div class="empty">هێشتا هیچ کتابێک دەرنەچووە.</div>` : html`
            <div class="table-wrap"><table>
              <thead><tr><th>ژمارەی دەرچوو</th><th>بەروار</th><th>بابەت</th><th>وەرگر</th><th>ڕێگا</th><th>ژمارە</th><th>لەلایەن</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
              <tbody>${sent.map(d => html`<tr>
                <td class="mono"><strong>${ltr(d.outgoing_no)}</strong></td>
                <td>${date(d.outgoing_date)}</td>
                <td><a href="/documents/${d.id}">${d.subject}</a></td>
                <td>${d.outgoing_recipient}</td>
                <td class="muted">${channelName(d.outgoing_channel)}</td>
                <td class="mono muted">${ltr(d.incoming_no)}</td>
                <td class="muted">${d.by_name ?? ''}</td>
                <td><a class="btn small secondary" href="/documents/${d.id}/compare">بەراورد</a></td>
              </tr>`)}</tbody>
            </table></div>`}
        </div>`,
    }));
  } catch (err) { next(err); }
});

export default router;
