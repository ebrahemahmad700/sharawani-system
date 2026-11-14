// Reading the barcode on a folder.
//
// Named barcode-lookup rather than scan, because "scan" already means two other
// things in this system: the virus scan on an upload, and the scanner tray. A
// third meaning would cost somebody an afternoon.
//
// A hand-held reader is a keyboard. It types the digits it saw and presses
// Enter, and that is the whole of its behaviour: no driver, no permission
// prompt, no API. So this screen is one text box with the cursor already in it,
// and everything else on the page is a consequence of what was scanned.
//
// The box also accepts a document number typed by hand, ه/2026/25, because the
// person holding a folder whose label has torn still needs to find it, and
// making them go to a different screen for that is the kind of small cruelty
// that gets a system abandoned.
//
// One scan, three things offered, in the order the person standing at the desk
// wants them: sign for the folder, open the letter, print its sheet again.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { paperReceive, RoutingError } from '../lib/routing.mjs';
import { deliver as deliverPushes } from '../lib/notify.mjs';
import { normaliseBarcode, barcodeValid, code39Svg } from '../lib/barcode.mjs';
import { parseNumber } from '../lib/ku.mjs';
import { statusPill } from './registry.mjs';
import { page } from '../views/layout.mjs';
import { html, raw, num, date, time, ltr, ident, escapeHtml } from '../lib/html.mjs';

const router = Router();

// Everyone who handles paper. Not IT: a folder is a letter.
const USERS = ['registry_clerk', 'room_clerk', 'room_head', 'archive_clerk',
               'mayor', 'deputy_mayor', 'directorate_head'];

// Normal priority is shown nowhere; only the two that ask for speed get a pill.
const PRIORITY_PILL = { urgent: ['warn', 'پەلە'], very_urgent: ['danger', 'زۆر پەلە'] };

/**
 * Find the letter a scan or a typed number refers to.
 *
 * Barcode first, because that is what a reader produces and it is exact. Only if
 * the input is not a barcode is it treated as a document number, which is fuzzy:
 * ه/2026/25, ٢٥, 25 and د/2026/25 are all things people type.
 */
async function lookup(q, input) {
  const barcode = normaliseBarcode(input);

  if (barcode) {
    // The check digit is verified before the query, so a mis-scan is reported as
    // a mis-scan rather than as a letter that does not exist. The difference
    // matters to the person holding the folder: one means try again, the other
    // means go and ask.
    if (!barcodeValid(barcode)) return { kind: 'bad_check', input };
    const { rows } = await q(`SELECT id FROM document WHERE barcode = $1`, [barcode]);
    return rows[0] ? { kind: 'hit', id: rows[0].id, barcode } : { kind: 'miss', input };
  }

  const parsed = parseNumber(input);
  if (!parsed) return { kind: 'unreadable', input };

  // ه/ is the incoming register and د/ the outgoing one; only a bare number can
  // mean either. It used to match both, so ه/2026/79 was "more than one letter".
  const { rows } = await q(
    `SELECT id FROM document
      WHERE ($3::text IS DISTINCT FROM 'outgoing' AND incoming_year = $1 AND incoming_seq = $2)
         OR ($3::text IS DISTINCT FROM 'incoming' AND outgoing_year = $1 AND outgoing_seq = $2)
      ORDER BY id LIMIT 2`,
    [parsed.year ?? new Date().getFullYear(), parsed.serial, parsed.kind ?? null]);

  if (rows.length === 1) return { kind: 'hit', id: rows[0].id };
  if (rows.length > 1) return { kind: 'ambiguous', input };
  return { kind: 'miss', input };
}

/** Everything the screen shows about one letter after a successful scan. */
async function scannedDocument(q, id) {
  const { rows: [d] } = await q(
    `SELECT d.id, d.incoming_no, d.outgoing_no, d.barcode, d.subject, d.status,
            d.priority, d.incoming_date, d.sender_name, d.plot_no,
            d.physical_shelf, d.physical_folder, d.physical_section,
            r.name AS room_name, r.room_number,
            s.id AS step_id, s.sent_at, s.due_at, s.received_at,
            s.paper_received_at, s.paper_handed_by,
            (s.status = 'active' AND s.due_at < now()) AS overdue,
            pu.full_name AS paper_received_by_name,
            fr.name AS from_room_name,
            (s.to_room_id = ANY (app_visible_rooms())) AS mine
       FROM document d
       LEFT JOIN room r ON r.id = d.current_room_id
       LEFT JOIN routing_step s ON s.id = d.current_step_id
       LEFT JOIN app_user pu ON pu.id = s.paper_received_by
       LEFT JOIN room fr ON fr.id = s.from_room_id
      WHERE d.id = $1`, [id]);
  return d ?? null;
}

