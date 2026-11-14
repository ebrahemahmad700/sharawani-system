// The scan tray (سینیی سکان).
//
// The office scanner produces a pile of PDFs with names like scan-4521.pdf and no
// idea which letter each belongs to. The tray is where they wait until somebody
// who knows says "that one is letter ه/2026/25".
//
// Two ways in, because the building and the demo do not have the same shape:
//
//   A watched folder. src/jobs.mjs picks up anything the scanner drops into
//   TRAY_DIR and puts it in the tray. This is the real workflow on a municipal
//   server: nobody uploads anything, the paper is scanned and it appears.
//
//   An upload form. Several files at once, straight into the tray. This is how it
//   works where there is no folder to watch, and it is also how a clerk adds a
//   scan made on a phone.
//
// Claiming a tray item does not copy the file. The attachment row is written
// pointing at the bytes that are already stored, which is why a tray path is an
// ordinary storage path. A scanned page exists once, however many times it is
// looked at.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole, roomContext } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { receiveUpload, readStream, readStored, storeBuffer, scanFile, scanFailClosed,
         removeStored, fileExists, UploadError } from '../lib/files.mjs';
import { mergeToPdf, countPages, MergeError } from '../lib/pdfmerge.mjs';
import { ATTACHMENT_KINDS } from './attachments.mjs';
import { scannersFor } from '../lib/escl.mjs';
import { detectLetters } from '../lib/detect.mjs';
import { MIME as MIME_OF } from '../lib/files.mjs';
import { page, asset } from '../views/layout.mjs';
import { html, num, date, ltr, ltrText } from '../lib/html.mjs';
import { notFound } from '../lib/respond.mjs';
import { findByReference } from '../lib/documents.mjs';

const router = Router();

// Anyone who handles paper. Not IT: a scanned letter is a letter.
const USERS = ['registry_clerk', 'room_clerk', 'room_head', 'archive_clerk', 'mayor', 'deputy_mayor', 'directorate_head'];

const MIME = MIME_OF;

// One pass of a sheet feeder. High enough for any municipal file, low enough
// that a mistaken select-all in a photo folder is refused rather than accepted.
const MAX_PAGES_PER_UPLOAD = 40;

// Where a scan came from, in words. The codes are what the watched folder and the
// scanner screen write, and MANUAL, CAMERA and SIMULATOR were being shown to
// people as they are (browser audit, 13 September). A real scanner's own code
// (REGISTRY-1) is a name somebody chose, and is shown as it is.
const SOURCE_KU = { MANUAL: 'بارکردنی دەستی', CAMERA: 'وێنەی مۆبایل', SIMULATOR: 'سکانەری تاقیکردنەوە' };
const sourceName = code => SOURCE_KU[code] ?? ltr(code);

