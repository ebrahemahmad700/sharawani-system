// The whole case on one screen (هەموو دۆسیەکە).
//
// A request in 2024, a complaint that it was never answered in 2025, the answer,
// a follow-up about the answer. Four letters, each with its own trail, and until
// now four pages to open and hold in your head at once. The plot file does this
// for one piece of land; this does it for one case, whatever it is about.
//
// A case is a chain of letters linked by "follow-up of" (document.related_
// document_id, set by the clerk at the counter when the similar-letter check
// finds the earlier one). From any letter the chain is walked up to the first
// letter and then down to every follow-up, and every event of every letter goes
// on one line of time: arrived, sent to a room, finished there, sent back, the
// handwritten instruction, the remarks, answered, cancelled.
//
// All of it is read as the person asking. A letter in the chain that they may
// not see simply is not in it, and the walk does not reach past it; there is no
// "one hidden letter here", which would itself say something.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { trail } from '../lib/routing.mjs';
import { logEvent } from '../lib/log.mjs';
import { notFound, logRefusal } from '../lib/respond.mjs';
import { page } from '../views/layout.mjs';
import { html, num, date, time, ltr, ident, elapsed, ltrText } from '../lib/html.mjs';
import { statusPill } from './registry.mjs';

const router = Router();

const MAX_LETTERS = 40;

const STEP_ACTION = {
  opinion: 'بیروڕای نووسی', approved: 'ڕەزامەندی دا', rejected: 'ڕەتی کردەوە',
  forwarded: 'ناردی بۆ ژوورێکی تر', letter_attached: 'کتابێکی تری لکاند',
  handwritten_reply: 'وەڵامی دەستنووسی نووسی', no_action: 'هیچ کردارێک پێویست نەبوو',
};

async function caseLetters(q, id) {
  const { rows } = await q(`
    WITH RECURSIVE up AS (
      SELECT d.id, d.related_document_id, 0 AS depth FROM document d WHERE d.id = $1
      UNION
      SELECT p.id, p.related_document_id, up.depth + 1
        FROM document p JOIN up ON p.id = up.related_document_id
       WHERE up.depth < 50
    ),
    root AS (SELECT id FROM up ORDER BY depth DESC LIMIT 1),
    down AS (
      SELECT d.id, 0 AS depth FROM document d WHERE d.id = (SELECT id FROM root)
      UNION
      SELECT c.id, down.depth + 1
        FROM document c JOIN down ON c.related_document_id = down.id
       WHERE down.depth < 50
    )
    SELECT d.id, d.incoming_no, d.incoming_date, d.incoming_registered_at, d.subject, d.sender_name,
           d.status, d.priority, d.plot_no, d.neighbourhood, d.related_document_id,
           d.outgoing_no, d.outgoing_date, d.outgoing_recipient, d.closed_at,
           d.cancelled_at, d.cancel_reason, r.name AS current_room_name,
           min(down.depth) AS depth
      FROM down
      JOIN document d ON d.id = down.id
      LEFT JOIN room r ON r.id = d.current_room_id
     GROUP BY d.id, r.name
     ORDER BY d.incoming_date, d.id
     LIMIT ${MAX_LETTERS}`, [id]);
  return rows;
}

