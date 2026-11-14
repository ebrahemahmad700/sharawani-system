// Scanned pages and other files attached to a letter.
//
// The original scan, the handwritten reply on the back, a letter that was
// attached in a room, the outgoing copy. Each is a row in `attachment` pointing
// at a file on disk whose path is a uuid, with a hash so the record can prove
// the file is the one that was uploaded.
//
// The schema caps an attachment at 50 MiB and requires the path under files/.
// Row-level security decides who may attach: the same people who may see the
// letter, and never IT.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { receiveUpload, readStream, readStored, scanFile, scanFailClosed, removeStored, fileExists, verifyStored, UploadError, MIME, SHOWABLE } from '../lib/files.mjs';
import { page, asset } from '../views/layout.mjs';
import { html, num, date, ltr } from '../lib/html.mjs';
import { LOW_CONFIDENCE, readScan, canRead, isAvailable } from '../lib/ocr.mjs';
import { notFound, refused, logRefusal } from '../lib/respond.mjs';

const router = Router();

export const ATTACHMENT_KINDS = [
  ['original_scan',     'سکانی کتابی ڕەسەن'],
  ['handwritten_reply', 'وەڵامی دەستنووس (پشتی کتاب)'],
  ['attached_letter',   'کتابی لکێندراو'],
  ['supporting',        'بەڵگەی پشتگیر'],
  ['drawing',           'نەخشە'],
  ['outgoing_copy',     'کۆپی دەرچوو'],
];

// The kinds nobody chooses when uploading, only shown: the handwritten instruction
// is made by its own page (routes/margin.mjs), never uploaded as a file.
const SHOWN_ONLY = [['margin_note', 'هامشی دەستنووس']];
export const kindLabel = k => [...ATTACHMENT_KINDS, ...SHOWN_ONLY].find(x => x[0] === k)?.[1] ?? k;

const ATTACH_MAX = 50 * 1024 * 1024;   // the schema's cap; files.mjs allows 60 for drawings

// What any room may attach to a letter: a scan or a photograph of paper.
export const SCAN_TYPES = ['pdf', 'jpg', 'png', 'tif'];
// And what the drawing rooms may attach as well. Rooms 8 and 9 answer letters
// about plots with the plot's map, and the map is a DWG. Refusing it meant the
// room printed the drawing, scanned the print and attached a picture of a map
// that the next room could not measure.
export const DRAWING_TYPES = ['dwg', 'dxf'];

/**
 * The file types this person may attach. Decided by the kind of room they sit
 * in, which is data an administrator sets, rather than by room numbers written
 * into the code: when the real list of rooms arrives, a third drawing room is a
 * setting and not a release.
 */
export async function attachableTypes(q, user) {
  if (!user?.roomId) return SCAN_TYPES;
  const { rows: [r] } = await q(`SELECT kind FROM room WHERE id = $1`, [user.roomId]);
  return r?.kind === 'archive' ? [...SCAN_TYPES, ...DRAWING_TYPES] : SCAN_TYPES;
}

/** The accept attribute for a file input offering these types. */
export const acceptFor = types => types
  .flatMap(t => ({ jpg: ['.jpg', '.jpeg'], tif: ['.tif', '.tiff'] }[t] ?? [`.${t}`])).join(',');

