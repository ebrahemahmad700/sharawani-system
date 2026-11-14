// What came in beside what went out (بەراوردی هاتوو و دەرچوو).
//
// The question this answers is asked at a counter, with a citizen standing there
// holding a paper: "is this the answer to my request, and is this the paper this
// office sent?" Until now it took two clicks into two attachments and a memory of
// the first while looking at the second. Here the two scans are side by side, each
// under the number the office gave it, with the line of time under them both.
//
// Which two scans. The letter arrives as paper and is scanned at the counter: that
// is the intake scan, the first original_scan. It leaves as paper too, signed and
// stamped, and that scan is filed with «هاوپێچی دەرچوو» ticked: that is the outgoing
// scan, the last one ticked. Either can be chosen by hand when a letter has more
// than one candidate, which is why the two pickers exist; nothing else on the page
// changes when they are.
//
// The two bands over the scans are written by this page, not by the scanner: the
// number, the room and the moment come from the register, and they say what the
// register holds about the paper below them. They are not a claim that anything is
// printed on the paper. The wording keeps that distinction («لە تۆماردا:»).
//
// Read as the person asking, like every other screen: a letter they may not see is
// not here, and the refusal is logged.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { trail } from '../lib/routing.mjs';
import { getDocument } from '../lib/documents.mjs';
import { logEvent } from '../lib/log.mjs';
import { notFound, logRefusal } from '../lib/respond.mjs';
import { page, asset } from '../views/layout.mjs';
import { html, num, date, time, ltr, ident, ltrText, elapsed } from '../lib/html.mjs';
import { statusPill, DOC_TYPES } from './registry.mjs';
import { listAttachments, kindLabel, typeLabel } from './attachments.mjs';
import { groupCode } from '../lib/verify.mjs';
import { STAMPERS } from './stamp.mjs';

const router = Router();

// What each side may show. A scan of paper, nothing else: a DWG has no page to
// put beside another page, and the file list on the letter is where those belong.
export const COMPARABLE = ['application/pdf', 'image/png', 'image/jpeg'];

const SENDER_KIND = {
  citizen: 'هاووڵاتی', company: 'کۆمپانیا', government: 'فەرمانگەی حکومی', internal: 'ناوخۆیی',
};

const STEP_ACTION = {
  opinion: 'بیروڕا', approved: 'ڕەزامەندی', rejected: 'ڕەتکردنەوە', forwarded: 'ناردنی بۆ ژوورێکی تر',
  letter_attached: 'کتاب لکاندن', handwritten_reply: 'وەڵامی دەستنووس', no_action: 'بێ کردار',
};

/** The candidates for each side, newest last, and which one the page shows. */
function sides(attachments, { wantIn, wantOut, stamped = {} }) {
  const showable = attachments.filter(a => COMPARABLE.includes(a.mime_type));
  // Oldest first: the intake scan is the first thing that ever came in, and the
  // outgoing copy is the last thing that went out.
  const byTime = [...showable].sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at));

  const inList = byTime.filter(a => !a.is_outgoing && a.kind !== 'outgoing_copy');
  const outList = byTime.filter(a => a.is_outgoing || a.kind === 'outgoing_copy');

  const pick = (list, want, fallback) =>
    list.find(a => Number(a.id) === Number(want)) ?? fallback(list) ?? null;

  // A scan that carries the arrival or dispatch mark (migration 0590) is what a
  // person means by "what came in" and "what went out", so it wins over the bare
  // scan underneath it.
  const marked = (list, id) => (id ? list.find(a => Number(a.id) === Number(id)) : null);

  return {
    inList,
    outList,
    // The stamped arrival copy; failing that the first scan of the original;
    // failing that the first scan of anything.
    intake: pick(inList, wantIn, l => marked(l, stamped.incoming) ?? l.find(a => a.kind === 'original_scan') ?? l[0]),
    // The stamped dispatch copy, or the last thing filed as going out.
    outgoing: pick(outList, wantOut, l => marked(l, stamped.outgoing) ?? l.at(-1)),
  };
}

