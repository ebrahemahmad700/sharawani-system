// Scanning from a scanner, and telling the system which scanners exist.
//
//   /scan                     press scan; the pages land on a letter, in the room's
//                             tray, or on a registration form
//   /admin/scanners           IT, the mayor and the deputy add and test scanners
//
// The protocol is in lib/escl.mjs. This file is the part a person sees, and the
// part that decides where the pages go and who is allowed to send them there.
//
// Where the pages go is decided by where the person started, not by a choice on
// the form. From a letter's page they go onto that letter, from the tray into the
// tray, from the registration form into a registration. A scan that lands
// somewhere other than where somebody pressed the button is a scan that gets lost.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { storeBuffer, scanFile, scanFailClosed, removeStored, UploadError } from '../lib/files.mjs';
import { checkScannerUrl, capabilities, status, scan, scannersFor, ScannerError, SCAN_ROLES,
         SIMULATOR_URL, simulatorEnabled } from '../lib/escl.mjs';
import { detectLetters } from '../lib/detect.mjs';
import { getDocument } from '../lib/documents.mjs';
import { ATTACHMENT_KINDS } from './attachments.mjs';
import { page } from '../views/layout.mjs';
import { html, raw, num, date, time, ltr } from '../lib/html.mjs';
import { notFound } from '../lib/respond.mjs';

const router = Router();

const USERS = SCAN_ROLES;
const ADMINS = ['sysadmin', 'mayor', 'deputy_mayor'];

const opt = (value, label, selected) => html`<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`;

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Where the pages will go, from the query string or the posted form. */
function destination(src) {
  const documentId = Number(src.document_id) || null;
  if (documentId) return { to: 'document', documentId };
  return { to: src.to === 'registry' ? 'registry' : 'tray' };
}

