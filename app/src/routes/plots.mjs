// The plot file (فایلی پارچە).
//
// Everything that ever touched one piece of land, on one page.
//
// This is the shape municipal work actually has and the shape nothing in the
// system had until now. A citizen comes to the counter and asks about plot
// 247/5. Today that means searching the letters, then searching the drawing
// archive separately, then asking whoever remembers whether a company was
// involved, and hoping nobody has spelled the number differently. The answer
// exists; it is just spread across four screens and one person's memory.
//
// So: type the number, get the file. Every letter about it in date order, every
// drawing in the archive, every company that appears on any of them, which
// neighbourhood it has been called, and what is happening to it right now.
//
// TWO THINGS WORTH KNOWING
//
// The number is canonicalised before anything is looked up. 247/5, ٢٤٧/٥,
// 247-5 and "247 / 5" are the same piece of land, and plot_key is the column
// that already knows it. A clerk who types the Arabic-Indic form off the paper
// finds the file a colleague registered in Latin digits.
//
// Nothing here does its own permission filtering, and that is deliberate. Every
// query runs through withActor, so row-level security answers as the person
// asking: a room clerk sees the letters their room may see and no others, and
// the count at the top of the page is the count of what they may see, not a
// total that leaks the existence of the rest. IT, which may not read letters at
// all, gets an empty file, which is correct.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { logSearch } from '../lib/log.mjs';
import { plotKey, kuNormalize, unifyDigits } from '../lib/ku.mjs';
import { statusPill } from './registry.mjs';
import { page } from '../views/layout.mjs';
import { refused } from '../lib/respond.mjs';
import { html, num, date, ltr, ident, ltrText } from '../lib/html.mjs';
import { MAP_PLACERS } from './plotmap.mjs';

const router = Router();

