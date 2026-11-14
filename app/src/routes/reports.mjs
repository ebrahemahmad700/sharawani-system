// The weekly room report (ڕاپۆرتی هەفتانە).
//
// Saturday's staff meeting starts with the same question every week: how did
// each room do. The answer was in the system, spread across every trail, and
// nobody was going to add it up by hand. This page adds it up.
//
// For each room, for one week (Saturday to Friday, Rania's week), and the week
// before it for comparison:
//
//   received       steps that arrived in the room that week
//   finished       steps the room finished or sent back that week
//   average days   how long those finished steps had been in the room
//   finished late  of those, how many went past their deadline
//   open at end    steps still in the room when the week ended
//   late at end    of those, how many were already past their deadline
//
// plus, on the printed sheet, the letters that were late at the end of the week
// and who finished how many. Every figure is counted from routing_step as the
// person asking, so row-level security decides which rooms a head sees: the
// mayor all of them, a room head their own.
//
// The deadlines job tells the readers on Saturday morning (lib/jobs-core.mjs).

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { page, bare, asset } from '../views/layout.mjs';
import { html, num, date, time, ltr, TIME_ZONE } from '../lib/html.mjs';

const router = Router();

const READERS = ['mayor', 'deputy_mayor', 'directorate_head', 'room_head'];

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Today's calendar date in Rania, as a UTC midnight Date for arithmetic. */
function todayInRania() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

/** The Saturday that starts the week containing a day. */
function weekStart(day) {
  const d = new Date(day);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7));
  return d;
}
const plusDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

/**
 * Which week was asked for. ?week= any day of it; without one, the last whole
 * week, which is what a Saturday meeting discusses.
 */
function chosenWeek(q) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(q ?? ''));
  const today = todayInRania();
  let start = m ? weekStart(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))) : plusDays(weekStart(today), -7);
  if (Number.isNaN(start.getTime())) start = plusDays(weekStart(today), -7);
  // Nothing to count in a week that has not started.
  if (start > weekStart(today)) start = weekStart(today);
  return { start, end: plusDays(start, 7), current: iso(start) === iso(weekStart(today)) };
}

const dayLabel = d => num(`${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`);
const weekLabel = w => html`${dayLabel(w.start)} – ${dayLabel(plusDays(w.start, 6))}`;

// One row per room for one week. Timestamps are compared against the week's
// edges at midnight in Rania, not in the server's clock.
const ROOM_WEEK_SQL = `
  WITH b AS (
    SELECT ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}') AS t0,
           (($1::date + 7)::timestamp AT TIME ZONE '${TIME_ZONE}') AS t1
  )
  SELECT r.id, r.name, r.room_number, r.kind, h.full_name AS head_name,
         count(s.id) FILTER (WHERE s.sent_at >= b.t0 AND s.sent_at < b.t1)                                   AS received,
         count(s.id) FILTER (WHERE s.status IN ('done', 'returned') AND s.completed_at >= b.t0 AND s.completed_at < b.t1) AS finished,
         count(s.id) FILTER (WHERE s.status = 'returned' AND s.completed_at >= b.t0 AND s.completed_at < b.t1)  AS returned,
         avg(extract(epoch FROM (s.completed_at - s.sent_at)) / 86400)
           FILTER (WHERE s.status IN ('done', 'returned') AND s.completed_at >= b.t0 AND s.completed_at < b.t1) AS avg_days,
         count(s.id) FILTER (WHERE s.status IN ('done', 'returned') AND s.completed_at >= b.t0 AND s.completed_at < b.t1
                             AND s.completed_at > s.due_at)                                                 AS finished_late,
         count(s.id) FILTER (WHERE s.sent_at < b.t1 AND (s.completed_at IS NULL OR s.completed_at >= b.t1))     AS open_at_end,
         -- Late by the end of the week, or by now in a week still running: a
         -- deadline next Friday is not late on Sunday (feature test, 13 September).
         count(s.id) FILTER (WHERE s.sent_at < b.t1 AND (s.completed_at IS NULL OR s.completed_at >= b.t1)
                             AND s.due_at < least(now(), b.t1))                                            AS late_at_end
    FROM room r
    CROSS JOIN b
    LEFT JOIN app_user h ON h.id = r.head_user_id
    LEFT JOIN routing_step s ON s.to_room_id = r.id AND s.sent_at IS NOT NULL AND s.sent_at < b.t1
   WHERE r.is_active AND r.kind <> 'executive'
     AND r.id = ANY ((SELECT app_visible_rooms())::bigint[])
   GROUP BY r.id, h.full_name, r.sort_order
   ORDER BY r.sort_order, r.name`;

