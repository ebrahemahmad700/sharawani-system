// The arrival and dispatch marks on a scan (مۆری هاتوو · مۆری دەرچوو).
//
// On paper the front desk stamps the letter the moment it arrives: a small box in
// a corner, «هاتوو», and the number the letter was just given. When the answer
// leaves, the same box again with «دەرچوو» and the outgoing number. The point is
// that anybody holding the paper can read off the paper itself which letter they
// have.
//
// This does the same to the scan. The clerk opens a scan, drags the mark to the
// corner they want — the clerk chooses the place, because on paper they do — picks
// how big it should be, and presses the button. The mark is drawn onto that page
// and the whole file is kept as a new attachment; the scan that arrived is never
// altered.
//
// The browser draws the mark, as it draws the هامش stamp, because only the browser
// joins Kurdish letters correctly. The server lays the transparent sheet it sends
// over the page with pdf-lib (lib/margin.mjs), which already knows how to turn it
// back for pages stored sideways.
//
// A dispatch mark needs the letter to have an outgoing number: the mark carries
// that number, so there is nothing to stamp before the answer has one.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { getDocument } from '../lib/documents.mjs';
import { readStored, storeBuffer, scanFile, removeStored, receiveUpload, UploadError } from '../lib/files.mjs';
import { inkOntoLetter, MarginError } from '../lib/margin.mjs';
import { logEvent } from '../lib/log.mjs';
import { notFound, refused, logRefusal } from '../lib/respond.mjs';
import { page, asset } from '../views/layout.mjs';
import { html, num, date, ltr, ltrText } from '../lib/html.mjs';
import { groupCode } from '../lib/verify.mjs';

const router = Router();