/** The attachments for one document, newest first. Used by the document page. */
export async function listAttachments(q, documentId) {
  const { rows } = await q(`
    SELECT a.id, a.kind, a.original_name, a.mime_type, a.size_bytes, a.page_count, a.uploaded_at,
           a.is_outgoing, a.virus_scanned_at, a.sha256,
           u.full_name AS uploaded_by_name, s.seq_no AS step_seq,
           -- Which room it came from. The room holding the step it was attached
           -- at, when there was one, because that is where the letter was; the
           -- uploader's own room otherwise. "Attached by the legal room" is the
           -- question a reader actually asks.
           coalesce(sr.name, ur.name) AS uploaded_room_name,
           -- What the reader made of it, if it has been read yet. The text
           -- itself is not selected here: the list shows whether a scan is
           -- searchable, and the text is on the scan's own page.
           t.status AS ocr_status, t.confidence AS ocr_confidence, t.chars AS ocr_chars
      FROM attachment a
      LEFT JOIN app_user u ON u.id = a.uploaded_by
      LEFT JOIN room ur ON ur.id = u.room_id
      LEFT JOIN routing_step s ON s.id = a.routing_step_id
      LEFT JOIN room sr ON sr.id = s.to_room_id
      LEFT JOIN attachment_text t ON t.attachment_id = a.id
     WHERE a.document_id = $1
     ORDER BY a.uploaded_at DESC`, [documentId]);
  return rows;
}

/** A short label for a file's type, for the badge beside its name. */
export function typeLabel(mime) {
  return {
    'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/tiff': 'TIF',
    'image/vnd.dwg': 'DWG', 'image/vnd.dxf': 'DXF',
  }[mime] ?? 'فایل';
}

/**
 * Read this scan now, rather than when the reader next comes round.
 *
 * The reader normally runs as a job every couple of minutes, which is right: a
 * clerk pressing upload should not wait seconds for a page to be read. But there
 * are two moments when somebody wants it now — a clerk at a counter who has just
 * scanned something and needs to find it, and a scan whose first reading failed
 * and is worth another try after being rescanned — and without this the only
 * answer is to wait and hope.
 *
 * Runs as the signed-in user, so row-level security decides whether they may
 * touch this attachment at all, and then writes through a function owned by the
 * database rather than granting the application a write on the table.
 */
router.post('/attachments/:id(\\d+)/read', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const a = await withActor(req.user, async q => {
      const { rows } = await q(
        `SELECT id, document_id, stored_path, mime_type FROM attachment WHERE id = $1`, [id]);
      return rows[0] ?? null;
    });
    if (!a) return notFound(req, res, 'ئەم هاوپێچە نەدۆزرایەوە.');

    const back = msg => res.redirect(303, `/documents/${a.document_id}?${msg}`);

    const have = await isAvailable();
    if (!have.ok) return back('error=' + encodeURIComponent('خوێنەری نووسین لەسەر ئەم ڕاژەیە دانەمەزراوە.'));
    if (!canRead(a.mime_type)) return back('error=' + encodeURIComponent('ئەم جۆرە پەڕگەیە ناخوێندرێتەوە.'));

    const bytes = await readStored(a.stored_path, req.user);
    const result = await readScan(bytes, a.mime_type);

    await withActor(req.user, q => q(
      `SELECT store_attachment_text($1, $2, $3, $4, $5, $6, $7, $8)`,
      [a.id, result.status, result.text, result.pages, result.chars,
       result.confidence, result.engine, result.ms]));

    const said = { done: 'خوێندرایەوە.', low: 'خوێندرایەوە بەڵام بە دڵنیایی کەم.',
                   empty: 'هیچ نووسینێک نەدۆزرایەوە.', unsupported: 'ناخوێندرێتەوە.',
                   failed: 'خوێندنەوەکە سەرکەوتوو نەبوو.' }[result.status] ?? result.status;
    back('ok=' + encodeURIComponent(said));
  } catch (err) { next(err); }
});

/**
 * What the reader read.
 *
 * Shown as plain text next to a plain statement of how well it was read, because
 * the two are only useful together. A confident reading of a typed letter is a
 * reliable copy of what is on the paper; a poor reading of handwriting is a
 * guess, and presenting the two the same way would teach people to trust the
 * second one.
 *
 * Row-level security does the work here. The policy on attachment_text is the
 * attachment's own, so somebody who cannot open the scan gets nothing from this
 * page either, IT included.
 */