/** The stops on the horizontal bar under the two scans. */
function stops(doc, steps) {
  const list = [];
  list.push({
    kind: 'in', at: doc.incoming_registered_at ?? doc.incoming_date,
    room: 'تۆمارکردن', what: 'کتاب تۆمارکرا و سکان کرا',
    who: doc.registered_by_name ?? null,
  });
  for (const s of steps) {
    if (s.status === 'done' && s.completed_at) {
      list.push({
        kind: 'done', at: s.completed_at, room: s.to_room_name, who: s.completed_by_name,
        what: STEP_ACTION[s.action_taken] ?? 'تەواوی کرد', roomNo: s.to_room_number,
      });
    } else if (s.status === 'returned' && s.completed_at) {
      list.push({ kind: 'returned', at: s.completed_at, room: s.to_room_name, who: s.completed_by_name,
        what: 'گەڕاندییەوە', roomNo: s.to_room_number });
    } else if (s.status === 'active') {
      list.push({ kind: 'now', at: s.sent_at, room: s.to_room_name, who: s.assigned_to_name,
        what: s.overdue ? 'دواکەوتوو' : 'لەژێر کاردا', roomNo: s.to_room_number, overdue: s.overdue });
    }
  }
  if (doc.closed_at) {
    list.push({ kind: 'out', at: doc.closed_at, room: 'تۆمارکردن',
      what: `وەڵام بە ژمارەی ${ltrText(doc.outgoing_no ?? '')} نێردرا`, who: doc.closed_by_name ?? null });
  }
  if (doc.cancelled_at) {
    list.push({ kind: 'cancelled', at: doc.cancelled_at, room: '—', what: 'هەڵوەشێنرایەوە', who: null });
  }
  return list.sort((a, b) => new Date(a.at) - new Date(b.at));
}