async function scanPage(req, res, { error = null, values = {} } = {}) {
  const dest = destination({ ...req.query, ...values });
  const data = await withActor(req.user, async q => {
    const scanners = await scannersFor(q, req.user);
    const doc = dest.to === 'document' ? await getDocument(q, dest.documentId) : null;
    return { scanners, doc };
  });
  if (dest.to === 'document' && !data.doc) return notFound(req, res, 'ئەم کتابە نەدۆزرایەوە.');
  const { scanners, doc } = data;
  const v = (k, d) => values[k] ?? d;
  const back = dest.to === 'document' ? `/documents/${dest.documentId}` : dest.to === 'registry' ? '/registry/new' : '/tray';

  res.status(error ? 400 : 200).send(page({
    user: req.user, title: 'سکانکردن', current: '/tray',
    notice: error ? { kind: 'error', text: error } : null,
    actions: html`<a class="btn secondary" href="${back}">گەڕانەوە</a>`,
    body: html`
      <div class="card form">
        <h2>
          ${dest.to === 'document' ? html`سکانکردن بۆ کتابی <span class="mono">${ltr(doc.incoming_no)}</span>`
            : dest.to === 'registry' ? 'سکانکردنی کتابێکی نوێ بۆ تۆمارکردن'
            : 'سکانکردن بۆ سینیی سکانی ژوورەکەت'}
        </h2>
        ${doc ? html`<p class="card-sub">${doc.subject}</p>` : ''}

        ${scanners.length === 0 ? html`
          <div class="empty">
            <p style="margin-top:0"><strong>هیچ سکانەرێک بۆ ژوورەکەت ناسێنراوە.</strong></p>
            <p>بەڕێوەبەری سیستەم دەتوانێت سکانەری تۆڕ (eSCL / AirScan) لە بەشی «سکانەرەکان» زیاد بکات.
               تا ئەو کاتە، فایلی سکانکراو بە دوگمەی «لکاندن» باربکە.</p>
          </div>` : html`
          <form method="post" action="/scan" data-busy-form>
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            ${dest.to === 'document' ? html`<input type="hidden" name="document_id" value="${dest.documentId}">` : ''}
            ${dest.to !== 'document' ? html`<input type="hidden" name="to" value="${dest.to}">` : ''}

            <fieldset class="scanner-pick">
              <legend class="required">سکانەر</legend>
              ${scanners.map((s, i) => html`
                <label class="scanner-option">
                  <input type="radio" name="scanner_id" value="${s.id}" required
                         ${String(v('scanner_id', i === 0 ? s.id : '')) === String(s.id) ? 'checked' : ''}>
                  <span>
                    <strong>${s.name}</strong>
                    <span class="muted"> · ${s.room_name ?? 'هاوبەش بۆ هەموو بینا'}</span>
                    ${s.make_model ? html`<span class="cell-sub" dir="auto">${s.base_url === SIMULATOR_URL ? 'سکانەری تاقیکردنەوەی ناو سیستەم' : s.make_model}</span>` : ''}
                  </span>
                  <span class="pill muted" data-scanner-status="${s.id}">…</span>
                </label>`)}
            </fieldset>

            <div class="grid cols-3">
              <div class="field">
                <label for="source">کاغەز لە کوێیە؟</label>
                <select id="source" name="source">
                  ${opt('Platen', 'سەر شووشەکە (یەک پەڕە)', v('source', 'Platen'))}
                  ${opt('Feeder', 'فیدەر (چەند پەڕەیەک)', v('source', 'Platen'))}
                </select>
              </div>
              <div class="field">
                <label for="color">ڕەنگ</label>
                <select id="color" name="color">
                  ${opt('gray', 'ڕەش و سپی', v('color', 'gray'))}
                  ${opt('color', 'ڕەنگاوڕەنگ', v('color', 'gray'))}
                </select>
                <div class="hint">ڕەش و سپی بچووکترە و بۆ نووسین باشترە. مۆری ڕەنگی؟ ڕەنگاوڕەنگ.</div>
              </div>
              <div class="field">
                <label for="resolution">وردی</label>
                <select id="resolution" name="resolution">
                  ${opt('200', '٢٠٠ DPI — خێرا', v('resolution', '300'))}
                  ${opt('300', '٣٠٠ DPI — ئاسایی', v('resolution', '300'))}
                  ${opt('600', '٦٠٠ DPI — نەخشە و وردەکاری', v('resolution', '300'))}
                </select>
              </div>
            </div>

            ${dest.to === 'document' ? html`
              <div class="field">
                <label for="kind">جۆری پەڕە</label>
                <select id="kind" name="kind">
                  ${ATTACHMENT_KINDS.map(([k, label]) => opt(k, label, v('kind', 'original_scan')))}
                </select>
              </div>` : ''}

            <button class="btn" type="submit" data-busy-text="سکان دەکرێت… تکایە چاوەڕێ بکە">دەستپێکردنی سکان</button>
            <p class="hint">کاغەزەکە دابنێ، پاشان لێرە دوگمەکە لێبدە. پەڕەکان ڕاستەوخۆ
              ${dest.to === 'document' ? 'بە کتابەکەوە دەلکێن.' : dest.to === 'registry' ? 'دەچنە فۆڕمی تۆمارکردن.' : 'دەچنە سینیی سکانی ژوورەکەت.'}</p>
          </form>`}
      </div>`,
  }));
}

router.get('/scan', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try { await scanPage(req, res); } catch (err) { next(err); }
});

/** Idle or busy, for the dot beside each scanner on the form. */
router.get('/scan/scanners/:id(\\d+)/status', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    const s = (await withActor(req.user, q => scannersFor(q, req.user))).find(x => x.id === Number(req.params.id));
    if (!s) return res.status(404).json({ ok: false });
    try {
      const st = await status(checkScannerUrl(s.base_url));
      res.json({ ok: true, state: st.state, adf: st.adf });
    } catch (err) {
      res.json({ ok: false, message: err.expected ? err.message : 'پەیوەندی نەکرا.' });
    }
  } catch (err) { next(err); }
});

