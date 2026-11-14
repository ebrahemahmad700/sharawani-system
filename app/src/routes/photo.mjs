// Registering a letter by photographing it.
//
// A clerk at the counter holds a letter and a phone. Today they type twelve
// fields off the paper while the person waits. This points the camera at it
// instead: the photograph becomes the scan, the reader reads it, and the
// registration form opens with whatever could be made out already filled in.
//
// The rule that shapes this screen, and it is the opposite of the rule
// everywhere else in the system:
//
//   EVERY VALUE HERE IS A SUGGESTION AND IS LABELLED AS ONE.
//
// Elsewhere, something that might be wrong is refused. Here it is offered,
// because the alternative is typing from scratch and the clerk is looking at the
// paper anyway. What must not happen is a guess presented as a fact, so the
// screen shows, field by field, the line the machine was reading when it made
// each guess. A clerk who can see "ژمارە: ٤٥٢١" beside a filled box can confirm
// it at a glance; one who sees only a filled box has to check the whole letter
// again, which is slower than typing it.
//
// The photograph is not thrown away. It goes into the scan tray, the same place
// a sheet feeder's output goes, and is claimed onto the letter the moment the
// letter is registered. So the record ends with the scan attached, which is
// what would have happened anyway with three more steps.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { receiveUpload, removeStored, scanFile, scanFailClosed, readStored, UploadError } from '../lib/files.mjs';
import { readScan, canRead, isAvailable } from '../lib/ocr.mjs';
import { extractLetterFields, asFormValues } from '../lib/letterfields.mjs';
import { page } from '../views/layout.mjs';
import { html, num } from '../lib/html.mjs';
import { SENDER_KINDS, PRIORITIES, options } from './registry.mjs';

const router = Router();

// The people who register letters. The same list as the registration screen,
// because this is that screen with a camera in front of it.
// The same people as the tray, because a photographed letter becomes a tray item
// (tray_insert in migration 0460). Archive rooms and directorate heads can start
// letters since 0450 and were offered this screen and refused.
const USERS = ['registry_clerk', 'room_clerk', 'room_head', 'archive_clerk', 'mayor', 'deputy_mayor', 'directorate_head'];

const FIELD_NAMES = {
  reference:     'ژمارەی نێردەر',
  date:          'بەرواری کتاب',
  subject:       'بابەت',
  plot_no:       'پارچە',
  neighbourhood: 'گەڕەک',
  sender_name:   'نێردەر',
};

// --- the camera -------------------------------------------------------------

router.get('/registry/photo', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    const have = await isAvailable();
    res.send(page({
      user: req.user, title: 'وێنەگرتنی کتاب', current: '/registry',
      notice: req.query.error ? { kind: 'error', text: String(req.query.error) } : null,
      body: html`
        <div class="card form">
          <h2>وێنەی کتابەکە بگرە</h2>
          <p class="card-sub">
            مۆبایلەکەت بۆ کتابەکە بگرە. سیستەم نووسینەکەی دەخوێنێتەوە و فۆرمی
            تۆمارکردن پڕ دەکاتەوە بەوەی توانی بیخوێنێتەوە. هەموو خانەکان
            دەستکاری دەکرێن پێش ناردن.
          </p>

          ${have.ok ? '' : html`<div class="notice warn">
            خوێنەری نووسین لەسەر ئەم ڕاژەیە دانەمەزراوە، بۆیە خانەکان پڕ ناکرێنەوە.
            وێنەکە هێشتا هەڵدەگیرێت و دەلکێندرێت بە کتابەکەوە.
          </div>`}

          <form method="post" action="/registry/photo" enctype="multipart/form-data">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            <div class="field">
              <label for="photo" class="required">وێنە یان پەڕگە</label>
              <!--
                capture asks a phone for the back camera directly rather than the
                photo library, which is the difference between two taps and six.
                A desktop browser ignores it and shows the ordinary file chooser,
                so the same screen works at a desk with a scanner.
              -->
              <input id="photo" name="file" type="file" required
                     accept="image/*,.pdf" capture="environment">
              <div class="hint">وێنەی ڕوون بگرە، ڕووناکی باش، هەموو لاپەڕەکە لە وێنەکەدا بێت.</div>
            </div>
            <div class="row">
              <button class="btn" type="submit" data-sound-on-click="scan">خوێندنەوە</button>
              <a class="btn secondary" href="/registry/new">بەبێ وێنە تۆمار بکە</a>
            </div>
          </form>
        </div>`,
    }));
  } catch (err) { next(err); }
});

// --- reading it -------------------------------------------------------------