router.get('/tray', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    // One room's tray at a time: your own, or another you are allowed to look
    // into, chosen with the same switcher as the inbox. Row-level security has the
    // final word on what can be seen (migration 0460); this chooses which of the
    // visible trays is on the screen, so the mayor's tray is the mayor's room and
    // not every scan in the building at once.
    const { rooms } = await roomContext(req.user);
    const asked = Number(req.query.room) || null;
    const roomId = asked && rooms.some(r => r.id === asked) ? asked : req.user.roomId;
    const { items, mine, scanners } = await withActor(req.user, async q => {
      // Scans from the building's watched folder have no room, and wait in the
      // registry's tray, which is where the building scanner stands.
      const { rows: items } = await q(`
        SELECT t.id, t.scanner_code, t.original_name, t.size_bytes, t.detected_at, t.tray_path,
               u.full_name AS uploaded_by_name
          FROM scan_tray_item t
          LEFT JOIN app_user u ON u.id = t.uploaded_by
         WHERE t.status = 'new'
           AND (t.room_id = $1
                OR (t.room_id IS NULL AND $1 = (SELECT id FROM room WHERE kind = 'registry' AND is_active)))
         ORDER BY t.detected_at DESC LIMIT 100`, [roomId ?? 0]);
      const scanners = await scannersFor(q, req.user);
      const { rows: mine } = await q(`
        SELECT t.id, t.original_name, t.claimed_at, t.attachment_id, a.document_id, d.incoming_no, d.subject
          FROM scan_tray_item t
          LEFT JOIN attachment a ON a.id = t.attachment_id
          LEFT JOIN document d ON d.id = a.document_id
         WHERE t.status = 'claimed' AND t.claimed_by = $1
         ORDER BY t.claimed_at DESC LIMIT 10`, [req.user.id]);
      return { items, mine, scanners };
    });
    const viewed = rooms.find(r => r.id === roomId);
    // With the number: the two archive rooms share a name (design test).
    const roomName = viewed ? `${viewed.name}${viewed.room_number ? ` (${num(viewed.room_number)})` : ''}` : null;

    res.send(page({
      user: req.user, title: roomName ? `سینیی سکان — ${roomName}` : 'سینیی سکان', current: '/tray',
      rooms, viewingRoomId: roomId,
      actions: scanners.length ? html`<a class="btn" href="/scan?to=tray">سکانکردن لە سکانەر</a>` : null,
      notice: req.query.ok    ? { kind: 'ok',    text: String(req.query.ok) }
            : req.query.error ? { kind: 'error', text: String(req.query.error) }
            : null,
      body: html`
        <div class="card">
          <h2>سکانە نوێیەکان</h2>
          <p class="card-sub">
            پەڕەکانی سکانکراو لێرە چاوەڕوان دەکەن تا دیاری بکرێت سەر بە کام کتابن.
            تەنها سکانەکانی ئەم ژوورە لێرە دەردەکەون.
          </p>
          ${items.length === 0
            ? html`<div class="empty">هیچ سکانێکی نوێ نییە.</div>`
            : html`<div class="table-wrap"><table>
                <thead><tr><th>ناوی فایل</th><th>سکانەر</th><th>قەبارە</th><th>بەروار</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
                <tbody>${items.map(t => html`<tr>
                  <td><span class="breakable">${ltr(t.original_name)}</span>${t.uploaded_by_name ? html`<span class="cell-sub">${t.uploaded_by_name}</span>` : ''}</td>
                  <td class="muted">${sourceName(t.scanner_code)}</td>
                  <td class="muted">${num(Math.max(1, Math.round(Number(t.size_bytes) / 1024)))} کیلۆبایت</td>
                  <td class="muted">${date(t.detected_at)}</td>
                  <td>
                    <a class="btn small" href="/tray/${t.id}">بینین و دیاریکردنی کتاب</a>
                  </td>
                </tr>`)}</tbody>
              </table></div>`}
        </div>

        <div class="card">
          <h2>زیادکردنی سکان</h2>
          <form method="post" action="/tray/upload" enctype="multipart/form-data">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            <!-- Where an upload came from. Typed by nobody: a person uploading by
                 hand is "MANUAL", shown as «بارکردنی دەستی». It was a field
                 pre-filled with the English word (design test, 13 September). -->
            <input type="hidden" name="scanner_code" value="MANUAL">
            <div class="field">
              <label for="file" class="required">فایل</label>
              <input id="file" name="file" type="file" multiple
                     accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" required>
              <div class="hint">
                دەتوانیت چەند پەڕەیەک پێکەوە هەڵبژێریت. ڕیزبەندییان هەمان ڕیزبەندی
                هەڵبژاردنە.
              </div>
            </div>
            <div class="field">
              <label>
                <input type="checkbox" name="merge" value="1" checked>
                تێکەڵکردنیان بۆ یەک پەڕگەی PDF
              </label>
              <div class="hint">
                بۆ داواکارییەکی چەند پەڕەیی. TIF ناتوانرێت تێکەڵ بکرێت.
              </div>
            </div>
            <button class="btn" type="submit">زیادکردن بۆ سینی</button>
          </form>
        </div>

        ${mine.length ? html`
          <div class="card">
            <h2>دوایین دیاریکراوەکانی تۆ</h2>
            <div class="table-wrap"><table>
              <thead><tr><th>فایل</th><th>ژمارە</th><th>بابەت</th><th>بەروار</th></tr></thead>
              <tbody>${mine.map(t => html`<tr>
                <td><span class="breakable">${ltr(t.original_name)}</span></td>
                <td class="mono">${t.incoming_no ? ltr(t.incoming_no) : '—'}</td>
                <td>${t.document_id && t.subject ? html`<a href="/documents/${t.document_id}">${t.subject}</a>` : '—'}</td>
                <td class="muted">${date(t.claimed_at)}</td>
              </tr>`)}</tbody>
            </table></div>
          </div>` : ''}`,
    }));
  } catch (err) { next(err); }
});

