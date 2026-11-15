// One letter: everything about it, and everything you can do to it.
//
// Screens: design/Document.dc.html (the file and its trail) and
//          design/Route.dc.html (sending it on, one room or in sequence).
//
// The trail is the part that matters. It answers the question the mayor actually
// asks, which is not "what is the status" but "where is my letter and who has
// been sitting on it".

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import {
  sendSingle, sendSequence, receive, complete, returnStep, recall, trail,
  paperReceive, maySend, holdsStep, RoutingError,
} from '../lib/routing.mjs';
import { notFound, logRefusal } from '../lib/respond.mjs';
import { getDocument, searchDocuments, cancelDocument, mayCancel, setDocumentFlags, DocumentError } from '../lib/documents.mjs';
import { page } from '../views/layout.mjs';
import { html, raw, num, date, time, elapsed, ago, ltr, ident, initials, ltrText } from '../lib/html.mjs';
import { statusPill, DOC_TYPES, CHANNELS, options, replyByPill } from './registry.mjs';
import { listAttachments, ATTACHMENT_KINDS, kindLabel, attachableTypes, acceptFor, typeLabel } from './attachments.mjs';
import { MARGIN_WRITERS } from './margin.mjs';
import { COMPARABLE } from './compare.mjs';
import { STAMPERS } from './stamp.mjs';
import { groupCode } from '../lib/verify.mjs';
import { MAX_BYTES } from '../lib/files.mjs';
import { scannersFor } from '../lib/escl.mjs';
import { logEvent } from '../lib/log.mjs';
import { notifyRoom, deliver as deliverPushes } from '../lib/notify.mjs';

const router = Router();

const STEP_ACTION = {
  opinion:           'بیروڕا',
  approved:          'ڕەزامەندی',
  rejected:          'ڕەتکراوە',
  forwarded:         'ناردرا بۆ پێشتر',
  letter_attached:   'کتابی تر لکێندرا',
  handwritten_reply: 'وەڵامی دەستنووس',
  no_action:         'بێ کردار',
};

const STEP_STATUS = {
  waiting:   ['muted',  'چاوەڕوان'],
  active:    ['warn',   'ئێستا لێرەیە'],
  done:      ['ok',     'تەواوبوو'],
  returned:  ['danger', 'گەڕێندرایەوە'],
  skipped:   ['muted',  'تێپەڕێندرا'],
  cancelled: ['danger', 'هەڵوەشێنراوە'],
};

// The letter's priority beside its status, as the inbox shows it. It appeared
// nowhere on the letter's own page (design test, 13 September).
const PRIORITY_PILL = { urgent: ['warn', 'پەلە'], very_urgent: ['danger', 'زۆر پەلە'] };

const ACTIONS_FOR_COMPLETE = [
  ['opinion',           'بیروڕام نووسی'],
  ['approved',          'ڕەزامەندیم دا'],
  ['rejected',          'ڕەتم کردەوە'],
  ['letter_attached',   'کتابێکی ترم لکاند'],
  ['handwritten_reply', 'وەڵامی دەستنووسم نووسی'],
  ['no_action',         'هیچ کردارێک پێویست نەبوو'],
];

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

