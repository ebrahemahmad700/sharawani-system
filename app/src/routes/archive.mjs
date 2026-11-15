// The drawing archive (ئەرشیفی نەخشە), rooms 8 and 9.
//
// Screen: design/Archive.dc.html.
//
// A plot must be findable two ways: on the screen, and on the shelf. So every
// record carries both a search key and a physical location, and the result table
// always shows the shelf column. A drawing the system knows about but cannot
// point to on a shelf is only half catalogued.
//
// A record here IS a file. The schema insists on it: a stored path, a size, a
// hash, and a verifier who is a different person from the uploader. A drawing
// in DWG form must have a PDF alongside it before it can be verified, because a
// browser cannot show a DWG and a verifier has to see what they are verifying.
// PLAN.md section 7.3 chose that rule for version one.
//
// Since migration 0600 every room has its own archive. A record belongs to one
// room; that room's people read and add to it, and the mayor and deputy see
// every room's. The database decides (archive_select), so every query here is
// already limited to the rooms this person may look into, and the room filter
// on the screen only narrows that further. A plot number is required in the base
// map rooms, whose archive is drawings, and optional everywhere else, whose
// archive is folders.
//
// Files can be lent out of an archive and are recorded when they come back
// (archive_loan). A file is out to one person at a time.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent, logSearch } from '../lib/log.mjs';
import { receiveUpload, readStream, scanFile, scanFailClosed, removeStored, fileExists, UploadError, MAX_BYTES, MIME } from '../lib/files.mjs';
import { kuNormalize, plotKey, unifyDigits, foldDigits } from '../lib/ku.mjs';
import { page } from '../views/layout.mjs';
import { html, num, date, ltr, ltrText, ident } from '../lib/html.mjs';
import { notFound } from '../lib/respond.mjs';
import { toCsv, sendCsv, isoDate } from '../lib/csv.mjs';

const router = Router();

// Everyone who belongs to a room. IT is the one role with no archive.
const ARCHIVE_ROLES = ['mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'room_clerk',
                       'registry_clerk', 'archive_clerk', 'hr'];
// The same people may add to and correct their own room's archive; which room is
// decided by the database, not by this list.
const EDIT_ROLES = ARCHIVE_ROLES;
const ALL_ROOMS = ['mayor', 'deputy_mayor'];

/**
 * The rooms whose archive this person may open, for the filter and the form.
 * The mayor and deputy see every room; everyone else the rooms app_visible_rooms()
 * gives them, which is their own plus any they cover or oversee.
 */
async function archiveRooms(q, user) {
  const { rows } = await q(ALL_ROOMS.includes(user.role)
    ? `SELECT id, name, room_number, kind FROM room WHERE is_active ORDER BY sort_order, name`
    : `SELECT id, name, room_number, kind FROM room
        WHERE is_active AND id = ANY (app_visible_rooms()) ORDER BY sort_order, name`);
  return rows;
}

const roomLabel = r => r ? `${r.name}${r.room_number ? ` (${num(r.room_number)})` : ''}` : '';

/**
 * Which room the screen is showing: the one asked for, if it is one this person
 * may open; otherwise their own room; otherwise (the mayor, or somebody whose
 * own room is not in the list) every room they may open.
 */
function pickRoom(rooms, asked, user) {
  if (asked === 'all') return null;
  const want = Number(asked);
  if (want && rooms.some(r => Number(r.id) === want)) return want;
  if (ALL_ROOMS.includes(user.role) && !asked) return null;
  if (user.roomId && rooms.some(r => Number(r.id) === Number(user.roomId))) return Number(user.roomId);
  return null;
}

const plusDays = n => isoDate(new Date(Date.now() + n * 86400000));
// Lateness is worked out by the database (due_on < current_date, in the
// building's time zone), never by comparing dates in JavaScript, where a date
// column arrives as midnight in whatever zone the server happens to run in.
const loanLate = l => Boolean(l && !l.returned_at && l.late);

/** The open loan on each record, if any, for the list. */
const OPEN_LOAN_SQL = `
  LEFT JOIN LATERAL (SELECT l.borrower_name, l.due_on, (l.due_on < current_date) AS late
                       FROM archive_loan l
                      WHERE l.archive_file_id = a.id AND l.returned_at IS NULL) ol ON true`;


/**
 * Archive search, ranked in tiers:
 *   100  exact plot key
 *    90  plot key prefix (typing 247 shows 247/5 and 247/6)
 *    70  the words appear in the record
 *    50  fuzzy match on the record
 */
async function searchArchive(q, { text, byUser, req, roomId = null, limit = 60 }) {
  const started = Date.now();
  const raw = String(text ?? '').trim();
  const norm = kuNormalize(raw);
  const pkey = plotKey(raw);

  let rows;
  if (!norm) {
    ({ rows } = await q(`
      SELECT a.*, u.full_name AS uploaded_by_name, rm.name AS room_name, rm.room_number,
             ol.borrower_name AS loan_to, ol.due_on AS loan_due, ol.late AS loan_late, 0 AS tier
        FROM archive_file a LEFT JOIN app_user u ON u.id = a.uploaded_by
        JOIN room rm ON rm.id = a.room_id
        ${OPEN_LOAN_SQL}
       WHERE a.is_active AND ($2::bigint IS NULL OR a.room_id = $2::bigint)
       ORDER BY a.uploaded_at DESC LIMIT $1`, [limit, roomId]));
  } else {
    ({ rows } = await q(`
      SELECT a.*, u.full_name AS uploaded_by_name, rm.name AS room_name, rm.room_number,
             ol.borrower_name AS loan_to, ol.due_on AS loan_due, ol.late AS loan_late, x.tier
        FROM archive_file a
        LEFT JOIN app_user u ON u.id = a.uploaded_by
        JOIN room rm ON rm.id = a.room_id
        ${OPEN_LOAN_SQL}
        JOIN LATERAL (SELECT CASE
             WHEN $2::text IS NOT NULL AND a.plot_key = $2::text                   THEN 100
             WHEN $2::text IS NOT NULL AND a.plot_key LIKE $2::text || '/%'        THEN 90
             WHEN a.search_blob LIKE '%' || $1 || '%'                             THEN 70
             -- Fuzzy matching runs against the per-field columns, not only the
             -- blob. The blob holds title, owner, neighbourhood, plot, block,
             -- folder and file name together, so a short query such as a name
             -- with its vowels dropped shares too few trigrams with the whole
             -- to clear the threshold, while against the owner column alone it
             -- clears it easily.
             --
             -- Measured on the fixture "سەلام حەسەن" searched as "سلام حسن" (both
             -- vowels dropped, the commonest Arabic-keyboard habit):
             --   similarity against owner_search   0.235   just under the 0.25 threshold
             --   similarity against search_blob    0.053   diluted by the other fields
             --   word_similarity against owner     0.333   clears comfortably
             -- word_similarity scores the best-matching substring, which is the
             -- right question when a short name is typed against a longer field.
             -- The threshold is written here rather than read from the server
             -- setting, so the behaviour cannot change under a reconfiguration.
             WHEN word_similarity($1, coalesce(a.owner_search, ''))         >= 0.3
               OR word_similarity($1, coalesce(a.neighbourhood_search, '')) >= 0.3
               OR a.search_blob % $1                                        THEN 50
             ELSE 0 END AS tier) x ON x.tier > 0
       WHERE a.is_active AND ($4::bigint IS NULL OR a.room_id = $4::bigint)
       ORDER BY x.tier DESC,
                greatest(similarity(a.search_blob, $1),
                         word_similarity($1, coalesce(a.owner_search, '')),
                         word_similarity($1, coalesce(a.neighbourhood_search, ''))) DESC,
                a.plot_key
       LIMIT $3`, [norm, pkey, limit, roomId]));
  }

  await logSearch(q, {
    area: 'archive', raw, normalised: norm, hits: rows.length,
    ms: Date.now() - started, userId: byUser.id, roomId: byUser.roomId, req,
  });
  return rows;
}

