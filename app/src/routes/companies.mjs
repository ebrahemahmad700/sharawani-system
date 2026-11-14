// The company register (کۆمپانیاکان).
//
// The contracts room asks the same question about every company letter that
// arrives: what else have we had from these people, and is their licence still
// valid. Before this screen the answer lived in somebody's memory and a filing
// cabinet, because sender_name is free text and free text cannot be joined on.
//
// Three things per company: who they are, every letter that concerns them, and
// the files that belong to the company rather than to any one letter. The
// licence expiry date is the column the room actually opens this for, so the
// list leads with what is about to run out.
//
// Searching is by ku_normalize, the same as everywhere else, so ئاسۆ finds
// كۆمپانیای ئاسۆ regardless of which ی or ک was typed.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { kuNormalize, foldDigits } from '../lib/ku.mjs';
import { receiveUpload, scanFile, scanFailClosed, removeStored, UploadError } from '../lib/files.mjs';
import { readStream } from '../lib/storage.mjs';
import { page } from '../views/layout.mjs';
import { html, num, date, ltr, escapeHtml, TIME_ZONE, dateInput, readDay, DAY_FORMAT } from '../lib/html.mjs';
import { notFound, refused } from '../lib/respond.mjs';
import { findByReference } from '../lib/documents.mjs';

const router = Router();

const READERS = ['registry_clerk', 'room_clerk', 'room_head', 'archive_clerk',
                 'mayor', 'deputy_mayor', 'directorate_head'];
const WRITERS = ['registry_clerk', 'room_clerk', 'room_head', 'mayor', 'deputy_mayor'];

const STATUS = {
  active:       ['چالاک', 'ok'],
  under_review: ['لە ژێر پێداچوونەوە', 'warn'],
  suspended:    ['ڕاگیراو', 'danger'],
  closed:       ['داخراو', 'muted'],
};

const FILE_CATEGORIES = ['مۆڵەت', 'پاکتاوی باج', 'پەیماننامە', 'بەڵگەی خاوەندارێتی', 'تر'];

// Keyed by the sniffed type, not by the name the browser sent, because the type
// is decided by looking at the bytes.
const MIME_BY_EXT = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', tif: 'image/tiff',
};

const canWrite = user => WRITERS.includes(user.role);

// Today's date in Rania, whatever the server's time zone.
const TODAY = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** A calendar day as a whole number, so two of them subtract to whole days. */
const dayNo = (y, m, d) => Date.UTC(y, m - 1, d) / 86_400_000;

/**
 * The year, month and day of a DATE column, or null. The column arrives as
 * midnight in the server's own zone, so its local parts are the date that was
 * stored; a string from a form is read as it is written.
 */