router.get('/attachments/:id(\\d+)/text', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await withActor(req.user, async q => {
      const { rows } = await q(
        `SELECT t.*, a.original_name, a.document_id, d.incoming_no
           FROM attachment_text t
           JOIN attachment a ON a.id = t.attachment_id
           LEFT JOIN document d ON d.id = a.document_id
          WHERE t.attachment_id = $1`, [id]);
      return rows[0] ?? null;
    });
    if (!row) {
      await logRefusal(req, 'attachment', req.params.id);
      return notFound(req, res, 'دەقی ئەم هاوپێچە نەدۆزرایەوە.');
    }

    const conf = row.confidence === null ? null : Number(row.confidence);
    const LABEL = {
      done: 'خوێندرایەوە', low: 'بە دڵنیایی نەخوێندرایەوە', empty: 'بێ نووسین',
      unsupported: 'ناخوێندرێتەوە', failed: 'سەرکەوتوو نەبوو',
    };
    const SAYS = {
      done: 'ئەم نووسینە بە دڵنیاییەکی باش خوێندرایەوە.',
      low:  'ئەم پەڕگەیە بە دڵنیایی نەخوێندرایەوە. لەوانەیە بە دەست نووسرابێت. ' +
            'گەڕان بەم وشانە کاردەکات، بەڵام وشەکان لەوانەیە هەڵە بن.',
      empty: 'هیچ نووسینێک لەم پەڕگەیەدا نەدۆزرایەوە. لەوانەیە نەخشە یان وێنە بێت.',
      unsupported: 'ئەم جۆرە پەڕگەیە ناخوێندرێتەوە.',
      failed: 'خوێندنەوەی ئەم پەڕگەیە سەرکەوتوو نەبوو.',
    };
    const tone = row.status === 'done' ? 'ok' : row.status === 'low' ? 'warn' : 'muted';

    res.send(page({
      user: req.user, title: 'دەقی سکان', current: '/documents',
      actions: html`
        ${row.document_id ? html`<a class="btn secondary" href="/documents/${row.document_id}">گەڕانەوە</a>` : ''}
        <a class="btn secondary" href="/attachments/${id}/view">پەڕگەی ڕەسەن</a>`,
      body: html`
        <div class="card">
          <div class="card-head">
            <h2>${row.original_name}</h2>
            <div class="end"><span class="pill ${tone}">${LABEL[row.status] ?? row.status}</span></div>
          </div>
          <p class="card-sub">${SAYS[row.status] ?? ''}</p>

          <div class="table-wrap kv"><table><tbody>
            <tr><th>دڵنیایی</th><td>${
              conf === null ? '—' : html`${num(Math.round(conf))}٪${
                conf < LOW_CONFIDENCE ? html` <span class="muted">(لە ${num(LOW_CONFIDENCE)}٪ کەمترە)</span>` : ''}`}</td></tr>
            <tr><th>پەڕەکان</th><td>${num(row.pages)}</td></tr>
            <tr><th>پیتەکان</th><td>${num(row.chars)}</td></tr>
            <tr><th>خوێندرایەوە</th><td>${date(row.read_at)}</td></tr>
            <tr><th>خوێنەر</th><td class="mono">${row.engine ? ltr(row.engine) : '—'}</td></tr>
          </tbody></table></div>

          ${row.text
            ? html`<pre style="white-space:pre-wrap;unicode-bidi:plaintext;background:#FAF9F5;
                               border:1px solid var(--rule);border-radius:8px;padding:14px;
                               margin-top:14px;font-family:inherit;font-size:14px;line-height:1.9"
                   >${row.text}</pre>`
            : html`<div class="empty compact">هیچ دەقێک نییە.</div>`}
        </div>`,
    }));
  } catch (err) { next(err); }
});

