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
import { CHANNELS, exportCard } from './registry.mjs';
import { logEvent } from '../lib/log.mjs';
import { toCsv, sendCsv, exportRange } from '../lib/csv.mjs';

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
        </div>

        ${exportCard('/outgoing/export.csv', exportRange(req.query), 'تۆماری دەرچوو بۆ Excel',
          'هەموو ئەو کتابانەی لەم ماوەیەدا ژمارەی دەرچوویان وەرگرتووە، بە وەرگر و ڕێگای ناردن.')}`,
    }));
  } catch (err) { next(err); }
});

router.get('/outgoing/export.csv', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'sysadmin') return res.status(403).send('');
    const range = exportRange(req.query);
    const rows = await withActor(req.user, async q => {
      // Under row-level security, like the screen: each person's file holds the
      // letters they may open, and nothing else.
      const { rows } = await q(`
        SELECT d.outgoing_no, to_char(d.outgoing_date, 'YYYY-MM-DD') AS outgoing_date, d.subject,
               d.outgoing_recipient, d.outgoing_channel, d.incoming_no,
               to_char(d.incoming_date, 'YYYY-MM-DD') AS incoming_date, d.sender_name,
               to_char(d.reply_by, 'YYYY-MM-DD') AS reply_by,
               (d.reply_by IS NOT NULL AND d.outgoing_date > d.reply_by) AS late_reply,
               u.full_name AS by_name
          FROM document d LEFT JOIN app_user u ON u.id = d.outgoing_registered_by
         WHERE d.outgoing_no IS NOT NULL AND d.outgoing_date BETWEEN $1::date AND $2::date
         ORDER BY d.outgoing_year, d.outgoing_seq
         LIMIT 50000`, [range.from, range.to]);
      await logEvent(q, { action: 'export.outgoing', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { from: range.from, to: range.to, rows: rows.length } });
      return rows;
    });
    sendCsv(res, `outgoing-${range.from}-${range.to}.csv`, toCsv([
      ['ژمارەی دەرچوو', r => r.outgoing_no],
      ['بەرواری دەرچوو', r => r.outgoing_date],
      ['بابەت', r => r.subject],
      ['وەرگر', r => r.outgoing_recipient],
      ['ڕێگای ناردن', r => channelName(r.outgoing_channel)],
      ['ژمارەی هاتوو', r => r.incoming_no],
      ['بەرواری هاتوو', r => r.incoming_date],
      ['نێردەری کتابی هاتوو', r => r.sender_name],
      ['بەڵێنی وەڵام', r => r.reply_by],
      ['دوای بەڵێن وەڵام درایەوە', r => (r.late_reply ? 'بەڵێ' : '')],
      ['لەلایەن', r => r.by_name],
    ], rows));
  } catch (err) { next(err); }
});

export default router;