router.get('/documents', requireAuth, async (req, res, next) => {
  try {
    const qtext = String(req.query.q ?? '');
    const rows = await withActor(req.user, q =>
      searchDocuments(q, { text: qtext, limit: 60, byUser: req.user, req }));

    res.send(page({
      user: req.user, title: 'گەڕان بەدوای کتاب', current: '/documents',
      body: html`
        <div class="card">
          <form method="get" action="/documents" class="row" role="search">
            <input type="search" name="q" value="${qtext}" aria-label="گەڕان بەدوای کتاب" autofocus
                   placeholder="ژمارەی کتاب، ژمارەی پارچە، بابەت، یان ناوی نێردەر">
            <button class="btn" type="submit">گەڕان</button>
          </form>
          <div class="hint">
            ژمارە بە هەر شێوەیەک بنووسیت دەدۆزرێتەوە: ٤٤٩٨ یان 4498 یان ه/٢٠٢٦/٤٤٩٨.
            هەروەها گەر بە تەختەکلیلی عەرەبی بنووسیت.
          </div>

          ${!qtext ? '' : rows.length === 0
            ? html`<div class="empty">هیچ کتابێک نەدۆزرایەوە.</div>`
            : html`<div class="table-wrap"><table>
                <thead><tr><th>ژمارە</th><th>بەروار</th><th>بابەت</th><th>نێردەر</th><th>دۆخ</th><th>ئێستا لای</th></tr></thead>
                <tbody>${rows.map(d => html`<tr>
                  <td class="mono">${ltr(d.incoming_no)}</td>
                  <td>${date(d.incoming_date)}</td>
                  <td>
                    <a href="/documents/${d.id}">${d.subject}</a>
                    ${d.is_confidential ? html` <span class="pill danger">نهێنی</span>` : ''}
                    ${Number(d.tier) === 40 ? html` <span class="pill info" title="ئەم وشانە لە ناو سکانێکی هاوپێچدا نووسراون">
                      لە ناو سکان
                    </span>` : ''}
                  </td>
                  <td>${d.sender_name}</td>
                  <td>${statusPill(d.status)}</td>
                  <td class="muted">${d.current_room_name ?? '—'}</td>
                </tr>`)}</tbody>
              </table></div>`}
        </div>`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// One document
// ---------------------------------------------------------------------------

router.get('/documents/:id(\\d+)', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = await withActor(req.user, async q => {
      const doc = await getDocument(q, id);
      if (!doc) return null;
      const steps = await trail(q, id);
      const attachments = await listAttachments(q, id);
      const allowTypes = await attachableTypes(q, req.user);
      const scanners = await scannersFor(q, req.user);
      const { rows: rooms } = await q(
        `SELECT id, name, room_number FROM room WHERE is_active ORDER BY sort_order, name`);
      // Opening the letter in the room that holds it counts as receiving it.
      const active = steps.find(s => s.status === 'active');
      if (active && !active.received_at && active.to_room_id === req.user.roomId) {
        await receive(q, { documentId: id, byUser: req.user, req });
        active.received_at = new Date();
      }
      // Remarks about the letter rather than about one hand-off (migration 0330).
      const { rows: notes } = await q(`
        SELECT n.id, n.body, n.created_at, u.full_name AS author_name, r.name AS room_name
          FROM document_note n
          LEFT JOIN app_user u ON u.id = n.author_id
          LEFT JOIN room r ON r.id = n.room_id
         WHERE n.document_id = $1
         ORDER BY n.created_at DESC
         LIMIT 100`, [id]);

      const { rows: companies } = await q(`
        SELECT c.id, c.name, c.registration_no
          FROM company_document cd JOIN company c ON c.id = cd.company_id
         WHERE cd.document_id = $1
         ORDER BY c.name_sort`, [id]);

      // Letters that follow on from this one. The link was shown only on the later
      // letter, so the earlier one gave no sign that anything had followed it.
      const { rows: followUps } = await q(`
        SELECT id, incoming_no, subject, status FROM document
         WHERE related_document_id = $1 ORDER BY incoming_year, incoming_seq`, [id]);

      // The same rules the actions apply (lib/routing.mjs), so the cards on this
      // page are offered to exactly the people the actions will accept.
      const canRoute = await maySend(q, req.user, doc, active ?? null);
      const holdsIt = active ? await holdsStep(q, req.user, active) : false;
      // The code a receiver checks the letter with (migration 0540), for the
      // people who print replies; the policy answers nothing for anyone else.
      const { rows: [verify] } = doc.outgoing_no
        ? await q(`SELECT code FROM document_verify WHERE document_id = $1`, [id])
        : { rows: [] };
      // Whether this letter is one of a chain, for the whole-case button.
      const { rows: [chain] } = await q(
        `SELECT EXISTS (SELECT 1 FROM document WHERE related_document_id = $1) AS has_follow_ups`, [id]);

      // The marks already drawn onto this letter's scans (migration 0590).
      const { rows: stamps } = await q(
        `SELECT attachment_id, kind FROM document_stamp WHERE document_id = $1 ORDER BY placed_at`, [id]);

      await q(`INSERT INTO activity_log (user_id, room_id, document_id, action, detail)
               VALUES ($1, $2, $3, 'document.viewed', '{}')`,
              [req.user.id, req.user.roomId, id]);
      return { doc, steps, rooms, active, attachments, notes, companies, allowTypes, scanners, followUps, canRoute, holdsIt,
               stamps, verifyCode: verify?.code ?? null, inChain: Boolean(doc.related_document_id || chain?.has_follow_ups) };
    });

    if (!data) {
      await logRefusal(req, 'document', req.params.id);
      return notFound(req, res, 'ئەم کتابە نەدۆزرایەوە، یان ڕێگەت پێنەدراوە بیبینیت.');
    }

    const { doc, steps, rooms, active, attachments, notes, companies, allowTypes, scanners, followUps, canRoute, holdsIt, stamps, verifyCode, inChain } = data;
    const canMargin = canRoute && MARGIN_WRITERS.includes(req.user.role)
                      && ['registered', 'in_flow', 'ready_to_close'].includes(doc.status);
    // Who may put the arrival or dispatch mark on a scan (routes/stamp.mjs), and
    // which files already carry one, so the list can say so.
    const canStamp = STAMPERS.includes(req.user.role);
    // The oldest scan on the letter: the one the arrival mark belongs on.
    const firstScan = [...attachments].reverse().find(a => COMPARABLE.includes(a.mime_type) && !a.is_outgoing) ?? null;
    const stampOn = new Map(stamps.map(s => [String(s.attachment_id), s.kind]));
    // The two scans side by side (routes/compare.mjs) need at least one scan of
    // paper to put on the screen; a letter with only a DWG attached has nothing
    // to compare.
    const canCompare = attachments.some(a => COMPARABLE.includes(a.mime_type));
    const iHoldIt = holdsIt;
    const iSentIt = active && active.assigned_by === req.user.id;
    // Confidentiality and the applicant's reply-by date (migration 0600): the
    // front desk, who promised it at the counter, and the mayor's office.
    const canFlags = ['registry_clerk', 'mayor', 'deputy_mayor'].includes(req.user.role)
                     && doc.status !== 'cancelled';
    const canClose = ['registry_clerk', 'mayor', 'deputy_mayor'].includes(req.user.role)
                     && ['ready_to_close', 'in_flow', 'registered'].includes(doc.status);
    // Writing the reply, or reading the one that was sent. A cancelled letter
    // never had a reply and never will, so it is the one case with no button.
    const canReply = ['mayor', 'deputy_mayor', 'registry_clerk', 'directorate_head', 'room_head']
                       .includes(req.user.role) && doc.status !== 'cancelled';
    // Chasing: the letter is with another room, and this person, or their room,
    // is the one that sent it there. The same rule is enforced again in the
    // handler, because hiding a button is not a permission.
    const canChase = active
                     && (active.assigned_by === req.user.id
                         || (active.from_room_id && active.from_room_id === req.user.roomId))
                     && active.to_room_id !== req.user.roomId
                     && !['closed', 'cancelled'].includes(doc.status);
    // The step this page was drawn for. Every form that acts on the letter sends
    // it back, and the action refuses if the letter has moved since.
    const stepField = html`<input type="hidden" name="step_id" value="${active?.id ?? ''}">`;
    // The room a new step would leave from; sending there is refused, so it is
    // not offered.
    const fromRoom = active?.to_room_id ?? doc.current_room_id ?? req.user.roomId;

    const notice = req.query.registered ? { kind: 'ok',    text: `کتاب تۆمارکرا. ژمارەی: ${ltrText(doc.incoming_no)}` }
                 : req.query.closed     ? { kind: 'ok',    text: `کتاب داخرا. ژمارەی دەرچوو: ${ltrText(doc.outgoing_no)}` }
                 : DONE[req.query.done] ? { kind: 'ok',    text: DONE[req.query.done] }
                 : req.query.chased     ? { kind: 'ok',    text: 'داواکاری بەدواداچوونەکەت نووسرا.' }
                 : req.query.sent       ? { kind: 'ok',    text: 'کتاب نێردرا.' }
                 : req.query.attached   ? { kind: 'ok',    text: 'هاوپێچ زیادکرا.' }
                 : req.query.ok         ? { kind: 'ok',    text: String(req.query.ok) }
                 : req.query.error      ? { kind: 'error', text: String(req.query.error) }
                 : null;

    const roomLabel = r => `${r.name}${r.room_number ? ` (${num(r.room_number)})` : ''}`;

    res.send(page({
      user: req.user,
      title: `کتابی ${ltrText(doc.incoming_no)}`,
      current: '/documents',
      notice,
      actions: html`
        ${canMargin ? html`<a class="btn gold" href="/documents/${doc.id}/margin">نووسینی هامش</a>` : ''}
        ${canReply ? html`<a class="btn" href="/documents/${doc.id}/reply">${doc.outgoing_no ? 'بینینی وەڵام' : 'نووسینی وەڵام'}</a>` : ''}
        <a class="btn secondary" href="/documents/${doc.id}/case">${inChain ? 'هەموو دۆسیەکە' : 'مێژووی کتاب'}</a>
        <a class="btn secondary" href="/documents/${doc.id}/print" target="_blank">چاپی پەڕەی کتاب</a>`,
      body: html`
        <div class="grid cols-2 letter-page">

          <div>
            <div class="card">
              <div class="card-head">
                <h2>${doc.subject}</h2>
                <div class="end">${doc.is_confidential ? html`<span class="pill danger" title="تەنها سەرۆک، جێگر و ئەو ژوورانەی کتابەکەیان پێگەیشتووە دەیبینن">نهێنی</span>` : ''}${PRIORITY_PILL[doc.priority] ? html`<span class="pill ${PRIORITY_PILL[doc.priority][0]}">${PRIORITY_PILL[doc.priority][1]}</span>` : ''}${statusPill(doc.status)}</div>
              </div>
              <table class="kv">
                <tbody>
                  <tr><th>ژمارەی هاتوو</th><td class="mono">${ltr(doc.incoming_no)}</td></tr>
                  <tr><th>بەرواری هاتوو</th><td>${date(doc.incoming_date)}</td></tr>
                  ${doc.reply_by ? html`<tr><th>بەڵێنی وەڵام بۆ داواکار</th><td>
                    ${date(doc.reply_by)}
                    ${['closed', 'cancelled'].includes(doc.status) ? '' : replyByPill(doc.reply_days_left)}
                  </td></tr>` : ''}
                  <tr><th>جۆر</th><td>${doc.type_name ? html`${doc.type_name} <span class="muted">(${DOC_TYPES.find(t => t[0] === doc.doc_type)?.[1] ?? doc.doc_type})</span>` : DOC_TYPES.find(t => t[0] === doc.doc_type)?.[1] ?? doc.doc_type}${doc.type_requires_seal ? html` <span class="pill info">پێویستی بە مۆری فەرمییە</span>` : ''}</td></tr>
                  <tr><th>نێردەر</th><td>${doc.sender_name}${doc.sender_contact ? html`<span class="cell-sub"><span dir="ltr">${doc.sender_contact}</span></span>` : ''}</td></tr>
                  ${doc.plot_no ? html`<tr><th>پارچە</th><td>
                    <a class="mono" href="/plots?p=${encodeURIComponent(doc.plot_no)}">${ident(doc.plot_no)}</a>${doc.neighbourhood ? html` — ${doc.neighbourhood}` : ''}
                    <span class="cell-sub"><a href="/plots?p=${encodeURIComponent(doc.plot_no)}">هەموو مێژووی ئەم پارچەیە ببینە</a></span>
                  </td></tr>` : ''}
                  ${doc.related_document_id && doc.related_incoming_no ? html`
                    <tr><th>بەدواداچوونی</th><td>
                      <a class="mono" href="/documents/${doc.related_document_id}">${ltr(doc.related_incoming_no)}</a>
                      <span class="cell-sub">${doc.related_subject}</span>
                    </td></tr>` : ''}
                  ${followUps.length ? html`
                    <tr><th>بەدواداچوونەکان</th><td>
                      ${followUps.map(f => html`<div><a class="mono" href="/documents/${f.id}">${ltr(f.incoming_no)}</a>
                        <span class="muted">${f.subject}</span></div>`)}
                    </td></tr>` : ''}
                  ${doc.physical_shelf || doc.physical_folder || doc.physical_section ? html`
                    <tr><th>شوێنی کاغەز</th><td class="muted">
                      ${[doc.physical_shelf && `ڕەف ${doc.physical_shelf}`,
                         doc.physical_section && `بەش ${doc.physical_section}`,
                         doc.physical_folder && `دۆسیە ${doc.physical_folder}`].filter(Boolean).join(' · ')}
                    </td></tr>` : ''}
                  <tr><th>تۆمارکرا لەلایەن</th><td>${doc.registered_by_name ?? '—'}</td></tr>
                  ${doc.outgoing_no ? html`
                    <tr><th>ژمارەی دەرچوو</th><td class="mono">${ltr(doc.outgoing_no)}</td></tr>
                    ${verifyCode ? html`<tr><th>کۆدی پشتڕاستکردنەوە</th><td>
                      <span class="mono">${ltr(groupCode(verifyCode))}</span>
                      <span class="cell-sub">هەر کەسێک ئەم کتابەی پێبێت دەتوانێت لە <a href="/verify?code=${verifyCode}" target="_blank">پەڕەی پشتڕاستکردنەوە</a> بیپشکنێت.</span>
                    </td></tr>` : ''}
                    <tr><th>وەرگر</th><td>${doc.outgoing_recipient}</td></tr>
                    <tr><th>داخرا</th><td>${date(doc.closed_at)}</td></tr>
                    ${doc.outgoing_summary ? html`
                      <!-- The reply itself, on the letter it answers. Anything
                           else means the file on the screen and the paper the
                           citizen is holding are two different things. -->
                      <tr><th>وەڵامی نێردراو</th><td>
                        <div style="white-space:pre-wrap">${doc.outgoing_summary}</div>
                        ${canReply ? html`<div style="margin-top:6px">
                          <a class="btn small secondary" href="/documents/${doc.id}/reply/print" target="_blank">چاپی وەڵام</a>
                        </div>` : ''}
                      </td></tr>` : ''}` : ''}
                  ${doc.status === 'cancelled' ? html`
                    <tr><th>هۆکاری هەڵوەشاندنەوە</th><td class="muted">${doc.cancel_reason}</td></tr>` : ''}
                  <tr><th>بارکۆد</th><td class="mono">${ltr(doc.barcode)}</td></tr>
                  ${active ? html`<tr><th>پەڕگەی کاغەزی</th><td>
                    ${active.paper_received_at
                      ? html`<span class="pill ok">وەرگیراوە</span>
                             <span class="cell-sub">${date(active.paper_received_at)} ${time(active.paper_received_at)}</span>`
                      : html`<span class="pill warn">نەگەیشتووە</span>
                          ${iHoldIt ? html`
                            <form method="post" action="/documents/${doc.id}/paper-received" style="display:inline">
                              <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                              <button class="btn small" type="submit">وەرگرتنی پەڕگەی کاغەزی</button>
                            </form>` : ''}`}
                  </td></tr>` : ''}
                  ${companies.length ? html`<tr><th>کۆمپانیا</th><td>
                    ${companies.map(c => html`<a href="/companies/${c.id}">${c.name}</a> `)}
                  </td></tr>` : ''}
                </tbody>
              </table>

              ${doc.status === 'cancelled' ? '' : html`
                <div class="row" style="margin-top:12px">
                  <a class="btn secondary" href="/documents/${doc.id}/receipt" target="_blank">چاپی پسوولە</a>
                </div>`}
            </div>

            ${canChase ? html`
              <div class="card">
                <h2>ئێستا لای: ${active.to_room_name ?? 'ژوورێکی تر'}</h2>
                <p class="card-sub">
                  تۆ ناردووتە بۆ ئەوێ، ${ago(active.sent_at)}.
                  ${active.received_at ? '' : 'هێشتا نەیانکردۆتەوە.'}
                </p>
                <form method="post" action="/documents/${doc.id}/chase">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <div class="field">
                    <label for="chase_note">داواکاری بەدواداچوون</label>
                    <textarea id="chase_note" name="note" rows="2" maxlength="2000"
                      placeholder="تکایە بەدواداچوون بۆ ئەم کتابە بکرێت."></textarea>
                    <div class="hint">
                      وەک تێبینییەک لەسەر کتابەکە دەنووسرێت و ژوورەکە ئاگادار دەکرێتەوە.
                      ڕۆژی جارێک.
                    </div>
                  </div>
                  <button class="btn" type="submit">بیریان بخەرەوە</button>
                </form>
              </div>` : ''}

            <div class="card">
              <h2>تێبینییەکان ${notes.length ? html`<span class="pill muted">${num(notes.length)}</span>` : ''}</h2>
              <p class="card-sub">
                تێبینی سەبارەت بەم کتابە. ناسڕێتەوە و دەستکاری ناکرێت.
              </p>
              ${notes.length === 0 ? html`<div class="empty compact">هیچ تێبینییەک نییە.</div>` : html`
                <ul class="note-list">
                  ${notes.map(n => html`<li>
                    <div>${n.body}</div>
                    <div class="muted note-meta">
                      ${n.author_name ?? ''}${n.room_name ? html` · ${n.room_name}` : ''} · ${date(n.created_at)} ${time(n.created_at)}
                    </div>
                  </li>`)}
                </ul>`}
              <!-- Offered on a closed letter too, deliberately. "The applicant
                   came back about this in March" is a note worth having, and the
                   letter being finished is exactly when it gets said. -->
              <form method="post" action="/documents/${doc.id}/notes">
                <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                <div class="field">
                  <label for="note_body">تێبینییەکی نوێ</label>
                  <textarea id="note_body" name="body" rows="2" maxlength="2000" required></textarea>
                </div>
                <button class="btn" type="submit">زیادکردن</button>
              </form>
            </div>

            <div class="card" id="attachments">
              <div class="card-head">
                <h2>هاوپێچەکان ${attachments.length ? html`<span class="pill muted">${num(attachments.length)}</span>` : ''}</h2>
                ${canCompare ? html`<div class="end">
                  <a class="btn small secondary" href="/documents/${doc.id}/compare">بەراوردی هاتوو و دەرچوو</a>
                </div>` : ''}
              </div>
              <!-- The mark the front desk puts on paper. Said here because this is
                   where the clerk is standing when they have just scanned it. -->
              ${canStamp && firstScan && !stamps.some(x => x.kind === 'incoming') ? html`
                <p class="card-sub">
                  هێشتا مۆری هاتوو لەسەر هیچ سکانێک نییە.
                  <a href="/attachments/${firstScan.id}/stamp?kind=incoming">مۆری هاتوو لێبدە</a>
                </p>` : ''}
              ${canStamp && doc.outgoing_no && firstScan && !stamps.some(x => x.kind === 'outgoing') ? html`
                <p class="card-sub">
                  کاغەزی ئیمزاکراوی وەڵام سکان بکە و مۆری دەرچووی لێبدە، بۆ ئەوەی بەراورد تەواو بێت.
                </p>` : ''}
              ${attachments.length === 0 ? html`<div class="empty compact">هیچ هاوپێچێک نییە.</div>` : html`
                <!-- A list rather than a table. The table put five columns and
                     two buttons into half a screen, the buttons hung off the
                     card, and on a phone the file names were cut off entirely,
                     which read as "the attachment is not there". -->
                <ul class="attach-list">${attachments.map(a => html`<li>
                  <div class="attach-row">
                    <a class="attach-name" href="/attachments/${a.id}/view">
                      <span class="pill muted">${typeLabel(a.mime_type)}</span>
                      <bdi dir="ltr">${a.original_name}</bdi>
                    </a>
                    <span class="attach-actions">
                      <a class="btn small" href="/attachments/${a.id}/view">بینین</a>
                      ${canStamp && COMPARABLE.includes(a.mime_type)
                        ? html`<a class="btn small secondary" href="/attachments/${a.id}/stamp">مۆرکردن</a>` : ''}
                      <a class="btn small secondary" href="/attachments/${a.id}?download=1">داگرتن</a>
                    </span>
                  </div>
                  <div class="muted attach-meta">
                    ${a.kind === 'margin_note' ? html`<span class="pill info">${kindLabel(a.kind)}</span>` : kindLabel(a.kind)}
                    ${stampOn.get(String(a.id)) ? html` <span class="pill ${stampOn.get(String(a.id)) === 'incoming' ? 'info' : 'ok'}">مۆری ${stampOn.get(String(a.id)) === 'incoming' ? 'هاتوو' : 'دەرچوو'}</span>` : ''}
                    ${a.uploaded_room_name ? html` · ${a.uploaded_room_name}` : ''}
                    · ${a.uploaded_by_name ?? ''} · ${date(a.uploaded_at)}
                    · ${num(Math.max(1, Math.round(a.size_bytes / 1024)))} کیلۆبایت
                    ${a.page_count ? html` · ${num(a.page_count)} پەڕە` : ''}
                    ${a.virus_scanned_at ? '' : html` <span class="pill warn" title="پشکنەری ڤایرۆس هێشتا دانەمەزراوە">پشکنین نەکراوە</span>`}
                    ${raw(readBadge(a))}
                  </div>
                  <details class="attach-more">
                    <summary>زیاتر</summary>
                    <!-- The first twelve characters of the SHA-256 taken as the
                         bytes streamed in. Enough to compare two files by eye,
                         and the button below checks the whole of it properly. -->
                    <div class="muted mono" dir="ltr"
                         title="${a.sha256 ?? ''}">${(a.sha256 ?? '').slice(0, 12)}</div>
                    <form method="post" action="/attachments/${a.id}/verify" style="display:inline">
                      <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                      <button class="btn small secondary" type="submit"
                              title="خوێندنەوەی پەڕگەکە و بەراوردکردنی هاشەکەی">پشکنینی دەستکاری</button>
                    </form>
                    <!-- The reader comes round every couple of minutes on its
                         own. This is for the clerk standing at a counter who
                         needs the scan findable before the person leaves. -->
                    ${['done', 'empty', 'unsupported'].includes(a.ocr_status) || a.mime_type.startsWith('image/vnd.') ? '' : html`
                      <form method="post" action="/attachments/${a.id}/read" style="display:inline">
                        <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                        <button class="btn small secondary" type="submit"
                                title="خوێندنەوەی نووسینی ناو سکانەکە ئێستا">خوێندنەوەی نووسین</button>
                      </form>`}
                  </details>
                </li>`)}</ul>`}
              ${['closed', 'cancelled'].includes(doc.status) ? '' : html`
                <form method="post" action="/documents/${doc.id}/attachments" enctype="multipart/form-data" class="attach-upload">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <select name="kind" aria-label="جۆری هاوپێچ">${options(ATTACHMENT_KINDS, iHoldIt ? 'handwritten_reply' : 'original_scan')}</select>
                  <input type="file" name="file" required accept="${acceptFor(allowTypes)}"
                         data-max-bytes="${Math.min(MAX_BYTES, 50 * 1024 * 1024)}">
                  <button class="btn" type="submit">لکاندن</button>
                </form>
                <div class="hint">
                  ${allowTypes.includes('dwg')
                    ? 'PDF، وێنە، یان نەخشەی DWG و DXF'
                    : 'PDF یان وێنە'}، تا ${num(Math.floor(Math.min(MAX_BYTES, 50 * 1024 * 1024) / 1048576))} مێگابایت.
                </div>
                ${scanners.length ? html`<div style="margin-top:10px">
                  <a class="btn secondary" href="/scan?document_id=${doc.id}">سکانکردن لە سکانەر</a>
                </div>` : ''}`}
            </div>
          </div>

          <!-- The trail, and under it whatever this person can do next. The
               actions sat at the bottom of the other column, below notes and
               attachments, 1,200 pixels down for the room holding the letter,
               while this column was empty under the trail (design test, 13
               September; the mockup puts them here). -->
          <div>
            <div class="card">
              <h2>ڕێڕەوی کتاب</h2>
              ${steps.length === 0
                ? html`<div class="empty compact">${doc.status === 'cancelled' ? 'پێش ئەوەی بنێردرێت هەڵوەشێنرایەوە.' : 'هێشتا بۆ هیچ ژوورێک نەنێردراوە.'}</div>`
                : html`<ol class="trail">
                    ${steps.map(s => {
                      const [pk, pl] = STEP_STATUS[s.status] ?? ['muted', s.status];
                      const took = s.sent_at && s.completed_at ? elapsed(s.sent_at, s.completed_at) : '';
                      return html`<li class="${s.status}">
                        <div class="row">
                          <strong>${s.to_room_name}${s.to_room_number ? ` (${num(s.to_room_number)})` : ''}</strong>
                          <span class="pill ${pk}">${pl}</span>
                          ${s.overdue ? html`<span class="pill danger">دواکەوتوو</span>` : ''}
                          ${s.group_size > 1 ? html`<span class="pill muted">${num(s.group_position)} لە ${num(s.group_size)}</span>` : ''}
                        </div>
                        ${s.assigned_to_name ? html`<span class="cell-sub">${s.assigned_to_name}
                          ${s.assigned_via_delegation_id ? html`<span class="pill info">جێگر</span>` : ''}</span>` : ''}
                        ${s.note ? html`<div>${s.note}</div>` : ''}
                        ${s.action_taken ? html`<div>
                          <strong>${STEP_ACTION[s.action_taken] ?? s.action_taken}</strong>
                          ${s.reply_note ? html` — ${s.reply_note}` : ''}
                        </div>` : ''}
                        <div class="when">
                          ${s.sent_at ? html`نێردرا ${date(s.sent_at)} ${time(s.sent_at)}` : 'چاوەڕوانی نۆرەی خۆیەتی'}
                          ${s.status === 'cancelled' ? html` · هەڵوەشێنرایەوە`
                            : s.completed_at ? html` · ${s.status === 'returned' ? 'گەڕێندرایەوە' : 'تەواوبوو'}${took && took !== 'ئێستا' ? html` دوای ${took}` : ''}`
                            : s.sent_at ? html` · ${elapsed(s.sent_at) === 'ئێستا' ? 'تازە گەیشتووە' : html`${elapsed(s.sent_at)} کراوەیە`}` : ''}
                        </div>
                      </li>`;
                    })}
                  </ol>`}

              ${iSentIt && active && !active.received_at ? html`
                <form method="post" action="/documents/${doc.id}/recall" style="margin-top:16px">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  ${stepField}
                  <button class="btn secondary" type="submit">گەڕاندنەوەی ناردنەکە</button>
                  <div class="hint">هێشتا نەکراوەتەوە، بۆیە دەکرێت بگەڕێندرێتەوە.</div>
                </form>` : ''}
            </div>

            ${iHoldIt ? html`
              <div class="card">
                <h2>ئەم کتابە لای ژووری تۆیە</h2>
                <form method="post" action="/documents/${doc.id}/complete" style="margin-bottom:18px">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  ${stepField}
                  <div class="field">
                    <label for="action">چیت کرد؟</label>
                    <select id="action" name="action" required>${options(ACTIONS_FOR_COMPLETE, 'opinion')}</select>
                  </div>
                  <div class="field">
                    <label for="reply_note">تێبینی</label>
                    <textarea id="reply_note" name="reply_note" maxlength="2000"
                              placeholder="ئەوەی لە پەراوێزی کتابەکەدا دەنووسرێت"></textarea>
                  </div>
                  <button class="btn" type="submit">تەواوکردنی هەنگاو</button>
                </form>

                <details>
                  <summary class="muted">ئەمە بۆ ژووری ئێمە نییە</summary>
                  <form method="post" action="/documents/${doc.id}/return" style="margin-top:12px">
                    <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                    ${stepField}
                    <div class="field">
                      <label for="reason" class="required">هۆکار</label>
                      <textarea id="reason" name="reason" required minlength="3" maxlength="1000"
                                placeholder="بۆچی دەگەڕێتەوە؟"></textarea>
                    </div>
                    <button class="btn danger" type="submit">گەڕاندنەوە بۆ نێردەر</button>
                  </form>
                </details>
              </div>` : ''}

            ${canRoute && ['registered', 'in_flow', 'ready_to_close'].includes(doc.status) ? html`
              <div class="card">
                <h2>ناردن</h2>

                <form method="post" action="/documents/${doc.id}/route" style="margin-bottom:20px">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <input type="hidden" name="mode" value="single">
                  ${stepField}
                  <div class="field">
                    <label for="to_room">بۆ یەک ژوور</label>
                    <select id="to_room" name="to_room_id" required>
                      <option value="">— ژوورێک هەڵبژێرە —</option>
                      ${rooms.filter(r => Number(r.id) !== Number(fromRoom)).map(r =>
                        html`<option value="${r.id}"${Number(r.id) === Number(doc.type_room_id) && doc.status === 'registered' ? ' selected' : ''}>${roomLabel(r)}</option>`)}
                    </select>
                  </div>
                  <div class="field">
                    <label for="note">تێبینی بۆ ژوورەکە</label>
                    <input id="note" name="note" type="text" maxlength="500">
                  </div>
                  <label class="row" style="margin-bottom:12px">
                    <input type="checkbox" name="return_to_assigner" value="1">
                    <span>دوای تەواوبوون بگەڕێتەوە بۆ من</span>
                  </label>
                  <button class="btn" type="submit">ناردن</button>
                </form>

                <form method="post" action="/documents/${doc.id}/route">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <input type="hidden" name="mode" value="sequence">
                  ${stepField}
                  <div class="field">
                    <label>بە ڕیزبەندی — بە ڕیزی خۆی هەڵبژێرە</label>
                    <div class="hint" style="margin-bottom:8px">
                      کتاب یەک لە دوای یەک دەڕوات. هەر ژوورێک تەنها کاتێک دەیبینێت کە نۆرەی خۆی بێت.
                    </div>
                    ${[1, 2, 3, 4].map(i => html`
                      <select name="seq_room" aria-label="ژووری ${num(i)}" style="margin-bottom:6px">
                        <option value="">— ${num(i)} —</option>
                        ${rooms.filter(r => i > 1 || Number(r.id) !== Number(fromRoom)).map(r => html`<option value="${r.id}">${roomLabel(r)}</option>`)}
                      </select>`)}
                  </div>
                  <label class="row" style="margin-bottom:12px">
                    <input type="checkbox" name="return_to_assigner" value="1" checked>
                    <span>لە کۆتاییدا بگەڕێتەوە بۆ من</span>
                  </label>
                  <button class="btn gold" type="submit">ناردن بە ڕیزبەندی</button>
                </form>
              </div>` : ''}

            ${canFlags ? html`
              <details class="card" id="flags"${req.query.flags ? ' open' : ''}>
                <summary><strong>نهێنی و بەڵێنی وەڵام</strong></summary>
                <form method="post" action="/documents/${doc.id}/flags" style="margin-top:12px">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <div class="grid cols-2">
                    <div class="field">
                      <label for="reply_by">بەرواری وەڵامدانەوە بە داواکار</label>
                      <input id="reply_by" name="reply_by" type="date" dir="ltr" value="${doc.reply_by_iso ?? ''}">
                      <div class="hint">بەتاڵی بهێڵەوە بۆ لابردنی.</div>
                    </div>
                    <label class="row" style="margin-top:26px">
                      <input type="checkbox" name="is_confidential" value="1"${doc.is_confidential ? ' checked' : ''}>
                      <span>کتابێکی نهێنییە</span>
                    </label>
                  </div>
                  <p class="hint">
                    کتابی نهێنی تەنها سەرۆک، جێگر، ئەوەی تۆماری کردووە و ئەو ژوورانەی بۆیان نێردراوە دەیبینن.
                    کارمەندانی تری ژووری هات و دەرچوو تا دەگەڕێتەوە بۆ داخستن نایبینن.
                  </p>
                  <button class="btn" type="submit">پاشەکەوتکردن</button>
                </form>
              </details>` : ''}

            ${canClose ? html`
              <div class="card" id="close">
                <h2>داخستنی کتاب</h2>
                <p class="card-sub">
                  ژمارەی دەرچوو دەدرێت و کتابەکە دادەخرێت. ژمارە جارێکی تر
                  بەکارناهێنرێتەوە، بۆیە دوای واژووکردن ئەمە لێبدە، نەک پێشی.
                </p>
                <form method="post" action="/documents/${doc.id}/close">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <div class="grid cols-2">
                    <div class="field">
                      <label for="recipient" class="required">وەرگر</label>
                      <input id="recipient" name="recipient" type="text" required maxlength="200"
                             value="${doc.outgoing_recipient ?? doc.sender_name ?? ''}">
                    </div>
                    <div class="field">
                      <label for="channel">ڕێگای ناردن</label>
                      <select id="channel" name="channel">${options(CHANNELS, 'hand')}</select>
                    </div>
                  </div>
                  <div class="field">
                    <label for="summary">دەقی وەڵام</label>
                    <textarea id="summary" name="summary" maxlength="12000" rows="4">${doc.outgoing_summary ?? ''}</textarea>
                    <div class="hint">${doc.outgoing_summary
                      ? 'ئەمە ئەو ڕەشنووسەیە کە لە «نووسینی وەڵام» پاشەکەوتکراوە.'
                      : html`ئەگەر وەڵامەکە لە <a href="/documents/${doc.id}/reply">نووسینی وەڵام</a> دەنووسیت، ئەم خانەیە بەتاڵ بهێڵەوە.`}</div>
                  </div>
                  <button class="btn" type="submit">وەرگرتنی ژمارەی دەرچوو و داخستن</button>
                </form>
              </div>` : ''}

            ${mayCancel(req.user, doc) ? html`
              <details class="card danger-zone">
                <summary>هەڵوەشاندنەوەی کتاب</summary>
                <p class="muted">
                  بۆ کتابێک کە بە هەڵە یان دووجار تۆمارکراوە. ژمارەکەی بەکارناهێنرێتەوە و
                  کتابەکە لە هەموو ژوورەکان لادەبرێت، بەڵام مێژووەکەی دەمێنێت.
                </p>
                <form method="post" action="/documents/${doc.id}/cancel">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <div class="field">
                    <label for="cancel_reason" class="required">هۆکار</label>
                    <textarea id="cancel_reason" name="reason" required maxlength="1000" rows="2"
                              placeholder="بۆ نموونە: دووجار تۆمارکرا"></textarea>
                  </div>
                  <button class="btn danger" type="submit">هەڵوەشاندنەوەی کتاب</button>
                </form>
              </details>` : ''}
          </div>
        </div>`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * What the reader made of one scan.
 *
 * Four states and four different things to say, because the difference between
 * them is the difference between trusting a search result and not. No badge at
 * all means the reader has not reached this file yet, which on a busy morning is
 * a normal state lasting a minute or two.
 */
function readBadge(a) {
  if (!a.ocr_status) return '';
  if (a.ocr_status === 'done') {
    return `<span class="pill ok" title="دەتوانیت بەم وشانە بیدۆزیتەوە">` +
           `خوێندرایەوە</span> <a href="/attachments/${a.id}/text">دەق</a>`;
  }
  if (a.ocr_status === 'low') {
    return `<span class="pill warn" ` +
           `title="لەوانەیە بە دەست نووسرابێت. گەڕان کاردەکات بەڵام دڵنیا نییە">` +
           `بە دڵنیایی نەخوێندرایەوە</span> <a href="/attachments/${a.id}/text">دەق</a>`;
  }
  if (a.ocr_status === 'empty') {
    return `<span class="pill muted" title="نەخشە یان وێنەیەکە بێ نووسین">بێ نووسین</span>`;
  }
  if (a.ocr_status === 'unsupported') {
    return `<span class="pill muted">ناخوێندرێتەوە</span>`;
  }
  return `<span class="pill danger">خوێندنەوەکە سەرکەوتوو نەبوو</span>`;
}

// What each action says when it worked. Every one of them used to come back as
// "letter sent", so adding a note or signing for a folder told the clerk a letter
// had gone somewhere it had not (browser audit, 13 September). Sending keeps
// ?sent=1, which other screens and the tests already link to.
const DONE = {
  note:      'تێبینییەکە زیادکرا.',
  paper:     'وەرگرتنی پەڕگەی کاغەزی تۆمارکرا.',
  complete:  'هەنگاوەکە تەواوکرا.',
  returned:  'کتابەکە گەڕێندرایەوە بۆ نێردەر.',
  recalled:  'ناردنەکە گەڕێندرایەوە. دەتوانیت دووبارە بینێریت.',
  cancelled: 'کتابەکە هەڵوەشێنرایەوە.',
  margin:    'هامشەکە مۆرکرا و کتابەکە نێردرا.',
  stamp_incoming: 'مۆری هاتوو لەسەر سکانەکە دانرا.',
  stamp_outgoing: 'مۆری دەرچوو لەسەر سکانەکە دانرا.',
  flags:     'پاشەکەوتکرا.',
};

const back = (res, id, err, done = null) =>
  res.redirect(303, `/documents/${id}${err ? `?error=${encodeURIComponent(err)}` : done ? `?done=${done}` : '?sent=1'}`);

const handle = (fn, done = null) => async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    await withActor(req.user, q => fn(q, req, id));
    // After the commit, never inside it. Every action below can raise a
    // notification, and the browsers to ring are parked on the request until the
    // transaction has actually succeeded.
    await deliverPushes(req);
    back(res, id, null, done);
  } catch (err) {
    if (err instanceof RoutingError || err instanceof DocumentError) return back(res, id, err.message);
    // Row-level security refusing the write: a note or an action on a letter this
    // person cannot see. It came back as the error page (security test).
    if (err.code === '42501') return back(res, id, 'ئەم کارە لەسەر ئەم کتابە بۆ تۆ ڕێگەپێدراو نییە.');
    next(err);
  }
};

// The step the page was drawn for, when the form carried one. Undefined for a
// request without the field, which is then checked by room alone.
const stepOf = req => ('step_id' in (req.body ?? {}) ? req.body.step_id : undefined);

router.post('/documents/:id/route', requireAuth, handle(async (q, req, id) => {
  if (req.body.mode === 'sequence') {
    const roomIds = [].concat(req.body.seq_room ?? [])
      .filter(v => v !== '').map(Number);
    return sendSequence(q, {
      documentId: id, roomIds, byUser: req.user,
      note: req.body.note || null,
      returnToAssigner: !!req.body.return_to_assigner, stepId: stepOf(req), req,
    });
  }
  return sendSingle(q, {
    documentId: id, toRoomId: Number(req.body.to_room_id), byUser: req.user,
    note: req.body.note || null,
    returnToAssigner: !!req.body.return_to_assigner, stepId: stepOf(req), req,
  });
}));

// The folder arrived. Not the same as opening it on screen; see migration 0300.
router.post('/documents/:id/paper-received', requireAuth, handle((q, req, id) =>
  paperReceive(q, { documentId: id, byUser: req.user, req }), 'paper'));

// A remark about the letter rather than about a hand-off. Append-only, so there
// is no edit route to write and none to argue about.
router.post('/documents/:id/notes', requireAuth, handle(async (q, req, id) => {
  const body = (req.body.body ?? '').toString().trim();
  if (body.length < 1 || body.length > 2000) {
    throw new DocumentError('تێبینییەکە بەتاڵە یان زۆر درێژە.', 'bad_note');
  }
  const { rows: [n] } = await q(
    `INSERT INTO document_note (document_id, room_id, author_id, body)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [id, req.user.roomId, req.user.id, body]);
  await logEvent(q, {
    action: 'note.added', req, userId: req.user.id, roomId: req.user.roomId,
    documentId: id, detail: { note_id: n.id, length: body.length },
  });

  // Whoever is holding the letter now is told there is something new written on
  // it. The note's text stays where it is: the notification carries the id, and
  // the room reads the remark on the letter's own page under its own rules.
  const { rows: [d] } = await q(`SELECT current_room_id FROM document WHERE id = $1`, [id]);
  if (d?.current_room_id) {
    await notifyRoom(q, {
      roomId: d.current_room_id, kind: 'note.added', documentId: id,
      actorId: req.user.id, req, detail: { note_id: n.id },
    });
  }
}, 'note'));

router.post('/documents/:id/complete', requireAuth, handle((q, req, id) =>
  complete(q, {
    documentId: id, byUser: req.user,
    action: req.body.action || 'no_action',
    replyNote: req.body.reply_note || null, stepId: stepOf(req), req,
  }), 'complete'));

router.post('/documents/:id/return', requireAuth, handle((q, req, id) =>
  returnStep(q, { documentId: id, byUser: req.user, reason: req.body.reason, stepId: stepOf(req), req }), 'returned'));

router.post('/documents/:id/recall', requireAuth, handle((q, req, id) =>
  recall(q, { documentId: id, byUser: req.user, stepId: stepOf(req), req }), 'recalled'));

router.post('/documents/:id/flags', requireAuth, handle((q, req, id) =>
  setDocumentFlags(q, {
    documentId: id, isConfidential: req.body.is_confidential === '1',
    replyBy: req.body.reply_by || null, byUser: req.user, req,
  }), 'flags'));

router.post('/documents/:id/cancel', requireAuth, handle((q, req, id) =>
  cancelDocument(q, { documentId: id, reason: req.body.reason, byUser: req.user, req }), 'cancelled'));

export default router;