router.post('/registry/photo', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const back = msg => res.redirect(303, `/registry/photo?error=${encodeURIComponent(msg)}`);

  let upload;
  try {
    upload = await receiveUpload(req, {
      area: 'files', allow: ['jpg', 'png', 'pdf', 'tif'], maxFiles: 1, actor: req.user,
    });
  } catch (err) {
    if (err instanceof UploadError) return back(err.message);
    return next(err);
  }

  const stored = upload.fileList ?? [];
  const cleanup = async () => { for (const f of stored) await removeStored(f.storedPath).catch(() => {}); };

  try {
    if (!upload.fields._csrf || upload.fields._csrf !== res.locals.csrf) {
      await cleanup();
      return back('داواکارییەکە ڕەتکرایەوە.');
    }
    if (stored.length === 0) return back('وێنەیەک هەڵبژێرە.');

    const f = stored[0];

    // Scanned before anything else touches it, exactly as the tray does. A
    // photograph from a phone is still a file somebody handed the municipality.
    const verdict = await scanFile(f.storedPath, req.user);
    if (verdict === 'infected' || (verdict === 'error' && scanFailClosed())) {
      await cleanup();
      return back('پەڕگەکە ڕەتکرایەوە لە پشکنینی ڤایرۆس.');
    }

    // Into the tray, so the photograph is a scan waiting for a letter like any
    // other. If the clerk abandons the form, it is in the tray rather than lost.
    const trayId = await withActor(req.user, async q => {
      const { rows: [t] } = await q(`
        INSERT INTO scan_tray_item (scanner_code, tray_path, original_name, size_bytes, sha256, room_id, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        ['CAMERA', f.storedPath, f.originalName, f.sizeBytes, f.sha256, req.user.roomId ?? null, req.user.id]);
      await logEvent(q, {
        action: 'tray.detected', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { tray_id: t.id, size_bytes: f.sizeBytes, sha256: f.sha256, source: 'camera' },
      });
      return t.id;
    });

    // receiveUpload reports the kind it decided from the bytes ('pdf', 'jpg'),
    // not a mime type, so it is turned into one here rather than trusting what
    // the phone claimed the file was.
    const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', tif: 'image/tiff' };
    const mime = MIME[f.type] ?? 'application/octet-stream';

    // Read now rather than waiting for the job. The clerk is standing there.
    let found = {}, read = null;
    const have = await isAvailable();
    if (have.ok && canRead(mime)) {
      const bytes = await readStored(f.storedPath, req.user);
      read = await readScan(bytes, mime);
      if (read.text) found = extractLetterFields(read.text).found;
    }

    const lists = await withActor(req.user, formLists);
    res.send(suggestionPage({
      user: req.user, csrf: res.locals.csrf, trayId, found, read, ...lists,
    }));
  } catch (err) {
    await cleanup();
    next(err);
  }
});

// --- the screen that offers the guesses -------------------------------------

// The same two lists, in the same order, as the ordinary registration form
// (registry.mjs formLists), so the two forms offer the same choices.
async function formLists(q) {
  const { rows: types } = await q(
    `SELECT id, name, category, base_kind FROM doc_type_option WHERE is_active ORDER BY sort_order, name_sort`);
  const { rows: companies } = await q(
    `SELECT id, name FROM company WHERE is_active ORDER BY name_sort LIMIT 500`);
  return { types, companies };
}

function suggestionPage({ user, csrf, trayId, found, read, types, companies = [] }) {
  const values = asFormValues(found);
  const guessed = Object.keys(found);

  const row = key => {
    const f = found[key];
    return html`<tr>
      <th>${FIELD_NAMES[key] ?? key}</th>
      <td>${f ? html`<strong>${f.value}</strong>` : html`<span class="muted">نەدۆزرایەوە</span>`}</td>
      <td><span class="cell-sub" dir="auto">${f?.from ?? ''}</span></td>
    </tr>`;
  };

  return page({
    user, title: 'ئەوەی لە وێنەکەدا خوێندرایەوە', current: '/registry',
    body: html`
      <div class="card">
        <h2>پێشنیارەکان</h2>
        <p class="card-sub">
          ئەمانە پێشنیارن، نەک ڕاستی. لە ستوونی «لە کوێوە» ئەو دێڕەیە کە لێی وەرگیراوە.
          هەموویان لە فۆرمەکەی خوارەوە دەستکاری دەکرێن.
        </p>
        ${!read ? html`<div class="notice warn">
          وێنەکە نەخوێندرایەوە. فۆرمەکە بەتاڵە و وێنەکە دەلکێندرێت کاتێک تۆمار دەکەیت.
        </div>` : read.status === 'low' ? html`<div class="notice warn">
          نووسینەکە بە دڵنیایی نەخوێندرایەوە (${num(Math.round(read.confidence ?? 0))}٪).
          تکایە هەموو خانەیەک بەراورد بکە لەگەڵ کاغەزەکە.
        </div>` : read.status === 'empty' ? html`<div class="notice info">
          هیچ نووسینێک لە وێنەکەدا نەدۆزرایەوە.
        </div>` : html`<div class="notice ok">
          نووسینەکە خوێندرایەوە (${num(Math.round(read.confidence ?? 0))}٪).
          ${guessed.length
            ? html`${num(guessed.length)} خانە پڕکرانەوە.`
            : 'هیچ خانەیەک ناسرایەوە.'}
        </div>`}

        <div class="table-wrap"><table>
          <thead><tr><th>خانە</th><th>پێشنیار</th><th>لە کوێوە</th></tr></thead>
          <tbody>${Object.keys(FIELD_NAMES).map(row)}</tbody>
        </table></div>

        ${read?.text ? html`<details style="margin-top:12px">
          <summary class="muted" style="cursor:pointer">هەموو ئەوەی خوێندرایەوە</summary>
          <pre style="white-space:pre-wrap;unicode-bidi:plaintext;background:#FAF9F5;border:1px solid var(--rule);
                      border-radius:8px;padding:12px;margin-top:8px;font-family:inherit;font-size:13px"
            >${read.text}</pre>
        </details>` : ''}
      </div>

      <div class="card">
        <h2>تۆمارکردن</h2>
        <p class="card-sub">
          خانەکان بپشکنە و ڕاستیان بکەرەوە، پاشان تۆماری بکە. وێنەکە خۆکارانە
          دەلکێندرێت بە کتابەکەوە.
        </p>
        <form method="post" action="/registry/new">
          <input type="hidden" name="_csrf" value="${csrf}">
          <input type="hidden" name="tray_id" value="${trayId}">

          <div class="grid cols-2">
            <div class="field">
              <label for="subject" class="required">بابەت</label>
              <input id="subject" name="subject" type="text" required maxlength="400"
                     value="${values.subject ?? ''}">
            </div>
            <div class="field">
              <label for="doc_type_option_id" class="required">جۆری مامەڵە</label>
              <select id="doc_type_option_id" name="doc_type_option_id" required>
                ${types.map(t => html`<option value="${t.id}">${t.name}${t.category ? html` — ${t.category}` : ''}</option>`)}
              </select>
            </div>
          </div>

          <!-- The sender fields and the row under them laid out as the ordinary
               registration form lays them out (registry.mjs newForm). -->
          <div class="grid cols-2">
            <div class="field">
              <label for="sender_kind" class="required">جۆری نێردەر</label>
              <select id="sender_kind" name="sender_kind" required>${options(SENDER_KINDS, 'citizen')}</select>
            </div>
            <div class="field">
              <label for="sender_name" class="required">ناوی نێردەر</label>
              <input id="sender_name" name="sender_name" type="text" required maxlength="200"
                     value="${values.sender_name ?? ''}">
            </div>
            <div class="field">
              <label for="company_id">کۆمپانیا</label>
              <select id="company_id" name="company_id">
                <option value="">— هیچ —</option>
                ${companies.map(c => html`<option value="${c.id}">${c.name}</option>`)}
              </select>
              <div class="hint">ئەگەر ئەم کتابە سەبارەت بە کۆمپانیایەکە.</div>
            </div>
            <div class="field">
              <label for="sender_contact">پەیوەندی</label>
              <input id="sender_contact" name="sender_contact" type="text" maxlength="200" data-digits
                     value="${values.sender_contact ?? ''}">
              <div class="hint">ژمارەی مۆبایل یان ناونیشان.</div>
            </div>
          </div>

          <div class="grid cols-3">
            <div class="field">
              <label for="priority">گرنگی</label>
              <select id="priority" name="priority">${options(PRIORITIES, 'normal')}</select>
            </div>
            <div class="field">
              <label for="plot_no">ژمارەی پارچە</label>
              <input id="plot_no" name="plot_no" type="text" dir="ltr" maxlength="60" data-digits
                     value="${values.plot_no ?? ''}">
              <div class="hint">وەک ٢٤٧/٥ یان 247/5. هەردووکیان یەک شتن.</div>
            </div>
            <div class="field">
              <label for="neighbourhood">گەڕەک</label>
              <input id="neighbourhood" name="neighbourhood" type="text" maxlength="120"
                     value="${values.neighbourhood ?? ''}">
            </div>
          </div>

          <div class="row">
            <button class="btn" type="submit">تۆمارکردن و وەرگرتنی ژمارە</button>
            <a class="btn secondary" href="/registry/photo">وێنەیەکی تر</a>
          </div>
        </form>
      </div>`,
  });
}

export default router;
