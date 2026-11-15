// The printable file sheet for one letter.
//
// Paper is the workflow here. A room head prints the sheet, writes the reply on
// the back by hand, and the registry attaches the scan. So the printed page has
// to carry everything a person needs when the screen is not in front of them:
// the number, the subject, who sent it, where the paper copy lives, and the
// trail so far with a blank line for the next hand.
//
// No sidebar, no buttons, nothing that depends on a mouse. Opens in a new tab
// and triggers the print dialogue on load.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { trail } from '../lib/routing.mjs';
import { getDocument } from '../lib/documents.mjs';
import { logEvent } from '../lib/log.mjs';
import { html, raw, escapeHtml, num, date, time, ltr } from '../lib/html.mjs';
import { unifyDigits } from '../lib/ku.mjs';
import { code39Svg } from '../lib/barcode.mjs';
import { qrSvg, trackUrl } from '../lib/qr.mjs';
import { DOC_TYPES } from './registry.mjs';
import { notFound, statusPage, logRefusal } from '../lib/respond.mjs';
import { asset } from '../views/layout.mjs';

const router = Router();

const STEP_ACTION = {
  opinion: 'بیروڕا', approved: 'ڕەزامەندی', rejected: 'ڕەتکراوە', forwarded: 'ناردرا',
  letter_attached: 'کتابی تر لکێندرا', handwritten_reply: 'وەڵامی دەستنووس', no_action: 'بێ کردار',
};
const STEP_STATUS = {
  waiting: 'چاوەڕوان', active: 'ئێستا لێرەیە', done: 'تەواوبوو',
  returned: 'گەڕێندرایەوە', skipped: 'تێپەڕێندرا', cancelled: 'هەڵوەشێنراوە',
};