const location = a => [
  a.shelf && `ڕەف ${unifyDigits(a.shelf)}`, a.section && `بەش ${unifyDigits(a.section)}`,
  a.box_no && `سندوق ${unifyDigits(a.box_no)}`, a.folder_no && `دۆسیە ${unifyDigits(a.folder_no)}`,
].filter(Boolean).join(' · ') || '—';

router.get('/archive', requireAuth, requireRole(...ARCHIVE_ROLES), async (req, res, next) => {
  try {
    const qtext = String(req.query.q ?? '');
    const { rows, rooms, roomId, outLoans } = await withActor(req.user, async q => {
      const rooms = await archiveRooms(q, req.user);
      const roomId = pickRoom(rooms, req.query.room, req.user);
      const rows = await searchArchive(q, { text: qtext, byUser: req.user, req, roomId });
      // Everything currently lent out of the archive on the screen, overdue first.
      // The question a room head asks on a Thursday: whose desk are our folders on?
      const { rows: outLoans } = await q(`
        SELECT l.id, l.archive_file_id, l.borrower_name, l.due_on, l.lent_at,
               (l.due_on < current_date) AS late, a.title, a.plot_no, br.name AS borrower_room
          FROM archive_loan l
          JOIN archive_file a ON a.id = l.archive_file_id
          LEFT JOIN room br ON br.id = l.borrower_room_id
         WHERE l.returned_at IS NULL AND a.is_active
           AND ($1::bigint IS NULL OR a.room_id = $1::bigint)
         ORDER BY (l.due_on < current_date) DESC, l.due_on
         LIMIT 100`, [roomId]);
      return { rows, rooms, roomId, outLoans };
    });
    const canEdit = EDIT_ROLES.includes(req.user.role) && rooms.length > 0;
    const shown = rooms.find(r => Number(r.id) === roomId) ?? null;
    const lateCount = outLoans.filter(l => l.late).length;
    const roomParam = roomId ? `room=${roomId}` : 'room=all';

    res.send(page({
      user: req.user, title: shown ? `ئەرشیفی ${roomLabel(shown)}` : 'ئەرشیفی هەموو ژوورەکان', current: '/archive',
      notice: req.query.ok ? { kind: 'ok', text: String(req.query.ok) } : null,
      actions: html`
        <a class="btn secondary" href="/archive/export.csv?${roomParam}">داگرتن بۆ Excel</a>
        ${canEdit ? html`<a class="btn" href="/archive/new${roomId ? `?room=${roomId}` : ''}">تۆمارکردنی فایلی نوێ</a>` : ''}`,
      body: html`
        ${outLoans.length ? html`
          <div class="card${lateCount ? ' attention' : ''}">
            <div class="card-head">
              <h2>فایلە دەرچووەکان <span class="pill muted">${num(outLoans.length)}</span></h2>
              ${lateCount ? html`<span class="pill danger">${num(lateCount)} دواکەوتوو</span>` : ''}
            </div>
            <p class="card-sub">ئەو فایلانەی لە ڕەف دەرهێنراون و هێشتا نەگەڕاونەتەوە.</p>
            <div class="table-wrap"><table>
              <thead><tr><th>فایل</th><th>لای</th><th>دراوە</th><th>دەبێت بگەڕێتەوە</th></tr></thead>
              <tbody>${outLoans.map(l => html`<tr>
                <td><a href="/archive/${l.archive_file_id}">${l.title}</a>${l.plot_no ? html`<span class="cell-sub mono">${ident(l.plot_no)}</span>` : ''}</td>
                <td>${l.borrower_name}${l.borrower_room ? html`<span class="cell-sub">${l.borrower_room}</span>` : ''}</td>
                <td class="muted">${date(l.lent_at)}</td>
                <td>${l.late ? html`<span class="pill danger">${date(l.due_on)} — دواکەوتووە</span>` : date(l.due_on)}</td>
              </tr>`)}</tbody>
            </table></div>
          </div>` : ''}

        <div class="card">
          <form method="get" action="/archive" class="row" role="search">
            ${rooms.length > 1 ? html`
              <select name="room" aria-label="ژوور">
                <option value="all"${roomId === null ? ' selected' : ''}>هەموو ژوورەکان</option>
                ${rooms.map(r => html`<option value="${r.id}"${Number(r.id) === roomId ? ' selected' : ''}>${roomLabel(r)}</option>`)}
              </select>` : ''}
            <input type="search" name="q" value="${qtext}" aria-label="گەڕان لە ئەرشیف" autofocus
                   placeholder="ژمارەی پارچە، ناونیشان، گەڕەک، ناوی خاوەن، یان ناوی فایل">
            <button class="btn" type="submit">گەڕان</button>
          </form>
          <div class="hint">
            هەر ژوورێک ئەرشیفی خۆی هەیە و تەنها ئەوەی ژوورەکەی خۆت دەبینیت.
            ٢٤٧/٥ و <span dir="ltr">247-5</span> و «٢٤٧ / ٥» هەمان پارچەن.
          </div>

          ${rooms.length === 0 ? html`<div class="empty">تۆ سەر بە هیچ ژوورێک نیت، بۆیە ئەرشیفت نییە.</div>`
          : qtext && rows.length === 0 ? html`<div class="empty">هیچ فایلێک نەدۆزرایەوە بۆ «${qtext}».</div>`
          : rows.length === 0 ? html`<div class="empty">ئەم ئەرشیفە هێشتا بەتاڵە.</div>`
          : html`<div class="table-wrap"><table>
              <thead><tr>${roomId === null ? html`<th>ژوور</th>` : ''}<th>ناونیشان</th><th>پارچە</th><th>گەڕەک</th><th>خاوەن</th><th>جۆر</th><th>شوێن لەسەر ڕەف</th><th>دۆخ</th></tr></thead>
              <tbody>${rows.map(a => html`<tr>
                ${roomId === null ? html`<td class="muted">${roomLabel({ name: a.room_name, room_number: a.room_number })}</td>` : ''}
                <td><a href="/archive/${a.id}">${a.title}</a>${a.year ? html`<span class="cell-sub">${num(a.year)}</span>` : ''}</td>
                <td class="mono">${a.plot_no ? html`<strong>${ident(a.plot_no)}</strong>` : '—'}${a.block ? html`<span class="cell-sub">بلۆک ${ident(a.block)}</span>` : ''}</td>
                <td>${a.neighbourhood ?? ''}</td>
                <td class="muted">${a.owner_names ?? ''}</td>
                <td><span class="pill ${a.file_type === 'dwg' ? 'info' : 'muted'}">${ltr(a.file_type.toUpperCase())}</span></td>
                <td class="muted">${location(a)}</td>
                <td>${a.verified_at ? html`<span class="pill ok">پشتڕاستکراوە</span>` : html`<span class="pill warn">پشتڕاست نەکراوەتەوە</span>`}
                  ${a.loan_to ? html`<span class="cell-sub"><span class="pill ${a.loan_late ? 'danger' : 'info'}">لای ${a.loan_to}</span></span>` : ''}</td>
              </tr>`)}</tbody>
            </table></div>`}
        </div>`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// One record
// ---------------------------------------------------------------------------

router.get('/archive/:id(\\d+)', requireAuth, requireRole(...ARCHIVE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const found = await withActor(req.user, async q => {
      const { rows: [a] } = await q(`
        SELECT a.*, u.full_name AS uploaded_by_name, v.full_name AS verified_by_name,
               rm.name AS room_name, rm.room_number, rm.kind AS room_kind
          FROM archive_file a
          JOIN room rm ON rm.id = a.room_id
          LEFT JOIN app_user u ON u.id = a.uploaded_by
          LEFT JOIN app_user v ON v.id = a.verified_by
         WHERE a.id = $1`, [id]);
      if (!a) return null;
      await logEvent(q, { action: 'archive.viewed', req, userId: req.user.id, roomId: req.user.roomId, archiveFileId: id });
      const { rows: loans } = await q(`
        SELECT l.*, (l.due_on < current_date) AS late, br.name AS borrower_room,
               lb.full_name AS lent_by_name, rb.full_name AS returned_by_name
          FROM archive_loan l
          LEFT JOIN room br ON br.id = l.borrower_room_id
          LEFT JOIN app_user lb ON lb.id = l.lent_by
          LEFT JOIN app_user rb ON rb.id = l.returned_by
         WHERE l.archive_file_id = $1
         ORDER BY l.lent_at DESC LIMIT 50`, [id]);
      const { rows: rooms } = await q(`SELECT id, name, room_number FROM room WHERE is_active ORDER BY sort_order, name`);
      return { a, loans, rooms };
    });
    if (!found) return notFound(req, res, 'ئەم فایلە نەدۆزرایەوە، یان لە ئەرشیفی ژوورێکی ترە.');
    const { a, loans, rooms } = found;
    const openLoan = loans.find(l => !l.returned_at) ?? null;

    const canEdit = EDIT_ROLES.includes(req.user.role) && a.is_active;
    res.send(page({
      user: req.user, title: a.plot_no ? `پارچە ${ltrText(unifyDigits(a.plot_no))}` : a.title, current: '/archive',
      // Each outcome in its own words: «تۆمارکرا.» only for a map just registered,
      // not for every correction after it (design test, 13 September).
      notice: !a.is_active ? { kind: 'warn', text: 'ئەم تۆمارە کشێنراوەتەوە و لە لیست و گەڕاندا دەرناکەوێت.' }
            : req.query.error ? { kind: 'error', text: String(req.query.error) }
            : req.query.registered ? { kind: 'ok', text: 'تۆمارکرا.' }
            : req.query.verified ? { kind: 'ok', text: 'پشتڕاستکرایەوە.' }
            : req.query.lent ? { kind: 'ok', text: 'دەرچوونی فایلەکە تۆمارکرا.' }
            : req.query.returned ? { kind: 'ok', text: 'گەڕانەوەی فایلەکە تۆمارکرا.' }
            : req.query.saved ? { kind: 'ok', text: 'پاشەکەوتکرا.' } : null,
      body: html`
        <div class="grid cols-2">
          <div>
          <div class="card">
            <h2>${a.title}</h2>
            <div class="table-wrap kv"><table><tbody>
              <tr><th>ئەرشیفی</th><td><a href="/archive?room=${a.room_id}">${roomLabel({ name: a.room_name, room_number: a.room_number })}</a></td></tr>
              <tr><th>پارچە</th><td class="mono">${a.plot_no ? ident(a.plot_no) : '—'}${a.block ? html` — بلۆک ${ident(a.block)}` : ''}</td></tr>
              <tr><th>گەڕەک</th><td>${a.neighbourhood ?? '—'}</td></tr>
              <tr><th>خاوەن</th><td>${a.owner_names ?? '—'}</td></tr>
              <tr><th>ساڵ</th><td>${a.year ? num(a.year) : '—'}</td></tr>
              <tr><th>جۆری فایل</th><td>${ltr(a.file_type.toUpperCase())}${a.original_name ? html` · <span class="mono">${ltr(a.original_name)}</span>` : ''}</td></tr>
              <tr><th>شوێن لەسەر ڕەف</th><td><strong>${location(a)}</strong></td></tr>
              <tr><th>تۆمارکرا</th><td>${a.uploaded_by_name ?? '—'} · ${date(a.uploaded_at)}</td></tr>
              <tr><th>پشتڕاستکردنەوە</th><td>${a.verified_at
                ? html`<span class="pill ok">پشتڕاستکراوە</span> ${a.verified_by_name} · ${date(a.verified_at)}`
                : html`<span class="pill warn">پشتڕاست نەکراوەتەوە</span>`}</td></tr>
            </tbody></table></div>
            <p class="row">
              <a class="btn" href="/archive/${a.id}/download">داگرتنی ${ltr(a.file_type.toUpperCase())}</a>
              ${a.preview_path ? html`<a class="btn secondary" href="/archive/${a.id}/preview" target="_blank">بینینی PDF</a>` : ''}
              <span class="muted">${num(Math.max(1, Math.round(a.size_bytes / 1024)))} کیلۆبایت</span>
            </p>
          </div>

          <div class="card${loanLate(openLoan) ? ' attention' : ''}" id="loan">
            <h2>دەرچوون و گەڕانەوە</h2>
            ${openLoan ? html`
              <div class="notice ${openLoan.late ? 'error' : 'info'}">
                ئەم فایلە ئێستا لای <strong>${openLoan.borrower_name}</strong>ە${openLoan.borrower_room ? html` (${openLoan.borrower_room})` : ''}.
                دراوە ${date(openLoan.lent_at)}، دەبێت ${date(openLoan.due_on)} بگەڕێتەوە${openLoan.late ? html` — <strong>دواکەوتووە</strong>` : ''}.
                ${openLoan.purpose ? html`<div class="muted">بۆ: ${openLoan.purpose}</div>` : ''}
              </div>
              ${canEdit ? html`<form method="post" action="/archive/${a.id}/return">
                <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                <input type="hidden" name="loan_id" value="${openLoan.id}">
                <button class="btn" type="submit">فایلەکە گەڕایەوە بۆ ڕەف</button>
              </form>` : ''}`
            : canEdit ? html`
              <p class="card-sub">کاتێک فایلەکە لە ڕەف دەردەهێنرێت بۆ کەسێک، لێرە بینووسە بۆ ئەوەی بزانرێت لای کێیە.</p>
              <form method="post" action="/archive/${a.id}/lend">
                <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                <div class="grid cols-2">
                  <div class="field"><label for="borrower_name" class="required">بۆ کێ</label>
                    <input id="borrower_name" name="borrower_name" type="text" required minlength="2" maxlength="120"></div>
                  <div class="field"><label for="borrower_room_id">ژوور</label>
                    <select id="borrower_room_id" name="borrower_room_id">
                      <option value="">—</option>
                      ${rooms.map(r => html`<option value="${r.id}">${roomLabel(r)}</option>`)}
                    </select></div>
                  <div class="field"><label for="due_on" class="required">دەبێت بگەڕێتەوە</label>
                    <input id="due_on" name="due_on" type="date" required dir="ltr" value="${plusDays(7)}"></div>
                  <div class="field"><label for="purpose">بۆ چی</label>
                    <input id="purpose" name="purpose" type="text" maxlength="300"></div>
                </div>
                <button class="btn" type="submit">تۆمارکردنی دەرچوون</button>
              </form>`
            : html`<p class="muted">ئەم فایلە لە ڕەفەکەیەتی.</p>`}

            ${loans.some(l => l.returned_at) ? html`
              <details style="margin-top:14px">
                <summary>مێژووی دەرچوون (${num(loans.filter(l => l.returned_at).length)})</summary>
                <div class="table-wrap"><table>
                  <thead><tr><th>لای</th><th>دراوە</th><th>گەڕایەوە</th><th>تۆمارکرا لەلایەن</th></tr></thead>
                  <tbody>${loans.filter(l => l.returned_at).map(l => html`<tr>
                    <td>${l.borrower_name}${l.borrower_room ? html`<span class="cell-sub">${l.borrower_room}</span>` : ''}</td>
                    <td class="muted">${date(l.lent_at)}</td>
                    <td class="muted">${date(l.returned_at)}</td>
                    <td class="muted">${l.lent_by_name ?? '—'}${l.returned_by_name ? html`<span class="cell-sub">${l.returned_by_name}</span>` : ''}</td>
                  </tr>`)}</tbody>
                </table></div>
              </details>` : ''}
          </div>
          </div>

          ${canEdit ? html`<div class="card">
            ${!a.verified_at ? html`
              <h2>پشتڕاستکردنەوە</h2>
              <p class="card-sub">دوای ئەوەی بە دەست چوویتە سەر ڕەفەکە و دڵنیابوویت نەخشەکە لەوێیە.</p>
              ${a.uploaded_by === req.user.id
                ? html`<div class="notice info">ئەوەی بارکردووە ناتوانێت خۆی پشتڕاستی بکاتەوە. کەسێکی تر دەبێت بیکات.</div>`
                : (a.file_type === 'dwg' || a.file_type === 'dxf') && !a.preview_path
                  ? html`<div class="notice warn">ئەم نەخشەیە PDFی لەگەڵ نییە. پێش پشتڕاستکردنەوە PDFیەک باربکە، چونکە بەبێ ئەو کەس ناتوانێت بیبینێت.</div>`
                  : html`<form method="post" action="/archive/${a.id}/verify" style="margin-bottom:22px">
                      <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                      <button class="btn" type="submit">لەسەر ڕەفەکە دۆزیمەوە، پشتڕاستە</button>
                    </form>`}` : ''}
            <!-- A record could never be corrected, given its PDF, or withdrawn: a DWG
                 entered without its PDF could never be verified, and entering it
                 again made a duplicate (records test, 13 September). -->
            ${(a.file_type === 'dwg' || a.file_type === 'dxf' || !a.preview_path) ? html`
              <h2>${a.preview_path ? 'گۆڕینی PDFی لەگەڵ' : 'زیادکردنی PDFی لەگەڵ'}</h2>
              <form method="post" action="/archive/${a.id}/preview" enctype="multipart/form-data" style="margin-bottom:22px">
                <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                <div class="field"><label for="preview_file" class="required">PDF</label>
                  <input id="preview_file" name="preview" type="file" required accept=".pdf" data-max-bytes="${MAX_BYTES}"></div>
                <button class="btn" type="submit">بارکردنی PDF</button>
              </form>` : ''}

            <details style="margin-bottom:22px">
              <summary><strong>چاککردنی زانیارییەکان</strong></summary>
              <form method="post" action="/archive/${a.id}/details" style="margin-top:12px">
                <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                <div class="grid cols-2">
                  <div class="field"><label for="e_plot_no" class="${a.room_kind === 'archive' ? 'required' : ''}">ژمارەی پارچە</label><input id="e_plot_no" name="plot_no" type="text" dir="ltr" ${a.room_kind === 'archive' ? 'required' : ''} maxlength="60" value="${a.plot_no ?? ''}" data-digits></div>
                  <div class="field"><label for="e_block">بلۆک</label><input id="e_block" name="block" type="text" dir="ltr" maxlength="40" value="${a.block ?? ''}" data-digits></div>
                  <div class="field"><label for="e_neighbourhood">گەڕەک</label><input id="e_neighbourhood" name="neighbourhood" type="text" maxlength="120" value="${a.neighbourhood ?? ''}"></div>
                  <div class="field"><label for="e_year">ساڵ</label><input id="e_year" name="year" type="text" inputmode="numeric" dir="ltr" maxlength="4" value="${a.year ?? ''}" data-digits></div>
                </div>
                <div class="field"><label for="e_title" class="required">ناونیشان</label><input id="e_title" name="title" type="text" required minlength="3" maxlength="300" value="${a.title}"></div>
                <div class="field"><label for="e_owner">ناوی خاوەن(ەکان)</label><input id="e_owner" name="owner_names" type="text" maxlength="300" value="${a.owner_names ?? ''}"></div>
                <button class="btn" type="submit">پاشەکەوتکردن</button>
              </form>
            </details>

            <h2>گۆڕینی شوێن</h2>
            <form method="post" action="/archive/${a.id}/location">
              <input type="hidden" name="_csrf" value="${res.locals.csrf}">
              <div class="grid cols-2">
                <div class="field"><label for="shelf" class="required">ڕەف</label><input id="shelf" name="shelf" type="text" required maxlength="40" value="${a.shelf ?? ''}" data-digits></div>
                <div class="field"><label for="section" class="required">بەش</label><input id="section" name="section" type="text" required maxlength="40" value="${a.section ?? ''}" data-digits></div>
                <div class="field"><label for="box_no">سندوق</label><input id="box_no" name="box_no" type="text" maxlength="40" value="${a.box_no ?? ''}" data-digits></div>
                <div class="field"><label for="folder_no" class="required">دۆسیە</label><input id="folder_no" name="folder_no" type="text" required maxlength="40" value="${a.folder_no ?? ''}" data-digits></div>
              </div>
              <button class="btn" type="submit">پاشەکەوتکردن</button>
            </form>

            <details class="danger-zone" style="margin-top:22px">
              <summary>کشاندنەوەی ئەم تۆمارە</summary>
              <form method="post" action="/archive/${a.id}/withdraw" style="margin-top:10px">
                <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                <div class="field"><label for="w_reason" class="required">هۆکار</label>
                  <input id="w_reason" name="reason" type="text" required minlength="3" maxlength="300" placeholder="بۆ نموونە: دووجار تۆمارکرا، تۆماری ژمارە ٢١٩ دروستە"></div>
                <button class="btn danger" type="submit">کشاندنەوە</button>
              </form>
            </details>
          </div>` : ''}
        </div>`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// New record
// ---------------------------------------------------------------------------

function newForm({ user, csrf, error = null, v = {}, rooms = [], roomId = null }) {
  const val = k => v[k] ?? '';
  const chosen = Number(v.room_id) || roomId || Number(user.roomId) || Number(rooms[0]?.id) || null;
  const target = rooms.find(r => Number(r.id) === chosen) ?? rooms[0] ?? null;
  // The base map rooms file by plot; every other room files folders, which may
  // not concern a plot. The server checks the same rule against the room chosen.
  const plotRequired = target?.kind === 'archive';
  return page({
    user, title: 'تۆمارکردنی فایل لە ئەرشیف', current: '/archive',
    notice: error ? { kind: 'error', text: error } : null,
    body: html`<form method="post" action="/archive/new" enctype="multipart/form-data">
      <input type="hidden" name="_csrf" value="${csrf}">
      <div class="card">
        <h2>ئەرشیفی کام ژوور</h2>
        ${rooms.length > 1 ? html`
          <div class="field"><label for="room_id" class="required">ژوور</label>
            <select id="room_id" name="room_id" required>
              ${rooms.map(r => html`<option value="${r.id}"${Number(r.id) === Number(target?.id) ? ' selected' : ''}>${roomLabel(r)}</option>`)}
            </select>
            <div class="hint">فایلەکە دەچێتە ئەرشیفی ئەم ژوورە و تەنها خەڵکی ئەو ژوورە (و سەرۆک و جێگرەکەی) دەیبینن.</div></div>`
        : html`<input type="hidden" name="room_id" value="${target?.id ?? ''}">
          <p class="card-sub">ئەم فایلە دەچێتە ئەرشیفی <strong>${roomLabel(target)}</strong>.</p>`}
      </div>
      <div class="card">
        <h2>زانیاری فایل</h2>
        <!-- Four short fields, then the two long ones. The title spanned two of
             three columns inline, which on a phone made a second, empty column
             and pushed «ساڵ» 16px in from the others (design test). -->
        <div class="grid cols-4">
          <div class="field"><label for="plot_no" class="${plotRequired ? 'required' : ''}">ژمارەی پارچە</label>
            <input id="plot_no" name="plot_no" type="text" dir="ltr" ${plotRequired ? 'required' : ''} maxlength="60" value="${val('plot_no')}" data-digits>
            <div class="hint">وەک ${ltr('247/5')}.${plotRequired ? '' : ' ئەگەر فایلەکە پەیوەندی بە پارچەیەکەوە هەیە.'}</div></div>
          <div class="field"><label for="block">بلۆک</label><input id="block" name="block" type="text" dir="ltr" maxlength="40" value="${val('block')}" data-digits></div>
          <div class="field"><label for="neighbourhood">گەڕەک</label><input id="neighbourhood" name="neighbourhood" type="text" maxlength="120" value="${val('neighbourhood')}"></div>
          <div class="field"><label for="year">ساڵ</label><input id="year" name="year" type="text" inputmode="numeric" dir="ltr" maxlength="4" pattern="[0-9٠-٩۰-۹]{4}" value="${val('year')}" data-digits></div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label for="title" class="required">ناونیشان</label>
            <input id="title" name="title" type="text" required maxlength="300" value="${val('title')}"></div>
          <div class="field"><label for="owner_names">ناوی خاوەن(ەکان)</label><input id="owner_names" name="owner_names" type="text" maxlength="300" value="${val('owner_names')}"></div>
        </div>
      </div>
      <div class="card">
        <h2>شوێن لەسەر ڕەف</h2>
        <p class="card-sub">ئەمە ئەو بەشەیە کە نەخشەکە بە دەست دەدۆزێتەوە. ڕەف، بەش و دۆسیە پێویستن.</p>
        <div class="grid cols-4">
          <div class="field"><label for="shelf" class="required">ڕەف</label><input id="shelf" name="shelf" type="text" required maxlength="40" value="${val('shelf')}" data-digits></div>
          <!-- Required, as the table has always required it. The form left it
               optional, so a drawing entered without a section passed every
               check on the screen, was refused by the database, and the clerk
               saw only the generic error page. Reported from rooms 8 and 9. -->
          <div class="field"><label for="section" class="required">بەش</label><input id="section" name="section" type="text" required maxlength="40" value="${val('section')}" data-digits></div>
          <div class="field"><label for="box_no">سندوق</label><input id="box_no" name="box_no" type="text" maxlength="40" value="${val('box_no')}" data-digits></div>
          <div class="field"><label for="folder_no" class="required">دۆسیە</label><input id="folder_no" name="folder_no" type="text" required maxlength="40" value="${val('folder_no')}" data-digits></div>
        </div>
      </div>
      <!-- Last in the form on purpose. A browser sends the fields in page order,
           and a file refused for what is inside it stopped the upload before the
           typed fields had arrived, so the form came back empty (records test,
           13 September). With the files last, everything typed is already in hand. -->
      <div class="card">
        <h2>فایلەکان</h2>
        <div class="grid cols-2">
          <div class="field"><label for="file" class="required">فایل (سکان یان نەخشە)</label>
            <input id="file" name="file" type="file" required accept=".dwg,.dxf,.pdf,.jpg,.jpeg,.png,.tif,.tiff" data-max-bytes="${MAX_BYTES}">
            <div class="hint">DWG، DXF، PDF، JPG، PNG یان TIF. تا ${num(Math.floor(MAX_BYTES / 1048576))} مێگابایت. جۆرەکە لە ناوەڕۆکی فایلەکەوە دەناسرێتەوە، نەک لە ناوەکەی.</div></div>
          <div class="field"><label for="preview">PDFی لەگەڵ (بۆ DWG و DXF)</label>
            <input id="preview" name="preview" type="file" accept=".pdf" data-max-bytes="${MAX_BYTES}">
            <div class="hint">وێبگەڕ ناتوانێت DWG پیشان بدات. بەبێ PDF، نەخشەکە ناتوانرێت پشتڕاست بکرێتەوە.</div></div>
        </div>
      </div>
      <div class="row">
        <button class="btn" type="submit">تۆمارکردن</button>
        <a class="btn secondary" href="/archive">پاشگەزبوونەوە</a>
      </div>
    </form>`,
  });
}

router.get('/archive/new', requireAuth, requireRole(...EDIT_ROLES), async (req, res, next) => {
  try {
    const rooms = await withActor(req.user, q => archiveRooms(q, req.user));
    if (!rooms.length) return res.redirect(303, '/archive');
    res.send(newForm({ user: req.user, csrf: res.locals.csrf, rooms, roomId: pickRoom(rooms, req.query.room, req.user) }));
  } catch (err) { next(err); }
});

router.post('/archive/new', requireAuth, requireRole(...EDIT_ROLES), async (req, res, next) => {
  let upload;
  try {
    upload = await receiveUpload(req, { area: 'archive', maxFiles: 2, actor: req.user });
  } catch (err) {
    if (err instanceof UploadError) {
      const rooms = await withActor(req.user, q => archiveRooms(q, req.user)).catch(() => []);
      return res.status(400).send(newForm({ user: req.user, csrf: res.locals.csrf, v: err.fields ?? {}, rooms, error: `${err.message} تکایە فایلەکان دووبارە هەڵبژێرەوە.` }));
    }
    return next(err);
  }
  const b = upload.fields;
  const file = upload.files.file;
  const preview = upload.files.preview;
  let rooms = [];
  try { rooms = await withActor(req.user, q => archiveRooms(q, req.user)); } catch { /* the form below still renders */ }
  // Every refusal from here on takes the stored bytes back out. They were written
  // while the form streamed in, and a refused drawing left behind with no record
  // pointing at it is a file nobody can find or delete. A browser forgets chosen
  // files when the form comes back, so the message says to choose them again.
  const bad = async msg => {
    for (const f of Object.values(upload.files)) await removeStored(f.storedPath).catch(() => {});
    return res.status(400).send(newForm({ user: req.user, csrf: res.locals.csrf, v: b, rooms,
      error: `${msg} تکایە فایلەکان دووبارە هەڵبژێرەوە.` }));
  };
  // Identifiers in one kind of digit; see ident() in lib/html.mjs.
  const clean = k => { const x = unifyDigits(String(b[k] ?? '')).trim(); return x || null; };

  try {
    // The CSRF check ran on the urlencoded body, which a multipart request does
    // not have, so it is checked here against the parsed field instead.
    if (!b._csrf || b._csrf !== res.locals.csrf) {
      for (const f of Object.values(upload.files)) await removeStored(f.storedPath).catch(() => {});
      return res.status(403).send(newForm({ user: req.user, csrf: res.locals.csrf, v: b, rooms, error: 'داواکارییەکە ڕەتکرایەوە. دووبارە هەوڵبدەوە.' }));
    }
    if (!file) return bad('فایل پێویستە.');
    // The room comes from the form, and must be one of the rooms this person may
    // open; the database refuses any other too (archive_insert).
    // A room asked for and not in the list is refused, never quietly swapped for
    // the person's own: filing a folder into the wrong room's archive is the one
    // mistake this screen exists to prevent.
    const asked = String(b.room_id ?? '').trim();
    const room = asked ? rooms.find(r => Number(r.id) === Number(asked)) ?? null
                       : (rooms.length === 1 ? rooms[0] : null);
    if (!room) return bad('ژوورێک هەڵبژێرە کە ئەرشیفەکەیت پێدراوە.');
    if (preview && preview.type !== 'pdf') return bad('فایلی لەگەڵ دەبێت PDF بێت.');
    // Everything the table requires, checked here first and named in words.
    const missing = [
      room.kind === 'archive' && !clean('plot_no') && 'ژمارەی پارچە',
      String(b.title ?? '').trim().length < 3 && 'ناونیشان (لانیکەم ٣ پیت)',
      !clean('shelf') && 'ڕەف',
      !clean('section') && 'بەش',
      !clean('folder_no') && 'دۆسیە',
    ].filter(Boolean);
    if (missing.length) return bad(`ئەمانە پێویستن: ${missing.join('، ')}.`);
    // The same bytes already on file: the same drawing entered twice (records test).
    const twin = await withActor(req.user, async q =>
      (await q(`SELECT id, title FROM archive_file WHERE sha256 = $1 AND is_active AND room_id = $2 LIMIT 1`, [file.sha256, room.id])).rows[0]);
    if (twin) return bad(`هەمان فایل پێشتر تۆمارکراوە: «${twin.title}» (تۆماری ${num(twin.id)}).`);
    const year = clean('year');
    if (year && !(/^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 2100)) {
      return bad('ساڵ دەبێت چوار ژمارە بێت، لە نێوان ١٩٠٠ و ٢١٠٠.');
    }

    const scan = await scanFile(file.storedPath, req.user);
    if (scan === 'infected' || (scan === 'error' && scanFailClosed())) {
      // Take the stored bytes back out. A drawing upload can carry two files, so
      // the PDF that came alongside a refused DWG goes with it.
      return bad(scan === 'infected'
        ? 'فایلەکە ڤایرۆسی تێدایە و ڕەتکرایەوە.'
        : 'پشکنینی ڤایرۆس سەرکەوتوو نەبوو. تکایە دواتر هەوڵبدەوە.');
    }

    let id;
    try {
      id = await withActor(req.user, async q => {
        const { rows: [a] } = await q(`
          INSERT INTO archive_file (title, plot_no, block, neighbourhood, owner_names, year, file_type,
                                    original_name, stored_path, preview_path, size_bytes, sha256,
                                    shelf, section, box_no, folder_no, uploaded_by, room_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id, plot_key`,
          [b.title.trim(), clean('plot_no'), clean('block'), b.neighbourhood?.trim() || null, b.owner_names?.trim() || null,
           year ? Number(year) : null, file.type,
           file.originalName, file.storedPath, preview?.storedPath ?? null, file.sizeBytes, file.sha256,
           clean('shelf'), clean('section'), clean('box_no'), clean('folder_no'), req.user.id, room.id]);
        await logEvent(q, { action: 'archive.uploaded', req, userId: req.user.id, roomId: req.user.roomId, archiveFileId: a.id,
          detail: { plot_key: a.plot_key, room_id: room.id, file_type: file.type, size_bytes: file.sizeBytes, sha256: file.sha256,
                    has_preview: !!preview, virus_scan: scan } });
        return a.id;
      });
    } catch (err) {
      // Whatever the table still refuses, a rule this form does not know about or
      // one added later, is said as a sentence and the files are taken back out,
      // instead of the generic error page and bytes nobody can find.
      if (['23502', '23514', '22P02', '22001', '22003', '42501'].includes(err.code)) {
        console.error('[archive] refused by the database:', err.code, err.column ?? err.constraint ?? '');
        return bad(err.code === '42501'
          ? 'ڕێگەت پێنەدراوە لە ئەرشیفی ئەم ژوورەدا فایل تۆمار بکەیت.'
          : 'زانیارییەکان تەواو نین یان شێوەیان هەڵەیە. خانە پێویستەکان بپشکنە.');
      }
      throw err;
    }
    res.redirect(303, `/archive/${id}?registered=1`);
  } catch (err) { next(err); }
});

// Serving files. The path comes from the database row, never from the URL, and
// every download is logged against the record.
async function serve(req, res, next, { preview }) {
  try {
    const id = Number(req.params.id);
    const a = await withActor(req.user, async q => {
      const { rows: [a] } = await q(`SELECT id, original_name, file_type, stored_path, preview_path FROM archive_file WHERE id = $1 AND is_active`, [id]);
      if (a) await logEvent(q, { action: 'archive.downloaded', req, userId: req.user.id, roomId: req.user.roomId, archiveFileId: id, detail: { preview } });
      return a;
    });
    const path = preview ? a?.preview_path : a?.stored_path;
    if (!a || !path || !(await fileExists(path, req.user))) return notFound(req, res);
    const ext = path.split('.').pop();
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const safeName = preview ? a.original_name.replace(/\.[^.]+$/, '') + '.pdf' : a.original_name;
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    readStream(path, req.user).on('error', next).pipe(res);
  } catch (err) { next(err); }
}
router.get('/archive/:id(\\d+)/download', requireAuth, requireRole(...ARCHIVE_ROLES), (req, res, next) => serve(req, res, next, { preview: false }));
router.get('/archive/:id(\\d+)/preview',  requireAuth, requireRole(...ARCHIVE_ROLES), (req, res, next) => serve(req, res, next, { preview: true }));

router.post('/archive/:id(\\d+)/verify', requireAuth, requireRole(...EDIT_ROLES), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    await withActor(req.user, async q => {
      // Only a record in a room this person may open is updated (archive_update),
      // so the log says "verified" only when something actually was.
      const { rowCount } = await q(`UPDATE archive_file SET verified_by = $2, verified_at = now() WHERE id = $1 AND verified_at IS NULL`, [id, req.user.id]);
      if (rowCount) await logEvent(q, { action: 'archive.verified', req, userId: req.user.id, roomId: req.user.roomId, archiveFileId: id });
    });
    // saved=1 stays for anything that reads the redirect; verified=1 picks the words.
    res.redirect(303, `/archive/${id}?saved=1&verified=1`);
  } catch (err) {
    if (err.constraint === 'archive_verifier_differs') return res.redirect(303, `/archive/${id}?error=` + encodeURIComponent('ئەوەی بارکردووە ناتوانێت خۆی پشتڕاستی بکاتەوە.'));
    if (err.constraint === 'archive_dwg_needs_preview') return res.redirect(303, `/archive/${id}?error=` + encodeURIComponent('DWG بەبێ PDF ناتوانرێت پشتڕاست بکرێتەوە.'));
    next(err);
  }
});

router.post('/archive/:id(\\d+)/location', requireAuth, requireRole(...EDIT_ROLES), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const b = req.body;
    const clean = k => { const x = unifyDigits(String(b[k] ?? '')).trim(); return x || null; };
    // The same three the table requires. Emptying one used to reach the database
    // and come back as the generic error page.
    if (!clean('shelf') || !clean('section') || !clean('folder_no')) {
      return res.redirect(303, `/archive/${id}?error=` + encodeURIComponent('ڕەف، بەش و دۆسیە پێویستن.'));
    }
    await withActor(req.user, async q => {
      const { rows: [before] } = await q(`SELECT shelf, section, box_no, folder_no FROM archive_file WHERE id = $1`, [id]);
      const to = { shelf: clean('shelf'), section: clean('section'), box_no: clean('box_no'), folder_no: clean('folder_no') };
      await q(`UPDATE archive_file SET shelf = $2, section = $3, box_no = $4, folder_no = $5 WHERE id = $1`,
              [id, to.shelf, to.section, to.box_no, to.folder_no]);
      await logEvent(q, { action: 'archive.location_changed', req, userId: req.user.id, roomId: req.user.roomId,
        archiveFileId: id, detail: { from: before, to } });
    });
    res.redirect(303, `/archive/${id}?saved=1`);
  } catch (err) { next(err); }
});

// The record's own corrections: its PDF, its details, and withdrawing it. By the
// archive rooms and the mayor's office, as for entering one.
router.post('/archive/:id(\\d+)/preview', requireAuth, requireRole(...EDIT_ROLES), async (req, res, next) => {
  const id = Number(req.params.id);
  let upload;
  try {
    upload = await receiveUpload(req, { area: 'archive', maxFiles: 1, allow: ['pdf'], actor: req.user });
  } catch (err) {
    if (err instanceof UploadError) return res.redirect(303, `/archive/${id}?error=${encodeURIComponent(err.message)}`);
    return next(err);
  }
  const file = upload.files.preview;
  try {
    if (!upload.fields._csrf || upload.fields._csrf !== res.locals.csrf) {
      if (file) await removeStored(file.storedPath).catch(() => {});
      return res.redirect(303, `/archive/${id}?error=${encodeURIComponent('داواکارییەکە ڕەتکرایەوە. دووبارە هەوڵبدەوە.')}`);
    }
    if (!file) return res.redirect(303, `/archive/${id}?error=${encodeURIComponent('PDFێک هەڵبژێرە.')}`);
    const verdict = await scanFile(file.storedPath, req.user);
    if (verdict === 'infected' || (verdict === 'error' && scanFailClosed())) {
      await removeStored(file.storedPath).catch(() => {});
      return res.redirect(303, `/archive/${id}?error=${encodeURIComponent(verdict === 'infected' ? 'فایلەکە ڤایرۆسی تێدایە و ڕەتکرایەوە.' : 'پشکنینی ڤایرۆس سەرکەوتوو نەبوو.')}`);
    }
    const updated = await withActor(req.user, async q => {
      const { rows: [row] } = await q(
        `UPDATE archive_file SET preview_path = $2 WHERE id = $1 AND is_active RETURNING id`, [id, file.storedPath]);
      if (row) await logEvent(q, { action: 'archive.updated', req, userId: req.user.id, roomId: req.user.roomId,
        archiveFileId: id, detail: { field: 'preview', size_bytes: file.sizeBytes, sha256: file.sha256 } });
      return row;
    });
    if (!updated) { await removeStored(file.storedPath).catch(() => {}); return notFound(req, res, 'ئەم نەخشەیە نەدۆزرایەوە.'); }
    res.redirect(303, `/archive/${id}?saved=1`);
  } catch (err) {
    if (file) await removeStored(file.storedPath).catch(() => {});
    next(err);
  }
});

router.post('/archive/:id(\\d+)/details', requireAuth, requireRole(...EDIT_ROLES), async (req, res, next) => {
  const id = Number(req.params.id);
  const b = req.body;
  const clean = k => { const x = unifyDigits(String(b[k] ?? '')).trim(); return x || null; };
  const back = msg => res.redirect(303, `/archive/${id}?error=${encodeURIComponent(msg)}`);
  const title = String(b.title ?? '').trim();
  if (title.length < 3) return back('ناونیشان لانیکەم سێ پیت بێت.');
  const yearText = foldDigits(String(b.year ?? '')).trim();
  const year = yearText ? Number(yearText) : null;
  if (yearText && !(/^\d{4}$/.test(yearText) && year >= 1900 && year <= 2100)) return back('ساڵ دەبێت چوار ژمارە بێت، لە نێوان ١٩٠٠ و ٢١٠٠.');
  try {
    const refused = await withActor(req.user, async q => {
      // A plot number is what a drawing is filed by, so the base map rooms must
      // keep one; a folder in any other room's archive may not have a plot at all.
      const { rows: [f] } = await q(
        `SELECT r.kind FROM archive_file a JOIN room r ON r.id = a.room_id WHERE a.id = $1`, [id]);
      if (f?.kind === 'archive' && !clean('plot_no')) return 'ژمارەی پارچە پێویستە.';
      await q(`UPDATE archive_file SET plot_no = $2, block = $3, neighbourhood = $4, year = $5, title = $6, owner_names = $7
                WHERE id = $1 AND is_active`,
        [id, clean('plot_no'), clean('block'), String(b.neighbourhood ?? '').trim() || null, year, title,
         String(b.owner_names ?? '').trim() || null]);
      await logEvent(q, { action: 'archive.updated', req, userId: req.user.id, roomId: req.user.roomId,
        archiveFileId: id, detail: { field: 'details' } });
      return null;
    });
    if (refused) return back(refused);
    res.redirect(303, `/archive/${id}?saved=1`);
  } catch (err) {
    if (['23514', '22001', '22003'].includes(err.code)) return back('زانیارییەکان شێوەیان هەڵەیە.');
    next(err);
  }
});

router.post('/archive/:id(\\d+)/withdraw', requireAuth, requireRole(...EDIT_ROLES), async (req, res, next) => {
  const id = Number(req.params.id);
  const reason = String(req.body.reason ?? '').trim();
  if (reason.length < 3) return res.redirect(303, `/archive/${id}?error=${encodeURIComponent('هۆکاری کشاندنەوە بنووسە.')}`);
  try {
    await withActor(req.user, async q => {
      const { rowCount } = await q(`UPDATE archive_file SET is_active = false WHERE id = $1 AND is_active`, [id]);
      if (rowCount) await logEvent(q, { action: 'archive.updated', req, userId: req.user.id, roomId: req.user.roomId,
        archiveFileId: id, detail: { field: 'withdrawn', reason_length: reason.length } });
    });
    res.redirect(303, `/archive?ok=${encodeURIComponent('کشێنرایەوە.')}`);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Lending a file out of the archive, and its return (migration 0600)
// ---------------------------------------------------------------------------

router.post('/archive/:id(\\d+)/lend', requireAuth, requireRole(...EDIT_ROLES), async (req, res, next) => {
  const id = Number(req.params.id);
  const b = req.body;
  const back = msg => res.redirect(303, `/archive/${id}?error=${encodeURIComponent(msg)}#loan`);
  const borrower = String(b.borrower_name ?? '').trim();
  const purpose = String(b.purpose ?? '').trim() || null;
  const due = foldDigits(String(b.due_on ?? '')).trim();
  if (borrower.length < 2 || borrower.length > 120) return back('ناوی ئەو کەسەی فایلەکەی پێدەدرێت بنووسە.');
  if (purpose && purpose.length > 300) return back('«بۆ چی» زۆر درێژە.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return back('بەرواری گەڕانەوە بنووسە.');
  try {
    const refused = await withActor(req.user, async q => {
      // Read under the archive's own rule: a file in another room's archive is
      // simply not found, so it cannot be lent from here.
      const { rows: [f] } = await q(`SELECT id FROM archive_file WHERE id = $1 AND is_active`, [id]);
      if (!f) return 'ئەم فایلە نەدۆزرایەوە.';
      const { rows: [ok] } = await q(`SELECT $1::date >= current_date AS ok`, [due]);
      if (!ok?.ok) return 'بەرواری گەڕانەوە نابێت لە ڕابردوودا بێت.';
      const roomId = Number(b.borrower_room_id) || null;
      const { rows: [loan] } = await q(`
        INSERT INTO archive_loan (archive_file_id, borrower_name, borrower_room_id, purpose, due_on, lent_by)
        VALUES ($1, $2, (SELECT id FROM room WHERE id = $3 AND is_active), $4, $5, $6) RETURNING id`,
        [id, borrower, roomId, purpose, due, req.user.id]);
      await logEvent(q, { action: 'archive.lent', req, userId: req.user.id, roomId: req.user.roomId,
        archiveFileId: id, detail: { loan_id: loan.id, due_on: due, borrower_room_id: roomId } });
      return null;
    });
    if (refused) return back(refused);
    res.redirect(303, `/archive/${id}?lent=1#loan`);
  } catch (err) {
    // The unique index on open loans: somebody else lent it a moment ago.
    if (err.constraint === 'ux_archive_loan_open') return back('ئەم فایلە پێشتر دراوە و هێشتا نەگەڕاوەتەوە.');
    if (err.code === '42501') return back('ڕێگەت پێنەدراوە ئەم فایلە بدەیت.');
    if (['23514', '22007', '22008'].includes(err.code)) return back('زانیارییەکان شێوەیان هەڵەیە.');
    next(err);
  }
});

router.post('/archive/:id(\\d+)/return', requireAuth, requireRole(...EDIT_ROLES), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const done = await withActor(req.user, async q => {
      const { rows: [loan] } = await q(`
        UPDATE archive_loan SET returned_at = now(), returned_by = $2
         WHERE archive_file_id = $1 AND returned_at IS NULL
        RETURNING id, (due_on < current_date) AS late`, [id, req.user.id]);
      if (loan) await logEvent(q, { action: 'archive.returned', req, userId: req.user.id, roomId: req.user.roomId,
        archiveFileId: id, detail: { loan_id: loan.id, late: loan.late } });
      return loan;
    });
    if (!done) return res.redirect(303, `/archive/${id}?error=${encodeURIComponent('ئەم فایلە لای کەس نییە.')}#loan`);
    res.redirect(303, `/archive/${id}?returned=1#loan`);
  } catch (err) {
    if (err.code === '42501') return res.redirect(303, `/archive/${id}?error=${encodeURIComponent('ڕێگەت پێنەدراوە.')}#loan`);
    next(err);
  }
});

// ---------------------------------------------------------------------------
// The archive as a spreadsheet
// ---------------------------------------------------------------------------

router.get('/archive/export.csv', requireAuth, requireRole(...ARCHIVE_ROLES), async (req, res, next) => {
  try {
    const { rows, roomId } = await withActor(req.user, async q => {
      const rooms = await archiveRooms(q, req.user);
      const roomId = pickRoom(rooms, req.query.room, req.user);
      // Every row the archive's own rule lets this person see, in the room asked
      // for. Dates as text, so the file says what the screen says.
      const { rows } = await q(`
        SELECT a.id, rm.name AS room_name, rm.room_number, a.title, a.plot_no, a.block, a.neighbourhood,
               a.owner_names, a.year, a.file_type, a.shelf, a.section, a.box_no, a.folder_no,
               to_char(a.uploaded_at AT TIME ZONE 'Asia/Baghdad', 'YYYY-MM-DD') AS uploaded_on,
               u.full_name AS uploaded_by_name,
               to_char(a.verified_at AT TIME ZONE 'Asia/Baghdad', 'YYYY-MM-DD') AS verified_on,
               ol.borrower_name AS loan_to, to_char(ol.due_on, 'YYYY-MM-DD') AS loan_due, ol.late AS loan_late
          FROM archive_file a
          JOIN room rm ON rm.id = a.room_id
          LEFT JOIN app_user u ON u.id = a.uploaded_by
          ${OPEN_LOAN_SQL}
         WHERE a.is_active AND ($1::bigint IS NULL OR a.room_id = $1::bigint)
         ORDER BY rm.sort_order, a.plot_key NULLS LAST, a.id
         LIMIT 20000`, [roomId]);
      await logEvent(q, { action: 'export.archive', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { room_id: roomId, rows: rows.length } });
      return { rows, roomId };
    });
    const csv = toCsv([
      ['ژمارەی تۆمار', r => r.id],
      ['ژوور', r => r.room_number ? `${r.room_name} (${r.room_number})` : r.room_name],
      ['ناونیشان', r => r.title],
      ['پارچە', r => r.plot_no],
      ['بلۆک', r => r.block],
      ['گەڕەک', r => r.neighbourhood],
      ['خاوەن', r => r.owner_names],
      ['ساڵ', r => r.year],
      ['جۆری فایل', r => String(r.file_type).toUpperCase()],
      ['ڕەف', r => r.shelf],
      ['بەش', r => r.section],
      ['سندوق', r => r.box_no],
      ['دۆسیە', r => r.folder_no],
      ['تۆمارکرا', r => r.uploaded_on],
      ['تۆمارکرا لەلایەن', r => r.uploaded_by_name],
      ['پشتڕاستکرایەوە', r => r.verified_on],
      ['ئێستا لای', r => r.loan_to],
      ['دەبێت بگەڕێتەوە', r => r.loan_due],
      ['دواکەوتووە', r => (r.loan_late ? 'بەڵێ' : '')],
    ], rows);
    sendCsv(res, `archive-${roomId ?? 'all'}-${isoDate(new Date())}.csv`, csv);
  } catch (err) { next(err); }
});

export default router;