async function reportData(q, week) {
  const { rows: now } = await q(ROOM_WEEK_SQL, [iso(week.start)]);
  const { rows: before } = await q(ROOM_WEEK_SQL, [iso(plusDays(week.start, -7))]);
  const prev = new Map(before.map(r => [String(r.id), r]));
  const rooms = now.map(r => ({ ...r, prev: prev.get(String(r.id)) ?? null }));
  return { rooms };
}

/** The late letters at the end of the week and who finished what, for the printed sheet. */
async function roomDetail(q, week, roomIds) {
  if (!roomIds.length) return { late: [], people: [] };
  const t0 = iso(week.start), t1 = iso(week.end);
  const { rows: late } = await q(`
    SELECT s.to_room_id, d.id AS document_id, d.incoming_no, d.subject, u.full_name AS holder_name,
           extract(epoch FROM (least(now(), ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')) - s.due_at)) / 86400 AS days_late
      FROM routing_step s
      JOIN document d ON d.id = s.document_id
      LEFT JOIN app_user u ON u.id = s.assigned_to
     WHERE s.to_room_id = ANY ($2::bigint[])
       AND s.sent_at < ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
       AND (s.completed_at IS NULL OR s.completed_at >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}'))
       AND s.due_at < least(now(), ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}'))
     ORDER BY s.due_at
     LIMIT 400`, [t1, roomIds]);
  const { rows: people } = await q(`
    SELECT s.to_room_id, u.full_name, count(*) AS finished
      FROM routing_step s
      JOIN app_user u ON u.id = s.completed_by
     WHERE s.to_room_id = ANY ($3::bigint[])
       AND s.status IN ('done', 'returned')
       AND s.completed_at >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
       AND s.completed_at <  ($2::date::timestamp AT TIME ZONE '${TIME_ZONE}')
     GROUP BY s.to_room_id, u.full_name
     ORDER BY count(*) DESC`, [t0, t1, roomIds]);
  return { late, people };
}

// Whether a change is good news. More finished is better; more late, more open
// and longer waits are worse; more received is neither.
const TONE = { received: 0, finished: 1, avg_days: -1, finished_late: -1, open_at_end: -1, late_at_end: -1 };

function delta(key, r) {
  if (!r.prev) return '';
  const a = key === 'avg_days' ? Number(r[key] ?? 0) : Number(r[key]);
  const b = key === 'avg_days' ? Number(r.prev[key] ?? 0) : Number(r.prev[key]);
  const diff = key === 'avg_days' ? Math.round((a - b) * 10) / 10 : a - b;
  if (!diff) return html`<span class="delta same">وەک پێشوو</span>`;
  const better = TONE[key] === 0 ? null : (diff > 0) === (TONE[key] > 0);
  const cls = better === null ? 'info' : better ? 'good' : 'bad';
  return html`<span class="delta ${cls}">${diff > 0 ? '▲' : '▼'} ${num(Math.abs(diff))}</span>`;
}