router.post('/scan', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const b = req.body;
  const dest = destination(b);
  let saved = null;
  try {
    const found = await withActor(req.user, async q => {
      const scanners = await scannersFor(q, req.user);
      const doc = dest.to === 'document' ? await getDocument(q, dest.documentId) : null;
      return { scanner: scanners.find(s => s.id === Number(b.scanner_id)), doc };
    });
    if (!found.scanner) return scanPage(req, res, { error: 'سکانەرێک هەڵبژێرە.', values: b });
    if (dest.to === 'document') {
      if (!found.doc) return notFound(req, res, 'ئەم کتابە نەدۆزرایەوە.');
      if (['closed', 'cancelled'].includes(found.doc.status)) {
        return scanPage(req, res, { error: 'ناتوانرێت شت بە کتابی داخراو یان هەڵوەشێنراوەوە بلکێندرێت.', values: b });
      }
    }
    const scanner = found.scanner;

    let result;
    try {
      result = await scan(checkScannerUrl(scanner.base_url), {
        source: b.source === 'Feeder' ? 'Feeder' : 'Platen',
        color: b.color === 'color' ? 'color' : 'gray',
        resolution: [200, 300, 600].includes(Number(b.resolution)) ? Number(b.resolution) : 300,
      });
    } catch (err) {
      if (!(err instanceof ScannerError)) throw err;
      await withActor(req.user, q => q(`UPDATE scanner SET last_error = $2 WHERE id = $1`, [scanner.id, err.message]));
      return scanPage(req, res, { error: err.message, values: b });
    }

    saved = await storeBuffer(result.pdf, 'pdf', req.user);
    const verdict = await scanFile(saved.storedPath, req.user);
    if (verdict === 'infected' || (verdict === 'error' && scanFailClosed())) {
      await removeStored(saved.storedPath);
      return scanPage(req, res, { error: 'پشکنینی ڤایرۆس پەڕەکانی ڕەتکردەوە.', values: b });
    }

    const name = `${scanner.code}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.pdf`;
    const detail = { source: 'scanner', scanner_id: scanner.id, pages: result.pages, size_bytes: saved.sizeBytes, sha256: saved.sha256, virus_scan: verdict };

    if (dest.to === 'document') {
      const kind = ATTACHMENT_KINDS.some(k => k[0] === b.kind) ? b.kind : 'original_scan';
      await withActor(req.user, async q => {
        const { rows: [step] } = await q(
          `SELECT id FROM routing_step WHERE document_id = $1 AND status = 'active' AND to_room_id = $2`,
          [dest.documentId, req.user.roomId]);
        const { rows: [a] } = await q(`
          INSERT INTO attachment (document_id, routing_step_id, kind, original_name, stored_path, mime_type,
                                  size_bytes, page_count, sha256, virus_scanned_at, uploaded_by, is_outgoing)
          VALUES ($1, $2, $3, $4, $5, 'application/pdf', $6, $7, $8, $9, $10, $11) RETURNING id`,
          [dest.documentId, step?.id ?? null, kind, name, saved.storedPath, saved.sizeBytes, result.pages,
           saved.sha256, verdict === 'clean' ? new Date() : null, req.user.id, kind === 'outgoing_copy']);
        await q(`UPDATE scanner SET last_seen_at = now(), last_error = NULL, make_model = coalesce($2, make_model) WHERE id = $1`,
                [scanner.id, result.makeModel]);
        await logEvent(q, { action: 'attachment.added', req, userId: req.user.id, roomId: req.user.roomId,
          documentId: dest.documentId, detail: { attachment_id: a.id, kind, ...detail } });
      });
      saved = null;
      return res.redirect(303, `/documents/${dest.documentId}?attached=1#attachments`);
    }

    // Into the tray, which is where a scan waits until somebody says which letter
    // it is, and where the registration form collects it from.
    const trayId = await withActor(req.user, async q => {
      const { rows: [t] } = await q(`
        INSERT INTO scan_tray_item (scanner_code, tray_path, original_name, size_bytes, sha256, room_id, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [scanner.code, saved.storedPath, name, saved.sizeBytes, saved.sha256, req.user.roomId ?? null, req.user.id]);
      await q(`UPDATE scanner SET last_seen_at = now(), last_error = NULL, make_model = coalesce($2, make_model) WHERE id = $1`,
              [scanner.id, result.makeModel]);
      await logEvent(q, { action: 'tray.detected', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { tray_id: t.id, ...detail } });
      return t.id;
    });
    saved = null;

    if (dest.to === 'registry') return res.redirect(303, `/registry/new?tray_id=${trayId}`);

    // Which letter it is, if the page says. Only a suggestion; see lib/detect.mjs.
    const detected = await detectLetters(req.user, result.pdf, 'application/pdf').catch(() => ({ available: false, matches: [] }));
    const found2 = detected.available ? (detected.matches.map(m => m.id).join(',') || 'none') : '';
    res.redirect(303, `/tray/${trayId}${found2 ? `?found=${found2}` : ''}`);
  } catch (err) {
    if (saved) await removeStored(saved.storedPath).catch(() => {});
    if (err instanceof UploadError) return scanPage(req, res, { error: err.message, values: b }).catch(next);
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Which scanners exist
// ---------------------------------------------------------------------------

async function adminPage(req, res, { error = null, ok = null, values = {} } = {}) {
  const { scanners, rooms } = await withActor(req.user, async q => {
    const { rows: scanners } = await q(`
      SELECT s.*, r.name AS room_name FROM scanner s LEFT JOIN room r ON r.id = s.room_id
       ORDER BY s.is_active DESC, s.name`);
    const { rows: rooms } = await q(`SELECT id, name, room_number FROM room WHERE is_active ORDER BY sort_order, name`);
    return { scanners, rooms };
  });
  const v = k => values[k] ?? '';
  const roomLabel = r => `${r.name}${r.room_number ? ` (${num(r.room_number)})` : ''}`;

  res.status(error ? 400 : 200).send(page({
    user: req.user, title: 'سکانەرەکان', current: '/admin/scanners',
    notice: error ? { kind: 'error', text: error } : ok ? { kind: 'ok', text: ok }
          : req.query.ok ? { kind: 'ok', text: String(req.query.ok) }
          : req.query.error ? { kind: 'error', text: String(req.query.error) } : null,
    body: html`
      <!-- The form to add one comes first and the list below it, as on every
           other admin screen. It sat under the list (design test, 13 September). -->
      <div class="card form">
        <h2>سکانەری نوێ</h2>
        <p class="card-sub">
          هەر سکانەر یان پرینتەرێکی فرە-کار کە AirScan یان Mopria (eSCL) دەناسێت. ناونیشانەکەی
          زۆرجار <span dir="ltr" class="mono">http://&lt;IP&gt;/eSCL</span>یە. سکانەری USB کە
          بە کۆمپیوتەرێکەوە بەستراوە ناتوانرێت لێرە زیاد بکرێت؛ ئەوانە بۆ فۆڵدەری هاوبەش سکان دەکەن.
        </p>
        <form method="post" action="/admin/scanners">
          <input type="hidden" name="_csrf" value="${res.locals.csrf}">
          <div class="grid cols-2">
            <div class="field"><label for="name" class="required">ناو</label>
              <input id="name" name="name" type="text" required maxlength="120" value="${v('name')}"
                     placeholder="سکانەری ژووری هات و دەرچوو"></div>
            <div class="field"><label for="code" class="required">کۆد</label>
              <input id="code" name="code" type="text" dir="ltr" required maxlength="30" pattern="(?:[A-Za-z0-9_]|-){2,30}"
                     value="${v('code')}" placeholder="REGISTRY-1">
              <div class="hint">پیتی ئینگلیزی و ژمارە. لەسەر ناوی فایلەکان دەنووسرێت.</div></div>
            <div class="field"><label for="base_url" class="required">ناونیشانی eSCL</label>
              <input id="base_url" name="base_url" type="text" dir="ltr" required maxlength="300"
                     value="${v('base_url')}" placeholder="http://192.168.1.40/eSCL">
              <div class="hint">تەنها ناونیشانی ناو تۆڕی ناوخۆ قبوڵ دەکرێت.</div></div>
            <div class="field"><label for="room_id">ژوور</label>
              <select id="room_id" name="room_id">
                <option value="">هاوبەش بۆ هەموو بینا</option>
                ${rooms.map(r => opt(String(r.id), roomLabel(r), String(v('room_id'))))}
              </select></div>
          </div>
          <button class="btn" type="submit">زیادکردن و تاقیکردنەوە</button>
        </form>
        ${simulatorEnabled() && !scanners.some(s => s.base_url === SIMULATOR_URL) ? html`
          <form method="post" action="/admin/scanners" style="margin-top:14px">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            <input type="hidden" name="name" value="سکانەری تاقیکردنەوە">
            <input type="hidden" name="code" value="SIMULATOR">
            <input type="hidden" name="base_url" value="${SIMULATOR_URL}">
            <button class="btn secondary" type="submit">زیادکردنی سکانەری تاقیکردنەوە</button>
            <div class="hint">بۆ تاقیکردنەوەی سیستەم بەبێ ئامێر: سکانەرێکی ساختە کە پەڕەیەکی تاقیکردنەوە دەنێرێت.</div>
          </form>` : ''}
      </div>

      <div class="card">
        <h2>سکانەرەکانی تۆڕ${scanners.length ? html` <span class="pill muted">${num(scanners.length)}</span>` : ''}</h2>
        ${scanners.length === 0 ? html`<div class="empty">هیچ سکانەرێک نییە.</div>` : html`
          <div class="table-wrap"><table>
            <thead><tr><th>ناو</th><th>ژوور</th><th>ناونیشان</th><th>دوایین پەیوەندی</th><th>دۆخ</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
            <tbody>${scanners.map(s => html`<tr id="s${s.id}"${s.is_active ? '' : raw(' class="inactive"')}>
              <td><strong>${s.name}</strong><span class="cell-sub mono">${ltr(s.code)}</span>
                ${s.make_model ? html`<span class="cell-sub" dir="auto">${s.base_url === SIMULATOR_URL ? 'سکانەری تاقیکردنەوەی ناو سیستەم' : s.make_model}</span>` : ''}</td>
              <td>${s.room_name ?? html`<span class="muted">هاوبەش</span>`}</td>
              ${s.base_url === SIMULATOR_URL
                ? html`<td>سکانەری تاقیکردنەوە (ناو سیستەم)</td>`
                : html`<td class="mono">${ltr(s.base_url)}</td>`}
              <td class="muted">
                ${s.last_seen_at ? html`${date(s.last_seen_at)} ${time(s.last_seen_at)}` : '—'}
                ${s.last_error ? html`<span class="cell-sub text-danger">${s.last_error}</span>` : ''}
              </td>
              <td>${s.is_active ? html`<span class="pill ok">چالاک</span>` : html`<span class="pill muted">ناچالاک</span>`}</td>
              <td>
                <form method="post" action="/admin/scanners/${s.id}/test" style="display:inline">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <button class="btn small secondary" type="submit">تاقیکردنەوە</button>
                </form>
                <form method="post" action="/admin/scanners/${s.id}/active" style="display:inline">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <input type="hidden" name="active" value="${s.is_active ? '0' : '1'}">
                  ${s.is_active
                    ? html`<button class="btn small danger-outline" type="submit">ناچالاککردن</button>`
                    : html`<button class="btn small secondary" type="submit">چالاککردن</button>`}
                </form>
              </td>
            </tr>`)}</tbody>
          </table></div>`}
      </div>`,
  }));
}

router.get('/admin/scanners', requireAuth, requireRole(...ADMINS), async (req, res, next) => {
  try { await adminPage(req, res); } catch (err) { next(err); }
});

router.post('/admin/scanners', requireAuth, requireRole(...ADMINS), async (req, res, next) => {
  const b = req.body;
  try {
    const name = String(b.name ?? '').trim();
    const code = String(b.code ?? '').trim().toUpperCase();
    if (name.length < 2) return adminPage(req, res, { error: 'ناوی سکانەر پێویستە.', values: b });
    if (!/^[A-Z0-9_-]{2,30}$/.test(code)) return adminPage(req, res, { error: 'کۆد دەبێت پیتی ئینگلیزی یان ژمارە بێت.', values: b });
    let base;
    try { base = checkScannerUrl(b.base_url); } catch (err) {
      if (err instanceof ScannerError) return adminPage(req, res, { error: err.message, values: b });
      throw err;
    }

    // Asked before saving, so a wrong address is found now and not on the morning
    // somebody needs it. Saved either way: the scanner may simply be switched off.
    let caps = null, problem = null;
    try { caps = await capabilities(base); } catch (err) {
      if (!(err instanceof ScannerError)) throw err;
      problem = err.message;
    }

    const id = await withActor(req.user, async q => {
      const { rows: [s] } = await q(`
        INSERT INTO scanner (code, name, base_url, room_id, make_model, last_seen_at, last_error, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [code, name, base, Number(b.room_id) || null, caps?.makeModel ?? null,
         caps ? new Date() : null, problem, req.user.id]);
      await logEvent(q, { action: 'scanner.added', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { scanner_id: s.id, code, room_id: Number(b.room_id) || null, reachable: !!caps } });
      return s.id;
    });
    res.redirect(303, `/admin/scanners?${caps
      ? `ok=${encodeURIComponent(`زیادکرا و وەڵامی دایەوە${caps.makeModel ? `: ${caps.makeModel}` : ''}.`)}`
      : `error=${encodeURIComponent(`زیادکرا، بەڵام وەڵامی نەدایەوە: ${problem}`)}`}#s${id}`);
  } catch (err) {
    if (err.code === '23505') return adminPage(req, res, { error: 'ئەم کۆدە پێشتر بەکارهاتووە.', values: b }).catch(next);
    next(err);
  }
});

