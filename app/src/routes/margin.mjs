// Writing the هامش (the handwritten instruction on the letter).
//
// The page shows the letter's scan, full width, with a sheet of glass over it for
// the pen: a finger, a stylus, or a mouse. Blue, red, green or black ink, three
// thicknesses, undo. Under it the rooms to send it to, in order, and an optional
// line of typed words for the search to find («بە پەلە»). The stamp with the
// writer's name, role and the time goes on in the corner when it is sent.
//
// What happens then (lib/margin.mjs): the ink is laid onto that page of the PDF,
// the whole letter is kept as a new attachment of kind margin_note, a margin_note
// row records it, and the letter is sent exactly as the ordinary send form would
// send it: one room, or several in sequence. One transaction, so a send that is
// refused leaves no stamped page behind claiming an instruction was given.
//
// The drawing needs the page script (public/margin.js); without it this page says
// so and points to the ordinary send form, which still works.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { getDocument } from '../lib/documents.mjs';
import { trail, maySend, sendSingle, sendSequence, RoutingError } from '../lib/routing.mjs';
import { receiveUpload, readStored, storeBuffer, scanFile, removeStored, UploadError } from '../lib/files.mjs';
import { inkOntoLetter, MarginError } from '../lib/margin.mjs';
import { logEvent } from '../lib/log.mjs';
import { deliver as deliverPushes } from '../lib/notify.mjs';
import { notFound, refused, logRefusal } from '../lib/respond.mjs';
import { page, asset, ROLE_NAMES } from '../views/layout.mjs';
import { html, num, date, time, ltr, ltrText } from '../lib/html.mjs';

const router = Router();

export const MARGIN_WRITERS = ['mayor', 'deputy_mayor', 'directorate_head', 'room_head'];
const OPEN = ['registered', 'in_flow', 'ready_to_close'];
const INK_MAX_BYTES = 12 * 1024 * 1024;

// The heading of the stamp, by who is writing.
const STAMP_TITLE = {
  mayor: 'هامشی سەرۆکی شارەوانی',
  deputy_mayor: 'هامشی جێگری سەرۆکی شارەوانی',
  directorate_head: 'هامشی بەڕێوەبەر',
  room_head: 'هامشی بەرپرسی ژوور',
};

/** Everything the page and the action both need to decide. */
async function context(q, user, id) {
  const doc = await getDocument(q, id);
  if (!doc) return null;
  const steps = await trail(q, id);
  const active = steps.find(s => s.status === 'active') ?? null;
  const allowed = MARGIN_WRITERS.includes(user.role) && OPEN.includes(doc.status)
                  && await maySend(q, user, doc, active);
  return { doc, active, allowed };
}