router.get('/documents/:id(\\d+)/case', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = await withActor(req.user, async q => {
      const letters = await caseLetters(q, id);
      if (!letters.some(l => Number(l.id) === id)) return null;
      const ids = letters.map(l => Number(l.id));

      const steps = new Map();
      for (const l of letters) steps.set(String(l.id), await trail(q, l.id));

      const { rows: notes } = await q(`
        SELECT n.document_id, n.body, n.created_at, u.full_name AS author_name, r.name AS room_name
          FROM document_note n
          LEFT JOIN app_user u ON u.id = n.author_id
          LEFT JOIN room r ON r.id = n.room_id
         WHERE n.document_id = ANY ($1::bigint[])`, [ids]);
      const { rows: margins } = await q(`
        SELECT m.document_id, m.attachment_id, m.instruction, m.created_at, m.room_ids,
               u.full_name AS author_name
          FROM margin_note m
          LEFT JOIN app_user u ON u.id = m.author_id
         WHERE m.document_id = ANY ($1::bigint[])`, [ids]);
      const { rows: files } = await q(`
        SELECT document_id, count(*) AS n FROM attachment
         WHERE document_id = ANY ($1::bigint[]) GROUP BY document_id`, [ids]);
      const { rows: rooms } = await q(`SELECT id, name FROM room`);

      await logEvent(q, {
        action: 'case.viewed', req, userId: req.user.id, roomId: req.user.roomId,
        documentId: id, detail: { count: letters.length },
      });
      return { letters, steps, notes, margins, files, rooms };
    });

    if (!data) {
      await logRefusal(req, 'document', req.params.id);
      return notFound(req, res, 'ئەم کتابە نەدۆزرایەوە، یان ڕێگەت پێنەدراوە بیبینیت.');
    }

    const { letters, steps, notes, margins, files, rooms } = data;
    const roomName = new Map(rooms.map(r => [String(r.id), r.name]));
    const mark = new Map(letters.map((l, i) => [String(l.id), i + 1]));
    const fileCount = new Map(files.map(f => [String(f.document_id), Number(f.n)]));

    // One line of time for the whole case.
    const events = [];
    for (const l of letters) {
      const key = String(l.id);
      events.push({ at: l.incoming_registered_at ?? l.incoming_date, doc: l, kind: 'in',
        text: html`کتابی ${ltr(l.incoming_no)} هات لە <strong>${l.sender_name}</strong>` });
      for (const s of steps.get(key) ?? []) {
        if (s.sent_at) {
          events.push({ at: s.sent_at, doc: l, kind: 'sent',
            text: html`نێردرا بۆ <strong>${s.to_room_name}</strong>${s.assigned_by_name ? html` لەلایەن ${s.assigned_by_name}` : ''}`,
            sub: s.note });
        }
        if (s.completed_at && s.status === 'done') {
          events.push({ at: s.completed_at, doc: l, kind: 'done',
            text: html`<strong>${s.to_room_name}</strong>: ${s.completed_by_name ?? ''} ${STEP_ACTION[s.action_taken] ?? 'تەواوی کرد'}${s.sent_at && elapsed(s.sent_at, s.completed_at) !== 'ئێستا' ? html` <span class="muted">(دوای ${elapsed(s.sent_at, s.completed_at)})</span>` : ''}`,
            sub: s.reply_note });
        } else if (s.completed_at && s.status === 'returned') {
          events.push({ at: s.completed_at, doc: l, kind: 'returned',
            text: html`<strong>${s.to_room_name}</strong> گەڕاندییەوە`, sub: s.reply_note });
        }
        if (s.status === 'active') {
          events.push({ at: new Date(), doc: l, kind: 'now',
            text: html`ئێستا لای <strong>${s.to_room_name}</strong>${s.assigned_to_name ? html`، ${s.assigned_to_name}` : ''}${s.sent_at && elapsed(s.sent_at) !== 'ئێستا' ? html` <span class="muted">(${elapsed(s.sent_at)})</span>` : ''}${s.overdue ? html` <span class="pill danger">دواکەوتوو</span>` : ''}` });
        }
      }
      for (const m of margins.filter(x => String(x.document_id) === key)) {
        events.push({ at: m.created_at, doc: l, kind: 'margin',
          text: html`${m.author_name ?? ''} هامشی نووسی بۆ ${(m.room_ids ?? []).map(r => roomName.get(String(r)) ?? '').join('، ')}
            <a href="/attachments/${m.attachment_id}/view">بینینی هامش</a>`,
          sub: m.instruction });
      }
      for (const n of notes.filter(x => String(x.document_id) === key)) {
        events.push({ at: n.created_at, doc: l, kind: 'note',
          text: html`تێبینی ${n.author_name ?? ''}${n.room_name ? html` <span class="muted">(${n.room_name})</span>` : ''}`, sub: n.body });
      }
      if (l.closed_at) {
        events.push({ at: l.closed_at, doc: l, kind: 'out',
          text: html`وەڵام درایەوە بە ژمارەی ${ltr(l.outgoing_no)} بۆ <strong>${l.outgoing_recipient ?? '—'}</strong>` });
      }
      if (l.cancelled_at) {
        events.push({ at: l.cancelled_at, doc: l, kind: 'cancelled', text: html`هەڵوەشێنرایەوە`, sub: l.cancel_reason });
      }
    }
    // Things done in one action share a timestamp: the instruction is written,
    // then the letter goes. Within the same moment, this order.
    const ORDER = { in: 0, margin: 1, note: 2, done: 3, returned: 3, sent: 4, out: 5, cancelled: 6, now: 7 };
    events.sort((a, b) => (new Date(a.at) - new Date(b.at)) || (ORDER[a.kind] - ORDER[b.kind]));

    const first = letters[0];
    const last = events.filter(e => e.kind !== 'now').at(-1);
    const open = letters.filter(l => !['closed', 'cancelled'].includes(l.status));
    const involved = new Set();
    for (const list of steps.values()) for (const s of list) if (s.to_room_name) involved.add(s.to_room_name);
    const startedAt = first.incoming_registered_at ?? first.incoming_date;
    const spanDays = Math.max(0, Math.round(((open.length ? Date.now() : new Date(last?.at ?? startedAt)) - new Date(startedAt)) / 86400000));

    const byYear = [];
    for (const e of events) {
      const y = new Date(e.at).getFullYear();
      if (!byYear.length || byYear.at(-1).year !== y) byYear.push({ year: y, events: [] });
      byYear.at(-1).events.push(e);
    }

    const KIND = {
      in: 'هات', sent: 'نێردرا', done: 'تەواوبوو', returned: 'گەڕایەوە', now: 'ئێستا',
      margin: 'هامش', note: 'تێبینی', out: 'وەڵام', cancelled: 'هەڵوەشێنرایەوە',
    };

    res.send(page({
      user: req.user, title: `دۆسیەی کتابی ${ltrText(letters.find(l => Number(l.id) === id)?.incoming_no ?? '')}`,
      current: '/documents',
      actions: html`<a class="btn secondary" href="/documents/${id}">گەڕانەوە بۆ کتاب</a>`,
      body: html`
        <div class="grid cols-4 stats">
          <div class="stat"><div class="n">${num(letters.length)}</div><div class="k">کتاب لەم دۆسیەیەدا</div></div>
          <div class="stat"><div class="n">${num(spanDays)}</div><div class="k">ڕۆژ ${open.length ? 'تا ئێستا' : 'لە سەرەتاوە تا کۆتایی'}</div></div>
          <div class="stat"><div class="n">${num(involved.size)}</div><div class="k">ژوور بەشدار بوون</div></div>
          <div class="stat"><div class="n${open.length ? '' : ''}">${num(open.length)}</div><div class="k">کتابی کراوە</div></div>
        </div>

        <div class="grid split-2-1 case-layout">
          <div class="card">
            <div class="card-head">
              <h2>ڕووداوەکانی دۆسیە</h2>
              <span class="pill muted">${num(events.length)}</span>
            </div>
            <p class="card-sub">
              لە ${date(startedAt)}ەوە. هەموو ئەوەی بە سەر ئەم کتابانەدا هاتووە بە ڕیزی کات، ساڵ بە ساڵ.
            </p>
            ${byYear.map(y => html`
              <h3 class="case-year">${num(y.year)}</h3>
              <ol class="case-timeline">
                ${y.events.map(e => html`<li class="case-event ${e.kind}">
                  <div class="case-when">${e.kind === 'now' ? 'ئێستا' : html`${date(e.at)}<span class="cell-sub">${time(e.at)}</span>`}</div>
                  <div class="case-what">
                    <div class="row">
                      <a class="case-mark m${((mark.get(String(e.doc.id)) - 1) % 6) + 1}" href="/documents/${e.doc.id}" title="${e.doc.incoming_no}">${num(mark.get(String(e.doc.id)))}</a>
                      <span class="pill muted">${KIND[e.kind]}</span>
                    </div>
                    <div>${e.text}</div>
                    ${e.sub ? html`<div class="case-sub">${e.sub}</div>` : ''}
                  </div>
                </li>`)}
              </ol>`)}
          </div>

          <div>
            <div class="card">
              <h2>کتابەکانی دۆسیە</h2>
              <ol class="case-letters">
                ${letters.map(l => html`<li class="${Number(l.id) === id ? 'current' : ''}">
                  <a class="case-mark m${((mark.get(String(l.id)) - 1) % 6) + 1}" href="/documents/${l.id}">${num(mark.get(String(l.id)))}</a>
                  <div>
                    <a class="mono" href="/documents/${l.id}">${ltr(l.incoming_no)}</a> ${statusPill(l.status)}
                    <div>${l.subject}</div>
                    <div class="cell-sub">
                      ${date(l.incoming_date)}${l.related_document_id ? ' · بەدواداچوونی کتابێکی پێشوو' : ' · یەکەم کتاب'}
                      ${fileCount.get(String(l.id)) ? html` · ${num(fileCount.get(String(l.id)))} هاوپێچ` : ''}
                      ${l.current_room_name ? html` · ئێستا لای ${l.current_room_name}` : ''}
                    </div>
                  </div>
                </li>`)}
              </ol>
              ${letters.length === 1 ? html`<p class="hint">
                هیچ بەدواداچوونێک بۆ ئەم کتابە نییە کە تۆ بتوانیت بیبینیت. کاتێک کتابێکی نوێ لە تۆمارکردندا وەک بەدواداچوونی ئەم کتابە دیاری بکرێت، لێرە دەردەکەوێت.
              </p>` : ''}
            </div>

            ${first.plot_no ? html`<div class="card">
              <h2>پارچە</h2>
              <p><a class="mono" href="/plots?p=${encodeURIComponent(first.plot_no)}">${ident(first.plot_no)}</a>${first.neighbourhood ? html` — ${first.neighbourhood}` : ''}</p>
              <a class="btn small secondary" href="/plots?p=${encodeURIComponent(first.plot_no)}">فایلی پارچە</a>
            </div>` : ''}
          </div>
        </div>`,
    }));
  } catch (err) { next(err); }
});

export default router;