router.post('/admin/scanners/:id(\\d+)/test', requireAuth, requireRole(...ADMINS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const s = await withActor(req.user, async q => (await q(`SELECT * FROM scanner WHERE id = $1`, [id])).rows[0]);
    if (!s) return notFound(req, res, 'ئەم سکانەرە نەدۆزرایەوە.');
    try {
      const caps = await capabilities(checkScannerUrl(s.base_url));
      await withActor(req.user, q => q(
        `UPDATE scanner SET last_seen_at = now(), last_error = NULL, make_model = coalesce($2, make_model) WHERE id = $1`,
        [id, caps.makeModel]));
      const what = [caps.platen && 'شووشە', caps.feeder && 'فیدەر', caps.formats.includes('application/pdf') && 'PDF'].filter(Boolean).join('، ');
      res.redirect(303, `/admin/scanners?ok=${encodeURIComponent(`${s.name} وەڵامی دایەوە${caps.makeModel ? ` (${caps.makeModel})` : ''}. ${what}`)}`);
    } catch (err) {
      if (!(err instanceof ScannerError)) throw err;
      await withActor(req.user, q => q(`UPDATE scanner SET last_error = $2 WHERE id = $1`, [id, err.message]));
      res.redirect(303, `/admin/scanners?error=${encodeURIComponent(`${s.name}: ${err.message}`)}`);
    }
  } catch (err) { next(err); }
});

router.post('/admin/scanners/:id(\\d+)/active', requireAuth, requireRole(...ADMINS), async (req, res, next) => {
  const id = Number(req.params.id);
  const on = req.body.active === '1';
  try {
    const changed = await withActor(req.user, async q => {
      const { rowCount } = await q(`UPDATE scanner SET is_active = $2 WHERE id = $1`, [id, on]);
      if (rowCount) await logEvent(q, { action: 'scanner.changed', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { scanner_id: id, is_active: on } });
      return rowCount > 0;
    });
    if (!changed) return notFound(req, res, 'ئەم سکانەرە نەدۆزرایەوە.');
    // Said, like every other switch: the page came back with nothing (design test).
    res.redirect(303, `/admin/scanners?ok=${encodeURIComponent(on ? 'چالاککرایەوە.' : 'ناچالاککرا.')}#s${id}`);
  } catch (err) { next(err); }
});

export default router;