// IT is excluded exactly as it is everywhere else: it may run the system and may
// not read the correspondence. The database would refuse anyway; refusing here
// too means a clear page rather than a confusing empty one.
const READERS = ['mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                 'room_clerk', 'registry_clerk', 'archive_clerk', 'hr'];

/** The letters, drawings and companies for one canonical plot key. */
async function plotFile(q, key) {
  const { rows: documents } = await q(`
    SELECT d.id, d.incoming_no, d.incoming_date, d.subject, d.sender_name, d.sender_kind,
           d.status, d.priority, d.plot_no, d.neighbourhood,
           d.outgoing_no, d.outgoing_date, d.closed_at, d.cancelled_at,
           r.name AS room_name, r.room_number,
           s.due_at, (s.due_at IS NOT NULL AND s.due_at < now() AND s.status = 'active') AS overdue
      FROM document d
      LEFT JOIN room r ON r.id = d.current_room_id
      LEFT JOIN routing_step s ON s.id = d.current_step_id
     WHERE d.plot_key = $1
     ORDER BY d.incoming_date DESC, d.id DESC
     LIMIT 300`, [key]);

  // The drawing archive is a separate table with its own policies, so a room
  // clerk may see letters here and no drawings, or the other way round. Asking
  // for both and letting each answer for itself is the whole point.
  const { rows: drawings } = await q(`
    SELECT id, title, year, plot_no, block, neighbourhood, owner_names,
           file_type, shelf, section, folder_no, box_no, verified_at, uploaded_at
      FROM archive_file
     WHERE plot_key = $1 AND is_active
     ORDER BY year DESC NULLS LAST, id DESC
     LIMIT 200`, [key]);

  const { rows: companies } = await q(`
    SELECT c.id, c.name, c.registration_no, count(*) AS letters
      FROM company_document cd
      JOIN company c ON c.id = cd.company_id
      JOIN document d ON d.id = cd.document_id
     WHERE d.plot_key = $1
     GROUP BY c.id, c.name, c.registration_no
     ORDER BY count(*) DESC, c.name_sort
     LIMIT 50`, [key]);

  // Where it is, when somebody has put it on the map (migration 0560).
  const { rows: [location] } = await q(
    `SELECT lat, lng, outline IS NOT NULL AS has_outline, placed_at, updated_at FROM plot_location WHERE plot_key = $1`, [key]);

  return { documents, drawings, companies, location: location ?? null };
}

/**
 * One list of dated events, newest first.
 *
 * A letter arriving, a letter being answered, a drawing being filed. Shown as a
 * single run because that is how somebody at the counter thinks about a plot:
 * not "the letters, and separately the drawings", but "what has happened here".
 */
function timeline({ documents, drawings }) {
  const events = [];
  for (const d of documents) {
    events.push({
      when: d.incoming_date, kind: 'in', doc: d,
      text: d.subject, who: d.sender_name,
    });
    if (d.outgoing_date) {
      events.push({
        when: d.outgoing_date, kind: 'out', doc: d,
        text: `وەڵام درایەوە بە ژمارەی ${ltrText(d.outgoing_no)}`, who: null,
      });
    }
    if (d.cancelled_at) {
      events.push({ when: d.cancelled_at, kind: 'cancelled', doc: d, text: 'هەڵوەشێنرایەوە', who: null });
    }
  }
  for (const a of drawings) {
    // A drawing's year is the year of the plan, which is what matters on a plot
    // file; the date it happened to be scanned is not. Falls back to the upload
    // when a legacy sheet has no year on it.
    events.push({
      when: a.year ? new Date(Date.UTC(a.year, 0, 1)) : a.uploaded_at,
      approximate: Boolean(a.year), kind: 'drawing', file: a,
      text: a.title, who: a.owner_names,
    });
  }
  return events
    .filter(e => e.when)
    .sort((a, b) => new Date(b.when) - new Date(a.when));
}

const EVENT = {
  in:        ['active',  'کتابێک هات'],
  out:       ['done',    'وەڵام نێردرا'],
  cancelled: ['waiting', 'هەڵوەشێنراوە'],
  drawing:   ['done',    'نەخشە'],
};

function searchPage({ user, typed, matches, notice = null }) {
  return page({
    user, title: 'فایلی پارچە', current: '/plots', notice,
    body: html`
      <!-- No heading: the top bar already says فایلی پارچە. -->
      <div class="card">
        <p class="card-sub">
          ژمارەی پارچە بنووسە و هەموو ئەوەی تا ئێستا سەبارەت بەو پارچەیە ڕوویداوە
          لە یەک لاپەڕەدا ببینە: کتابەکان، نەخشەکان و کۆمپانیاکان.
        </p>
        <form method="get" action="/plots" class="row" role="search">
          <input id="p" name="p" type="search" dir="ltr" autofocus maxlength="60"
                 aria-label="ژمارەی پارچە یان ناوی گەڕەک" placeholder="247/5" value="${typed ?? ''}">
          <button class="btn" type="submit">گەڕان</button>
        </form>
        <div class="hint">هەردوو شێوەی ژمارەکان یەک شتن. دەتوانیت ناوی گەڕەکیش بنووسیت.</div>
      </div>

      ${matches === null ? '' : html`
        <div class="card">
          <h2>ئەنجامەکانی گەڕان${matches.length ? html` <span class="pill muted">${num(matches.length)}</span>` : ''}</h2>
          ${matches.length === 0 ? html`<div class="empty">هیچ پارچەیەک نەدۆزرایەوە.</div>` : html`
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>پارچە</th><th>گەڕەک</th><th>کتاب</th><th>کراوە</th><th>دوا جار</th>
              </tr></thead>
              <tbody>
                ${matches.map(m => html`<tr>
                  <td class="mono"><a href="/plots?p=${encodeURIComponent(m.plot_key)}">${ident(m.shown ?? m.plot_key)}</a></td>
                  <td>${m.hood ?? '—'}</td>
                  <td>${num(m.letters)}</td>
                  <td>${Number(m.open) > 0 ? html`<span class="pill warn">${num(m.open)}</span>` : '—'}</td>
                  <td class="muted">${date(m.last_seen)}</td>
                </tr>`)}
              </tbody>
            </table>
          </div>`}
        </div>`}
    `,
  });
}

router.get('/plots', requireAuth, async (req, res, next) => {
  try {
    if (!READERS.includes(req.user.role)) {
      return refused(req, res, 'فایلی پارچە ناوەڕۆکی کتابەکان پیشان دەدات، بۆیە بۆ ئەم هەژمارە کراوە نییە.');
    }

    const typed = (req.query.p ?? '').toString().trim();
    if (!typed) return res.send(searchPage({ user: req.user, typed: '', matches: null }));

    const key = plotKey(typed);
    const started = Date.now();

    const result = await withActor(req.user, async q => {
      // An exact plot key is the common case and goes straight to the file.
      if (key) {
        const file = await plotFile(q, key);
        if (file.documents.length || file.drawings.length) return { kind: 'file', key, file };
      }

      // Otherwise this is a hunt: a partial number, or a neighbourhood name.
      // Both are answered from the same list so that typing "سەرچنار" gives the
      // plots in that neighbourhood rather than nothing.
      const norm = kuNormalize(typed);
      // Drawings as well as letters. A plot known only from its drawings was "no
      // plot found" when typed in part (records test, 13 September).
      const { rows: matches } = await q(`
        WITH seen AS (
          SELECT d.plot_key, d.plot_no, d.neighbourhood, d.neighbourhood_search, d.incoming_date AS on_date,
                 d.id, d.status, 1 AS is_letter
            FROM document d WHERE d.plot_key IS NOT NULL
          UNION ALL
          SELECT a.plot_key, a.plot_no, a.neighbourhood, a.neighbourhood_search, a.uploaded_at::date,
                 a.id, NULL, 0
            FROM archive_file a WHERE a.plot_key IS NOT NULL AND a.is_active
        )
        SELECT d.plot_key,
               count(*) FILTER (WHERE d.is_letter = 1)              AS letters,
               count(*) FILTER (WHERE d.status IN ('registered','in_flow','ready_to_close')) AS open,
               max(d.on_date)                                       AS last_seen,
               (array_agg(d.plot_no ORDER BY d.id DESC))[1]         AS shown,
               (array_agg(d.neighbourhood ORDER BY d.id DESC)
                  FILTER (WHERE d.neighbourhood IS NOT NULL))[1]    AS hood
          FROM seen d
         WHERE ($1::text IS NULL OR d.plot_key LIKE '%' || $1 || '%'
                OR d.neighbourhood_search LIKE '%' || $2 || '%')
         GROUP BY d.plot_key
         ORDER BY max(d.on_date) DESC, max(d.id) DESC
         LIMIT 60`, [key, norm]);

      await logSearch(q, {
        area: 'documents', raw: typed, normalised: norm, hits: matches.length,
        filters: { plot: true }, ms: Date.now() - started, req,
        userId: req.user.id, roomId: req.user.roomId,
      });
      return { kind: 'matches', matches };
    });

    if (result.kind === 'matches') {
      return res.send(searchPage({ user: req.user, typed, matches: result.matches }));
    }

    const { file } = result;
    const { documents, drawings, companies, location } = file;
    const canPlace = MAP_PLACERS.includes(req.user.role);
    const events = timeline(file);

    const shown = unifyDigits(documents[0]?.plot_no ?? drawings[0]?.plot_no ?? result.key);
    const hoods = [...new Set([...documents, ...drawings]
      .map(x => x.neighbourhood).filter(Boolean))];
    const open = documents.filter(d => ['registered', 'in_flow', 'ready_to_close'].includes(d.status));
    const late = documents.filter(d => d.overdue);

    res.send(page({
      user: req.user,
      title: `پارچە ${ltrText(shown)}`,
      current: '/plots',
      actions: html`<a class="btn secondary" href="/plots">پارچەیەکی تر</a>`,
      body: html`
        <!-- The top bar already names the plot; this card is its summary. -->
        <div class="card">
          <div class="card-head">
            <h2>کورتە</h2>
            <div class="end">
              ${late.length ? html`<span class="pill danger">${num(late.length)} دواکەوتوو</span>` : ''}
              ${open.length ? html`<span class="pill warn">${num(open.length)} کراوە</span>` : html`<span class="pill ok">هیچ کتابێکی کراوە نییە</span>`}
            </div>
          </div>
          ${hoods.length ? html`<p class="card-sub">گەڕەک: ${hoods.join(' · ')}</p>` : ''}
          <div class="row plot-location">
            ${location
              ? html`<span class="pill ok">لەسەر نەخشە دیاریکراوە${location.has_outline ? ' بە سنوورەوە' : ''}</span>
                     <a class="btn small secondary" href="/plots/map?p=${encodeURIComponent(shown)}">بینین لەسەر نەخشە</a>
                     ${canPlace ? html`<a class="btn small secondary" href="/plots/map?place=${encodeURIComponent(shown)}">گۆڕینی شوێن</a>` : ''}`
              : html`<span class="pill muted">هێشتا لەسەر نەخشە نییە</span>
                     ${canPlace ? html`<a class="btn small secondary" href="/plots/map?place=${encodeURIComponent(shown)}">دیاریکردن لەسەر نەخشە</a>` : ''}`}
          </div>
        </div>

        <div class="grid cols-4 stats">
          <div class="stat"><div class="n">${num(documents.length)}</div><div class="k">کتاب</div></div>
          <div class="stat"><div class="n">${num(open.length)}</div><div class="k">هێشتا کراوەن</div></div>
          <div class="stat"><div class="n">${num(drawings.length)}</div><div class="k">نەخشە لە ئەرشیف</div></div>
          <div class="stat"><div class="n">${num(companies.length)}</div><div class="k">کۆمپانیا</div></div>
        </div>

        <div class="grid cols-2" style="align-items:start">
          <div>
            <div class="card">
              <h2>کتابەکان</h2>
              ${documents.length === 0 ? html`<div class="empty">هیچ کتابێک سەبارەت بەم پارچەیە نییە کە تۆ بتوانیت بیبینیت.</div>` : html`
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>ژمارە</th><th>بابەت</th><th>نێردەر</th><th>دۆخ</th><th>ئێستا لای</th></tr></thead>
                    <tbody>
                      ${documents.map(d => html`<tr>
                        <td class="mono">${ltr(d.incoming_no)}<span class="cell-sub">${date(d.incoming_date)}</span></td>
                        <td><a href="/documents/${d.id}">${d.subject}</a></td>
                        <td>${d.sender_name}</td>
                        <td>${statusPill(d.status)}${d.overdue ? html` <span class="pill danger">دواکەوتوو</span>` : ''}</td>
                        <td class="muted">${d.room_name ?? (d.outgoing_no ? 'داخراوە' : '—')}</td>
                      </tr>`)}
                    </tbody>
                  </table>
                </div>`}
            </div>

            ${drawings.length === 0 ? '' : html`
              <div class="card">
                <h2>نەخشەکان</h2>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>ناونیشان</th><th>ساڵ</th><th>خاوەن</th><th>شوێن</th></tr></thead>
                    <tbody>
                      ${drawings.map(a => html`<tr>
                        <td><a href="/archive/${a.id}">${a.title}</a>
                            ${a.verified_at ? html`<span class="pill ok">پشتڕاستکراوە</span>` : ''}</td>
                        <td>${a.year ? num(a.year) : '—'}</td>
                        <td class="muted">${a.owner_names ?? '—'}</td>
                        <td class="muted">${[a.shelf && `ڕەف ${a.shelf}`, a.section && `بەش ${a.section}`,
                                             a.folder_no && `دۆسیە ${a.folder_no}`, a.box_no && `سندوق ${a.box_no}`]
                                            .filter(Boolean).join(' · ') || '—'}</td>
                      </tr>`)}
                    </tbody>
                  </table>
                </div>
              </div>`}

            ${companies.length === 0 ? '' : html`
              <div class="card">
                <h2>کۆمپانیاکان</h2>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>ناو</th><th>ژمارەی تۆمار</th><th>کتاب</th></tr></thead>
                    <tbody>
                      ${companies.map(c => html`<tr>
                        <td><a href="/companies/${c.id}">${c.name}</a></td>
                        <td class="mono">${c.registration_no ? ltr(c.registration_no) : '—'}</td>
                        <td>${num(c.letters)}</td>
                      </tr>`)}
                    </tbody>
                  </table>
                </div>
              </div>`}
          </div>

          <div class="card">
            <h2>چی ڕوویداوە</h2>
            ${events.length === 0 ? html`<div class="empty">هیچ ڕووداوێک نییە.</div>` : html`
              <ul class="trail">
                ${events.map(e => {
                  const [cls, label] = EVENT[e.kind] ?? ['waiting', e.kind];
                  return html`<li class="${cls}">
                    <div class="when">${e.approximate ? html`ساڵی ${num(new Date(e.when).getUTCFullYear())}` : date(e.when)} · ${label}</div>
                    <div>${e.doc
                      ? html`<a href="/documents/${e.doc.id}">${e.text}</a>`
                      : html`<a href="/archive/${e.file.id}">${e.text}</a>`}</div>
                    ${e.who ? html`<span class="cell-sub">${e.who}</span>` : ''}
                  </li>`;
                })}
              </ul>`}
          </div>
        </div>
      `,
    }));
  } catch (err) { next(err); }
});

export default router;
