// The map of plots (نەخشەی پارچەکان).
//
// Rania's streets and water, drawn from a file on this server (public/map/
// rania.json, from OpenStreetMap), with every plot somebody has placed on it,
// coloured by what is happening to it: a late letter, an open letter, all
// answered, only drawings in the archive. Clicking a plot opens its file.
//
// Placing a plot is part of the same page: from a plot's file, "put it on the
// map" opens this page in placing mode for that number, one click sets the
// point, and further clicks can trace its outline. Moving it later is the same.
//
// Nothing about the map is fetched from anywhere but this server while it is in
// use: no tile service learns which streets the municipality is looking at, and
// the map works with the internet down. The plot counts are read as the person
// looking (row-level security), so a clerk's map shows the letters that clerk may
// see, and IT, which may not read letters, is not let in at all.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { plotKey } from '../lib/ku.mjs';
import { page, asset } from '../views/layout.mjs';
import { html, num, ident } from '../lib/html.mjs';

const router = Router();

export const MAP_READERS = ['mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                            'room_clerk', 'registry_clerk', 'archive_clerk', 'hr'];
export const MAP_PLACERS = ['mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                            'registry_clerk', 'archive_clerk'];

router.get('/plots/map', requireAuth, requireRole(...MAP_READERS), async (req, res, next) => {
  try {
    const place = String(req.query.place ?? '').trim().slice(0, 60);
    const focus = String(req.query.p ?? '').trim().slice(0, 60);
    const canPlace = MAP_PLACERS.includes(req.user.role);

    const { unplaced, placed } = await withActor(req.user, async q => {
      // The plots with letters that nobody has put on the map yet, busiest first:
      // the list a clerk with a quiet afternoon can work through.
      const { rows: unplaced } = await q(`
        SELECT min(d.plot_no) AS plot_no, d.plot_key, count(*) AS letters,
               count(*) FILTER (WHERE d.status IN ('registered', 'in_flow', 'ready_to_close')) AS open
          FROM document d
         WHERE d.plot_key IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM plot_location p WHERE p.plot_key = d.plot_key)
         GROUP BY d.plot_key
         ORDER BY count(*) FILTER (WHERE d.status IN ('registered', 'in_flow', 'ready_to_close')) DESC, count(*) DESC
         LIMIT 30`);
      const { rows: [placed] } = await q(`
        SELECT (SELECT count(*) FROM plot_location) AS n,
               (SELECT count(DISTINCT d.plot_key) FROM document d
                 WHERE d.plot_key IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM plot_location p WHERE p.plot_key = d.plot_key)) AS unplaced`);
      await logEvent(q, { action: 'map.viewed', req, userId: req.user.id, roomId: req.user.roomId, detail: {} });
      return { unplaced, placed };
    });

    res.send(page({
      user: req.user, title: 'نەخشەی پارچەکان', current: '/plots/map',
      notice: place && canPlace ? { kind: 'info', text: `شوێنی پارچەی ${place} دیاری بکە: کرتە لەسەر نەخشەکە بکە.` } : null,
      body: html`
        <link rel="stylesheet" href="${asset('/vendor/leaflet/leaflet.css')}">
        <div class="card map-card">
          <div class="map-bar">
            <form class="row" role="search" data-map-search>
              <input type="search" name="p" dir="ltr" aria-label="ژمارەی پارچە" placeholder="247/5" value="${focus}" maxlength="60">
              <button class="btn" type="submit">دۆزینەوە</button>
            </form>
            <div class="map-legend" aria-label="ڕەنگەکان">
              <span><i class="late"></i>کتابی دواکەوتوو</span>
              <span><i class="open"></i>کتابی کراوە</span>
              <span><i class="done"></i>هەموو وەڵامدراوە</span>
              <span><i class="drawing"></i>تەنها نەخشە</span>
            </div>
          </div>
          <div class="plot-map" id="plot-map"
               data-plot-map
               data-map-src="${asset('/map/rania.json')}"
               data-place="${canPlace ? place : ''}"
               data-focus="${focus}"
               data-can-place="${canPlace ? '1' : ''}"
               data-csrf="${res.locals.csrf}"
               role="application" aria-label="نەخشەی شاری ڕانیە و پارچەکان">
            <p class="map-loading muted">نەخشەکە دەکرێتەوە…</p>
          </div>
          <div class="map-place-bar" data-place-bar hidden>
            <span data-place-text></span>
            <button type="button" class="btn small secondary" data-outline>کێشانی سنوور</button>
            <button type="button" class="btn small secondary" data-outline-undo hidden>گەڕانەوە</button>
            <button type="button" class="btn small" data-place-save disabled>پاشەکەوتکردن</button>
            <a class="btn small secondary" data-place-cancel href="/plots/map">پاشگەزبوونەوە</a>
          </div>
          <p class="hint">
            نەخشەکە خۆی لەسەر ڕاژەی شارەوانی هەڵگیراوە؛ هیچ نەخشە یان وێنەیەک لە دەرەوە بار ناکرێت و بێ ئینتەرنێتیش کار دەکات.
            ${html`<span dir="ltr">© OpenStreetMap contributors</span>`}
          </p>
          <noscript><p class="notice warn">نەخشەکە پێویستی بە JavaScript ە. فایلی هەر پارچەیەک لە «فایلی پارچە» هەیە.</p></noscript>
        </div>

        <div class="grid cols-2 top">
          <div class="card">
            <div class="card-head">
              <h2>پارچە دیاریکراوەکان</h2>
              <span class="pill muted">${num(placed.n)}</span>
            </div>
            <div data-placed-list><div class="empty compact">…</div></div>
          </div>
          <div class="card">
            <div class="card-head">
              <h2>پارچەی بێ شوێن</h2>
              <span class="pill muted">${num(placed.unplaced)}</span>
            </div>
            <p class="card-sub">پارچەکان کە کتابیان هەیە بەڵام هێشتا لەسەر نەخشە نین. کراوەکان لە سەرەوەن${Number(placed.unplaced) > unplaced.length ? html`؛ ${num(unplaced.length)}ی یەکەم لێرەن` : ''}.</p>
            ${unplaced.length === 0 ? html`<div class="empty compact">هەموو پارچەکان شوێنیان هەیە.</div>` : html`
              <div class="table-wrap"><table>
                <thead><tr><th>پارچە</th><th>کتاب</th><th>کراوە</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
                <tbody>${unplaced.map(u => html`<tr>
                  <td><a class="mono" href="/plots?p=${encodeURIComponent(u.plot_no)}">${ident(u.plot_no)}</a></td>
                  <td>${num(u.letters)}</td>
                  <td>${Number(u.open) ? html`<span class="pill warn">${num(u.open)}</span>` : num(0)}</td>
                  <td>${canPlace ? html`<a class="btn small secondary" href="/plots/map?place=${encodeURIComponent(u.plot_no)}">دیاریکردن</a>` : ''}</td>
                </tr>`)}</tbody>
              </table></div>`}
          </div>
        </div>
        <script src="${asset('/vendor/leaflet/leaflet.js')}"></script>
        <script src="${asset('/plotmap.js')}"></script>`,
    }));
  } catch (err) { next(err); }
});

// The plots on the map, with their counts as the person asking may see them.
router.get('/plots/map/data', requireAuth, requireRole(...MAP_READERS), async (req, res, next) => {
  try {
    const rows = await withActor(req.user, async q => {
      const { rows } = await q(`
        SELECT p.plot_no, p.plot_key, p.neighbourhood, p.lat, p.lng, p.outline,
               (SELECT count(*) FROM document d WHERE d.plot_key = p.plot_key) AS letters,
               (SELECT count(*) FROM document d WHERE d.plot_key = p.plot_key
                   AND d.status IN ('registered', 'in_flow', 'ready_to_close')) AS open,
               (SELECT count(*) FROM document d JOIN routing_step s ON s.id = d.current_step_id
                 WHERE d.plot_key = p.plot_key AND s.status = 'active' AND s.due_at < now()) AS late,
               (SELECT count(*) FROM archive_file a WHERE a.plot_key = p.plot_key AND a.is_active) AS drawings
          FROM plot_location p
         ORDER BY p.plot_key
         LIMIT 5000`);
      return rows;
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      plots: rows.map(r => ({
        no: r.plot_no, key: r.plot_key, hood: r.neighbourhood, lat: r.lat, lng: r.lng, outline: r.outline,
        letters: Number(r.letters), open: Number(r.open), late: Number(r.late), drawings: Number(r.drawings),
      })),
    });
  } catch (err) { next(err); }
});

// Put a plot on the map, or move it. The answer is JSON for the map's script.
router.post('/plots/map/place', requireAuth, requireRole(...MAP_PLACERS), async (req, res, next) => {
  const plotNo = String(req.body.plot_no ?? '').trim().slice(0, 60);
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  const key = plotKey(plotNo);
  if (!plotNo || !key) return res.status(400).json({ error: 'ژمارەی پارچە دروست نییە.' });
  if (!(lat >= 34 && lat <= 38 && lng >= 42 && lng <= 47)) return res.status(400).json({ error: 'ئەم شوێنە لە ناوچەکەدا نییە.' });

  let outline = null;
  if (req.body.outline) {
    try {
      const ring = JSON.parse(String(req.body.outline));
      const ok = Array.isArray(ring) && ring.length >= 3 && ring.length <= 200
        && ring.every(p => Array.isArray(p) && p.length === 2
                       && p[0] >= 34 && p[0] <= 38 && p[1] >= 42 && p[1] <= 47);
      if (!ok) return res.status(400).json({ error: 'سنووری پارچەکە دروست نییە.' });
      outline = ring.map(([a, b]) => [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6]);
    } catch {
      return res.status(400).json({ error: 'سنووری پارچەکە دروست نییە.' });
    }
  }
  const round = n => Math.round(n * 1e6) / 1e6;

  try {
    const result = await withActor(req.user, async q => {
      const { rows: [before] } = await q(`SELECT id, lat, lng FROM plot_location WHERE plot_key = $1`, [key]);
      const { rows: [hood] } = await q(
        `SELECT neighbourhood FROM document WHERE plot_key = $1 AND neighbourhood IS NOT NULL
          ORDER BY incoming_date DESC LIMIT 1`, [key]);
      if (before) {
        await q(`
          UPDATE plot_location SET lat = $2, lng = $3, outline = $4::jsonb,
                 neighbourhood = coalesce($5, neighbourhood), updated_by = $6, updated_at = now()
           WHERE id = $1`, [before.id, round(lat), round(lng), outline ? JSON.stringify(outline) : null, hood?.neighbourhood ?? null, req.user.id]);
        await logEvent(q, {
          action: 'plot.moved', req, userId: req.user.id, roomId: req.user.roomId,
          detail: { plot_no: plotNo, from: [before.lat, before.lng], to: [round(lat), round(lng)], outline: Boolean(outline) },
        });
        return 'moved';
      }
      await q(`
        INSERT INTO plot_location (plot_no, neighbourhood, lat, lng, outline, placed_by)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [plotNo, hood?.neighbourhood ?? null, round(lat), round(lng), outline ? JSON.stringify(outline) : null, req.user.id]);
      await logEvent(q, {
        action: 'plot.located', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { plot_no: plotNo, lat: round(lat), lng: round(lng), outline: Boolean(outline) },
      });
      return 'located';
    });
    res.json({ ok: true, result, location: `/plots/map?p=${encodeURIComponent(plotNo)}` });
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'ئەم شوێنە قبووڵ نەکرا.' });
    next(err);
  }
});

export default router;