/** One scan's pane: the band, the page, the picker, the download. */
function pane({ side, att, list, band, stamp, title, sub, emptyText, emptyAction, docId, mayStamp, marked }) {
  const src = att ? `/attachments/${att.id}` : null;
  const isPdf = att && att.mime_type === 'application/pdf';
  // The band sits where the stamp sits on the paper: the receiving mark at the
  // head of what came in, the dispatch mark at the foot of what went out.
  const stampBand = html`
    <div class="cmp-stamp ${side}">
      <span class="cmp-stamp-mark">${stamp.mark}</span>
      <span class="cmp-stamp-lines">
        <span class="cmp-stamp-no mono">${ltr(stamp.no)}</span>
        <span class="cmp-stamp-sub">${stamp.sub}</span>
      </span>
    </div>`;
  return html`
    <section class="card cmp-pane ${side}">
      <div class="card-head">
        <h2>${title}</h2>
        <div class="end"><span class="pill ${side === 'intake' ? 'info' : 'ok'}">${band}</span></div>
      </div>
      <p class="card-sub">${sub}</p>

      ${att ? html`
        ${side === 'intake' ? stampBand : ''}

        <div class="cmp-view" data-cmp-pane="${side}"
             ${isPdf ? html`data-pdf-file="${src}"` : html`data-img-file="${src}"`}>
          <div class="cmp-bar">
            <span class="cmp-page" data-cmp-page>${isPdf ? 'PDFەکە دەکرێتەوە…' : ''}</span>
            <span class="spacer"></span>
            <span class="cmp-turn" data-cmp-turn hidden>
              <button type="button" class="btn small secondary" data-cmp-prev aria-label="پەڕەی پێشوو">‹</button>
              <button type="button" class="btn small secondary" data-cmp-next aria-label="پەڕەی دواتر">›</button>
            </span>
            <span class="cmp-zoom">
              <button type="button" class="btn small secondary" data-cmp-zoom="-1" aria-label="بچووککردنەوە">−</button>
              <button type="button" class="btn small secondary" data-cmp-zoom="0">پانی پەڕە</button>
              <button type="button" class="btn small secondary" data-cmp-zoom="1" aria-label="گەورەکردن">+</button>
            </span>
          </div>
          <div class="cmp-paper" data-cmp-paper>
            ${isPdf ? '' : html`<img src="${src}" alt="${att.original_name}">`}
          </div>
          <noscript><a class="btn small secondary" href="${src}" target="_blank">کردنەوەی فایل</a></noscript>
        </div>

        ${side === 'outgoing' ? stampBand : ''}

        <table class="kv cmp-kv">
          <tbody>
            <tr><th>فایل</th><td><a href="/attachments/${att.id}/view" dir="auto">${att.original_name}</a>
              <span class="cell-sub">${typeLabel(att.mime_type)} · ${num(Math.max(1, Math.round(att.size_bytes / 1024)))} کیلۆبایت${att.page_count ? html` · ${num(att.page_count)} پەڕە` : ''}</span></td></tr>
            <tr><th>جۆر</th><td>${kindLabel(att.kind)}</td></tr>
            <tr><th>سکان کرا</th><td>${date(att.uploaded_at)} <span class="muted">${time(att.uploaded_at)}</span>
              <span class="cell-sub">${att.uploaded_by_name ?? '—'}${att.uploaded_room_name ? html` · ${att.uploaded_room_name}` : ''}</span></td></tr>
            <tr><th>پشکنینی ڤایرۆس</th><td>${att.virus_scanned_at
              ? html`<span class="pill ok">پشتڕاستکراوە</span>`
              : html`<span class="pill warn">پشتڕاست نەکراوەتەوە</span>`}</td></tr>
          </tbody>
        </table>

        <div class="cmp-foot">
          <a class="btn secondary" href="${src}?download=1">داگرتنی ${side === 'intake' ? 'سکانی هاتوو' : 'کۆپی دەرچوو'}</a>
          ${mayStamp && !marked ? html`
            <a class="btn secondary" href="/attachments/${att.id}/stamp?kind=${side === 'intake' ? 'incoming' : 'outgoing'}">مۆری ${side === 'intake' ? 'هاتوو' : 'دەرچوو'} لێبدە</a>` : ''}
          ${list.length > 1 ? html`
            <form method="get" action="/documents/${docId}/compare" class="cmp-choose">
              ${stamp.other ? html`<input type="hidden" name="${side === 'intake' ? 'out' : 'in'}" value="${stamp.other}">` : ''}
              <label for="cmp-${side}">فایلێکی تر</label>
              <select id="cmp-${side}" name="${side === 'intake' ? 'in' : 'out'}">
                ${list.map(x => html`<option value="${x.id}"${Number(x.id) === Number(att.id) ? html` selected` : ''}>${kindLabel(x.kind)} — ${date(x.uploaded_at)} ${time(x.uploaded_at)}</option>`)}
              </select>
              <button class="btn small secondary" type="submit">پیشاندان</button>
            </form>` : ''}
        </div>`
      : html`
        <div class="empty">
          <p style="margin-top:0"><strong>${emptyText}</strong></p>
          ${emptyAction ?? ''}
        </div>`}
    </section>`;
}