function calendarDay(d) {
  if (!d) return null;
  if (d instanceof Date) {
    return Number.isNaN(d.getTime()) ? null : [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  }
  const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  return x ? [Number(x[1]), Number(x[2]), Number(x[3])] : null;
}

/**
 * How many days until a licence runs out, or null when there is no date.
 *
 * Counted in calendar days. Subtracting two timestamps and rounding called a
 * licence that ends today «بەسەرچووە» and one that ends tomorrow «٠ ڕۆژ ماوە»,
 * depending on the hour (design test, 13 September).
 */
function daysLeft(d) {
  const p = calendarDay(d);
  if (!p) return null;
  const t = Object.fromEntries(TODAY.formatToParts(new Date()).map(x => [x.type, x.value]));
  return dayNo(...p) - dayNo(Number(t.year), Number(t.month), Number(t.day));
}

function expiryPill(d) {
  const n = daysLeft(d);
  if (n === null) return '';
  if (n < 0)   return html`<span class="pill danger">بەسەرچووە</span>`;
  if (n === 0) return html`<span class="pill warn">ئەمڕۆ کۆتایی دێت</span>`;
  if (n <= 30) return html`<span class="pill warn">${num(n)} ڕۆژ ماوە</span>`;
  return html`<span class="muted">${date(d)}</span>`;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

router.get('/companies', requireAuth, requireRole(...READERS), async (req, res, next) => {
  const qtext = (req.query.q ?? '').toString().trim();
  try {
    const { companies, expiring } = await withActor(req.user, async q => {
      const { rows: companies } = qtext
        ? await q(`
            SELECT c.*, (SELECT count(*) FROM company_document cd WHERE cd.company_id = c.id) AS doc_count
              FROM company c
             WHERE c.is_active
               AND (c.name_search % $1 OR c.name_search ILIKE '%' || $1 || '%'
                    OR c.legal_search ILIKE '%' || $1 || '%'
                    OR c.rep_search ILIKE '%' || $1 || '%'
                    OR c.registration_no ILIKE '%' || $2 || '%'
                    OR c.tax_no ILIKE '%' || $2 || '%')
             ORDER BY similarity(c.name_search, $1) DESC, c.name_sort
             LIMIT 60`, [kuNormalize(qtext), foldDigits(qtext)])
        : await q(`
            SELECT c.*, (SELECT count(*) FROM company_document cd WHERE cd.company_id = c.id) AS doc_count
              FROM company c
             WHERE c.is_active
             ORDER BY c.name_sort
             LIMIT 60`);

      const { rows: expiring } = await q(`
        SELECT id, name, licence_expires_on
          FROM company
         WHERE is_active AND licence_expires_on IS NOT NULL
           AND licence_expires_on < current_date + 60
         ORDER BY licence_expires_on
         LIMIT 60`);

      return { companies, expiring };
    });

    res.send(page({
      user: req.user, title: 'کۆمپانیاکان', current: '/companies',
      notice: req.query.ok    ? { kind: 'ok',    text: String(req.query.ok) }
            : req.query.error ? { kind: 'error', text: String(req.query.error) }
            : null,
      actions: canWrite(req.user) ? html`<a class="btn" href="/companies/new">کۆمپانیای نوێ</a>` : null,
      body: html`
        ${expiring.length ? html`
          <div class="card">
            <h2>مۆڵەتی بەسەرچوو و نزیک لە بەسەرچوون</h2>
            <div class="table-wrap"><table>
              <thead><tr><th>کۆمپانیا</th><th>بەرواری بەسەرچوون</th></tr></thead>
              <tbody>${expiring.map(c => html`<tr>
                <td><a href="/companies/${c.id}">${c.name}</a></td>
                <td>${expiryPill(c.licence_expires_on)}</td>
              </tr>`)}</tbody>
            </table></div>
          </div>` : ''}

        <div class="card">
          <form method="get" action="/companies" class="row" role="search">
            <input type="search" id="q" name="q" value="${qtext}" autocomplete="off"
                   aria-label="گەڕان لە کۆمپانیاکان" placeholder="ناوی کۆمپانیا، ژمارەی تۆمار یان نوێنەر">
            <button class="btn" type="submit">گەڕان</button>
          </form>
          <div class="hint">بە ناو، ناوی یاسایی، ژمارەی تۆمار، ژمارەی باج یان ناوی نوێنەر.</div>

          ${companies.length === 0
            ? html`<div class="empty">${qtext ? 'هیچ کۆمپانیایەک نەدۆزرایەوە.' : 'هیچ کۆمپانیایەک نییە.'}</div>`
            : html`<div class="table-wrap"><table>
                <thead><tr>
                  <th>ناو</th><th>ژمارەی تۆمار</th><th>دۆخ</th>
                  <th>مۆڵەت</th><th>کتاب</th><th>نوێنەر</th>
                </tr></thead>
                <tbody>${companies.map(c => html`<tr>
                  <td><a href="/companies/${c.id}">${c.name}</a></td>
                  <td class="mono">${ltr(c.registration_no)}</td>
                  <td><span class="pill ${STATUS[c.status]?.[1] ?? 'muted'}">${STATUS[c.status]?.[0] ?? c.status}</span></td>
                  <td>${expiryPill(c.licence_expires_on)}</td>
                  <td>${num(c.doc_count)}</td>
                  <td class="muted">${c.representative ?? '—'}</td>
                </tr>`)}</tbody>
              </table></div>`}
        </div>`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// New and edit
// ---------------------------------------------------------------------------

// Fields in a grid of two. In .row the paired fields shrank to 147-200px while
// the single ones ran 1,048px across (design test, 13 September).
const form = (c, csrf, action) => html`
  <form method="post" action="${action}">
    <input type="hidden" name="_csrf" value="${csrf}">
    <div class="grid cols-2">
      <div class="field">
        <label for="name" class="required">ناوی کۆمپانیا</label>
        <input id="name" name="name" required maxlength="200" value="${c?.name ?? ''}">
      </div>
      <div class="field">
        <label for="legal_name">ناوی یاسایی</label>
        <input id="legal_name" name="legal_name" maxlength="200" value="${c?.legal_name ?? ''}">
      </div>
      <div class="field">
        <label for="registration_no" class="required">ژمارەی تۆمار</label>
        <input id="registration_no" name="registration_no" dir="ltr" required maxlength="40"
               value="${c?.registration_no ?? ''}">
      </div>
      <div class="field">
        <label for="tax_no">ژمارەی باج</label>
        <input id="tax_no" name="tax_no" dir="ltr" maxlength="40" value="${c?.tax_no ?? ''}">
      </div>
      <div class="field">
        <label for="status">دۆخ</label>
        <select id="status" name="status">
          ${Object.entries(STATUS).map(([k, v]) => html`
            <option value="${k}"${(c?.status ?? 'active') === k ? ' selected' : ''}>${v[0]}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="licence_expires_on">بەسەرچوونی مۆڵەت</label>
        ${dateInput({ id: 'licence_expires_on', value: c?.licence_expires_on })}
      </div>
      <div class="field">
        <label for="representative">نوێنەر</label>
        <input id="representative" name="representative" maxlength="160" value="${c?.representative ?? ''}">
      </div>
      <div class="field">
        <label for="phone">تەلەفۆن</label>
        <input id="phone" name="phone" dir="ltr" maxlength="60" value="${c?.phone ?? ''}">
      </div>
      <div class="field">
        <label for="email">ئیمەیڵ</label>
        <input id="email" name="email" type="email" dir="ltr" maxlength="120" value="${c?.email ?? ''}">
      </div>
      <div class="field">
        <label for="capital">سەرمایە</label>
        <input id="capital" name="capital" maxlength="60" value="${c?.capital ?? ''}">
      </div>
    </div>
    <div class="field">
      <label for="address">ناونیشان</label>
      <input id="address" name="address" maxlength="300" value="${c?.address ?? ''}">
    </div>
    <div class="field">
      <label for="note">تێبینی</label>
      <textarea id="note" name="note" rows="3" maxlength="1000">${c?.note ?? ''}</textarea>
    </div>
    <button class="btn" type="submit">پاشەکەوتکردن</button>
  </form>`;

/** The new-company form, empty, or again with what was typed and why it was refused. */
function newCompanyPage(req, res, { values = null, error = null } = {}) {
  res.status(error ? 400 : 200).send(page({
    user: req.user, title: 'کۆمپانیای نوێ', current: '/companies',
    notice: error ? { kind: 'error', text: error } : null,
    body: html`<div class="card form">
      ${form(values, res.locals.csrf, '/companies/new')}
    </div>`,
  }));
}

router.get('/companies/new', requireAuth, requireRole(...WRITERS), (req, res) => newCompanyPage(req, res));

/** The columns a form may set, read out of the body in one place. */
// What the database refuses that a person can fix: a required field left empty
// (23502), a check (23514), a date or status it cannot read (22007, 22008, 22P02).
// A request that skipped the browser's own checks got the error page for these
// (security test, 13 September).
const FIXABLE = new Set(['23502', '23514', '22007', '22008', '22P02', '22001']);
const MISSING = f => (!f.name || !f.registration_no) ? 'ناوی کۆمپانیا و ژمارەی تۆمار پێویستن.'
  : f.badDay ? `بەرواری بەسەرچوونی مۆڵەت دروست نییە. ${DAY_FORMAT}` : null;

function fieldsFrom(body) {
  const t = v => (v ?? '').toString().trim() || null;
  // A licence date that could not be read refuses the form with the reason and
  // keeps what was typed in the box, rather than saving with the date dropped.
  const day = readDay(body.licence_expires_on);
  return {
    name: t(body.name),
    legal_name: t(body.legal_name),
    // Identifiers in Latin digits and addresses in lower case, which is what the
    // table's checks accept: ٢٠٢٤ typed on a Kurdish keyboard, or SALES@ASO.COM,
    // was refused as the error page (records test, 13 September).
    registration_no: t(foldDigits(String(body.registration_no ?? ''))),
    tax_no: t(foldDigits(String(body.tax_no ?? ''))),
    status: STATUS[body.status] ? body.status : 'active',
    licence_expires_on: day === null ? String(body.licence_expires_on) : day || null,
    badDay: day === null,
    representative: t(body.representative),
    phone: t(foldDigits(String(body.phone ?? ''))),
    email: t(String(body.email ?? '').toLowerCase()),
    capital: t(body.capital),
    address: t(body.address),
    note: t(body.note),
  };
}

router.post('/companies/new', requireAuth, requireRole(...WRITERS), async (req, res, next) => {
  const f = fieldsFrom(req.body);
  if (MISSING(f)) return newCompanyPage(req, res, { values: f, error: MISSING(f) });
  try {
    const id = await withActor(req.user, async q => {
      const { rows: [c] } = await q(`
        INSERT INTO company (name, legal_name, registration_no, tax_no, status,
                             licence_expires_on, representative, phone, email,
                             capital, address, note, created_by)
        VALUES ($1,$2,$3,$4,$5::company_status,$6::date,$7,$8,$9,$10,$11,$12,$13)
        RETURNING id`,
        [f.name, f.legal_name, f.registration_no, f.tax_no, f.status, f.licence_expires_on,
         f.representative, f.phone, f.email, f.capital, f.address, f.note, req.user.id]);
      await logEvent(q, {
        action: 'company.created', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { company_id: c.id, registration_no: f.registration_no },
      });
      return c.id;
    });
    res.redirect(303, `/companies/${id}?ok=${encodeURIComponent('زیادکرا.')}`);
  } catch (err) {
    // A duplicate registration number is the common mistake and is worth saying
    // plainly, because it usually means the company is already on file.
    if (err.code === '23505') return newCompanyPage(req, res, { values: f, error: 'ئەم ژمارەی تۆمارە پێشتر هەیە.' });
    if (FIXABLE.has(err.code)) return newCompanyPage(req, res, { values: f, error: 'هەندێک خانە شێوەیان هەڵەیە: ژمارەی تۆمار، ئیمەیڵ یان بەروار.' });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// One company
// ---------------------------------------------------------------------------

router.get('/companies/:id(\\d+)', requireAuth, requireRole(...READERS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const data = await withActor(req.user, async q => {
      const { rows: [c] } = await q(`
        SELECT c.*, cb.full_name AS created_by_name
          FROM company c LEFT JOIN app_user cb ON cb.id = c.created_by
         WHERE c.id = $1`, [id]);
      if (!c) return null;

      // Letters the reader is allowed to see. Row-level security decides that,
      // not this query, so a room head sees their own and the mayor sees all.
      const { rows: docs } = await q(`
        SELECT d.id, d.incoming_no, d.barcode, d.subject, d.status, d.incoming_date,
               r.name AS current_room_name, cd.linked_at
          FROM company_document cd
          JOIN document d ON d.id = cd.document_id
          LEFT JOIN room r ON r.id = d.current_room_id
         WHERE cd.company_id = $1
         ORDER BY d.incoming_year DESC, d.incoming_seq DESC
         LIMIT 200`, [id]);

      const { rows: files } = await q(`
        SELECT f.*, u.full_name AS uploaded_by_name
          FROM company_file f LEFT JOIN app_user u ON u.id = f.uploaded_by
         WHERE f.company_id = $1 AND f.is_active
         ORDER BY f.uploaded_at DESC`, [id]);

      await logEvent(q, {
        action: 'company.viewed', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { company_id: id },
      });

      return { c, docs, files };
    });
    if (!data) return notFound(req, res, 'ئەم کۆمپانیایە نەدۆزرایەوە.');
    const { c, docs, files } = data;

    res.send(page({
      user: req.user, title: c.name, current: '/companies',
      notice: req.query.ok    ? { kind: 'ok',    text: String(req.query.ok) }
            : req.query.error ? { kind: 'error', text: String(req.query.error) }
            : null,
      actions: canWrite(req.user) ? html`<a class="btn secondary" href="/companies/${c.id}/edit">دەستکاریکردن</a>` : null,
      // The name is the page's title, so the card does not repeat it as a
      // heading. It is the first line of the table instead, where a long name
      // cut short in the top bar can still be read in full.
      body: html`
        <div class="card">
          <h2>زانیارییەکانی کۆمپانیا</h2>
          <div class="table-wrap kv"><table><tbody>
            <tr><th>ناو</th><td>${c.name}</td></tr>
            ${c.legal_name ? html`<tr><th>ناوی یاسایی</th><td>${c.legal_name}</td></tr>` : ''}
            <tr><th>دۆخ</th><td><span class="pill ${STATUS[c.status]?.[1] ?? 'muted'}">${STATUS[c.status]?.[0] ?? c.status}</span></td></tr>
            <tr><th>ژمارەی تۆمار</th><td class="mono">${ltr(c.registration_no)}</td></tr>
            ${c.tax_no ? html`<tr><th>ژمارەی باج</th><td class="mono">${ltr(c.tax_no)}</td></tr>` : ''}
            <tr><th>بەسەرچوونی مۆڵەت</th><td>${c.licence_expires_on ? expiryPill(c.licence_expires_on) : '—'}</td></tr>
            ${c.representative ? html`<tr><th>نوێنەر</th><td>${c.representative}</td></tr>` : ''}
            ${c.phone ? html`<tr><th>تەلەفۆن</th><td>${ltr(c.phone)}</td></tr>` : ''}
            ${c.email ? html`<tr><th>ئیمەیڵ</th><td>${ltr(c.email)}</td></tr>` : ''}
            ${c.capital ? html`<tr><th>سەرمایە</th><td>${c.capital}</td></tr>` : ''}
            ${c.address ? html`<tr><th>ناونیشان</th><td>${c.address}</td></tr>` : ''}
            ${c.note ? html`<tr><th>تێبینی</th><td>${c.note}</td></tr>` : ''}
          </tbody></table></div>
        </div>

        <div class="card">
          <h2>کتابەکانی ئەم کۆمپانیایە <span class="pill muted">${num(docs.length)}</span></h2>
          <p class="card-sub">تەنها ئەو کتابانە دەردەکەون کە دەستت پێیان دەگات.</p>
          ${docs.length === 0
            ? html`<div class="empty compact">هیچ کتابێک نییە.</div>`
            : html`<div class="table-wrap"><table>
                <thead><tr><th>ژمارە</th><th>بابەت</th><th>بەروار</th><th>ئێستا لای</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
                <tbody>${docs.map(d => html`<tr>
                  <td class="mono">${ltr(d.incoming_no)}</td>
                  <td><a href="/documents/${d.id}">${d.subject}</a></td>
                  <td class="muted">${date(d.incoming_date)}</td>
                  <td class="muted">${d.current_room_name ?? '—'}</td>
                  <td>${canWrite(req.user) ? html`
                    <form method="post" action="/companies/${c.id}/unlink" style="display:inline">
                      <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                      <input type="hidden" name="document_id" value="${d.id}">
                      <button class="btn small danger-outline" type="submit">لابردن</button>
                    </form>` : ''}</td>
                </tr>`)}</tbody>
              </table></div>`}

          ${canWrite(req.user) ? html`
            <form method="post" action="/companies/${c.id}/link" class="row" style="margin-top:14px">
              <input type="hidden" name="_csrf" value="${res.locals.csrf}">
              <input id="link_no" name="reference" type="text" dir="ltr" placeholder="ه/2026/25" required
                     aria-label="ژمارە یان بارکۆدی کتاب">
              <button class="btn" type="submit">بەستنەوە</button>
            </form>
            <div class="hint">بەستنەوەی کتابێک بەم کۆمپانیایەوە، بە ژمارەی کتاب یان بارکۆدەکەی.</div>` : ''}
        </div>

        <div class="card">
          <h2>پەڕگەکانی کۆمپانیا</h2>
          ${files.length === 0
            ? html`<div class="empty compact">هیچ پەڕگەیەک نییە.</div>`
            : html`<div class="table-wrap"><table>
                <thead><tr><th>ناونیشان</th><th>جۆر</th><th>بەسەرچوون</th><th>قەبارە</th><th>بەروار</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
                <tbody>${files.map(f => html`<tr>
                  <td>${f.title}</td>
                  <td class="muted">${f.category ?? '—'}</td>
                  <td>${f.valid_until ? expiryPill(f.valid_until) : '—'}</td>
                  <td class="muted">${num(Math.max(1, Math.round(Number(f.size_bytes) / 1024)))} کیلۆبایت</td>
                  <td class="muted">${date(f.uploaded_at)}${f.uploaded_by_name ? html`<span class="cell-sub">${f.uploaded_by_name}</span>` : ''}</td>
                  <td><a class="btn small secondary" href="/companies/files/${f.id}" target="_blank">کردنەوە</a></td>
                </tr>`)}</tbody>
              </table></div>`}

          ${canWrite(req.user) ? html`
            <form method="post" action="/companies/${c.id}/files" enctype="multipart/form-data" style="margin-top:14px">
              <input type="hidden" name="_csrf" value="${res.locals.csrf}">
              <div class="grid cols-2">
                <div class="field">
                  <label for="title" class="required">ناونیشان</label>
                  <input id="title" name="title" required maxlength="200">
                </div>
                <div class="field">
                  <label for="category">جۆر</label>
                  <select id="category" name="category">
                    ${FILE_CATEGORIES.map(k => html`<option value="${k}">${k}</option>`)}
                  </select>
                </div>
                <div class="field">
                  <label for="valid_until">بەسەرچوون</label>
                  ${dateInput({ id: 'valid_until' })}
                </div>
                <div class="field">
                  <label for="file" class="required">پەڕگە</label>
                  <input id="file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" required>
                </div>
              </div>
              <button class="btn" type="submit">زیادکردن</button>
            </form>` : ''}
        </div>`,
    }));
  } catch (err) { next(err); }
});

router.get('/companies/:id(\\d+)/edit', requireAuth, requireRole(...WRITERS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const c = await withActor(req.user, async q => {
      const { rows } = await q(`SELECT * FROM company WHERE id = $1`, [id]);
      return rows[0] ?? null;
    });
    if (!c) return notFound(req, res, 'ئەم کۆمپانیایە نەدۆزرایەوە.');
    res.send(page({
      user: req.user, title: `دەستکاری ${c.name}`, current: '/companies',
      // The reason an edit was refused. It redirected here with ?error= and the
      // page never showed it, so the fields just quietly went back (records test).
      notice: req.query.error ? { kind: 'error', text: String(req.query.error) } : null,
      body: html`<div class="card form">
        ${form(c, res.locals.csrf, `/companies/${c.id}/edit`)}
      </div>`,
    }));
  } catch (err) { next(err); }
});

router.post('/companies/:id(\\d+)/edit', requireAuth, requireRole(...WRITERS), async (req, res, next) => {
  const id = Number(req.params.id);
  const f = fieldsFrom(req.body);
  if (MISSING(f)) return res.redirect(303, `/companies/${id}/edit?error=${encodeURIComponent(MISSING(f))}`);
  try {
    await withActor(req.user, async q => {
      await q(`
        UPDATE company
           SET name = $2, legal_name = $3, registration_no = $4, tax_no = $5,
               status = $6::company_status, licence_expires_on = $7::date,
               representative = $8, phone = $9, email = $10, capital = $11,
               address = $12, note = $13, updated_by = $14, updated_at = now()
         WHERE id = $1`,
        [id, f.name, f.legal_name, f.registration_no, f.tax_no, f.status, f.licence_expires_on,
         f.representative, f.phone, f.email, f.capital, f.address, f.note, req.user.id]);
      await logEvent(q, {
        action: 'company.updated', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { company_id: id },
      });
    });
    res.redirect(303, `/companies/${id}?ok=${encodeURIComponent('پاشەکەوتکرا.')}`);
  } catch (err) {
    if (err.code === '23505') {
      return res.redirect(303, `/companies/${id}/edit?error=${encodeURIComponent('ئەم ژمارەی تۆمارە بۆ کۆمپانیایەکی تر هەیە.')}`);
    }
    if (FIXABLE.has(err.code)) {
      return res.redirect(303, `/companies/${id}/edit?error=${encodeURIComponent('زانیارییەکان تەواو نین یان شێوەیان هەڵەیە.')}`);
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Linking letters
// ---------------------------------------------------------------------------

router.post('/companies/:id(\\d+)/link', requireAuth, requireRole(...WRITERS), async (req, res, next) => {
  const id = Number(req.params.id);
  const ref = (req.body.reference ?? '').toString().trim();
  try {
    const outcome = await withActor(req.user, async q => {
      // A barcode or a document number. Both are offered because both are on the
      // paper in front of whoever is doing this.
      const rows = await findByReference(q, ref);

      if (rows.length !== 1) return { ok: false };

      await q(`INSERT INTO company_document (company_id, document_id, linked_by)
               VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, rows[0].id, req.user.id]);
      await logEvent(q, {
        action: 'company.linked', req, userId: req.user.id, roomId: req.user.roomId,
        documentId: rows[0].id, detail: { company_id: id },
      });
      return { ok: true };
    });

    res.redirect(303, outcome.ok
      ? `/companies/${id}?ok=${encodeURIComponent('کتابەکە بەسترایەوە.')}`
      : `/companies/${id}?error=${encodeURIComponent('کتابێک بەم ژمارەیە نەدۆزرایەوە، یان دەستت پێی ناگات.')}`);
  } catch (err) { next(err); }
});

router.post('/companies/:id(\\d+)/unlink', requireAuth, requireRole(...WRITERS), async (req, res, next) => {
  const id = Number(req.params.id);
  const documentId = Number(req.body.document_id);
  try {
    await withActor(req.user, async q => {
      await q(`DELETE FROM company_document WHERE company_id = $1 AND document_id = $2`, [id, documentId]);
      await logEvent(q, {
        action: 'company.unlinked', req, userId: req.user.id, roomId: req.user.roomId,
        documentId, detail: { company_id: id },
      });
    });
    res.redirect(303, `/companies/${id}?ok=${encodeURIComponent('بەستنەوەکە لابرا.')}`);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Company files
// ---------------------------------------------------------------------------

router.post('/companies/:id(\\d+)/files', requireAuth, requireRole(...WRITERS), async (req, res, next) => {
  const id = Number(req.params.id);
  const back = msg => res.redirect(303, `/companies/${id}?error=${encodeURIComponent(msg)}`);
  let upload;

  try {
    upload = await receiveUpload(req, {
      area: 'files',
      allow: ['pdf', 'png', 'jpg', 'tif'],
      maxFiles: 1,
      actor: req.user,
    });
  } catch (err) {
    if (err instanceof UploadError) return back(err.message);
    return next(err);
  }

  const file = upload.files.file;

  try {
    // A multipart body is not parsed by the CSRF middleware, so the token is
    // checked here against the fields busboy produced. Same rule as attachments.
    if (!upload.fields._csrf || upload.fields._csrf !== res.locals.csrf) {
      if (file) await removeStored(file.storedPath).catch(() => {});
      return back('داواکارییەکە ڕەتکرایەوە. دووبارە هەوڵبدەوە.');
    }
    if (!file) return back('هیچ پەڕگەیەک نەنێردرا.');
    const validUntil = readDay(upload.fields.valid_until);
    if (validUntil === null) {
      await removeStored(file.storedPath).catch(() => {});
      return back(`بەرواری بەسەرچوون دروست نییە. ${DAY_FORMAT}`);
    }

    // Same rule as every other upload: a scan that did not happen is not a
    // clean scan. When the scanner is required and absent, the bytes go.
    const verdict = await scanFile(file.storedPath, req.user);
    if (verdict === 'infected' || (verdict === 'error' && scanFailClosed())) {
      await removeStored(file.storedPath);
      await withActor(req.user, q => logEvent(q, {
        action: 'attachment.rejected_virus', req, userId: req.user.id,
        detail: { company_id: id, virus_scan: verdict },
      }));
      return back(verdict === 'infected' ? 'پەڕگەکە ڤایرۆسی تێدایە.' : 'پشکنینی ڤایرۆس سەرکەوتوو نەبوو.');
    }

    const t = v => (v ?? '').toString().trim() || null;
    await withActor(req.user, async q => {
      const { rows: [f] } = await q(`
        INSERT INTO company_file (company_id, title, category, valid_until, original_name,
                                  stored_path, mime_type, size_bytes, sha256,
                                  virus_scanned_at, uploaded_by)
        VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [id, t(upload.fields.title) ?? file.originalName, t(upload.fields.category),
         validUntil || null, file.originalName, file.storedPath,
         MIME_BY_EXT[file.type] ?? 'application/octet-stream', file.sizeBytes, file.sha256,
         verdict === 'clean' ? new Date() : null, req.user.id]);
      await logEvent(q, {
        action: 'company.file_added', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { company_id: id, file_id: f.id, virus_scan: verdict },
      });
    });

    res.redirect(303, `/companies/${id}?ok=${encodeURIComponent('پەڕگەکە زیادکرا.')}`);
  } catch (err) {
    if (file) await removeStored(file.storedPath).catch(() => {});
    if (err.code === '42501') return refused(req, res);
    next(err);
  }
});

router.get('/companies/files/:id(\\d+)', requireAuth, requireRole(...READERS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const f = await withActor(req.user, async q => {
      const { rows } = await q(`SELECT * FROM company_file WHERE id = $1 AND is_active`, [id]);
      return rows[0] ?? null;
    });
    if (!f) return notFound(req, res, 'ئەم پەڕگەیە نەدۆزرایەوە.');

    res.setHeader('Content-Type', f.mime_type);
    res.setHeader('Content-Length', String(f.size_bytes));
    // inline, and the filename quoted through RFC 5987 so a Kurdish name
    // survives the header intact.
    res.setHeader('Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);

    const stream = readStream(f.stored_path, req.user);
    stream.on('error', next);
    stream.pipe(res);
  } catch (err) { next(err); }
});

export default router;