const fmtDays = v => (v === null || v === undefined ? '—' : num(Math.round(Number(v) * 10) / 10));
const quiet = r => !Number(r.received) && !Number(r.finished) && !Number(r.open_at_end)
                   && (!r.prev || (!Number(r.prev.received) && !Number(r.prev.finished) && !Number(r.prev.open_at_end)));

function totals(rooms) {
  const t = { received: 0, finished: 0, finished_late: 0, open_at_end: 0, late_at_end: 0 };
  const p = { received: 0, finished: 0, finished_late: 0, open_at_end: 0, late_at_end: 0 };
  let wsum = 0, wn = 0, psum = 0, pn = 0;
  for (const r of rooms) {
    for (const k of Object.keys(t)) { t[k] += Number(r[k]); if (r.prev) p[k] += Number(r.prev[k]); }
    if (r.avg_days !== null) { wsum += Number(r.avg_days) * Number(r.finished); wn += Number(r.finished); }
    if (r.prev?.avg_days !== null && r.prev) { psum += Number(r.prev.avg_days ?? 0) * Number(r.prev.finished); pn += Number(r.prev.finished); }
  }
  return { ...t, avg_days: wn ? wsum / wn : null, prev: { ...p, avg_days: pn ? psum / pn : null } };
}

const METRICS = [
  ['received',      'هاتوو'],
  ['finished',      'تەواوکراو'],
  ['avg_days',      'تێکڕای ڕۆژ'],
  ['finished_late', 'بە دواکەوتن تەواوکراو'],
  ['open_at_end',   'کراوە لە کۆتایی هەفتە'],
  ['late_at_end',   'دواکەوتوو لە کۆتایی هەفتە'],
];

router.get('/reports/weekly', requireAuth, requireRole(...READERS), async (req, res, next) => {
  try {
    const week = chosenWeek(req.query.week);
    const { rooms } = await withActor(req.user, async q => {
      const data = await reportData(q, week);
      await logEvent(q, { action: 'report.viewed', req, userId: req.user.id, roomId: req.user.roomId, detail: { week: iso(week.start) } });
      return data;
    });
    const all = totals(rooms);
    const busy = rooms.filter(r => !quiet(r));
    const today = weekStart(todayInRania());
    const prevWeek = iso(plusDays(week.start, -7));
    const nextWeek = plusDays(week.start, 7) <= today ? iso(plusDays(week.start, 7)) : null;

    res.send(page({
      user: req.user, title: 'ڕاپۆرتی هەفتانە', current: '/reports/weekly',
      actions: html`<a class="btn" href="/reports/weekly/print?week=${iso(week.start)}" target="_blank">چاپی ڕاپۆرت</a>`,
      body: html`
        <div class="card">
          <div class="card-head">
            <h2>هەفتەی ${weekLabel(week)}${week.current ? html` <span class="pill warn">هێشتا تەواو نەبووە</span>` : ''}</h2>
            <div class="end">
              <a class="btn small secondary" href="/reports/weekly?week=${prevWeek}">هەفتەی پێشوو</a>
              ${nextWeek ? html`<a class="btn small secondary" href="/reports/weekly?week=${nextWeek}">هەفتەی دواتر</a>` : ''}
              ${week.current ? '' : html`<a class="btn small secondary" href="/reports/weekly?week=${iso(today)}">ئەم هەفتەیە</a>`}
            </div>
          </div>
          <p class="card-sub">
            هەفتە لە شەممەوە تا هەینی. هەر ژمارەیەک بەراورد دەکرێت بە هەفتەی پێشوو:
            سەوز واتە باشتر، سوور واتە خراپتر.
          </p>
          <div class="grid cols-3 report-totals">
            ${METRICS.map(([k, label]) => html`<div class="stat">
              <div class="n">${k === 'avg_days' ? fmtDays(all.avg_days) : num(all[k])}</div>
              <div class="k">${label} ${delta(k, all)}</div>
            </div>`)}
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>ژوورەکان <span class="pill muted">${num(rooms.length)}</span></h2>
          </div>
          ${rooms.length === 0 ? html`<div class="empty">هیچ ژوورێک نییە کە بتوانیت ڕاپۆرتەکەی ببینیت.</div>` : html`
          <div class="table-wrap"><table class="report-table">
            <thead><tr>
              <th>ژوور</th>
              ${METRICS.map(([, label]) => html`<th>${label}</th>`)}
            </tr></thead>
            <tbody>${rooms.map(r => html`<tr class="${quiet(r) ? 'inactive' : ''}">
              <td><strong>${r.name}</strong>${r.room_number ? html` <span class="muted">(${num(r.room_number)})</span>` : ''}
                ${r.head_name ? html`<span class="cell-sub">${r.head_name}</span>` : ''}</td>
              ${METRICS.map(([k]) => html`<td class="nowrap">
                <span class="${(k === 'late_at_end' || k === 'finished_late') && Number(r[k]) > 0 ? 'text-danger' : ''}">${k === 'avg_days' ? fmtDays(r[k]) : num(r[k])}</span>
                ${delta(k, r)}
              </td>`)}
            </tr>`)}</tbody>
          </table></div>
          <p class="hint">${num(busy.length)} ژوور چالاکی هەبووە. ژوورە کاڵەکان لەم دوو هەفتەیەدا هیچ کتابێکیان نەبووە و لە چاپدا نایەن.</p>`}
        </div>`,
    }));
  } catch (err) { next(err); }
});

