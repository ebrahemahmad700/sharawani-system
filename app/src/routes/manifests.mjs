// Delivery manifests (لیستی گەیاندن).
//
// Twice a day somebody carries an armful of folders from one room to another.
// The system used to have no way of saying that, so the choice was between
// signing for twelve folders separately, which nobody has time for, and signing
// for none, which is what happened.
//
// A manifest is one sending room, one receiving room, one named courier, and a
// list. It is printed, it goes with the folders, it is signed at the far end,
// and receiving it in the system stamps all twelve at once.
//
// Three screens: what is waiting to be sent from my room, what is on its way to
// my room, and one manifest with a print button.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole, roomContext } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { createManifest, receiveManifest, cancelManifest, manifestWithItems, manifestRights, RoutingError } from '../lib/routing.mjs';
import { deliver as deliverPushes } from '../lib/notify.mjs';
import { qrSvg } from '../lib/qr.mjs';
import { page, asset } from '../views/layout.mjs';
import { notFound } from '../lib/respond.mjs';
import { html, num, date, time, ltr, escapeHtml, ltrText } from '../lib/html.mjs';

const router = Router();

const USERS = ['registry_clerk', 'room_clerk', 'room_head', 'mayor', 'deputy_mayor', 'directorate_head'];

// Normal priority is shown nowhere; only the two that ask for speed get a pill.
const PRIORITY_PILL = { urgent: ['warn', 'پەلە'], very_urgent: ['danger', 'زۆر پەلە'] };

