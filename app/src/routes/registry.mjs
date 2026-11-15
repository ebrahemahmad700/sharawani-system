// The incoming and outgoing room (ژووری هات و دەرچوو).
//
// Screen: design/Registry.dc.html.
//
// This is the front door and the back door. Every letter that enters the
// building is registered here and gets its number, and every letter that leaves
// is registered here and closed. Nothing else issues a number.
//
// The form is deliberately short. If registering a letter takes longer than
// writing it in the paper book, staff will quietly keep using the paper book.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { claimTrayItem } from './tray.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { registerIncoming, registerOutgoingAndClose, searchDocuments, findSimilar, DocumentError } from '../lib/documents.mjs';
import { page } from '../views/layout.mjs';
import { html, raw, num, date, ltr } from '../lib/html.mjs';
import { scannersFor } from '../lib/escl.mjs';
import { logEvent } from '../lib/log.mjs';
import { toCsv, sendCsv, exportRange } from '../lib/csv.mjs';

const router = Router();

const DOC_TYPES = [
  ['citizen_request', 'داواکاری هاووڵاتی'],
  ['company_request', 'داواکاری کۆمپانیا'],
  ['gov_letter',      'نامەی حکومی'],
  ['internal',        'نامەی ناوخۆیی'],
  ['complaint',       'سکاڵا'],
  ['report',          'ڕاپۆرت'],
  ['contract',        'گرێبەست'],
  ['leave_request',   'داواکاری مۆڵەت'],
  ['other',           'جۆری تر'],
];

const SENDER_KINDS = [
  ['citizen',    'هاووڵاتی'],
  ['company',    'کۆمپانیا'],
  ['government', 'فەرمانگەی حکومی'],
  ['internal',   'ناوخۆیی'],
];

// One word for priority everywhere, the mockups' word. Registration said گرنگ and
// the barcode screen and delivery lists said پەلە, so a clerk chose one and later
// read the other (browser audit, 13 September).
const PRIORITIES = [
  ['normal',      'ئاسایی'],
  ['urgent',      'پەلە'],
  ['very_urgent', 'زۆر پەلە'],
];

const STATUS_PILL = {
  registered:     ['info',   'تۆمارکراو'],
  in_flow:        ['warn',   'لەژێر کاردا'],
  ready_to_close: ['ok',     'ئامادەی داخستن'],
  closed:         ['muted',  'داخراو'],
  cancelled:      ['danger', 'هەڵوەشێنراوە'],
  draft:          ['muted',  'ڕەشنووس'],
};

export const statusPill = s => {
  const [kind, label] = STATUS_PILL[s] ?? ['muted', s];
  return html`<span class="pill ${kind}">${label}</span>`;
};

const options = (list, selected) => raw(list.map(([v, l]) =>
  `<option value="${v}"${v === selected ? ' selected' : ''}>${l}</option>`).join(''));

// ---------------------------------------------------------------------------
// The register: today's letters, newest first
// ---------------------------------------------------------------------------