router.get('/documents/:id(\\d+)/margin', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!MARGIN_WRITERS.includes(req.user.role)) return refused(req, res, 'نووسینی هامش بۆ سەرۆک، جێگر و بەرپرسەکانە.');
    const data = await withActor(req.user, async q => {
      const ctx = await context(q, req.user, id);
      if (!ctx) return null;
      // The newest هامش first: on paper the next instruction goes on the same
      // sheet as the last one, under it. Then the original scan, then the rest.
      const { rows: scans } = await q(`
        SELECT a.id, a.original_name, a.mime_type, a.kind, a.page_count, a.uploaded_at,
               u.full_name AS uploaded_by_name
          FROM attachment a
          LEFT JOIN app_user u ON u.id = a.uploaded_by
         WHERE a.document_id = $1 AND a.mime_type IN ('application/pdf', 'image/png', 'image/jpeg')
         ORDER BY (a.kind = 'margin_note') DESC, (a.kind = 'original_scan') DESC,
                  CASE WHEN a.kind = 'margin_note' THEN a.uploaded_at END DESC NULLS LAST, a.uploaded_at`, [id]);
      const { rows: rooms } = await q(
        `SELECT id, name, room_number FROM room WHERE is_active ORDER BY sort_order, name`);
      return { ...ctx, scans, rooms };
    });
    if (!data) {
      await logRefusal(req, 'document', id);
      return notFound(req, res, 'ئەم کتابە نەدۆزرایەوە، یان ڕێگەت پێنەدراوە بیبینیت.');
    }
    const { doc, active, allowed, scans, rooms } = data;
    if (!allowed) {
      return refused(req, res, 'ئەم کتابە ئێستا لای تۆ نییە، بۆیە ناتوانیت هامشی بۆ بنووسیت و بینێریت.');
    }
    const fromRoom = active?.to_room_id ?? doc.current_room_id ?? req.user.roomId;
    const now = new Date();

    res.send(page({
      user: req.user, title: `هامش — ${ltrText(doc.incoming_no)}`, current: '/documents',
      actions: html`<a class="btn secondary" href="/documents/${doc.id}">گەڕانەوە بۆ کتاب</a>`,
      body: html`
        <noscript><div class="notice warn">نووسینی هامش پێویستی بە JavaScript ە. دەتوانیت لە پەڕەی کتابەکەدا بە فۆڕمی ئاسایی بینێریت.</div></noscript>
        <form class="margin-app" id="margin-form" method="post" action="/documents/${doc.id}/margin"
              enctype="multipart/form-data"
              data-margin
              data-stamp-title="${STAMP_TITLE[req.user.role]}"
              data-stamp-name="${req.user.fullName ?? ''}"
              data-stamp-role="${req.user.jobTitle || ROLE_NAMES[req.user.role] || ''}"
              data-server-now="${now.toISOString()}"
              data-letter-no="${doc.incoming_no}"
              data-letter-date="${date(doc.incoming_date)}"
              data-letter-subject="${doc.subject}"
              data-letter-sender="${doc.sender_name}">
          <input type="hidden" name="_csrf" value="${res.locals.csrf}">
          <input type="hidden" name="step_id" value="${active?.id ?? ''}">
          <input type="hidden" name="rooms" value="">
          <input type="hidden" name="page_no" value="1">

          <div class="card margin-sheet-card">
            <div class="margin-toolbar" role="toolbar" aria-label="قەڵەم">
              <div class="margin-source">
                <label for="source" class="sr-only">سکانی کتاب</label>
                <select id="source" name="source_attachment_id">
                  ${scans.map(s => html`<option value="${s.id}" data-type="${s.mime_type}">${s.kind === 'margin_note'
                    ? `هامشی پێشووی ${s.uploaded_by_name ?? ''}، ${date(s.uploaded_at)} ${time(s.uploaded_at)}`
                    : s.original_name}</option>`)}
                  <option value="">پەڕەی سپی (بێ سکان)</option>
                </select>
                <span class="margin-pages" data-pages hidden>
                  <button type="button" class="btn small secondary" data-page-step="-1" aria-label="پەڕەی پێشوو">‹</button>
                  <span data-page-label>پەڕەی ١</span>
                  <button type="button" class="btn small secondary" data-page-step="1" aria-label="پەڕەی دواتر">›</button>
                </span>
              </div>
              <div class="margin-inks" role="radiogroup" aria-label="ڕەنگی مەرەکەب">
                ${[['#1f3f9c', 'شین'], ['#b3261e', 'سوور'], ['#1e6b43', 'سەوز'], ['#16241d', 'ڕەش']].map(([c, n], i) => html`
                  <button type="button" class="ink" role="radio" aria-checked="${i === 0 ? 'true' : 'false'}" data-ink="${c}" aria-label="${n}" title="${n}" style="--ink:${c}"></button>`)}
              </div>
              <div class="margin-widths" role="radiogroup" aria-label="ئەستووری">
                ${[[2, 'باریک'], [3.5, 'مامناوەند'], [6, 'ئەستوور']].map(([w, n], i) => html`
                  <button type="button" class="width" role="radio" aria-checked="${i === 1 ? 'true' : 'false'}" data-width="${w}" aria-label="${n}" title="${n}"><span style="--w:${w}px"></span></button>`)}
              </div>
              <div class="margin-edit">
                <button type="button" class="btn small secondary" data-undo disabled>گەڕانەوە</button>
                <button type="button" class="btn small secondary" data-clear disabled>سڕینەوەی هەموو</button>
              </div>
            </div>

            <div class="margin-stage" data-stage>
              <canvas class="margin-page" data-page-canvas aria-hidden="true"></canvas>
              <canvas class="margin-ink" data-ink-canvas role="img"
                      aria-label="شوێنی نووسینی هامش. بە پەنجە، قەڵەم یان ماوس بنووسە."></canvas>
              <p class="margin-status muted" data-status>کتابەکە دەکرێتەوە…</p>
            </div>
            <p class="hint">
              بە پەنجە، قەڵەمی تابلێت یان ماوس لەسەر کتابەکە بنووسە، وەک لەسەر کاغەز. کاتی ناردن، ناو و
              پلەت و کات لە خوارەوەی هامشەکە مۆر دەکرێت.
            </p>
          </div>

          <div class="card">
            <h2>بۆ کوێ بچێت</h2>
            <p class="card-sub">ژوورەکان بە ڕیزی خۆیان هەڵبژێرە. یەک ژوور: ڕاستەوخۆ دەچێت. زیاتر: یەک لە دوای یەک.</p>
            <div class="margin-rooms" data-rooms>
              ${rooms.filter(r => Number(r.id) !== Number(fromRoom)).map(r => html`
                <label class="margin-room">
                  <input type="checkbox" value="${r.id}" data-room>
                  <span class="margin-room-order" data-order aria-hidden="true"></span>
                  <span>${r.name}${r.room_number ? html` <span class="muted">(${num(r.room_number)})</span>` : ''}</span>
                </label>`)}
            </div>
            <div class="field after">
              <label for="instruction">بە نووسینی تایپ (ئارەزوومەندانە)</label>
              <input id="instruction" name="instruction" type="text" maxlength="300"
                     placeholder="بۆ نموونە: بە پەلە، بۆ لێکۆڵینەوە">
              <div class="hint">ئەمە لە ڕێڕەوی کتابدا دەنووسرێت و دەتوانرێت بەدوایدا بگەڕێیت.</div>
            </div>
            <p class="notice error" data-error hidden></p>
            <div class="row">
              <button class="btn" type="submit" data-send disabled>مۆرکردن و ناردن</button>
              <span class="muted" data-send-hint>سەرەتا هامشەکە بنووسە و ژوورێک هەڵبژێرە.</span>
            </div>
          </div>
        </form>
        <script type="module" src="${asset('/margin.js')}"></script>`,
    }));
  } catch (err) { next(err); }
});