router.get('/documents/:id(\\d+)/compare', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = await withActor(req.user, async q => {
      const doc = await getDocument(q, id);
      if (!doc) return null;
      const steps = await trail(q, id);
      const attachments = await listAttachments(q, id);
      const { rows: [verify] } = doc.outgoing_no
        ? await q(`SELECT code FROM document_verify WHERE document_id = $1`, [id])
        : { rows: [] };
      // The latest mark of each kind, which is the copy this screen prefers.
      const { rows: marks } = await q(`
        SELECT DISTINCT ON (kind) kind, attachment_id
          FROM document_stamp WHERE document_id = $1 ORDER BY kind, placed_at DESC`, [id]);
      await logEvent(q, {
        action: 'compare.viewed', req, userId: req.user.id, roomId: req.user.roomId,
        documentId: id, detail: { files: attachments.length },
      });
      return { doc, steps, attachments, marks, verifyCode: verify?.code ?? null };
    });

    if (!data) {
      await logRefusal(req, 'document', req.params.id);
      return notFound(req, res, 'ئەم کتابە نەدۆزرایەوە، یان ڕێگەت پێنەدراوە بیبینیت.');
    }

    const { doc, steps, attachments, marks, verifyCode } = data;
    const stamped = Object.fromEntries(marks.map(m => [m.kind, m.attachment_id]));
    const { inList, outList, intake, outgoing } = sides(attachments, {
      wantIn: req.query.in, wantOut: req.query.out, stamped,
    });
    const bar = stops(doc, steps);
    const canReply = ['mayor', 'deputy_mayor', 'registry_clerk', 'directorate_head', 'room_head']
                       .includes(req.user.role) && doc.status !== 'cancelled';
    // How long the whole thing took, or has taken so far.
    const startedAt = doc.incoming_registered_at ?? doc.incoming_date;
    const endedAt = doc.closed_at ?? doc.cancelled_at ?? null;

    res.send(page({
      user: req.user,
      title: `بەراوردی کتابی ${ltrText(doc.incoming_no)}`,
      current: '/documents',
      actions: html`
        <a class="btn secondary" href="/documents/${doc.id}">گەڕانەوە بۆ کتاب</a>
        <a class="btn secondary" href="/documents/${doc.id}/case">مێژووی کتاب</a>
        ${canReply && doc.outgoing_no ? html`<a class="btn secondary" href="/documents/${doc.id}/reply/print" target="_blank">چاپی وەڵام</a>` : ''}`,
      body: html`
        <!-- The header: the numbers the office knows this letter by, who it is
             about, and where it stands. Everything a person at the counter reads
             out loud before looking at the paper. -->
        <section class="card cmp-head">
          <div class="cmp-ids">
            <div class="cmp-id">
              <span class="k">ژمارەی هاتوو</span>
              <span class="v mono">${ltr(doc.incoming_no)}</span>
              <span class="cell-sub">${date(doc.incoming_date)}</span>
            </div>
            <div class="cmp-id">
              <span class="k">ژمارەی دەرچوو</span>
              ${doc.outgoing_no
                ? html`<span class="v mono">${ltr(doc.outgoing_no)}</span>
                       <span class="cell-sub">${date(doc.outgoing_date)}</span>`
                : html`<span class="v muted">—</span><span class="cell-sub">هێشتا وەڵام نەنێردراوە</span>`}
            </div>
            <div class="cmp-id">
              <span class="k">بارکۆد</span>
              <span class="v mono">${ltr(doc.barcode)}</span>
              <span class="cell-sub">هەمان کتاب لەسەر کاغەز</span>
            </div>
            <div class="cmp-id cmp-id-status">
              <span class="k">دۆخ</span>
              <span class="v">${statusPill(doc.status)}</span>
              <span class="cell-sub">
                ${endedAt ? html`لە ${elapsed(startedAt, endedAt)}دا تەواوبوو`
                  : elapsed(startedAt) === 'ئێستا'
                    ? html`تازە تۆمارکراوە${doc.current_room_name ? html` · ئێستا لای ${doc.current_room_name}` : ''}`
                    : html`${elapsed(startedAt)} لە تۆمارکردنەوە${doc.current_room_name ? html` · ئێستا لای ${doc.current_room_name}` : ''}`}
              </span>
            </div>
          </div>
          <div class="cmp-who">
            <div><span class="k">بابەت</span> <strong>${doc.subject}</strong></div>
            <div>
              <span class="k">نێردەر</span> ${doc.sender_name}
              <span class="pill muted">${SENDER_KIND[doc.sender_kind] ?? doc.sender_kind}</span>
              ${doc.sender_contact ? html`<span class="mono cmp-contact">${ltr(doc.sender_contact)}</span>` : ''}
            </div>
            <div>
              <span class="k">جۆر</span> ${doc.type_name ?? DOC_TYPES.find(t => t[0] === doc.doc_type)?.[1] ?? doc.doc_type}
              ${doc.plot_no ? html` · <span class="k">پارچە</span>
                <a class="mono" href="/plots?p=${encodeURIComponent(doc.plot_no)}">${ident(doc.plot_no)}</a>${doc.neighbourhood ? html` — ${doc.neighbourhood}` : ''}` : ''}
            </div>
            ${doc.outgoing_recipient ? html`<div><span class="k">وەرگر</span> ${doc.outgoing_recipient}</div>` : ''}
          </div>
        </section>

        <!-- The two scans. In this direction of reading the letter that came in is
             on the right, where the eye starts, and the answer that went out is on
             the left, where it ends. -->
        <div class="cmp-pair">
          ${pane({
            side: 'intake', att: intake, list: inList, docId: doc.id,
            mayStamp: STAMPERS.includes(req.user.role), marked: Boolean(stamped.incoming),
            title: 'هاتوو', band: 'یەکەم سکان',
            sub: 'کاغەزی وەک ئەوەی گەیشتە شارەوانی، پێش هەموو مۆر و ئیمزایەک.',
            stamp: {
              mark: 'وەرگیرا', no: doc.incoming_no, other: outgoing?.id ?? '',
              sub: `لە تۆماردا: ${[intake?.uploaded_room_name, date(doc.incoming_date)].filter(Boolean).join(' · ')}`,
            },
            emptyText: 'هێشتا سکانی کاغەزی هاتوو نییە.',
            emptyAction: html`<p>کاتێک ژووری تۆمارکردن کاغەزەکە سکان بکات، لێرە دەردەکەوێت.</p>
              <a class="btn" href="/documents/${doc.id}">هاوپێچ زیادبکە</a>`,
          })}
          ${pane({
            side: 'outgoing', att: outgoing, list: outList, docId: doc.id,
            mayStamp: STAMPERS.includes(req.user.role) && Boolean(doc.outgoing_no), marked: Boolean(stamped.outgoing),
            title: 'دەرچوو', band: 'سکانی کۆتایی',
            sub: 'هەمان کاغەز دوای ئیمزا و مۆری ژوورەکان، وەک ئەوەی لە شارەوانی چووەتە دەرەوە.',
            stamp: {
              mark: 'نێردرا', no: doc.outgoing_no ?? doc.incoming_no, other: intake?.id ?? '',
              sub: `لە تۆماردا: ${[doc.outgoing_recipient, doc.outgoing_date ? date(doc.outgoing_date) : null].filter(Boolean).join(' · ')
                    || 'هێشتا داخرا نەکراوە'}${verifyCode ? ` · کۆدی پشتڕاستکردنەوە ${groupCode(verifyCode)}` : ''}`,
            },
            emptyText: doc.outgoing_no
              ? 'وەڵام نێردراوە، بەڵام کۆپی مۆرکراوی کاغەز سکان نەکراوە.'
              : 'هێشتا وەڵامی ئەم کتابە نەنێردراوە.',
            emptyAction: html`
              <p>${doc.outgoing_no
                ? 'کاتێک کۆپی ئیمزاکراو بە «هاوپێچی دەرچوو» زیاد بکرێت، لێرە دەردەکەوێت.'
                : 'دوای ناردنی وەڵام و سکانکردنی کۆپی ئیمزاکراو، ئەم لایە پڕ دەبێت.'}</p>
              ${canReply ? html`<a class="btn" href="/documents/${doc.id}/reply">${doc.outgoing_no ? 'بینینی وەڵام' : 'نووسینی وەڵام'}</a>` : ''}`,
          })}
        </div>

        <!-- The line of time, as a bar rather than a list: the two scans are the
             ends of it, and the rooms in between are what happened to the paper. -->
        <section class="card cmp-track">
          <div class="card-head">
            <h2>ڕێڕەوی کتاب <span class="pill muted">${num(bar.length)}</span></h2>
            <div class="end"><a href="/documents/${doc.id}/case">هەموو ڕووداوەکان</a></div>
          </div>
          <ol class="cmp-stops">
            ${bar.map(s => html`
              <li class="cmp-stop ${s.kind}">
                <span class="cmp-dot" aria-hidden="true"></span>
                <span class="cmp-time">${time(s.at)}<span class="cell-sub">${date(s.at)}</span></span>
                <span class="cmp-room">${s.room}${s.roomNo ? html` <span class="muted">(${num(s.roomNo)})</span>` : ''}</span>
                <span class="cmp-what">${s.what}${s.overdue ? html` <span class="pill danger">دواکەوتوو</span>` : ''}
                  ${s.who ? html`<span class="cell-sub">${s.who}</span>` : ''}</span>
              </li>`)}
          </ol>
        </section>
        <script type="module" src="${asset('/compare.js')}"></script>`,
    }));
  } catch (err) { next(err); }
});

export default router;