router.get('/documents/:id(\\d+)/print', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = await withActor(req.user, async q => {
      const doc = await getDocument(q, id);
      if (!doc) return null;
      const steps = await trail(q, id);
      await logEvent(q, { action: 'document.printed', req, userId: req.user.id, roomId: req.user.roomId, documentId: id });
      return { doc, steps };
    });
    if (!data) { await logRefusal(req, 'document', req.params.id); return notFound(req, res); }
    const { doc, steps } = data;

    // Behind a reverse proxy the request host is the proxy rather than the name
    // on the sign, so the environment wins when it has an opinion.
    const base = process.env.PUBLIC_BASE_URL
      || `${req.protocol}://${req.get('host') ?? 'localhost'}`;

    const body = html`
      <style>
        @page { size: A4; margin: 18mm 16mm; }
        /* The same values as the receipt's A4 sheet: title 17pt, body 11.5pt,
           muted #555, heading background #f6f5f0 (design rules, 13 September). */
        body { font-family: Vazirmatn, "Noto Sans Arabic", Tahoma, sans-serif; color: #111; font-size: 11.5pt; line-height: 1.55; margin: 0; }
        .head { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #0E3A28; padding-bottom: 10px; margin-bottom: 16px; }
        .seal { width: 33pt; height: 33pt; border-radius: 50%; background: #C99A2E; flex: 0 0 33pt; }
        .head h1 { font-size: 17pt; margin: 0; }
        .head .sub { font-size: 10.5pt; color: #555; }
        .no { margin-inline-start: auto; text-align: left; font-size: 11pt; }
        .no b { font-size: 15pt; display: block; }
        .no .code { margin-top: 6px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
        th, td { text-align: right; padding: 5px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
        th { width: 32%; color: #555; font-weight: 600; background: #f6f5f0; }
        h2 { font-size: 12.5pt; margin: 18px 0 6px; border-bottom: 1px solid #bbb; padding-bottom: 3px; }
        .trail td { font-size: 11pt; }
        .blank { height: 120px; border: 1px dashed #999; margin-top: 8px; border-radius: 4px; }
        .foot { margin-top: 20px; font-size: 9.5pt; color: #555; display: flex; justify-content: space-between; }
        .openqr { flex: 0 0 auto; text-align: center; font-size: 8pt; color: #555; }
        .openqr svg { display: block; margin-bottom: 1mm; }
        @media screen { body { max-width: 190mm; margin: 20px auto; padding: 0 12px; } }
        /* Opened on a phone from the barcode screen: the sheet is 462px of fixed
           pieces on a 390px screen, so the head wraps instead (browser audit). */
        @media screen and (max-width: 600px) {
          body { font-size: 11pt; }
          .head { flex-wrap: wrap; }
          .no { margin-inline-start: 0; text-align: start; }
          th { width: 38%; }
          th, td { overflow-wrap: anywhere; padding: 4px 5px; }
          .trail th, .trail td { font-size: 9.5pt; }
        }
      </style>
      <div class="head">
        <div class="seal"></div>
        <div>
          <h1>شارەوانی ڕانیە</h1>
          <div class="sub">سیستەمی بەڕێوەبردنی دۆکیومێنت · پەڕەی دۆسیە</div>
        </div>
        <div class="no">
          ژمارەی هاتوو <b dir="ltr">${doc.incoming_no}</b>
          ${doc.outgoing_no ? html`ژمارەی دەرچوو <b dir="ltr">${doc.outgoing_no}</b>` : ''}
          <div class="code">${raw(code39Svg(doc.barcode, { moduleMm: 0.3, heightMm: 9 }))}</div>
        </div>
        <!--
          The folder cover carries a QR to the letter's own page, not to the
          public tracking page. Somebody holding the paper photographs it and the
          record opens on their phone; if they are not signed in they get the
          sign-in page first and then the letter, so this discloses nothing that
          the person could not already reach.
        -->
        <div class="openqr">
          ${raw(qrSvg(`${base}/documents/${doc.id}`, { sizeMm: 20 }))}
          <span>کردنەوە لە مۆبایل</span>
        </div>
      </div>

      <table><tbody>
        <tr><th>بابەت</th><td><strong>${doc.subject}</strong></td></tr>
        <tr><th>بەرواری هاتوو</th><td>${date(doc.incoming_date)}</td></tr>
        <tr><th>جۆر</th><td>${DOC_TYPES.find(t => t[0] === doc.doc_type)?.[1] ?? doc.doc_type}</td></tr>
        <tr><th>نێردەر</th><td>${doc.sender_name}${doc.sender_contact ? html` · <span dir="ltr">${doc.sender_contact}</span>` : ''}</td></tr>
        ${doc.plot_no ? html`<tr><th>پارچە</th><td dir="ltr" style="text-align:right">${unifyDigits(doc.plot_no)}${doc.neighbourhood ? ` — ${doc.neighbourhood}` : ''}</td></tr>` : ''}
        <tr><th>شوێنی کاغەز</th><td>${[doc.physical_shelf && `ڕەف ${doc.physical_shelf}`, doc.physical_section && `بەش ${doc.physical_section}`, doc.physical_folder && `دۆسیە ${doc.physical_folder}`].filter(Boolean).join(' · ') || '—'}</td></tr>
        <tr><th>تۆمارکرا لەلایەن</th><td>${doc.registered_by_name ?? '—'}</td></tr>
        ${doc.outgoing_no ? html`
          <tr><th>وەرگر</th><td>${doc.outgoing_recipient}</td></tr>
          <tr><th>بەرواری دەرچوو</th><td>${date(doc.outgoing_date)}</td></tr>
          ${doc.outgoing_summary ? html`<tr><th>کورتەی وەڵام</th><td>${doc.outgoing_summary}</td></tr>` : ''}` : ''}
      </tbody></table>

      <h2>ڕێڕەوی کتاب</h2>
      ${steps.length === 0 ? html`<p>هێشتا بۆ هیچ ژوورێک نەنێردراوە.</p>` : html`
        <table class="trail">
          <thead><tr><th style="width:5%">#</th><th style="width:25%">ژوور</th><th style="width:20%">لای</th><th style="width:15%">نێردرا</th><th style="width:15%">تەواوبوو</th><th>کردار و تێبینی</th></tr></thead>
          <tbody>${steps.map((s, i) => html`<tr>
            <td>${num(i + 1)}</td>
            <td>${s.to_room_name}${s.to_room_number ? ` (${num(s.to_room_number)})` : ''}<br><small>${STEP_STATUS[s.status] ?? s.status}</small></td>
            <td>${s.assigned_to_name ?? ''}</td>
            <td>${s.sent_at ? html`${date(s.sent_at)}<br><small>${time(s.sent_at)}</small>` : '—'}</td>
            <td>${s.completed_at ? html`${date(s.completed_at)}<br><small>${time(s.completed_at)}</small>` : '—'}</td>
            <td>${s.action_taken ? html`<strong>${STEP_ACTION[s.action_taken] ?? s.action_taken}</strong> ` : ''}${s.reply_note ?? s.note ?? ''}</td>
          </tr>`)}</tbody>
        </table>`}

      <h2>وەڵام / ڕاسپاردە بە دەست</h2>
      <div class="blank"></div>

      <div class="foot">
        <span>چاپکرا ${date(new Date())} ${time(new Date())} لەلایەن ${req.user.fullName}</span>
        <span dir="ltr">${doc.incoming_no}</span>
      </div>
      <script src="${asset('/print.js')}"></script>`;

    res.send(`<!doctype html><html lang="ckb" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<title>${escapeHtml(doc.incoming_no)} — چاپ</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap">
</head><body>${String(body)}</body></html>`);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// The applicant's receipt
// ---------------------------------------------------------------------------
//
// What the person at the counter walks away holding. Two formats on one page,
// and which one prints is a CSS choice rather than a second route, because the
// clerk should not have to know what kind of printer is attached:
//
//   the slip     80mm, for a till roll printer, which is what a counter has
//   the sheet    A4, for an ordinary printer, and it doubles as a folder cover
//
// It carries the barcode and the tracking PIN, and those two together are the
// whole of the public tracking page. Nothing else on the receipt is secret: the
// applicant wrote the subject themselves.
//
// Reprinting is deliberately allowed and deliberately does not reissue the PIN.
// A lost receipt is a daily event, and a system that invalidated the number the
// applicant is holding every time a clerk pressed print would be worse than no
// receipt at all.

router.get('/documents/:id(\\d+)/receipt', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sheet = req.query.format === 'sheet';

    const data = await withActor(req.user, async q => {
      const doc = await getDocument(q, id);
      if (!doc) return null;
      if (doc.status === 'cancelled') return { doc, pin: null };   // no PIN is issued for it
      const { rows: [t] } = await q(`SELECT issue_track_pin($1) AS pin`, [id]);
      await logEvent(q, {
        action: 'receipt.printed', req, userId: req.user.id,
        roomId: req.user.roomId, documentId: id,
      });
      return { doc, pin: t?.pin ?? null };
    });
    if (!data) { await logRefusal(req, 'document', req.params.id); return notFound(req, res); }
    // A cancelled letter has nothing for an applicant to follow, and a receipt with
    // a working PIN for it only invites a visit to ask (letters test, 13 September).
    if (data.doc?.status === 'cancelled') {
      return statusPage(req, res, 409, { title: 'هەڵوەشێنراوە', text: 'ئەم کتابە هەڵوەشێنراوە، بۆیە پسوولەی بۆ چاپ ناکرێت.', back: `/documents/${req.params.id}` });
    }
    const { doc, pin } = data;

    // Where to tell the applicant to go. The environment wins, because behind a
    // reverse proxy the request host is the proxy and not the name on the sign.
    const base = process.env.PUBLIC_BASE_URL
      || `${req.protocol}://${req.get('host') ?? 'localhost'}`;

    const body = html`
      <style>
        /* The colours of the letter sheet, on the slip as well; the A4 sheet
           takes its sizes too (design rules, 13 September). */
        :root { --ink:#141210; --muted:#555; --rule:#c9c2b2; --head-bg:#f6f5f0; }
        * { box-sizing: border-box; }
        body { font-family: Vazirmatn, "Noto Sans Arabic", Tahoma, sans-serif;
               color: var(--ink); margin: 0; background:#eeece6; }
        .slip, .sheet { background:#fff; }

        /* the till-roll slip */
        .slip { width: 76mm; margin: 8px auto; padding: 5mm 4mm; font-size: 9.6pt; line-height: 1.5; }
        .slip h1 { font-size: 12pt; margin: 0; text-align: center; }
        .slip .org { text-align:center; font-size: 8.6pt; color: var(--muted); margin-bottom: 3mm; }
        .slip .code { text-align:center; margin: 3mm 0; }
        .slip .pin { text-align:center; border:1px dashed var(--rule); border-radius:3px;
                     padding:2mm; margin:3mm 0; }
        .slip .pin b { display:block; font-family:monospace; font-size:16pt; letter-spacing:3px; direction:ltr; }
        .slip dl { margin:0; display:grid; grid-template-columns: 26mm 1fr; gap:1mm 2mm; }
        .slip dt { color: var(--muted); }
        .slip dd { margin:0; }
        .slip .cut { border-top:1px dashed var(--rule); margin-top:4mm; padding-top:2mm;
                     text-align:center; font-size:8pt; color:var(--muted); }
        .slip .qr { text-align:center; margin:3mm 0 0; font-size:8.2pt; color:var(--muted); line-height:1.4; }
        .slip .qr svg { display:block; margin:0 auto 1.5mm; }
        .slip .qr .plain { font-size:7.6pt; }
        .slip .subject { margin-top:2mm; }

        /* the A4 sheet, which doubles as a folder cover */
        .sheet { width: 190mm; margin: 8px auto; padding: 14mm; font-size: 11.5pt; }
        /* On a phone the A4 sheet was 718px wide on a 390px screen. It takes the
           screen's width there; printing is unaffected. */
        @media screen and (max-width: 760px) {
          .sheet { width: auto; margin: 8px; padding: 6mm; font-size: 10.5pt; }
          .sheet .head { flex-wrap: wrap; gap: 4mm; }
        }
        .sheet .head { display:flex; justify-content:space-between; align-items:flex-start;
                       gap:12mm; border-bottom:2px solid #0E3A28; padding-bottom:5mm; margin-bottom:6mm; }
        .sheet .brand { display:flex; align-items:center; gap:4mm; }
        .sheet .seal { width:33pt; height:33pt; border-radius:50%; background:#C99A2E; flex:0 0 33pt; }
        .sheet h1 { font-size: 17pt; margin:0 0 1mm; }
        .sheet .sub { font-size:10.5pt; color: var(--muted); }
        .sheet .code { text-align:center; }
        .sheet table { width:100%; border-collapse:collapse; margin-bottom:5mm; }
        .sheet th, .sheet td { text-align:start; padding:2.5mm 3mm; border-bottom:1px solid var(--rule); vertical-align:top; }
        .sheet th { width:34%; color:var(--muted); font-weight:600; background:var(--head-bg); }
        .sheet .pinbox { border:1.5px solid var(--ink); border-radius:4px; padding:4mm; text-align:center; }
        .sheet .pinbox b { font-family:monospace; font-size:22pt; letter-spacing:5px; direction:ltr; display:block; }
        .sheet .how { background:var(--head-bg); border-radius:4px; padding:4mm; font-size:10.5pt; margin-top:5mm; }
        .sheet .how p { margin:2mm 0; }
        .sheet .how ol { margin:2mm 0 0; padding-inline-start:6mm; list-style-type: arabic-indic; }
        .sheet .how { display:flex; gap:5mm; align-items:flex-start; }
        .sheet .how-qr { flex:none; }
        .sheet .how-qr svg { display:block; }
        .sheet .foot { margin-top:8mm; font-size:9.5pt; color:var(--muted); display:flex; justify-content:space-between; }

        .switch { text-align:center; padding:10px; font-size:13px; }
        .switch a { margin:0 6px; }

        /* On paper exactly one of the two prints. Which one is decided by the
           query string, so the clerk chooses and the printer never has to. */
        @media print {
          body { background:#fff; }
          .switch { display:none; }
          .slip, .sheet { margin:0; width:auto; }
          ${raw(sheet ? '.slip { display:none }' : '.sheet { display:none }')}
        }
        @page { size: ${raw(sheet ? 'A4' : '80mm 200mm')}; margin: ${raw(sheet ? '14mm' : '3mm')}; }
      </style>

      <div class="switch">
        <a href="?format=slip">پسوولەی بچووک</a> ·
        <a href="?format=sheet">پەڕەی A4</a>
      </div>

      <div class="slip">
        <h1>پسوولەی وەرگرتن</h1>
        <div class="org">شارەوانی ڕانیە</div>

        <dl>
          <dt>ژمارەی کتاب</dt><dd dir="ltr">${doc.incoming_no}</dd>
          <dt>بەروار</dt><dd>${date(doc.incoming_date)}</dd>
          <dt>ناوی داواکار</dt><dd>${doc.sender_name}</dd>
          ${doc.plot_no ? html`<dt>پارچە</dt><dd dir="ltr">${unifyDigits(doc.plot_no)}</dd>` : ''}
          ${doc.reply_by ? html`<dt>وەڵام تا</dt><dd><strong>${date(doc.reply_by)}</strong></dd>` : ''}
        </dl>

        <div class="subject">${doc.subject}</div>

        <div class="code">${raw(code39Svg(doc.barcode, { moduleMm: 0.30, heightMm: 12 }))}</div>

        <div class="pin">
          ژمارەی نهێنی
          <b>${pin ?? ''}</b>
        </div>

        <div class="qr">
          ${raw(qrSvg(trackUrl(base, doc.barcode, pin), { sizeMm: 24 }))}
          <div>مۆبایلەکەت بۆ ئەم وێنەیە بگرە بۆ زانینی دۆخی داواکارییەکەت</div>
          <div dir="ltr" class="plain">${base}/track</div>
        </div>

        <div class="cut">ئەم پسوولەیە بپارێزە</div>
      </div>

      <div class="sheet">
        <div class="head">
          <div class="brand">
            <div class="seal"></div>
            <div>
              <h1>شارەوانی ڕانیە</h1>
              <div class="sub">پسوولەی وەرگرتنی داواکاری</div>
            </div>
          </div>
          <div class="code">
            ${raw(code39Svg(doc.barcode, { moduleMm: 0.36, heightMm: 14 }))}
          </div>
        </div>

        <table><tbody>
          <tr><th>ژمارەی کتاب</th><td dir="ltr"><strong>${doc.incoming_no}</strong></td></tr>
          <tr><th>بەرواری وەرگرتن</th><td>${date(doc.incoming_date)}</td></tr>
          <tr><th>ناوی داواکار</th><td>${doc.sender_name}</td></tr>
          <tr><th>بابەت</th><td>${doc.subject}</td></tr>
          ${doc.plot_no ? html`<tr><th>پارچە</th><td dir="ltr">${unifyDigits(doc.plot_no)}</td></tr>` : ''}
          ${doc.neighbourhood ? html`<tr><th>گەڕەک</th><td>${doc.neighbourhood}</td></tr>` : ''}
          <tr><th>وەرگیرا لەلایەن</th><td>${doc.registered_by_name ?? ''}</td></tr>
          ${doc.reply_by ? html`<tr><th>بەرواری وەڵامدانەوە</th><td><strong>${date(doc.reply_by)}</strong></td></tr>` : ''}
        </tbody></table>

        <div class="pinbox">
          ژمارەی نهێنی بۆ بەدواداچوون
          <b>${pin ?? ''}</b>
        </div>

        <div class="how">
          <div class="how-qr">${raw(qrSvg(trackUrl(base, doc.barcode, pin), { sizeMm: 32 }))}</div>
          <div>
            <strong>چۆن دۆخی داواکارییەکەت بزانیت</strong>
            <p>
              مۆبایلەکەت بۆ ئەم وێنەیە بگرە. ئەگەر نەکرا، ئەم هەنگاوانە بگرەبەر:
            </p>
            <ol>
              <li>بڕۆ بۆ <span dir="ltr">${base}/track</span></li>
              <li>ژمارەی بارکۆد بنووسە: <span dir="ltr">${doc.barcode}</span></li>
              <li>ژمارەی نهێنی بنووسە: <span dir="ltr">${pin ?? ''}</span></li>
            </ol>
            ئەم پەڕەیە تەنها دۆخ پیشان دەدات، نەک ناوەڕۆکی کتاب.
          </div>
        </div>

        <div class="foot">
          <span>چاپکرا ${date(new Date())} ${time(new Date())} لەلایەن ${req.user.fullName}</span>
          <span dir="ltr">${doc.barcode}</span>
        </div>
      </div>
      <script src="${asset('/print.js')}"></script>`;

    res.send(`<!doctype html><html lang="ckb" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<title>${escapeHtml(doc.incoming_no)} — پسوولە</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap">
</head><body>${String(body)}</body></html>`);
  } catch (err) { next(err); }
});

export default router;