router.get('/reports/weekly/print', requireAuth, requireRole(...READERS), async (req, res, next) => {
  try {
    const week = chosenWeek(req.query.week);
    const { rooms, late, people } = await withActor(req.user, async q => {
      const { rooms } = await reportData(q, week);
      const busy = rooms.filter(r => !quiet(r));
      const detail = await roomDetail(q, week, busy.map(r => Number(r.id)));
      await logEvent(q, { action: 'report.printed', req, userId: req.user.id, roomId: req.user.roomId, detail: { week: iso(week.start), rooms: busy.length } });
      return { rooms: busy, ...detail };
    });
    const printedAt = new Date();

    res.send(bare({
      title: `ڕاپۆرتی هەفتانە ${iso(week.start)}`,
      body: html`
        <style>
          @page { size: A4; margin: 16mm 15mm; }
          body { font-family: Vazirmatn, "Noto Sans Arabic", Tahoma, sans-serif; color:#111; font-size: 11.5pt; line-height: 1.7; margin: 0; }
          .sheet { page-break-after: always; break-after: page; }
          .sheet:last-child { page-break-after: auto; break-after: auto; }
          .head { display:flex; align-items:center; gap:10.5pt; border-bottom:2px solid #0E3A28; padding-bottom:7.5pt; margin-bottom:9pt; }
          .seal { width:33pt; height:33pt; border-radius:50%; background:#C99A2E; flex:0 0 33pt; }
          .head h1 { font-size:17pt; margin:0; }
          .head .sub { font-size:10pt; color:#555; }
          .head .week { margin-inline-start:auto; text-align:left; font-size:10pt; color:#555; }
          h2 { font-size:14pt; margin: 0 0 3pt; }
          .who { color:#555; font-size:10pt; margin-bottom:9pt; }
          .boxes { display:grid; grid-template-columns: repeat(3, 1fr); gap:6pt; margin-bottom:12pt; }
          .box { border:1px solid #c9c2b2; border-radius:4pt; padding:6pt 8pt; }
          .box .n { font-size:18pt; font-weight:700; line-height:1.2; }
          .box .k { font-size:9.5pt; color:#555; }
          .delta { font-size:9pt; font-weight:600; white-space:nowrap; }
          .delta.good { color:#276E50; } .delta.bad { color:#9E2B25; } .delta.info, .delta.same { color:#555; }
          h3 { font-size:11.5pt; margin: 9pt 0 4pt; }
          table { width:100%; border-collapse:collapse; font-size:10pt; }
          th, td { text-align:right; padding:3pt 5pt; border-bottom:1px solid #ddd; vertical-align:top; }
          th { background:#f6f5f0; color:#555; font-weight:600; }
          .mono { direction:ltr; unicode-bidi:isolate; }
          .none { color:#555; font-size:10pt; }
          .foot { margin-top:12pt; border-top:1px solid #ddd; padding-top:4pt; font-size:9pt; color:#555; display:flex; justify-content:space-between; }
          .cover .boxes { grid-template-columns: repeat(3, 1fr); }
          @media screen { body { background:#eeece6; } .sheet { background:#fff; max-width:180mm; margin:12pt auto; padding:14mm; } }
          @media screen and (max-width: 760px) { .sheet { margin:8px; padding:6mm; } .boxes { grid-template-columns: repeat(2, 1fr); } }
        </style>

        ${rooms.length === 0 ? html`<div class="sheet"><p>لەم هەفتەیەدا هیچ ژوورێک چالاکی نەبووە.</p></div>` : ''}

        ${rooms.map(r => {
          const myLate = late.filter(l => String(l.to_room_id) === String(r.id));
          const myPeople = people.filter(p => String(p.to_room_id) === String(r.id));
          return html`<section class="sheet">
            <div class="head">
              <div class="seal"></div>
              <div>
                <h1>شارەوانی ڕانیە</h1>
                <div class="sub">ڕاپۆرتی هەفتانەی ژوورەکان</div>
              </div>
              <div class="week">هەفتەی ${weekLabel(week)}${week.current ? html`<br>هێشتا تەواو نەبووە` : ''}</div>
            </div>
            <h2>${r.name}${r.room_number ? html` (${num(r.room_number)})` : ''}</h2>
            <div class="who">${r.head_name ? html`بەرپرس: ${r.head_name}` : 'بەرپرسی دیاریکراو نییە'}</div>

            <div class="boxes">
              ${METRICS.map(([k, label]) => html`<div class="box">
                <div class="n">${k === 'avg_days' ? fmtDays(r[k]) : num(r[k])}</div>
                <div class="k">${label} ${delta(k, r)}</div>
              </div>`)}
            </div>

            <h3>کتابە دواکەوتووەکان لە کۆتایی هەفتەدا</h3>
            ${myLate.length === 0 ? html`<p class="none">هیچ کتابێک دوانەکەوتبوو.</p>` : html`
              <table>
                <thead><tr><th>ژمارە</th><th>بابەت</th><th>لای</th><th>دواکەوتن</th></tr></thead>
                <tbody>${myLate.map(l => html`<tr>
                  <td class="mono">${l.incoming_no}</td>
                  <td>${l.subject}</td>
                  <td>${l.holder_name ?? '—'}</td>
                  <td>${num(Math.max(0, Math.floor(Number(l.days_late))))} ڕۆژ</td>
                </tr>`)}</tbody>
              </table>`}

            <h3>کێ چەندی تەواوکرد</h3>
            ${myPeople.length === 0 ? html`<p class="none">لەم هەفتەیەدا هیچ هەنگاوێک تەواو نەکراوە.</p>` : html`
              <table>
                <thead><tr><th>کارمەند</th><th>تەواوکراو</th></tr></thead>
                <tbody>${myPeople.map(p => html`<tr><td>${p.full_name}</td><td>${num(p.finished)}</td></tr>`)}</tbody>
              </table>`}

            <div class="foot">
              <span>بەراورد بە هەفتەی پێشوو: ▲ زیادبوون، ▼ کەمبوون</span>
              <span>چاپکرا ${date(printedAt)} ${time(printedAt)}</span>
            </div>
          </section>`;
        })}
        <script src="${asset('/print.js')}"></script>`,
    }));
  } catch (err) { next(err); }
});

export default router;