// ---------------------------------------------------------------------------

// The page title already says what this is, so the card has no heading of its
// own. What was not found is said inside it, under the box, not as an error.
const searchBox = (value, csrf, result = '') => html`
  <div class="card">
    <form method="get" action="/barcode" class="row" role="search">
      <input id="q" name="q" type="search" dir="ltr" data-scan-input autocomplete="off"
             inputmode="text" maxlength="40" value="${value ?? ''}"
             aria-label="بارکۆد یان ژمارەی کتاب" placeholder="20260000253">
      <button class="btn" type="submit">گەڕان</button>
    </form>
    <div class="hint">بارکۆدی سەر فۆڵدەرەکە سکان بکە، یان ژمارەی کتاب بنووسە.</div>
    ${result}
  </div>`;

// One box in the top bar, two destinations.
//
// Somebody holding a folder should not have to decide which screen they want
// before they can type. Eleven digits is a barcode and goes to the scanner
// screen; anything else is a search. The decision is made here, in one place,
// rather than by asking the person to choose a mode.
//
// A redirect rather than rendering either screen itself, so the address bar ends
// up somewhere the person can bookmark, reload and go back to.
router.get('/find', requireAuth, (req, res) => {
  const q = (req.query.q ?? '').toString().trim();
  if (!q) return res.redirect(303, '/documents');

  const barcode = normaliseBarcode(q);
  if (barcode) return res.redirect(303, `/barcode?q=${encodeURIComponent(barcode)}`);
  return res.redirect(303, `/documents?q=${encodeURIComponent(q)}`);
});