// Several pages at once, and optionally one document out of them.
//
// A sheet feeder produces one file per page. Attaching them separately is how a
// five-page application becomes five attachments in no stated order, and then
// somebody prints page three alone and does not know it is page three. Ticking
// the box merges them in the order the browser sent them, which is the order
// they went through the feeder.
router.post('/tray/upload', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const back = msg => res.redirect(303, `/tray${msg ? '?error=' + encodeURIComponent(msg) : ''}`);
  let upload;
  try {
    upload = await receiveUpload(req, {
      area: 'files', allow: ['pdf', 'jpg', 'png', 'tif'],
      maxFiles: MAX_PAGES_PER_UPLOAD, actor: req.user,
    });
  } catch (err) {
    if (err instanceof UploadError) return back(err.message);
    return next(err);
  }

  const stored = upload.fileList ?? [];
  // What to take back out if this request does not finish. It starts as the
  // uploaded pages and becomes the merged file once the pages are folded into
  // it, so a failure after the merge does not leave the merged file orphaned
  // with no row pointing at it.
  let orphans = stored.map(f => f.storedPath);
  const cleanup = async () => { for (const p of orphans) await removeStored(p).catch(() => {}); };

  try {
    if (!upload.fields._csrf || upload.fields._csrf !== res.locals.csrf) {
      await cleanup();
      return back('داواکارییەکە ڕەتکرایەوە.');
    }
    if (stored.length === 0) return back('فایلێک هەڵبژێرە.');

    const scannerCode = String(upload.fields.scanner_code ?? 'MANUAL').slice(0, 30) || 'MANUAL';
    const wantsMerge = Boolean(upload.fields.merge) && stored.length > 1;

    // Every file is scanned, merged or not. Scanning only the merged result
    // would mean the originals were written to storage unchecked, and on the
    // database backend they would still be sitting there.
    for (const f of stored) {
      const verdict = await scanFile(f.storedPath, req.user);
      if (verdict === 'infected' || (verdict === 'error' && scanFailClosed())) {
        await cleanup();
        await withActor(req.user, q => logEvent(q, {
          action: 'attachment.rejected_virus', req, userId: req.user.id,
          detail: { source: 'tray', virus_scan: verdict },
        }));
        return back(verdict === 'infected'
          ? 'فایلەکە ڤایرۆسی تێدایە و ڕەتکرایەوە.'
          : 'پشکنینی ڤایرۆس سەرکەوتوو نەبوو.');
      }
      f.virusScan = verdict;
    }

    let items = stored;

    if (wantsMerge) {
      // TIFF has no place in a PDF without decoding it, which is a different
      // job. Say so plainly rather than dropping the page.
      const bad = stored.find(f => f.type === 'tif');
      if (bad) {
        await cleanup();
        return back('TIF ناتوانرێت تێکەڵ بکرێت. تکایە PDF یان وێنە بەکاربهێنە.');
      }

      const parts = [];
      for (const f of stored) parts.push({ bytes: await readStored(f.storedPath, req.user), type: f.type });

      let merged;
      try {
        merged = await mergeToPdf(parts);
      } catch (err) {
        await cleanup();
        if (err instanceof MergeError) return back(err.message);
        throw err;
      }

      const saved = await storeBuffer(merged, 'pdf', req.user);
      const pages = await countPages(merged);

      // The pages are now in the merged file, so the copies that went in are
      // taken back out. Keeping both would double the storage and leave two
      // versions of the same scan for somebody to attach the wrong one of.
      await cleanup();
      orphans = [saved.storedPath];

      const first = stored[0].originalName.replace(/\.[^.]+$/, '');
      items = [{
        ...saved,
        originalName: `${first} (${stored.length} پەڕە).pdf`,
        virusScan: stored.every(f => f.virusScan === 'clean') ? 'clean' : 'skipped',
        pageCount: pages,
      }];
    }

    let skipped = 0;
    await withActor(req.user, async q => {
      for (const f of items) {
        // The same file uploaded twice became two tray items (records test).
        const { rows: [dup] } = await q(
          `SELECT id FROM scan_tray_item WHERE sha256 = $1 AND status = 'new'
              AND room_id IS NOT DISTINCT FROM $2`, [f.sha256, req.user.roomId ?? null]);
        if (dup) { skipped++; await removeStored(f.storedPath).catch(() => {}); continue; }
        const { rows: [t] } = await q(`
          INSERT INTO scan_tray_item (scanner_code, tray_path, original_name, size_bytes, sha256, room_id, uploaded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [scannerCode, f.storedPath, f.originalName, f.sizeBytes, f.sha256, req.user.roomId ?? null, req.user.id]);
        await logEvent(q, {
          action: 'tray.detected', req, userId: req.user.id, roomId: req.user.roomId,
          detail: {
            tray_id: t.id, size_bytes: f.sizeBytes, sha256: f.sha256,
            source: wantsMerge ? 'upload_merged' : 'upload',
            virus_scan: f.virusScan ?? 'skipped',
            ...(f.pageCount ? { pages: f.pageCount, merged_from: stored.length } : {}),
          },
        });
      }
    });

    if (skipped === items.length) return back('ئەم فایلە پێشتر لە سینییەکەدایە.');
    // In brackets: without them the + bound first, the test was always a
    // non-empty string, and a single upload said its pages had been merged.
    res.redirect(303, `/tray?ok=${encodeURIComponent((skipped ? `${num(skipped)} فایلی دووبارە تێپەڕێندرا. ` : '') +
      (wantsMerge ? `${num(stored.length)} پەڕە تێکەڵ کران بۆ یەک فایل.` : `${num(items.length - skipped)} فایل زیادکرا.`))}`);
  } catch (err) {
    await cleanup();
    if (err.code === '23505') return back('ئەم فایلە پێشتر لە سینیدایە.');
    next(err);
  }
});

/** Look at a scan before deciding which letter it belongs to. */
router.get('/tray/:id(\\d+)/preview', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    const t = await withActor(req.user, async q => {
      // Only while it is waiting. Once claimed, the scan is an attachment and is
      // opened through the letter, under the letter's rules.
      const { rows: [t] } = await q(`SELECT id, tray_path, original_name FROM scan_tray_item WHERE id = $1 AND status = 'new'`, [Number(req.params.id)]);
      return t;
    });
    if (!t || !(await fileExists(t.tray_path, req.user))) return notFound(req, res);
    const ext = t.tray_path.split('.').pop();
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(t.original_name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    readStream(t.tray_path, req.user).on('error', next).pipe(res);
  } catch (err) { next(err); }
});

/** Choose the letter this scan belongs to. */
router.get('/tray/:id(\\d+)', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    // Letters the reader found named on the page, passed as ids and looked up
    // again here under this person's own rules, so a crafted link cannot show a
    // subject they may not see.
    const foundIds = String(req.query.found ?? '').split(',').map(Number).filter(Boolean).slice(0, 5);
    const { item, recent, found } = await withActor(req.user, async q => {
      const { rows: [item] } = await q(
        `SELECT id, original_name, scanner_code, detected_at, tray_path FROM scan_tray_item WHERE id = $1 AND status = 'new'`,
        [Number(req.params.id)]);
      const { rows: found } = foundIds.length ? await q(
        `SELECT id, incoming_no, subject, status FROM document WHERE id = ANY ($1::bigint[])`, [foundIds]) : { rows: [] };
      // The open letters this person can see, newest first, offered rather than
      // made to remember a number. Deliberately no join to routing_step: a letter
      // registered a minute ago has no steps yet, and that is precisely the one
      // whose original scan is being filed.
      const { rows: recent } = await q(`
        SELECT d.id, d.incoming_no, d.subject
          FROM document d
         WHERE d.status NOT IN ('closed', 'cancelled')
         ORDER BY d.id DESC LIMIT 25`);
      return { item, recent, found };
    });
    if (!item) return notFound(req, res, 'ئەم سکانە نەدۆزرایەوە.');
    const isPdf = item.tray_path.endsWith('.pdf');
    const isImage = /\.(png|jpg)$/.test(item.tray_path);

    res.send(page({
      user: req.user, title: 'دیاریکردنی کتاب', current: '/tray',
      notice: req.query.error ? { kind: 'error', text: 'کتابەکە نەدۆزرایەوە یان نەتوانرا پێیەوە ببەسترێت. لە لیستەکە هەڵیبژێرە یان ژمارەکەی بە تەواوی بنووسە.' } : null,
      body: html`
        <div class="viewer">
        <section class="card viewer-main">
          ${isPdf ? html`<div class="pdf-view" data-pdf-src="/tray/${item.id}/preview">
              <p class="muted" data-pdf-status>PDFەکە دەکرێتەوە…</p></div>`
            : isImage ? html`<div class="img-view" data-img-view><img src="/tray/${item.id}/preview" alt="وێنەی سکانکراو: ${item.original_name}"></div>`
            : html`<div class="empty"><a class="btn" href="/tray/${item.id}/preview">داگرتنی فایل</a></div>`}
        </section>
        <aside aria-label="دیاریکردنی کتاب">
        <div class="card">
          <h2>${ltr(item.original_name)}</h2>
          <p class="card-sub">${sourceName(item.scanner_code)} · ${date(item.detected_at)}
            · <a href="/tray/${item.id}/preview" target="_blank">کردنەوە لە تابێکی نوێ</a></p>

          ${req.query.found === 'none' ? html`<div class="empty compact">هیچ ژمارەی کتاب یان بارکۆدێک لەسەر پەڕەکە نەدۆزرایەوە. کتابەکە لە لیستەکە هەڵبژێرە.</div>` : ''}
          ${found.length ? html`
            <div class="notice info">
              <strong>ئەم سکانە لەوە دەچێت سەر بەم کتابە بێت:</strong>
              <p style="margin:4px 0 8px">ژمارەکە لەسەر پەڕەکە خوێندرایەوە. پێش بەستنەوە دڵنیابە.</p>
              ${found.map(d => html`
                <form method="post" action="/tray/${item.id}/claim" class="row" style="margin-bottom:6px">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <input type="hidden" name="document_id" value="${d.id}">
                  <input type="hidden" name="kind" value="original_scan">
                  <span class="mono">${ltr(d.incoming_no)}</span> <span>${d.subject}</span>
                  <button class="btn small" type="submit">بەستنەوە بەم کتابە</button>
                </form>`)}
            </div>` : ''}
          ${req.query.found ? '' : html`
            <form method="post" action="/tray/${item.id}/detect" data-busy-form style="margin-bottom:14px">
              <input type="hidden" name="_csrf" value="${res.locals.csrf}">
              <button class="btn secondary" type="submit" data-busy-text="دەخوێندرێتەوە…">ناسینەوەی کتاب لەسەر پەڕەکە</button>
              <div class="hint">بارکۆد یان ژمارەی کتاب لەسەر پەڕەکە دەخوێنێتەوە و کتابەکە پێشنیار دەکات.</div>
            </form>`}

          <form method="post" action="/tray/${item.id}/claim">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            <div class="field">
              <label for="document_id">کتاب</label>
              <select id="document_id" name="document_id">
                <option value="">— هەڵبژێرە —</option>
                ${recent.map(d => html`<option value="${d.id}">${ltrText(d.incoming_no)} — ${d.subject.slice(0, 50)}</option>`)}
              </select>
            </div>
            <div class="field">
              <label for="reference">یان ژمارە یان بارکۆدی کتاب</label>
              <input id="reference" name="reference" type="text" dir="ltr" data-digits placeholder="ه/2026/690">
              <div class="hint">لیستەکە تەنها نوێترین کتابەکانە. هەر کتابێکی تر بە ژمارەکەی بنووسە.</div>
            </div>
            <div class="field">
              <label for="kind" class="required">جۆری پەڕە</label>
              <select id="kind" name="kind" required>
                ${ATTACHMENT_KINDS.map(([v, label]) => html`<option value="${v}">${label}</option>`)}
              </select>
            </div>
            <button class="btn" type="submit">بەستنەوە بە کتاب</button>
          </form>
        </div>

        <div class="card">
          <!-- A row, not a paragraph: the paragraph's own margin started the text
               33px down the card (design test, 13 September). -->
          <form method="post" action="/tray/${item.id}/archive" class="row">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            <span class="muted">ئەگەر ئەم سکانە پێویست نییە، بینێرە بۆ ئەرشیفی سینی.</span>
            <button class="btn secondary" type="submit">ناردنی بۆ ئەرشیف</button>
          </form>
        </div>
        </aside>
        </div>
        <script type="module" src="${asset('/viewer.js')}"></script>`,
    }));
  } catch (err) { next(err); }
});

/**
 * Turn a waiting scan into an attachment on a letter.
 *
 * Exported because two screens do this. The tray, where a clerk picks the letter
 * from a list. And the registration screen, where a photograph taken at the
 * counter becomes the scan of the letter being registered from it. They are the
 * same operation, and neither copies the bytes: the attachment points at what
 * the tray already stored.
 *
 * Returns false when the item has already been claimed or does not exist, which
 * is what two clerks reaching for the same trolley looks like.
 */
export async function claimTrayItem(q, { trayId, documentId, kind, user, req }) {
  const { rows: [t] } = await q(
    `SELECT * FROM scan_tray_item WHERE id = $1 AND status = 'new' FOR UPDATE`, [trayId]);
  if (!t) return false;

  const useKind = ATTACHMENT_KINDS.some(k => k[0] === kind) ? kind : 'original_scan';
  const ext = t.tray_path.split('.').pop();

  // The step this room currently holds, so the trail knows which stage the page
  // belongs to. Same rule as a direct upload.
  const { rows: [step] } = await q(
    `SELECT id FROM routing_step WHERE document_id = $1 AND status = 'active' AND to_room_id = $2`,
    [documentId, user.roomId]);

  // No copy: the attachment points at the bytes already stored for the tray.
  const { rows: [a] } = await q(`
    INSERT INTO attachment (document_id, routing_step_id, kind, original_name, stored_path, mime_type,
                            size_bytes, sha256, uploaded_by, is_outgoing)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false) RETURNING id`,
    [documentId, step?.id ?? null, useKind, t.original_name, t.tray_path,
     MIME[ext] ?? 'application/octet-stream', t.size_bytes, t.sha256, user.id]);

  await q(`UPDATE scan_tray_item SET status = 'claimed', claimed_by = $2, claimed_at = now(), attachment_id = $3
            WHERE id = $1`, [trayId, user.id, a.id]);
  await logEvent(q, {
    action: 'tray.claimed', req, userId: user.id, roomId: user.roomId, documentId,
    detail: { tray_id: trayId, attachment_id: a.id, kind: useKind },
  });
  return a.id;
}

/**
 * Read the scan and suggest the letter it belongs to. See lib/detect.mjs for why
 * this only ever suggests.
 */
router.post('/tray/:id(\\d+)/detect', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const t = await withActor(req.user, async q =>
      (await q(`SELECT id, tray_path FROM scan_tray_item WHERE id = $1 AND status = 'new'`, [id])).rows[0]);
    if (!t) return notFound(req, res, 'ئەم سکانە نەدۆزرایەوە.');
    const ext = t.tray_path.split('.').pop();
    const bytes = await readStored(t.tray_path, req.user);
    const result = await detectLetters(req.user, bytes, MIME[ext] ?? 'application/octet-stream');
    res.redirect(303, `/tray/${id}?found=${result.matches.map(m => m.id).join(',') || 'none'}`);
  } catch (err) { next(err); }
});

router.post('/tray/:id(\\d+)/claim', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const reference = String(req.body.reference ?? '').trim();
    // A letter from the list, or any letter by its number or barcode: the list
    // offers the newest twenty-five, about forty minutes of the front desk's work
    // (records test, 13 September).
    const outcome = await withActor(req.user, async q => {
      let documentId = Number(req.body.document_id) || null;
      if (reference) {
        const found = await findByReference(q, reference);
        if (found.length !== 1) return { missing: true };
        documentId = Number(found[0].id);
      }
      if (!documentId) return { missing: true };
      const ok = await claimTrayItem(q, { trayId: id, documentId, kind: req.body.kind, user: req.user, req });
      return { ok, documentId };
    });
    if (outcome.missing) return res.redirect(303, `/tray/${id}?error=1`);
    if (!outcome.ok) return notFound(req, res, 'ئەم سکانە نەدۆزرایەوە.');
    const documentId = outcome.documentId;
    res.redirect(303, `/documents/${documentId}?attached=1`);
  } catch (err) {
    // Claiming onto a letter this person cannot see is refused by the policy.
    if (err.code === '42501' || err.code === '23503') return res.redirect(303, `/tray/${req.params.id}?error=1`);
    next(err);
  }
});

router.post('/tray/:id(\\d+)/archive', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await withActor(req.user, async q => {
      const { rowCount } = await q(
        `UPDATE scan_tray_item SET status = 'archived', archived_at = now() WHERE id = $1 AND status = 'new'`, [id]);
      if (rowCount) await logEvent(q, { action: 'tray.archived', req, userId: req.user.id, detail: { tray_id: id } });
    });
    res.redirect(303, '/tray');
  } catch (err) { next(err); }
});

export default router;