// The same list as the insert policy on document_stamp (migration 0590): anybody
// who files paper. Not IT, who may not see a letter at all, and not the staff
// office, which never handles the register's paper.
export const STAMPERS = ['mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                         'room_clerk', 'registry_clerk', 'archive_clerk'];

const STAMPABLE = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
const INK_MAX_BYTES = 12 * 1024 * 1024;

const MARK = {
  incoming: { word: 'هاتوو', kind: 'original_scan', pill: 'سکانی کتابی ڕەسەن' },
  outgoing: { word: 'دەرچوو', kind: 'outgoing_copy', pill: 'کۆپی دەرچوو' },
};

/** The letter, the file and what may be stamped on it. */
async function context(q, user, attachmentId) {
  const { rows: [a] } = await q(`
    SELECT a.id, a.document_id, a.original_name, a.mime_type, a.page_count
      FROM attachment a WHERE a.id = $1`, [attachmentId]);
  if (!a) return null;
  const doc = await getDocument(q, a.document_id);
  if (!doc) return null;
  const { rows: [verify] } = doc.outgoing_no
    ? await q(`SELECT code FROM document_verify WHERE document_id = $1`, [doc.id])
    : { rows: [] };
  const { rows: stamps } = await q(`
    SELECT kind, page_no, code, placed_at, u.full_name AS placed_by_name
      FROM document_stamp s LEFT JOIN app_user u ON u.id = s.placed_by
     WHERE s.document_id = $1 ORDER BY s.placed_at`, [doc.id]);
  return { a, doc, verifyCode: verify?.code ?? null, stamps };
}

router.get('/attachments/:id(\\d+)/stamp', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!STAMPERS.includes(req.user.role)) return refused(req, res, 'مۆرکردنی سکان بۆ کارمەندانی ژوورەکانە.');
    const data = await withActor(req.user, q => context(q, req.user, id));
    if (!data) {
      await logRefusal(req, 'attachment', req.params.id);
      return notFound(req, res, 'ئەم هاوپێچە نەدۆزرایەوە، یان ڕێگەت پێنەدراوە بیبینیت.');
    }

    const { a, doc, verifyCode, stamps } = data;
    if (!STAMPABLE[a.mime_type]) {
      return refused(req, res, 'تەنها لەسەر سکان (PDF، PNG، JPG) دەکرێت مۆر بدرێت.');
    }
    // Which mark the page opens on: the one the letter has not had yet.
    const has = k => stamps.some(s => s.kind === k);
    const canOut = Boolean(doc.outgoing_no);
    const want = req.query.kind === 'outgoing' && canOut ? 'outgoing'
               : req.query.kind === 'incoming' ? 'incoming'
               : has('incoming') && canOut ? 'outgoing' : 'incoming';

    res.send(page({
      user: req.user,
      title: `مۆرکردنی سکان — ${ltrText(doc.incoming_no)}`,
      current: '/documents',
      actions: html`
        <a class="btn secondary" href="/documents/${doc.id}">گەڕانەوە بۆ کتاب</a>
        <a class="btn secondary" href="/attachments/${a.id}/view">بینینی فایل</a>`,
      body: html`
        <form class="stamp-page" method="post" action="/attachments/${a.id}/stamp"
              data-stamp
              data-file="/attachments/${a.id}"
              data-type="${STAMPABLE[a.mime_type]}"
              data-incoming="${ltrText(doc.incoming_no)}"
              data-outgoing="${doc.outgoing_no ? ltrText(doc.outgoing_no) : ''}"
              data-barcode="${doc.barcode ?? ''}"
              data-verify="${verifyCode ? groupCode(verifyCode) : ''}"
              data-incoming-date="${date(doc.incoming_date)}"
              data-outgoing-date="${doc.outgoing_date ? date(doc.outgoing_date) : ''}">
          <input type="hidden" name="_csrf" value="${res.locals.csrf}">
          <input type="hidden" name="page_no" value="1" data-page-field>
          <input type="hidden" name="kind" value="${want}" data-kind-field>

          <div class="stamp-grid">
            <section class="card stamp-paper-card">
              <div class="card-head">
                <h2>شوێنی مۆرەکە</h2>
                <div class="end"><span class="muted" data-page-label></span></div>
              </div>
              <p class="card-sub">مۆرەکە ڕابکێشە بۆ ئەو شوێنەی دەتەوێت لەسەر کاغەزەکە. وەک ئەوەی لەسەر کاغەز مۆر دەدەیت.</p>
              <div class="stamp-bar">
                <span class="stamp-turn" data-turn hidden>
                  <button type="button" class="btn small secondary" data-prev aria-label="پەڕەی پێشوو">‹</button>
                  <button type="button" class="btn small secondary" data-next aria-label="پەڕەی دواتر">›</button>
                </span>
                <span class="spacer"></span>
                <span class="stamp-sizes" role="group" aria-label="قەبارەی مۆر">
                  <button type="button" class="btn small secondary" data-size="0.75">بچووک</button>
                  <button type="button" class="btn small secondary" data-size="1">مامناوەند</button>
                  <button type="button" class="btn small secondary" data-size="1.3">گەورە</button>
                </span>
              </div>
              <div class="stamp-stage" data-stage>
                <canvas data-page-canvas></canvas>
                <div class="stamp-mark" data-mark tabindex="0" role="button"
                     aria-label="مۆرەکە. بە ڕاکێشان یان بە دوگمەکانی ئاراستە بیجوڵێنە.">
                  <span class="w" data-mark-word></span>
                  <span class="n" data-mark-no></span>
                  <span class="s" data-mark-sub></span>
                </div>
              </div>
              <p class="hint">بە دوگمەکانی ئاراستەش دەجوڵێت، کاتێک مۆرەکە هەڵبژێردراوە.</p>
            </section>

            <aside class="card stamp-side">
              <h2>جۆری مۆر</h2>
              <div class="stamp-kinds">
                <label class="stamp-kind">
                  <input type="radio" name="kind_choice" value="incoming"${want === 'incoming' ? html` checked` : ''}>
                  <span>
                    <strong>مۆری هاتوو</strong>
                    <span class="cell-sub">${ltr(doc.incoming_no)} · ${date(doc.incoming_date)}</span>
                  </span>
                </label>
                <label class="stamp-kind${canOut ? '' : ' off'}">
                  <input type="radio" name="kind_choice" value="outgoing"${want === 'outgoing' ? html` checked` : ''}${canOut ? '' : html` disabled`}>
                  <span>
                    <strong>مۆری دەرچوو</strong>
                    <span class="cell-sub">${canOut
                      ? html`${ltr(doc.outgoing_no)} · ${date(doc.outgoing_date)}`
                      : 'هێشتا ژمارەی دەرچووی نییە'}</span>
                  </span>
                </label>
              </div>

              <table class="kv stamp-kv">
                <tbody>
                  <tr><th>فایل</th><td dir="auto">${a.original_name}</td></tr>
                  <tr><th>کتاب</th><td><a href="/documents/${doc.id}">${doc.subject}</a></td></tr>
                  <tr><th>بارکۆد</th><td class="mono">${ltr(doc.barcode)}</td></tr>
                </tbody>
              </table>

              ${stamps.length ? html`
                <h3 class="stamp-done-head">مۆرە دانراوەکان</h3>
                <ul class="stamp-done">
                  ${stamps.map(s => html`<li>
                    <span class="pill ${s.kind === 'incoming' ? 'info' : 'ok'}">${MARK[s.kind].word}</span>
                    <span class="mono">${ltr(s.code)}</span>
                    <span class="cell-sub">${s.placed_by_name ?? ''} · ${date(s.placed_at)}</span>
                  </li>`)}
                </ul>` : ''}

              <p class="notice error" data-error hidden></p>
              <div class="row stamp-go">
                <button class="btn" type="submit" data-send disabled>مۆرکردن</button>
                <span class="muted" data-send-hint>سکانەکە دەکرێتەوە…</span>
              </div>
              <p class="hint">
                فایلی ئێستا دەستکاری ناکرێت. کۆپییەکی نوێی مۆرکراو دروست دەبێت و لەسەر کتابەکە دادەنرێت.
              </p>
            </aside>
          </div>

          <noscript>
            <div class="notice warn">ئەم پەڕەیە پێویستی بە JavaScript هەیە. بەبێ ئەو، مۆرکردن ناکرێت.</div>
          </noscript>
        </form>
        <script type="module" src="${asset('/stamp.js')}"></script>`,
    }));
  } catch (err) { next(err); }
});