/** The one thing every screen here needs: which room am I acting for. */
function actingRoom(req) {
  const chosen = Number(req.query.room ?? req.body?.from_room_id ?? 0);
  return chosen || req.user.roomId || null;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

router.get('/manifests', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const roomId = actingRoom(req);
  try {
    const { rooms: visibleRooms } = await roomContext(req.user);
    const data = await withActor(req.user, async q => {
      // Folders my room has sent on but which the far end has not signed for.
      const { rows: sendable } = await q(`
        SELECT d.id AS document_id, d.incoming_no, d.barcode, d.subject, d.priority,
               s.id AS step_id, s.sent_at, s.to_room_id,
               tr.name AS to_room_name, tr.room_number AS to_room_number
          FROM routing_step s
          JOIN document d ON d.id = s.document_id
          JOIN room tr ON tr.id = s.to_room_id
         WHERE s.status = 'active'
           AND s.paper_received_at IS NULL
           AND s.from_room_id = $1
           AND NOT EXISTS (SELECT 1 FROM dispatch_item di
                            JOIN dispatch_manifest dm ON dm.id = di.manifest_id
                           WHERE di.routing_step_id = s.id AND dm.cancelled_at IS NULL)
         ORDER BY tr.name, s.sent_at`, [roomId]);

      // Manifests on their way to my room, not yet signed for.
      const { rows: incoming } = await q(`
        SELECT m.id, m.manifest_no, m.courier_name, m.created_at,
               fr.name AS from_room_name,
               (SELECT count(*) FROM dispatch_item di WHERE di.manifest_id = m.id) AS item_count
          FROM dispatch_manifest m
          LEFT JOIN room fr ON fr.id = m.from_room_id
         WHERE m.to_room_id = $1 AND m.received_at IS NULL AND m.cancelled_at IS NULL
         ORDER BY m.created_at`, [roomId]);

      const { rows: recent } = await q(`
        SELECT m.id, m.manifest_no, m.courier_name, m.created_at, m.received_at, m.cancelled_at,
               fr.name AS from_room_name, tr.name AS to_room_name,
               (SELECT count(*) FROM dispatch_item di WHERE di.manifest_id = m.id) AS item_count
          FROM dispatch_manifest m
          LEFT JOIN room fr ON fr.id = m.from_room_id
          LEFT JOIN room tr ON tr.id = m.to_room_id
         WHERE m.from_room_id = $1 OR m.to_room_id = $1
         ORDER BY m.created_at DESC LIMIT 25`, [roomId]);

      const { rows: [me] } = await q(`SELECT name FROM room WHERE id = $1`, [roomId]);

      return { sendable, incoming, recent, myRoom: me?.name ?? null };
    });

    // Group what can be sent by destination, because one manifest is one
    // destination and offering a mixed list would only produce a rejection.
    const byRoom = new Map();
    for (const s of data.sendable) {
      if (!byRoom.has(s.to_room_id)) byRoom.set(s.to_room_id, { name: s.to_room_name, number: s.to_room_number, rows: [] });
      byRoom.get(s.to_room_id).rows.push(s);
    }

    res.send(page({
      user: req.user, title: 'لیستی گەیاندن', current: '/manifests',
      counts: { manifests: data.incoming.length },
      rooms: visibleRooms, viewingRoomId: roomId,
      notice: req.query.ok    ? { kind: 'ok',    text: String(req.query.ok) }
            : req.query.error ? { kind: 'error', text: String(req.query.error) }
            : null,
      body: html`
        ${!roomId ? html`<div class="card"><div class="empty">
          هیچ ژوورێکت پێ نەدراوە، بۆیە ناتوانیت لیستی گەیاندن دروست بکەیت.
        </div></div>` : ''}

        ${data.incoming.length ? html`
          <div class="card">
            <h2>لە ڕێگەدا بۆ ${data.myRoom ?? 'ژوورەکەت'}</h2>
            <p class="card-sub">
              ئەمانە پەڕگەی کاغەزین کە بەرەو ژوورەکەتن. کاتێک گەیشتن، وەریانبگرە بە یەک کرتە.
            </p>
            <div class="table-wrap"><table>
              <thead><tr><th>ژمارە</th><th>لە</th><th>گەیەنەر</th><th>کتاب</th><th>بەروار</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
              <tbody>${data.incoming.map(m => html`<tr>
                <td class="mono"><a href="/manifests/${m.id}">${ltr(m.manifest_no)}</a></td>
                <td>${m.from_room_name ?? '—'}</td>
                <td>${m.courier_name}</td>
                <td>${num(m.item_count)}</td>
                <td class="muted">${date(m.created_at)} ${time(m.created_at)}</td>
                <td>
                  <form method="post" action="/manifests/${m.id}/receive" style="display:inline">
                    <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                    <button class="btn small" type="submit" data-sound-on-click="batch">وەرگرتنی هەموویان</button>
                  </form>
                </td>
              </tr>`)}</tbody>
            </table></div>
          </div>` : ''}

        ${roomId && byRoom.size === 0 ? html`
          <div class="card">
            <h2>ناردنی پەڕگە</h2>
            <div class="empty">هیچ پەڕگەیەکی کاغەزی لەم ژوورەوە چاوەڕوانی ناردن نییە.</div>
          </div>` : ''}

        ${[...byRoom.entries()].map(([toRoomId, g]) => html`
          <div class="card">
            <h2>ناردن بۆ ${g.name}${g.number ? html` (ژووری ${num(g.number)})` : ''}</h2>
            <form method="post" action="/manifests/new">
              <input type="hidden" name="_csrf" value="${res.locals.csrf}">
              <input type="hidden" name="from_room_id" value="${roomId}">
              <input type="hidden" name="to_room_id" value="${toRoomId}">
              <div class="table-wrap"><table>
                <thead><tr>
                  <th style="width:34px"><span class="sr-only">لەسەر لیستەکە</span></th><th>ژمارە</th><th>بابەت</th><th>گرنگی</th><th>بەروار</th>
                </tr></thead>
                <tbody>${g.rows.map(s => {
                  const [pk, pl] = PRIORITY_PILL[s.priority] ?? [];
                  return html`<tr>
                  <td><input type="checkbox" name="document_id" value="${s.document_id}" checked aria-label="لەسەر لیستەکە: ${s.incoming_no}"></td>
                  <td class="mono">${ltr(s.incoming_no)}</td>
                  <td><a href="/documents/${s.document_id}">${s.subject}</a></td>
                  <td>${pl ? html`<span class="pill ${pk}">${pl}</span>` : ''}</td>
                  <td class="muted">${date(s.sent_at)} ${time(s.sent_at)}</td>
                </tr>`;
                })}</tbody>
              </table></div>

              <div class="grid cols-2 after">
                <div class="field">
                  <label for="courier-${toRoomId}" class="required">ناوی گەیەنەر</label>
                  <input id="courier-${toRoomId}" name="courier" required maxlength="120"
                         placeholder="ئەو کەسەی پەڕگەکان دەبات">
                </div>
                <div class="field">
                  <label for="note-${toRoomId}">تێبینی</label>
                  <input id="note-${toRoomId}" name="note" maxlength="500">
                </div>
              </div>
              <button class="btn" type="submit">دروستکردنی لیستی گەیاندن</button>
            </form>
          </div>`)}

        ${data.recent.length ? html`
          <div class="card">
            <h2>لیستە پێشووەکان</h2>
            <div class="table-wrap"><table>
              <thead><tr><th>ژمارە</th><th>لە</th><th>بۆ</th><th>گەیەنەر</th><th>کتاب</th><th>دۆخ</th><th>بەروار</th></tr></thead>
              <tbody>${data.recent.map(m => html`<tr>
                <td class="mono"><a href="/manifests/${m.id}">${ltr(m.manifest_no)}</a></td>
                <td>${m.from_room_name ?? '—'}</td>
                <td>${m.to_room_name ?? '—'}</td>
                <td>${m.courier_name}</td>
                <td>${num(m.item_count)}</td>
                <td>${m.cancelled_at ? html`<span class="pill danger">هەڵوەشێنراوە</span>`
                      : m.received_at ? html`<span class="pill ok">وەرگیراوە</span>`
                      : html`<span class="pill warn">لە ڕێگەدا</span>`}</td>
                <td class="muted">${date(m.created_at)}</td>
              </tr>`)}</tbody>
            </table></div>
          </div>` : ''}`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Creating one
// ---------------------------------------------------------------------------

router.post('/manifests/new', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const back = (params) => res.redirect(303, `/manifests?${new URLSearchParams(params)}`);

  // One checkbox posts a string, several post an array. Normalising here rather
  // than in the routing function keeps the shape of that function honest.
  const posted = req.body.document_id;
  const ids = (Array.isArray(posted) ? posted : posted ? [posted] : []).map(Number).filter(Number.isInteger);

  try {
    const m = await withActor(req.user, q => createManifest(q, {
      fromRoomId: Number(req.body.from_room_id),
      toRoomId: Number(req.body.to_room_id),
      documentIds: ids,
      courier: req.body.courier,
      note: req.body.note?.trim() || null,
      byUser: req.user,
      req,
    }));
    await deliverPushes(req);

    const skipped = m.skipped
      ? ` (${num(m.skipped)} کتاب تێپەڕێندران، چونکە ئیتر لەم ڕێگەیەدا نەبوون)`
      : '';
    res.redirect(303, `/manifests/${m.id}?ok=${encodeURIComponent(`لیستی ${m.manifest_no} دروستکرا${skipped}`)}`);
  } catch (err) {
    if (err instanceof RoutingError) return back({ error: err.message });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// One manifest
// ---------------------------------------------------------------------------

router.get('/manifests/:id(\\d+)', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const { m, rights } = await withActor(req.user, async q => {
      const m = await manifestWithItems(q, id);
      return { m, rights: m ? await manifestRights(q, req.user, m) : null };
    });
    if (!m) return notFound(req, res, 'ئەم لیستەی گەیاندن نەدۆزرایەوە.');
    // The receiving room signs, the sending room withdraws. Both buttons were
    // offered to both rooms (letters test, 13 September).
    const canReceive = rights.receive;
    const canCancel = rights.cancel;

    res.send(page({
      user: req.user, title: `لیستی گەیاندن ${ltrText(m.manifest_no)}`, current: '/manifests',
      // A refused cancel comes back here with ?error=, and was shown nothing.
      notice: req.query.ok    ? { kind: 'ok',    text: String(req.query.ok) }
            : req.query.error ? { kind: 'error', text: String(req.query.error) }
            : null,
      body: html`
        ${req.query.ok ? html`<span hidden data-sound="batch"></span>` : ''}
        <div class="card">
          <!-- The top bar already names the list and its number; the card is its details. -->
          <div class="card-head">
            <h2>وردەکاری</h2>
            <div class="end">
              <a class="btn secondary" href="/manifests/${m.id}/print" target="_blank"
                 data-sound-on-click="click">چاپکردن</a>
              ${canReceive ? html`
                <form method="post" action="/manifests/${m.id}/receive">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <button class="btn" type="submit" data-sound-on-click="batch">وەرگرتنی هەموویان</button>
                </form>` : ''}
              ${canCancel ? html`
                <form method="post" action="/manifests/${m.id}/cancel">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <button class="btn danger-outline" type="submit">هەڵوەشاندنەوەی لیست</button>
                </form>` : ''}
            </div>
          </div>

          <div class="table-wrap kv"><table><tbody>
            <tr><th>لە</th><td>${m.from_room_name ?? '—'}</td></tr>
            <tr><th>بۆ</th><td>${m.to_room_name ?? '—'}</td></tr>
            <tr><th>گەیەنەر</th><td>${m.courier_name}</td></tr>
            <tr><th>دروستکرا لەلایەن</th><td>${m.created_by_name ?? '—'} · ${date(m.created_at)} ${time(m.created_at)}</td></tr>
            <tr><th>دۆخ</th><td>
              ${m.cancelled_at ? html`<span class="pill danger">هەڵوەشێنراوە</span>`
                : m.received_at ? html`<span class="pill ok">وەرگیراوە</span>
                    <span class="muted">${m.received_by_name ?? ''} · ${date(m.received_at)} ${time(m.received_at)}</span>`
                : html`<span class="pill warn">لە ڕێگەدا</span>`}
            </td></tr>
            ${m.note ? html`<tr><th>تێبینی</th><td>${m.note}</td></tr>` : ''}
          </tbody></table></div>
        </div>

        <div class="card">
          <h2>کتابەکان <span class="pill muted">${num(m.items.length)}</span></h2>
          <div class="table-wrap"><table>
            <thead><tr><th>ژمارە</th><th>بارکۆد</th><th>بابەت</th><th>کاغەز</th></tr></thead>
            <tbody>${m.items.map(i => html`<tr>
              <td class="mono">${ltr(i.incoming_no)}</td>
              <td class="mono">${ltr(i.barcode)}</td>
              <td><a href="/documents/${i.document_id}">${i.subject}</a></td>
              <td>${i.paper_received_at
                ? html`<span class="pill ok">وەرگیراوە</span>`
                : html`<span class="pill warn">نەگەیشتووە</span>`}</td>
            </tr>`)}</tbody>
          </table></div>
        </div>`,
    }));
  } catch (err) { next(err); }
});

router.post('/manifests/:id(\\d+)/receive', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const r = await withActor(req.user, q => receiveManifest(q, { manifestId: id, byUser: req.user, req }));
    await deliverPushes(req);
    const msg = r.already ? 'پێشتر وەرگیرابوو.' : `${num(r.stamped)} پەڕگە وەرگیران.`;
    res.redirect(303, `/manifests/${id}?ok=${encodeURIComponent(msg)}`);
  } catch (err) {
    if (err instanceof RoutingError) {
      return res.redirect(303, `/manifests?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

router.post('/manifests/:id(\\d+)/cancel', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    await withActor(req.user, q => cancelManifest(q, { manifestId: id, byUser: req.user, req }));
    res.redirect(303, `/manifests/${id}?ok=${encodeURIComponent('لیستەکە هەڵوەشێنرایەوە.')}`);
  } catch (err) {
    if (err instanceof RoutingError) {
      return res.redirect(303, `/manifests/${id}?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// The printed sheet
// ---------------------------------------------------------------------------
//
// This is the object that actually travels. It goes on top of the folders, and
// it is signed twice: once by whoever hands the pile over and once by whoever
// takes it. The signature boxes are the reason the page exists on paper at all;
// everything above them is so that a dispute six months later has something to
// look at.

router.get('/manifests/:id(\\d+)/print', requireAuth, requireRole(...USERS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const m = await withActor(req.user, async q => {
      const m = await manifestWithItems(q, id);
      if (m) {
        await logEvent(q, {
          action: 'manifest.printed', req, userId: req.user.id, roomId: m.from_room_id,
          detail: { manifest_no: m.manifest_no },
        });
      }
      return m;
    });
    if (!m) return notFound(req, res, 'ئەم لیستەی گەیاندن نەدۆزرایەوە.');

    const base = process.env.PUBLIC_BASE_URL
      || `${req.protocol}://${req.get('host') ?? 'localhost'}`;

    res.type('html').send(`<!doctype html>
<html lang="ckb" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<title>${escapeHtml(m.manifest_no)}</title>
<link rel="stylesheet" href="${asset('/app.css')}">
<style>
  /* The values every printed sheet shares (design rules, section 6): sizes in
     pt, a 17pt title over 11.5pt text, the green rule under the letterhead, one
     grey for secondary text, one heading tint, and the gold seal. */
  @page { size: A4; margin: 14mm; }
  body { background:#fff; font-family:Vazirmatn, "Noto Sans Arabic", Tahoma, sans-serif; color:#111;
         font-size:11.5pt; line-height:1.55; margin:0; }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 4mm; }
  .head { display:flex; align-items:flex-start; gap:6mm;
          border-bottom:2px solid #0E3A28; padding-bottom:3mm; margin-bottom:4mm; }
  .seal { width:33pt; height:33pt; border-radius:50%; background:#C99A2E; flex:0 0 33pt; }
  .title { flex:1; min-width:0; }
  h1 { font-size: 17pt; margin: 0; }
  .sub { font-size:10pt; color:#555; margin-bottom:2mm; }
  .meta { line-height:1.9; }
  .meta b { display:inline-block; min-width:26mm; font-weight:600; }
  .count, .openqr { text-align:center; }
  .count .n { font-size:22pt; font-weight:700; line-height:1.2; }
  .count .k, .openqr { font-size:9pt; color:#555; }
  .openqr svg { display:block; margin:0 auto 1mm; }
  /* app.css sizes tables and headings in px for the screen; the sheet says pt. */
  table { width:100%; border-collapse:collapse; margin-top:3mm; font-size:11.5pt; }
  th, td { border:0.5pt solid #b9b2a2; padding:2mm 2.5mm; text-align:start; vertical-align:top; }
  th { background:#f6f5f0; color:#555; font-weight:600; font-size:10pt; }
  th.idx { width:8mm; }
  th.no { width:32mm; }
  th.code { width:34mm; }
  td.n { font-family:monospace; direction:ltr; text-align:center; white-space:nowrap; }
  .tick { width:12mm; text-align:center; }
  td.tick { font-size:14pt; }
  .note { margin-top:4mm; }
  .sigs { display:flex; gap:8mm; margin-top:10mm; }
  .sig { flex:1; border:0.5pt solid #b9b2a2; padding:3mm; min-height:26mm; }
  .sig small { font-size:9.5pt; color:#555; display:block; margin-bottom:2mm; }
  .foot { margin-top:6mm; font-size:8.5pt; color:#555; display:flex; justify-content:space-between; }
  @media print { .noprint { display:none } }
</style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <div class="seal"></div>
    <div class="title">
      <h1>لیستی گەیاندنی پەڕگە</h1>
      <div class="sub">شارەوانی ڕانیە</div>
      <div class="meta">
        <b>ژمارەی لیست</b> <span dir="ltr">${escapeHtml(m.manifest_no)}</span><br>
        <b>لە ژووری</b> ${escapeHtml(m.from_room_name ?? '—')}<br>
        <b>بۆ ژووری</b> ${escapeHtml(m.to_room_name ?? '—')}<br>
        <b>گەیەنەر</b> ${escapeHtml(m.courier_name)}<br>
        <b>بەروار</b> ${escapeHtml(date(m.created_at))}
      </div>
    </div>
    <div class="count">
      <div class="n">${escapeHtml(num(m.items.length))}</div>
      <div class="k">پەڕگە</div>
    </div>
    <!--
      The receiving clerk photographs this and the manifest opens on their phone,
      ready to sign for. It is the difference between walking back to a desk and
      signing where the trolley is standing. Not signed in, they get the sign-in
      page first; the QR grants nothing.
    -->
    <div class="openqr">
      ${qrSvg(`${base}/manifests/${m.id}`, { sizeMm: 22 })}
      وەرگرتن لە مۆبایل
    </div>
  </div>

  <table>
    <thead><tr>
      <th class="idx">#</th><th class="no">ژمارە</th>
      <th class="code">بارکۆد</th><th>بابەت</th><th class="tick">وەرگیرا</th>
    </tr></thead>
    <tbody>
      ${m.items.map((i, n) => `<tr>
        <td class="n">${num(n + 1)}</td>
        <td class="n">${escapeHtml(i.incoming_no)}</td>
        <td class="n">${escapeHtml(i.barcode)}</td>
        <td>${escapeHtml(i.subject)}</td>
        <td class="tick">☐</td>
      </tr>`).join('')}
    </tbody>
  </table>

  ${m.note ? `<p class="note"><b>تێبینی:</b> ${escapeHtml(m.note)}</p>` : ''}

  <div class="sigs">
    <div class="sig"><small>ناردن — ناو و واژوو</small>${escapeHtml(m.created_by_name ?? '')}</div>
    <div class="sig"><small>گەیەنەر — ناو و واژوو</small>${escapeHtml(m.courier_name)}</div>
    <div class="sig"><small>وەرگرتن — ناو و واژوو و بەروار</small>${escapeHtml(m.received_by_name ?? '')}</div>
  </div>

  <div class="foot">
    <span>شارەوانی ڕانیە — سیستەمی دۆکیومێنت</span>
    <span dir="ltr">${escapeHtml(m.manifest_no)}</span>
  </div>
</div>
<script src="${asset('/print.js')}"></script>
</body>
</html>`);
  } catch (err) { next(err); }
});

export default router;