router.get('/barcode', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    const input = (req.query.q ?? '').toString().trim();

    if (!input) {
      return res.send(page({
        user: req.user, title: 'خوێندنەوەی بارکۆد', current: '/barcode',
        notice: req.query.ok    ? { kind: 'ok',    text: String(req.query.ok) }
              : req.query.error ? { kind: 'error', text: String(req.query.error) }
              : null,
        body: html`${req.query.ok ? html`<span hidden data-sound="received"></span>` : ''}
               ${req.query.error ? html`<span hidden data-sound="error"></span>` : ''}
               ${searchBox('', res.locals.csrf)}`,
      }));
    }

    const { result, doc } = await withActor(req.user, async q => {
      const result = await lookup(q, input);
      const doc = result.kind === 'hit' ? await scannedDocument(q, result.id) : null;

      // Row-level security can hide a letter that exists, and the honest report
      // of that is the same as not finding one. Saying "it exists but is not
      // yours" would answer a question the reader is not entitled to ask.
      await logEvent(q, {
        action: doc ? 'barcode.scanned' : 'barcode.miss',
        req, userId: req.user.id, documentId: doc?.id ?? null,
        detail: { outcome: doc ? 'hit' : result.kind },
      });

      return { result, doc: doc ?? null };
    });

    // Something wrong with what was typed or scanned is an error. A good number
    // that matches no letter is simply an empty result.
    const MESSAGES = {
      bad_check:  'ئەم بارکۆدە دروست نییە. لەوانەیە هەڵە خوێندرابێتەوە — دووبارە سکان بکە.',
      unreadable: 'نە بارکۆدە و نە ژمارەی کتاب.',
      ambiguous:  'دوو کتاب بەم ژمارەیە هەن، یەکێکی هاتوو و یەکێکی دەرچوو. پێشگرەکەشی بنووسە: ه/ یان د/.',
    };

    if (!doc) {
      const error = MESSAGES[result.kind];
      return res.send(page({
        user: req.user, title: 'خوێندنەوەی بارکۆد', current: '/barcode',
        notice: error ? { kind: 'error', text: error } : null,
        // The scanner beeps low twice on a miss, which is how somebody working
        // through a pile knows to look up without reading the screen first.
        body: html`<span hidden data-sound="error"></span>${searchBox(input, res.locals.csrf,
          error ? '' : html`<div class="empty">هیچ کتابێک نەدۆزرایەوە.</div>`)}`,
      }));
    }

    const [priorityKind, priorityLabel] = PRIORITY_PILL[doc.priority] ?? [];
    // Only the parts of the paper's place that were filled in, in the same words
    // as the letter page, so no dangling «فۆڵدەر» with nothing after it.
    const place = [
      doc.physical_shelf && html`ڕەف ${ident(doc.physical_shelf)}`,
      doc.physical_section && html`بەش ${ident(doc.physical_section)}`,
      doc.physical_folder && html`دۆسیە ${ident(doc.physical_folder)}`,
    ].filter(Boolean).map((part, i) => html`${i ? ' · ' : ''}${part}`);

    const barcodeSvg = raw(code39Svg(doc.barcode, { moduleMm: 0.36, heightMm: 11 }));

    res.send(page({
      user: req.user, title: 'خوێندنەوەی بارکۆد', current: '/barcode',
      // After signing for the paper the page comes back with ?ok=; it said
      // nothing (letters test, 13 September).
      notice: req.query.ok    ? { kind: 'ok',    text: String(req.query.ok) }
            : req.query.error ? { kind: 'error', text: String(req.query.error) }
            : null,
      body: html`
        <span hidden data-sound="scan"></span>
        ${searchBox('', res.locals.csrf)}

        <div class="card">
          <div class="card-head">
            <h2><a href="/documents/${doc.id}">${doc.subject}</a></h2>
            <div class="end">${barcodeSvg}</div>
          </div>

          <div class="table-wrap kv"><table>
            <tbody>
              <tr><th>ژمارە</th><td class="mono">${ltr(doc.incoming_no)}</td></tr>
              <tr><th>نێردەر</th><td>${doc.sender_name}</td></tr>
              <tr><th>بەروار</th><td>${date(doc.incoming_date)}</td></tr>
              ${doc.plot_no ? html`<tr><th>پارچە</th><td class="mono">${ident(doc.plot_no)}</td></tr>` : ''}
              <tr><th>دۆخ</th><td>${statusPill(doc.status)}${priorityLabel ? html` <span class="pill ${priorityKind}">${priorityLabel}</span>` : ''}</td></tr>
              <tr><th>ئێستا لای</th><td>
                ${doc.room_name
                  ? html`${doc.room_name}${doc.room_number ? html` (ژووری ${num(doc.room_number)})` : ''}`
                  : '—'}
                ${doc.overdue ? html` <span class="pill danger">دواکەوتوو</span>` : ''}
              </td></tr>
              <tr><th>پەڕگەی کاغەزی</th><td>
                ${doc.paper_received_at
                  ? html`<span class="pill ok">وەرگیراوە</span>
                         <span class="muted">${date(doc.paper_received_at)} ${time(doc.paper_received_at)}
                         — ${doc.paper_received_by_name ?? ''}</span>`
                  : doc.step_id
                    ? html`<span class="pill warn">نەگەیشتووە</span>`
                    : html`<span class="muted">لە ڕێڕەودا نییە</span>`}
              </td></tr>
              ${place.length ? html`<tr><th>شوێنی کاغەز</th><td class="muted">${place}</td></tr>` : ''}
            </tbody>
          </table></div>

          <div class="row after">
            ${doc.step_id && !doc.paper_received_at && doc.mine ? html`
              <form method="post" action="/barcode/${doc.id}/paper-received">
                <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                <input type="hidden" name="q" value="${doc.barcode}">
                <button class="btn" type="submit" data-sound-on-click="received">وەرگرتنی پەڕگەی کاغەزی</button>
              </form>` : ''}
            <a class="btn secondary" href="/documents/${doc.id}">کردنەوە</a>
            <a class="btn secondary" href="/documents/${doc.id}/print" target="_blank"
               data-sound-on-click="click">چاپی پەڕەی کتاب</a>
            <a class="btn secondary" href="/documents/${doc.id}/receipt" target="_blank"
               data-sound-on-click="click">چاپی پسوولە</a>
          </div>
        </div>`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------

router.post('/barcode/:id(\\d+)/paper-received', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    await withActor(req.user, q => paperReceive(q, { documentId: id, byUser: req.user, req }));
    await deliverPushes(req);
    res.redirect(303, `/barcode?q=${encodeURIComponent(req.body.q ?? '')}&ok=${encodeURIComponent('وەرگرتنی پەڕگەی کاغەزی تۆمارکرا.')}`);
  } catch (err) {
    if (err instanceof RoutingError) {
      return res.redirect(303, `/barcode?q=${encodeURIComponent(req.body.q ?? '')}&error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

export default router;