router.post('/documents/:id(\\d+)/attachments', requireAuth, async (req, res, next) => {
  const documentId = Number(req.params.id);
  const back = msg => res.redirect(303, `/documents/${documentId}${msg ? '?error=' + encodeURIComponent(msg) : '?attached=1'}`);
  let upload;
  try {
    const allow = await withActor(req.user, q => attachableTypes(q, req.user));
    upload = await receiveUpload(req, { area: 'files', allow, maxFiles: 1, actor: req.user });
  } catch (err) {
    if (err instanceof UploadError) return back(err.message);
    return next(err);
  }
  try {
    const b = upload.fields;
    const file = upload.files.file;
    if (!b._csrf || b._csrf !== res.locals.csrf) return back('داواکارییەکە ڕەتکرایەوە. دووبارە هەوڵبدەوە.');
    if (!file) return back('فایلێک هەڵبژێرە.');
    if (file.sizeBytes > ATTACH_MAX) return back('هاوپێچ لە ٥٠ مێگابایت گەورەترە.');
    const kind = ATTACHMENT_KINDS.some(k => k[0] === b.kind) ? b.kind : 'supporting';
    const scan = await scanFile(file.storedPath, req.user);
    if (scan === 'infected' || (scan === 'error' && scanFailClosed())) {
      // The bytes are already stored by this point, so a refused file has to be
      // taken back out. Without this an infected upload stays on the disk with
      // no row pointing at it and nothing to find it by.
      await removeStored(file.storedPath);
      await withActor(req.user, q => logEvent(q, {
        action: 'attachment.rejected_virus', req, userId: req.user.id, documentId,
        detail: { sha256: file.sha256, scan },
      }));
      return back(scan === 'infected'
        ? 'فایلەکە ڤایرۆسی تێدایە و ڕەتکرایەوە.'
        : 'پشکنینی ڤایرۆس سەرکەوتوو نەبوو. تکایە دواتر هەوڵبدەوە.');
    }

    await withActor(req.user, async q => {
      // Attach to the step this room currently holds, if any, so the trail can
      // show which stage the page belongs to.
      const { rows: [step] } = await q(
        `SELECT id FROM routing_step WHERE document_id = $1 AND status = 'active' AND to_room_id = $2`,
        [documentId, req.user.roomId]);
      const { rows: [a] } = await q(`
        INSERT INTO attachment (document_id, routing_step_id, kind, original_name, stored_path, mime_type,
                                size_bytes, sha256, virus_scanned_at, uploaded_by, is_outgoing)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [documentId, step?.id ?? null, kind, file.originalName, file.storedPath, MIME[file.type] ?? 'application/octet-stream',
         file.sizeBytes, file.sha256, scan === 'clean' ? new Date() : null, req.user.id, kind === 'outgoing_copy']);
      await logEvent(q, { action: 'attachment.added', req, userId: req.user.id, roomId: req.user.roomId, documentId,
        detail: { attachment_id: a.id, kind, size_bytes: file.sizeBytes, sha256: file.sha256, virus_scan: scan } });
    });
    back(null);
  } catch (err) {
    // A person who cannot see the letter cannot attach to it: the insert policy
    // refuses, and that arrives as a permission error rather than a 404.
    if (err.code === '42501') return refused(req, res);
    next(err);
  }
});

// Is this file still the file that was attached?
//
// The prototype this idea came from printed a "security hash" and a "seal
// number" beside every scan. They were decorative: made up in the browser,
// checked by nothing. A number that looks like proof and proves nothing is worse
// than no number, because people believe it.
//
// The hash here is real. It was taken as the bytes streamed in and stored beside
// the row. This route reads the stored bytes back and computes it again, so the
// answer is about the file that exists now rather than about a number in a
// column. The nightly job does the same for every file; this is the button for
// when somebody wants to know about one file, now, in front of them.
router.post('/attachments/:id(\\d+)/verify', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const a = await withActor(req.user, async q => {
      const { rows } = await q(
        `SELECT id, document_id, stored_path, sha256 FROM attachment WHERE id = $1`, [id]);
      return rows[0] ?? null;
    });
    // Row-level security hides an attachment the reader may not see, and the
    // honest report of that is the same as one that does not exist.
    if (!a) return notFound(req, res, 'ئەم هاوپێچە نەدۆزرایەوە.');

    let intact;
    try {
      intact = await verifyStored(a.stored_path, a.sha256, req.user);
    } catch {
      // The bytes could not be read at all, which is a different and worse
      // answer than "they changed". Both fail for the reader; the log keeps
      // the distinction.
      intact = false;
    }

    await withActor(req.user, q => logEvent(q, {
      action: 'attachment.viewed', req, userId: req.user.id, roomId: req.user.roomId,
      documentId: a.document_id, detail: { attachment_id: id, integrity: intact ? 'intact' : 'failed' },
    }));

    const msg = intact
      ? 'پەڕگەکە دەستکاری نەکراوە. هاشەکە هەمان هاشەی کاتی لکاندنە.'
      : 'ئاگاداری: هاشەی پەڕگەکە نەگونجا. تکایە ئاگادار بکەرەوە.';
    res.redirect(303, `/documents/${a.document_id}?${intact ? 'ok' : 'error'}=${encodeURIComponent(msg)}`);
  } catch (err) { next(err); }
});

router.get('/attachments/:id(\\d+)', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const a = await withActor(req.user, async q => {
      const { rows: [a] } = await q(`SELECT id, document_id, original_name, stored_path, mime_type FROM attachment WHERE id = $1`, [id]);
      // The viewer page fetches the bytes it has already logged a view for, so
      // that fetch is not logged a second time. Everything else is.
      // A download is logged as one, not as a view: migration 0530 watches for a
      // room taking copies of letters that are no longer in that room.
      if (a && req.get('x-docsys-viewer') !== '1') {
        await logEvent(q, {
          action: req.query.download === '1' ? 'attachment.downloaded' : 'attachment.viewed',
          req, userId: req.user.id, roomId: req.user.roomId, documentId: a.document_id, detail: { attachment_id: id },
        });
      }
      return a;
    });
    if (!a) await logRefusal(req, 'attachment', id);
    if (!a || !(await fileExists(a.stored_path, req.user))) return notFound(req, res);
    // A browser shows a PDF or a picture itself; a DWG or a TIFF it cannot, and
    // "inline" for those gives a blank tab that looks like a broken file.
    const inline = SHOWABLE.has(a.mime_type) && req.query.download !== '1';
    res.setHeader('Content-Type', a.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
    // Never kept by a shared cache or a browser's back-forward cache after sign-out.
    res.setHeader('Cache-Control', 'private, no-store');
    readStream(a.stored_path, req.user).on('error', next).pipe(res);
  } catch (err) { next(err); }
});

/**
 * Looking at an attachment inside the application.
 *
 * Reported from the demo: rooms could not open the PDFs on a letter. A link that
 * opens a PDF in a new tab depends entirely on the browser. A desktop browser
 * shows it; a phone downloads it into a folder nobody looks in; an installed copy
 * of the application on a phone does nothing visible at all. A clerk reading a
 * letter on the phone at a counter was the case that failed, and it failed
 * silently.
 *
 * So the page is drawn here. PDFs are rendered by PDF.js, served from this server
 * so it works with the internet down and inside the content security policy;
 * pictures are pictures; anything a browser cannot draw, a DWG from the drawing
 * rooms for instance, says so and offers the download. Beside it is every file
 * on the letter and the room each came from, which is the other half of what was
 * asked: what the other rooms attached.
 */
router.get('/attachments/:id(\\d+)/view', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = await withActor(req.user, async q => {
      const { rows: [a] } = await q(
        `SELECT a.id, a.document_id, a.original_name, a.mime_type, a.size_bytes, a.kind,
                d.incoming_no, d.subject
           FROM attachment a JOIN document d ON d.id = a.document_id
          WHERE a.id = $1`, [id]);
      if (!a) return null;
      const all = await listAttachments(q, a.document_id);
      await logEvent(q, { action: 'attachment.viewed', req, userId: req.user.id, roomId: req.user.roomId,
        documentId: a.document_id, detail: { attachment_id: id, via: 'viewer' } });
      return { a, all };
    });
    if (!data) {
      await logRefusal(req, 'attachment', req.params.id);
      return notFound(req, res, 'ئەم هاوپێچە نەدۆزرایەوە.');
    }

    const { a, all } = data;
    const src = `/attachments/${a.id}`;
    const kindName = kindLabel;
    const isPdf = a.mime_type === 'application/pdf';
    const isImage = ['image/png', 'image/jpeg'].includes(a.mime_type);

    res.send(page({
      user: req.user, title: a.original_name, current: '/documents',
      actions: html`
        <a class="btn secondary" href="/documents/${a.document_id}">گەڕانەوە</a>
        <a class="btn" href="${src}?download=1">داگرتن</a>`,
      body: html`
        <div class="viewer">
          <section class="card viewer-main">
            <div class="row" style="margin-bottom:10px">
              <span class="pill info">${typeLabel(a.mime_type)}</span>
              <span class="muted">${kindName(a.kind)} · ${num(Math.max(1, Math.round(a.size_bytes / 1024)))} کیلۆبایت</span>
              <span class="spacer"></span>
              ${isPdf || isImage ? html`
                <span class="viewer-zoom" data-viewer-zoom hidden>
                  <button type="button" class="btn secondary small" data-zoom="-1" title="بچووککردنەوە" aria-label="بچووککردنەوە">−</button>
                  <button type="button" class="btn secondary small" data-zoom="0" title="بە پانی پەڕە">پانی پەڕە</button>
                  <button type="button" class="btn secondary small" data-zoom="1" title="گەورەکردن" aria-label="گەورەکردن">+</button>
                </span>` : ''}
            </div>
            ${isPdf ? html`
              <div class="pdf-view" data-pdf-src="${src}">
                <p class="muted" data-pdf-status>PDFەکە دەکرێتەوە…</p>
                <noscript><p><a class="btn" href="${src}" target="_blank">کردنەوەی PDF</a></p></noscript>
              </div>`
            : isImage ? html`
              <div class="img-view" data-img-view><img src="${src}" alt="${a.original_name}"></div>`
            : html`
              <div class="empty">
                <p style="margin-top:0"><strong>وێبگەڕ ناتوانێت ئەم جۆرە فایلە پیشان بدات (${typeLabel(a.mime_type)}).</strong></p>
                <p>${a.mime_type === 'image/vnd.dwg' || a.mime_type === 'image/vnd.dxf'
                  ? 'دایبگرە و بە AutoCAD یان بەرنامەیەکی نەخشە بیکەرەوە.'
                  : 'دایبگرە و بە بەرنامەیەکی گونجاو بیکەرەوە.'}</p>
                <a class="btn" href="${src}?download=1">داگرتنی ${a.original_name}</a>
              </div>`}
          </section>

          <aside class="card viewer-list" aria-label="هاوپێچەکانی کتاب">
            <h2>هەموو هاوپێچەکانی ئەم کتابە <span class="pill muted">${num(all.length)}</span></h2>
            <p class="card-sub">
              <span class="mono">${ltr(a.incoming_no)}</span> — <a href="/documents/${a.document_id}">${a.subject}</a>
            </p>
            <ul class="attach-list">
              ${all.map(x => html`<li${x.id === a.id ? html` aria-current="true"` : ''}>
                <a class="attach-name" href="/attachments/${x.id}/view">
                  <span class="pill muted">${typeLabel(x.mime_type)}</span> <span dir="auto">${x.original_name}</span>
                </a>
                <div class="muted attach-meta">
                  ${kindName(x.kind)}${x.uploaded_room_name ? html` · ${x.uploaded_room_name}` : ''}
                  · ${x.uploaded_by_name ?? ''} · ${date(x.uploaded_at)}
                </div>
              </li>`)}
            </ul>
          </aside>
        </div>
        <script type="module" src="${asset('/viewer.js')}"></script>`,
    }));
  } catch (err) { next(err); }
});

export default router;