router.post('/documents/:id(\\d+)/margin', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  // The page's script posts with fetch and follows the answer; a JSON reply
  // carries the error to show, or where to go.
  const answer = (status, body) => res.status(status).json(body);
  if (!MARGIN_WRITERS.includes(req.user.role)) return answer(403, { error: 'نووسینی هامش بۆ سەرۆک، جێگر و بەرپرسەکانە.' });

  let upload;
  try {
    upload = await receiveUpload(req, { area: 'files', allow: ['png'], maxFiles: 1, actor: req.user });
  } catch (err) {
    if (err instanceof UploadError) return answer(400, { error: err.message });
    return next(err);
  }
  const inkFile = upload.files.ink;
  const cleanup = () => (inkFile ? removeStored(inkFile.storedPath).catch(() => {}) : Promise.resolve());

  if (!upload.fields._csrf || upload.fields._csrf !== res.locals.csrf) {
    await cleanup();
    return answer(403, { error: 'داواکارییەکە ڕەتکرایەوە. پەڕەکە نوێ بکەرەوە و دووبارە هەوڵبدەوە.' });
  }
  if (!inkFile) return answer(400, { error: 'هیچ نووسینێک نەگەیشت.' });
  if (inkFile.sizeBytes > INK_MAX_BYTES) { await cleanup(); return answer(400, { error: 'نووسینەکە زۆر گەورەیە.' }); }

  const roomIds = String(upload.fields.rooms ?? '').split(',').map(v => Number(v.trim())).filter(n => Number.isInteger(n) && n > 0);
  if (roomIds.length < 1 || roomIds.length > 4 || new Set(roomIds).size !== roomIds.length) {
    await cleanup();
    return answer(400, { error: 'یەک تا چوار ژووری جیاواز هەڵبژێرە.' });
  }
  const instruction = String(upload.fields.instruction ?? '').trim().slice(0, 300) || null;
  const sourceId = Number(upload.fields.source_attachment_id) || null;
  const pageNo = Number(upload.fields.page_no) || 1;

  let stored = null;
  try {
    const inkBytes = await readStored(inkFile.storedPath, req.user);
    await cleanup();

    // Reading and checking happen before the PDF is built: a letter that has
    // moved on since the page was drawn is refused without any work.
    const pre = await withActor(req.user, async q => {
      const ctx = await context(q, req.user, id);
      if (!ctx) return { missing: true };
      if (!ctx.allowed) return { refused: true };
      if (upload.fields.step_id && String(ctx.active?.id ?? '') !== String(upload.fields.step_id)) return { moved: true };
      let source = null;
      if (sourceId) {
        const { rows: [a] } = await q(
          `SELECT id, stored_path, mime_type FROM attachment WHERE id = $1 AND document_id = $2`, [sourceId, id]);
        if (!a) return { badSource: true };
        source = a;
      }
      const { rows: valid } = await q(`SELECT id FROM room WHERE is_active AND id = ANY ($1::bigint[])`, [roomIds]);
      if (valid.length !== roomIds.length) return { badRooms: true };
      return { ctx, source };
    });
    if (pre.missing) { await logRefusal(req, 'document', id); return answer(404, { error: 'ئەم کتابە نەدۆزرایەوە.' }); }
    if (pre.refused) return answer(403, { error: 'ئەم کتابە ئێستا لای تۆ نییە.' });
    if (pre.moved) return answer(409, { error: 'کتابەکە لەو کاتەوە جووڵاوە. پەڕەکە نوێ بکەرەوە.' });
    if (pre.badSource) return answer(400, { error: 'ئەو سکانە لەسەر ئەم کتابە نییە.' });
    if (pre.badRooms) return answer(400, { error: 'یەکێک لە ژوورەکان نەدۆزرایەوە.' });

    const sourceType = !pre.source ? null
      : pre.source.mime_type === 'application/pdf' ? 'pdf'
      : pre.source.mime_type === 'image/png' ? 'png'
      : pre.source.mime_type === 'image/jpeg' ? 'jpg' : 'unsupported';
    if (sourceType === 'unsupported') return answer(400, { error: 'لەسەر ئەم جۆرە پەڕگەیە ناتوانرێت بنووسرێت.' });
    const sourceBytes = pre.source ? await readStored(pre.source.stored_path, req.user) : null;

    const { bytes, pages } = await inkOntoLetter({ ink: inkBytes, source: sourceBytes, sourceType, pageNo });
    stored = await storeBuffer(bytes, 'pdf', req.user);
    const verdict = await scanFile(stored.storedPath, req.user);

    const doc = pre.ctx.doc;
    const safeNo = String(doc.incoming_no).replace(/[^0-9A-Za-z؀-ۿ]+/g, '-');
    await withActor(req.user, async q => {
      const { rows: [a] } = await q(`
        INSERT INTO attachment (document_id, routing_step_id, kind, original_name, stored_path, mime_type,
                                size_bytes, page_count, sha256, virus_scanned_at, uploaded_by, is_outgoing)
        VALUES ($1, $2, 'margin_note', $3, $4, 'application/pdf', $5, $6, $7, $8, $9, false) RETURNING id`,
        [id, pre.ctx.active?.id ?? null, `هامش-${safeNo}.pdf`, stored.storedPath, stored.sizeBytes, pages,
         stored.sha256, verdict === 'clean' ? new Date() : null, req.user.id]);
      const { rows: [m] } = await q(`
        INSERT INTO margin_note (document_id, attachment_id, source_attachment_id, page_no, instruction,
                                 room_ids, author_id, author_role)
        VALUES ($1, $2, $3, $4, $5, $6::bigint[], $7, $8) RETURNING id`,
        [id, a.id, pre.source?.id ?? null, pageNo, instruction, roomIds, req.user.id, req.user.role]);
      await logEvent(q, {
        action: 'margin.written', req, userId: req.user.id, roomId: req.user.roomId, documentId: id,
        detail: { margin_id: m.id, attachment_id: a.id, rooms: roomIds, page: pageNo, virus_scan: verdict },
      });
      // Sent exactly as the ordinary form sends it. The words that travel with
      // the step say there is a handwritten instruction, and what was typed.
      const note = instruction ? `هامش: ${instruction}` : 'هامشی دەستنووس لەسەر کتابەکە';
      const stepId = pre.ctx.active?.id ?? '';
      if (roomIds.length === 1) {
        await sendSingle(q, { documentId: id, toRoomId: roomIds[0], byUser: req.user, note, stepId, req });
      } else {
        await sendSequence(q, { documentId: id, roomIds, byUser: req.user, note, stepId, req });
      }
    });
    stored = null;
    await deliverPushes(req);
    return answer(200, { ok: true, location: `/documents/${id}?done=margin` });
  } catch (err) {
    if (stored) await removeStored(stored.storedPath).catch(() => {});
    if (err instanceof MarginError || err instanceof RoutingError) return answer(400, { error: err.message });
    if (err.code === '42501') return answer(403, { error: 'ئەم کارە لەسەر ئەم کتابە بۆ تۆ ڕێگەپێدراو نییە.' });
    next(err);
  }
});

export default router;