router.post('/attachments/:id(\\d+)/stamp', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  const answer = (status, body) => res.status(status).json(body);
  if (!STAMPERS.includes(req.user.role)) return answer(403, { error: 'مۆرکردنی سکان بۆ کارمەندانی ژوورەکانە.' });

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
  if (!inkFile) { return answer(400, { error: 'هیچ مۆرێک نەگەیشت.' }); }
  if (inkFile.sizeBytes > INK_MAX_BYTES) { await cleanup(); return answer(400, { error: 'مۆرەکە زۆر گەورەیە.' }); }

  const kind = upload.fields.kind === 'outgoing' ? 'outgoing' : 'incoming';
  const pageNo = Number(upload.fields.page_no) || 1;

  let stored = null;
  try {
    const inkBytes = await readStored(inkFile.storedPath, req.user);
    await cleanup();

    const pre = await withActor(req.user, async q => {
      const ctx = await context(q, req.user, id);
      if (!ctx) return { missing: true };
      if (!STAMPABLE[ctx.a.mime_type]) return { badType: true };
      if (kind === 'outgoing' && !ctx.doc.outgoing_no) return { noOutgoing: true };
      const { rows: [source] } = await q(
        `SELECT stored_path FROM attachment WHERE id = $1`, [id]);
      return { ctx, storedPath: source.stored_path };
    });
    if (pre.missing) { await logRefusal(req, 'attachment', id); return answer(404, { error: 'ئەم هاوپێچە نەدۆزرایەوە.' }); }
    if (pre.badType) return answer(400, { error: 'تەنها لەسەر سکان دەکرێت مۆر بدرێت.' });
    if (pre.noOutgoing) return answer(400, { error: 'ئەم کتابە هێشتا ژمارەی دەرچووی نییە.' });

    const { a, doc } = pre.ctx;
    const sourceBytes = await readStored(pre.storedPath, req.user);
    const { bytes, pages } = await inkOntoLetter({
      ink: inkBytes, source: sourceBytes, sourceType: STAMPABLE[a.mime_type], pageNo,
    });
    stored = await storeBuffer(bytes, 'pdf', req.user);
    const verdict = await scanFile(stored.storedPath, req.user);

    const code = kind === 'outgoing' ? doc.outgoing_no : doc.incoming_no;
    const safe = String(code).replace(/[^0-9A-Za-z؀-ۿ]+/g, '-');
    const made = await withActor(req.user, async q => {
      const { rows: [step] } = await q(
        `SELECT id FROM routing_step WHERE document_id = $1 AND status = 'active' AND to_room_id = $2`,
        [doc.id, req.user.roomId]);
      const { rows: [row] } = await q(`
        INSERT INTO attachment (document_id, routing_step_id, kind, original_name, stored_path, mime_type,
                                size_bytes, page_count, sha256, virus_scanned_at, uploaded_by, is_outgoing)
        VALUES ($1, $2, $3, $4, $5, 'application/pdf', $6, $7, $8, $9, $10, $11) RETURNING id`,
        [doc.id, step?.id ?? null, MARK[kind].kind, `${MARK[kind].word}-${safe}.pdf`, stored.storedPath,
         stored.sizeBytes, pages, stored.sha256, verdict === 'clean' ? new Date() : null, req.user.id,
         kind === 'outgoing']);
      await q(`
        INSERT INTO document_stamp (document_id, attachment_id, source_attachment_id, kind, page_no, code, placed_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [doc.id, row.id, a.id, kind, pageNo, code, req.user.id]);
      await logEvent(q, {
        action: 'stamp.applied', req, userId: req.user.id, roomId: req.user.roomId, documentId: doc.id,
        detail: { kind, attachment_id: row.id, source_attachment_id: a.id, page: pageNo, code, virus_scan: verdict },
      });
      return row.id;
    });
    stored = null;
    return answer(200, { ok: true, attachment_id: made, location: `/documents/${doc.id}?done=stamp_${kind}` });
  } catch (err) {
    if (stored) await removeStored(stored.storedPath).catch(() => {});
    if (err instanceof MarginError) return answer(400, { error: err.message });
    if (err.code === '42501') return answer(403, { error: 'مۆرکردنی ئەم کتابە بۆ تۆ ڕێگەپێدراو نییە.' });
    next(err);
  }
});

export default router;