router.get('/registry', requireAuth, async (req, res, next) => {
  try {
    const qtext = String(req.query.q ?? '');
    // The register is the front desk's screen. Everyone else could open it by
    // typing the address, and saw the same letters their search screen shows under
    // a title that was not theirs (browser audit, 13 September). They are sent to
    // search, with what they typed; IT to its own screen.
    if (!FRONT_DESK.includes(req.user.role)) {
      if (req.user.role === 'sysadmin') return res.redirect(303, '/admin/users');
      return res.redirect(303, qtext ? `/documents?q=${encodeURIComponent(qtext)}` : '/documents');
    }
    const { rows, promised } = await withActor(req.user, async q => ({
      rows: await searchDocuments(q, { text: qtext, filters: {}, limit: 60, byUser: req.user, req }),
      promised: await promisedReplies(q),
    }));
    const range = exportRange(req.query);

    res.send(page({
      user: req.user,
      title: 'ژووری هات و دەرچوو',
      current: '/registry',
      actions: html`<a class="btn" href="/registry/new">کتابی نوێ</a>`,
      body: html`
        ${promisedCard(promised)}

        <div class="card">
          <form method="get" action="/registry" class="row" role="search">
            <input type="search" name="q" value="${qtext}" aria-label="گەڕان لە تۆمار" placeholder="گەڕان بە ژمارە، بابەت، ناوی نێردەر یان ژمارەی پارچە">
            <button class="btn" type="submit">گەڕان</button>
          </form>
          <div class="hint">
            ژمارە بە هەر شێوەیەک بنووسیت دەدۆزرێتەوە: ٤٤٩٨ یان 4498 یان ه/٢٠٢٦/٤٤٩٨.
          </div>

          ${rows.length === 0
            ? html`<div class="empty">${qtext ? 'هیچ کتابێک نەدۆزرایەوە.' : 'هیچ کتابێک نییە.'}</div>`
            : html`<div class="table-wrap"><table>
                <thead><tr>
                  <th>ژمارە</th><th>بەروار</th><th>بابەت</th><th>نێردەر</th>
                  <th>دۆخ</th><th>ئێستا لای</th>
                </tr></thead>
                <tbody>
                  ${rows.map(d => html`<tr>
                    <td class="mono">${ltr(d.incoming_no)}</td>
                    <td>${date(d.incoming_date)}</td>
                    <td><a href="/documents/${d.id}">${d.subject}</a>${d.is_confidential ? html` <span class="pill danger">نهێنی</span>` : ''}</td>
                    <td>${d.sender_name}</td>
                    <td>${d.priority === 'very_urgent' ? html`<span class="pill danger">زۆر پەلە</span> ` : d.priority === 'urgent' ? html`<span class="pill warn">پەلە</span> ` : ''}${statusPill(d.status)}</td>
                    <td class="muted">${d.current_room_name ?? '—'}</td>
                  </tr>`)}
                </tbody>
              </table></div>`}
        </div>

        ${exportCard('/registry/export.csv', range, 'تۆماری هاتوو بۆ Excel', 'هەموو ئەو کتابانەی لەم ماوەیەدا هاتوون، بە ژمارە، بابەت، نێردەر، دۆخ و ئێستا لای کێیە.')}`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// The reply the applicant was promised (migration 0600)
// ---------------------------------------------------------------------------

/**
 * Open letters whose promised reply date is today, within three days, or gone.
 * The front desk made the promise at the counter, so the front desk sees it
 * coming; the mayor's dashboard shows the same list.
 */
export async function promisedReplies(q, { limit = 30 } = {}) {
  const { rows } = await q(`
    SELECT d.id, d.incoming_no, d.subject, d.sender_name, d.reply_by, d.is_confidential,
           (d.reply_by - current_date) AS days_left, r.name AS room_name
      FROM document d LEFT JOIN room r ON r.id = d.current_room_id
     WHERE d.reply_by IS NOT NULL AND d.reply_by <= current_date + 3
       AND d.status IN ('registered', 'in_flow', 'ready_to_close')
     ORDER BY d.reply_by, d.id
     LIMIT $1`, [limit]);
  return rows;
}

/** How the promise stands: late, today, or in N days. */
export function replyByPill(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '';
  const n = Number(daysLeft);
  if (n < 0) return html`<span class="pill danger">${num(-n)} ڕۆژ دواکەوتووە</span>`;
  if (n === 0) return html`<span class="pill danger">ئەمڕۆ</span>`;
  if (n <= 3) return html`<span class="pill warn">${num(n)} ڕۆژی ماوە</span>`;
  return html`<span class="pill muted">${num(n)} ڕۆژی ماوە</span>`;
}

export function promisedCard(rows) {
  if (!rows.length) return '';
  return html`
    <div class="card attention">
      <div class="card-head">
        <h2>بەڵێنی وەڵامدانەوە <span class="pill muted">${num(rows.length)}</span></h2>
      </div>
      <p class="card-sub">ئەو کتابانەی بەرواری وەڵامدانەوەیان بە داواکار دراوە و ئەمڕۆ یان لە سێ ڕۆژی داهاتوودا دێت، یان تێپەڕیوە.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>ژمارە</th><th>بابەت</th><th>داواکار</th><th>ئێستا لای</th><th>بەڵێن دراوە بۆ</th></tr></thead>
        <tbody>${rows.map(d => html`<tr>
          <td class="mono">${ltr(d.incoming_no)}</td>
          <td><a href="/documents/${d.id}">${d.subject}</a>${d.is_confidential ? html` <span class="pill danger">نهێنی</span>` : ''}</td>
          <td>${d.sender_name}</td>
          <td class="muted">${d.room_name ?? '—'}</td>
          <td class="nowrap">${date(d.reply_by)} ${replyByPill(d.days_left)}</td>
        </tr>`)}</tbody>
      </table></div>
    </div>`;
}

/** A date range and a download button, under a register. */
export function exportCard(action, range, heading, sub) {
  const key = action.replace(/[^a-z]/g, '');
  return html`
    <div class="card">
      <h2>${heading}</h2>
      <p class="card-sub">${sub} تەنها ئەو کتابانە دەچنە ناو فایلەکە کە تۆ دەتوانیت ببینیت.</p>
      <form method="get" action="${action}" class="row">
        <label for="from_${key}">لە</label>
        <input id="from_${key}" name="from" type="date" dir="ltr" value="${range.from}">
        <label for="to_${key}">بۆ</label>
        <input id="to_${key}" name="to" type="date" dir="ltr" value="${range.to}">
        <button class="btn secondary" type="submit">داگرتن بۆ Excel</button>
      </form>
    </div>`;
}

const STATUS_WORD = Object.fromEntries(Object.entries(STATUS_PILL).map(([k, [, l]]) => [k, l]));
const PRIORITY_WORD = Object.fromEntries(PRIORITIES);
const SENDER_WORD = Object.fromEntries(SENDER_KINDS);

router.get('/registry/export.csv', requireAuth, async (req, res, next) => {
  try {
    if (!FRONT_DESK.includes(req.user.role)) return res.status(403).send('');
    const range = exportRange(req.query);
    const rows = await withActor(req.user, async q => {
      // Row-level security decides which letters are in it, exactly as on the
      // screen: a confidential letter the clerk may not open is not in their file.
      const { rows } = await q(`
        SELECT d.incoming_no, to_char(d.incoming_date, 'YYYY-MM-DD') AS incoming_date, d.subject,
               coalesce(o.name, d.doc_type::text) AS type_name, d.sender_kind, d.sender_name, d.sender_contact,
               d.priority, d.status, d.plot_no, d.neighbourhood, r.name AS current_room,
               to_char(d.reply_by, 'YYYY-MM-DD') AS reply_by, d.is_confidential,
               d.outgoing_no, to_char(d.outgoing_date, 'YYYY-MM-DD') AS outgoing_date,
               u.full_name AS registered_by
          FROM document d
          LEFT JOIN doc_type_option o ON o.id = d.doc_type_option_id
          LEFT JOIN room r ON r.id = d.current_room_id
          LEFT JOIN app_user u ON u.id = d.incoming_registered_by
         WHERE d.incoming_date BETWEEN $1::date AND $2::date
         ORDER BY d.incoming_year, d.incoming_seq
         LIMIT 50000`, [range.from, range.to]);
      await logEvent(q, { action: 'export.registry', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { from: range.from, to: range.to, rows: rows.length } });
      return rows;
    });
    sendCsv(res, `incoming-${range.from}-${range.to}.csv`, toCsv([
      ['ژمارەی هاتوو', r => r.incoming_no],
      ['بەرواری هاتوو', r => r.incoming_date],
      ['بابەت', r => r.subject],
      ['جۆری مامەڵە', r => r.type_name],
      ['جۆری نێردەر', r => SENDER_WORD[r.sender_kind] ?? r.sender_kind],
      ['نێردەر', r => r.sender_name],
      ['پەیوەندی', r => r.sender_contact],
      ['گرنگی', r => PRIORITY_WORD[r.priority] ?? r.priority],
      ['دۆخ', r => STATUS_WORD[r.status] ?? r.status],
      ['ئێستا لای', r => r.current_room],
      ['پارچە', r => r.plot_no],
      ['گەڕەک', r => r.neighbourhood],
      ['بەڵێنی وەڵام', r => r.reply_by],
      ['نهێنی', r => (r.is_confidential ? 'بەڵێ' : '')],
      ['ژمارەی دەرچوو', r => r.outgoing_no],
      ['بەرواری دەرچوو', r => r.outgoing_date],
      ['تۆمارکرا لەلایەن', r => r.registered_by],
    ], rows));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Register an incoming letter
// ---------------------------------------------------------------------------

/**
 * The panel that says "this looks familiar".
 *
 * Shown twice over: once live as the clerk types, fetched into the page by
 * app.js, and once on the server when the form is submitted. The second is the
 * one that matters, because it works with javascript switched off, on the office
 * machine that has never been updated, and it is what actually stands between a
 * citizen's request and its second number.
 *
 * It offers three ways out and none of them is "no": open the earlier letter,
 * register this one as a follow-on to it, or register it as its own thing. A
 * clerk who is sure is one click away either way.
 */
export function similarPanel(similar, { withActions = true } = {}) {
  if (!similar?.length) return '';
  return html`
    <div class="card caution">
      <h2>ئەمە لەوە دەچێت پێشتر تۆمارکرابێت</h2>
      <p class="card-sub">
        ${num(similar.length)} کتاب دۆزرایەوە کە لەم یەکە دەچن. سەیریان بکە پێش ئەوەی
        ژمارەیەکی نوێ بدرێت. ئەگەر جیاوازن، بەردەوام بە.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>ژمارە</th><th>بەروار</th><th>بابەت</th><th>نێردەر</th>
            <th>بۆچی</th><th>دۆخ</th>${withActions ? html`<th class="actions"><span class="sr-only">کردار</span></th>` : ''}
          </tr></thead>
          <tbody>
            ${similar.map(d => html`<tr>
              <td class="mono">${ltr(d.incoming_no)}</td>
              <td>${date(d.incoming_date)}</td>
              <td><a href="/documents/${d.id}" target="_blank">${d.subject}</a></td>
              <td>${d.sender_name}</td>
              <td class="muted">${[
                  d.same_plot && 'هەمان پارچە',
                  d.like_subject && 'بابەتی لەوە چوو',
                  d.like_sender && 'هەمان نێردەر',
                ].filter(Boolean).join(' · ')}</td>
              <td>${statusPill(d.status)}${d.room_name ? html`<span class="cell-sub">${d.room_name}</span>` : ''}</td>
              ${withActions ? html`<td>
                <button class="btn small secondary" type="submit" name="related_document_id" value="${d.id}">
                  بەدواداچوونی ئەمە
                </button>
              </td>` : ''}
            </tr>`)}
          </tbody>
        </table>
      </div>
      ${withActions ? html`
        <p class="muted" style="margin-bottom:0">
          «بەدواداچوونی ئەمە» کتابە نوێیەکە بە کۆنەکەوە دەبەستێتەوە و ژمارەیەکی نوێی
          خۆی پێدەدات. ئەگەر پەیوەندییان نییە، تەنها «تۆمارکردن» لێبدە.
        </p>` : ''}
    </div>`;
}

// The front desk. Everyone else starting a letter is starting one from their own
// room, which reads differently and defaults differently.
const FRONT_DESK = ['registry_clerk', 'mayor', 'deputy_mayor'];

// Who a link on the form may lead. Each list is the one the screen at the other
// end checks (doctypes.mjs EDITORS, photo.mjs USERS, scanners.mjs USERS): a link
// that ends in "not for your role" is worse than no link, and eleven of fifteen
// people were being offered one (browser audit, 13 September).
const TYPE_EDITORS = ['registry_clerk', 'mayor', 'deputy_mayor', 'sysadmin'];
export const PAPER_ROLES = ['registry_clerk', 'room_clerk', 'room_head', 'archive_clerk', 'mayor', 'deputy_mayor', 'directorate_head'];

function newForm({ user, csrf, error = null, values = {}, types = [], companies = [], similar = [], tray = null, scanners = [] }) {
  const desk = FRONT_DESK.includes(user.role);
  const v = (k, d = '') => values[k] ?? d;
  // A letter started in a room is usually the room's own: a memo, an opinion, a
  // contract. So the sender starts as the room, and the clerk changes it when a
  // citizen has handed something in at this door instead.
  const senderDefault = desk ? 'citizen' : 'internal';
  const senderNameDefault = desk ? '' : (user.roomName ?? '');
  return page({
    user, title: 'تۆمارکردنی کتابی نوێ', current: desk ? '/registry' : '/registry/new',
    notice: error ? { kind: 'error', text: error } : null,
    actions: scanners.length && !values.tray_id && PAPER_ROLES.includes(user.role) ? html`<a class="btn secondary" href="/scan?to=registry">سکانکردن لە سکانەر</a>` : null,
    body: html`
      <form method="post" action="/registry/new" data-similar-form>
        <input type="hidden" name="_csrf" value="${csrf}">
        ${values.tray_id ? html`<input type="hidden" name="tray_id" value="${values.tray_id}">` : ''}
        <!--
          Set the moment the clerk has been shown the warning once. Without it the
          second press would show the same panel again for ever; with it, pressing
          register a second time means "yes, I looked, they are different".
        -->
        ${similar.length ? html`<input type="hidden" name="confirm_similar" value="1">` : ''}

        ${!PAPER_ROLES.includes(user.role) ? '' : tray ? html`
          <div class="notice ok row">
            <span>سکانەکە ئامادەیە (${ltr(tray.original_name)}) و دوای تۆمارکردن بە کتابەکەوە دەلکێت.</span>
            <a class="btn secondary spacer" href="/tray/${tray.id}" target="_blank">بینینی سکان</a>
          </div>` : html`
        <div class="notice info row">
          <span>مۆبایلت پێیە؟ وێنەی کتابەکە بگرە و فۆرمەکە خۆی پڕ دەبێتەوە.</span>
          <a class="btn secondary spacer" href="/registry/photo">وێنەگرتنی کتاب</a>
        </div>`}
        ${desk ? '' : html`<p class="card-sub">
          ئەم کتابە ژمارەیەک لە هەمان تۆماری شارەوانی وەردەگرێت و لە ${user.roomName ?? 'ژوورەکەی خۆت'} دەست پێدەکات.
          دوای تۆمارکردن دەتوانیت بینێریت بۆ هەر ژوورێک.
        </p>`}

        ${similarPanel(similar)}

        <div class="card">
          <h2>زانیاری کتاب</h2>
          <div class="grid cols-2">
            <div class="field">
              <label for="subject" class="required">بابەت</label>
              <input id="subject" name="subject" type="text" required maxlength="400" value="${v('subject')}">
              <div class="hint">وەک لەسەر کتابەکە نووسراوە.</div>
            </div>
            <div class="field">
              <label for="doc_type_option_id" class="required">جۆری مامەڵە</label>
              <select id="doc_type_option_id" name="doc_type_option_id" required>
                ${types.map(t => html`<option value="${t.id}"${String(v('doc_type_option_id')) === String(t.id) ? ' selected' : ''}
                  >${t.name}${t.category ? html` — ${t.category}` : ''}</option>`)}
              </select>
              ${TYPE_EDITORS.includes(user.role) ? html`<div class="hint">
                لیستەکە لە <a href="/admin/doc-types">جۆرەکانی مامەڵە</a> دەستکاری دەکرێت.
              </div>` : ''}
            </div>
          </div>

          <div class="grid cols-2">
            <div class="field">
              <label for="sender_kind" class="required">جۆری نێردەر</label>
              <select id="sender_kind" name="sender_kind" required>${options(SENDER_KINDS, v('sender_kind', senderDefault))}</select>
            </div>
            <div class="field">
              <label for="sender_name" class="required">ناوی نێردەر</label>
              <input id="sender_name" name="sender_name" type="text" required maxlength="200" value="${v('sender_name', senderNameDefault)}">
            </div>
            <div class="field">
              <label for="company_id">کۆمپانیا</label>
              <select id="company_id" name="company_id">
                <option value="">— هیچ —</option>
                ${companies.map(c => html`<option value="${c.id}"${String(v('company_id')) === String(c.id) ? ' selected' : ''}>${c.name}</option>`)}
              </select>
              <div class="hint">ئەگەر ئەم کتابە سەبارەت بە کۆمپانیایەکە.</div>
            </div>
            <div class="field">
              <label for="sender_contact">پەیوەندی</label>
              <input id="sender_contact" name="sender_contact" type="text" dir="ltr" maxlength="200" value="${v('sender_contact')}" data-digits>
              <div class="hint">ژمارەی مۆبایل یان ناونیشان.</div>
            </div>
          </div>
          <!-- Where the live check drops what it finds while the clerk is typing:
               under the subject and sender being typed, not above the form, where
               on a phone it appeared 500 pixels out of sight (accessibility test). -->
          <div data-similar-live aria-live="polite"></div>

          <div class="grid cols-3">
            <div class="field">
              <label for="priority">گرنگی</label>
              <select id="priority" name="priority">${options(PRIORITIES, v('priority', 'normal'))}</select>
            </div>
            <div class="field">
              <label for="plot_no">ژمارەی پارچە</label>
              <input id="plot_no" name="plot_no" type="text" dir="ltr" maxlength="60" value="${v('plot_no')}" data-digits>
              <div class="hint">وەک ٢٤٧/٥ یان 247/5. هەردووکیان یەک شتن.</div>
            </div>
            <div class="field">
              <label for="neighbourhood">گەڕەک</label>
              <input id="neighbourhood" name="neighbourhood" type="text" maxlength="120" value="${v('neighbourhood')}">
            </div>
          </div>
        </div>

        ${desk ? html`
        <div class="card">
          <h2>بەڵێن و نهێنی</h2>
          <div class="grid cols-2">
            <div class="field">
              <label for="reply_by">بەرواری وەڵامدانەوە بە داواکار</label>
              <input id="reply_by" name="reply_by" type="date" dir="ltr" value="${v('reply_by')}">
              <div class="hint">ئەو ڕۆژەی بە داواکار دەڵێیت وەڵام وەردەگرێت. لەسەر پسوولەکە چاپ دەکرێت و هەموو ئەو ژوورانەی کتابەکەیان لایە دەیبینن.</div>
            </div>
            <div class="field">
              <label class="row" style="margin-top:26px">
                <input type="checkbox" name="is_confidential" value="1"${values.is_confidential ? ' checked' : ''}>
                <span>کتابێکی نهێنییە</span>
              </label>
              <div class="hint">تەنها سەرۆک، جێگر، تۆ و ئەو ژوورانەی بۆیان دەنێردرێت دەیبینن. کارمەندانی تری ئەم ژوورە نایبینن.</div>
            </div>
          </div>
        </div>` : ''}

        <div class="card">
          <h2>شوێنی کاغەز</h2>
          <p class="card-sub">
            بۆ ئەوەی دواتر بە دەست بدۆزرێتەوە، نەک تەنها لەسەر کۆمپیوتەر.
          </p>
          <div class="grid cols-3">
            <div class="field">
              <label for="physical_shelf">ڕەف</label>
              <input id="physical_shelf" name="physical_shelf" type="text" maxlength="40" value="${v('physical_shelf')}" data-digits>
            </div>
            <div class="field">
              <label for="physical_section">بەش</label>
              <input id="physical_section" name="physical_section" type="text" maxlength="40" value="${v('physical_section')}" data-digits>
            </div>
            <div class="field">
              <label for="physical_folder">دۆسیە</label>
              <input id="physical_folder" name="physical_folder" type="text" maxlength="40" value="${v('physical_folder')}" data-digits>
            </div>
          </div>
        </div>

        <div class="row">
          <button class="btn" type="submit">تۆمارکردن و وەرگرتنی ژمارە</button>
          <a class="btn secondary" href="${desk ? '/registry' : '/inbox'}">پاشگەزبوونەوە</a>
        </div>
      </form>`,
  });
}

/** The two editable lists the registration form offers. */
async function formLists(q) {
  const { rows: types } = await q(
    `SELECT id, name, category, base_kind, default_room_id, default_due_days
       FROM doc_type_option WHERE is_active ORDER BY sort_order, name_sort`);
  const { rows: companies } = await q(
    `SELECT id, name FROM company WHERE is_active ORDER BY name_sort LIMIT 500`);
  return { types, companies };
}

/** A scan waiting in a tray this person can see, when the form was opened for one. */
async function trayItem(q, id) {
  if (!Number(id)) return null;
  const { rows: [t] } = await q(
    `SELECT id, original_name FROM scan_tray_item WHERE id = $1 AND status = 'new'`, [Number(id)]);
  return t ?? null;
}

router.get('/registry/new', requireAuth, async (req, res, next) => {
  try {
    // IT starts no letters. The database refuses it too; this saves the form.
    if (req.user.role === 'sysadmin') return res.redirect(303, '/');
    const { lists, tray, scanners } = await withActor(req.user, async q => ({
      lists: await formLists(q),
      // Row-level security decides whether this scan is one this person may see;
      // a tray id from another room's tray is simply not found.
      tray: await trayItem(q, req.query.tray_id),
      scanners: await scannersFor(q, req.user),
    }));
    res.send(newForm({
      user: req.user, csrf: res.locals.csrf, ...lists, tray, scanners,
      values: tray ? { tray_id: String(tray.id) } : {},
    }));
  } catch (err) { next(err); }
});

/**
 * The live check, for the browser to call while the clerk types.
 *
 * Returns a fragment of the page rather than JSON, so there is one renderer for
 * the panel and no chance of the live version and the submitted version showing
 * different things. Read-only: it looks, it does not write, and what it can see
 * is what row-level security lets this person see.
 */
router.get('/registry/similar', requireAuth, async (req, res, next) => {
  try {
    const similar = await withActor(req.user, q => findSimilar(q, {
      subject: req.query.subject ?? null,
      senderName: req.query.sender ?? null,
      plotNo: req.query.plot ?? null,
    }));
    res.type('html').send(String(similarPanel(similar, { withActions: false })));
  } catch (err) { next(err); }
});

router.post('/registry/new', requireAuth, async (req, res, next) => {
  const b = req.body;
  try {
    // Look before issuing a number, unless the clerk has already been shown what
    // was found. A number is the one thing here that cannot be taken back: it is
    // consumed for ever, even if the letter is cancelled a minute later, so the
    // pause happens before it is handed out and not after.
    if (b.confirm_similar !== '1' && !b.related_document_id) {
      const similar = await withActor(req.user, q => findSimilar(q, {
        subject: b.subject, senderName: b.sender_name, plotNo: b.plot_no,
      }));
      if (similar.length) {
        const { lists, tray } = await withActor(req.user, async q => ({
          lists: await formLists(q), tray: await trayItem(q, b.tray_id),
        }));
        return res.status(200).send(newForm({
          user: req.user, csrf: res.locals.csrf, values: b, similar, tray, ...lists,
        }));
      }
    }

    const doc = await withActor(req.user, q => registerIncoming(q, {
      subject: b.subject,
      docType: b.doc_type || 'other',
      docTypeOptionId: Number(b.doc_type_option_id) || null,
      companyId: Number(b.company_id) || null,
      senderKind: b.sender_kind,
      senderName: b.sender_name,
      senderContact: b.sender_contact || null,
      priority: b.priority || 'normal',
      plotNo: b.plot_no || null,
      neighbourhood: b.neighbourhood || null,
      physicalShelf: b.physical_shelf || null,
      physicalSection: b.physical_section || null,
      physicalFolder: b.physical_folder || null,
      relatedDocumentId: Number(b.related_document_id) || null,
      originRoomId: req.user.roomId ?? null,
      isConfidential: b.is_confidential === '1',
      replyBy: b.reply_by || null,
      byUser: req.user, req,
    }));

    // A photograph taken at the counter is waiting in the tray. Claiming it here
    // rather than making the clerk do it afterwards is the whole point of the
    // camera screen: one action registers the letter and files its scan.
    const trayId = Number(req.body.tray_id) || null;
    if (trayId) {
      await withActor(req.user, q => claimTrayItem(q, {
        trayId, documentId: doc.id, kind: 'original_scan', user: req.user, req,
      })).catch(err => {
        // The letter is registered and has a number; that must stand. A scan
        // that failed to attach is still in the tray, where it is visible and
        // can be attached by hand.
        console.error('[registry] photograph not attached to', doc.id, err.message);
      });
    }

    res.redirect(303, `/documents/${doc.id}?registered=1`);
  } catch (err) {
    if (err instanceof DocumentError) {
      const lists = await withActor(req.user, formLists);
      return res.status(400).send(newForm({
        user: req.user, csrf: res.locals.csrf, error: err.message, values: b, ...lists,
      }));
    }
    // Refused by the database's own rule on who may start a letter. Said plainly,
    // not as the generic error page, which is what legal and contracts saw before
    // migration 0450.
    if (err.code === '42501') {
      const lists = await withActor(req.user, formLists).catch(() => ({ types: [], companies: [] }));
      return res.status(403).send(newForm({
        user: req.user, csrf: res.locals.csrf, values: b, ...lists,
        error: 'ڕێگەت پێنەدراوە لەم ژوورەوە کتاب تۆمار بکەیت. پەیوەندی بە بەڕێوەبەری سیستەم بکە.',
      }));
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Register the outgoing number and close
// ---------------------------------------------------------------------------

const CHANNELS = [
  ['hand',     'بە دەست'],
  ['post',     'بە پۆست'],
  ['email',    'بە ئیمەیڵ'],
  ['whatsapp', 'بە واتساپ'],
];

router.post('/documents/:id/close', requireAuth, async (req, res, next) => {
  try {
    await withActor(req.user, q => registerOutgoingAndClose(q, {
      documentId: Number(req.params.id),
      recipient: req.body.recipient,
      summary: req.body.summary || null,
      channel: req.body.channel || 'hand',
      byUser: req.user, req,
    }));
    res.redirect(303, `/documents/${req.params.id}?closed=1`);
  } catch (err) {
    if (err instanceof DocumentError) {
      return res.redirect(303, `/documents/${req.params.id}?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

export { DOC_TYPES, SENDER_KINDS, PRIORITIES, CHANNELS, options };
export default router;
