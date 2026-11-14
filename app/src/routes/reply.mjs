// Writing the reply (نووسینی وەڵام).
//
// Until now this system tracked a letter beautifully and then lost it at the
// last step. The letter arrives, gets a number, moves between rooms, collects
// opinions, and then somebody opens Word, types the reply from memory or from a
// printout of those opinions, prints it, and the system records only that
// something went out. Half the file lives here and half of it lives on one
// person's desktop, and the half on the desktop is the half the citizen gets.
//
// So the reply is written here, from the opinions the rooms actually wrote,
// printed on the municipality's letterhead, and it is the same object that then
// receives the outgoing number.
//
// THE ORDER MATTERS AND IT IS THE OFFICE'S ORDER, NOT THE SYSTEM'S
//
// A reply is drafted, then signed, then given a number as it leaves. Not the
// other way round. Numbering it first would burn a number on a draft the mayor
// sends back for rewriting, and a number in this building is never reused. So:
//
//   1. write it          the draft is saved on the letter, editable, no number
//   2. print it          letterhead, signature line, seal box, no number yet
//   3. issue and close   the number is drawn, the file closes, and the printed
//                        copy now carries it
//
// WHERE THE TEXT LIVES
//
// In document.outgoing_summary, which already exists, is already covered by
// row-level security, already appears on the folder cover and is already part of
// what a search looks through. The column was named for a one-line summary and
// now holds the reply itself; renaming it would rewrite five files to say the
// same thing, and the honest version of that trade is this paragraph.
//
// No new table, no new column, and nothing about the letter's own text leaves
// the row it belongs to.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { getDocument, registerOutgoingAndClose, DocumentError } from '../lib/documents.mjs';
import { trail } from '../lib/routing.mjs';
import { CHANNELS, options } from './registry.mjs';
import { page, bare } from '../views/layout.mjs';
import { html, raw, num, date, ltr, ltrText } from '../lib/html.mjs';
import { qrSvg } from '../lib/qr.mjs';
import { ensureVerifyCode, groupCode } from '../lib/verify.mjs';
import { unifyDigits } from '../lib/ku.mjs';
import { notFound, logRefusal } from '../lib/respond.mjs';

const router = Router();

// Who writes replies. The same people who may close a letter, plus the room head
// who did the work and would otherwise be dictating it down the corridor.
const WRITERS = ['mayor', 'deputy_mayor', 'registry_clerk', 'directorate_head', 'room_head'];
const CLOSERS = ['mayor', 'deputy_mayor', 'registry_clerk'];

const may = (user, list) => list.includes(user.role);

const refuse = (res, user, text) => res.status(403).send(page({
  user, title: 'ڕێگەپێنەدراو', current: null,
  body: html`<div class="card"><div class="empty">${text}</div></div>`,
}));

/**
 * What the rooms said, in the order they said it.
 *
 * This is the raw material of a reply and the reason the composer is worth
 * having: the person writing has the opinions beside the box instead of on a
 * printout beside the keyboard.
 */
function opinions(steps) {
  return steps
    .filter(s => s.reply_note && String(s.reply_note).trim())
    .map(s => ({
      room: s.to_room_name, when: s.completed_at,
      who: s.completed_by_name ?? s.assigned_to_name, text: s.reply_note,
    }));
}

/** A starting draft, so the box is not empty on a screen nobody has time for. */
function starter(doc, said) {
  const lines = [
    `بۆ / ${doc.sender_name}`,
    '',
    // The date as the printed header writes it, in Kurdish digits. It was
    // 2026-09-13 in the draft and ٢٠٢٦/٠٩/١٣ in the header of the same sheet.
    `ئاماژە بە کتابەکەت ژمارە ${ltrText(doc.incoming_no)} لە ${date(doc.incoming_date)}`,
    doc.plot_no ? `سەبارەت بە پارچە ${unifyDigits(doc.plot_no)}${doc.neighbourhood ? ` لە گەڕەکی ${doc.neighbourhood}` : ''}` : null,
    '',
  ].filter(v => v !== null);

  if (said.length) {
    lines.push('پاش پێداچوونەوە لە ژوورە پەیوەندیدارەکان:');
    lines.push('');
    for (const o of said) lines.push(`— ${o.text}`);
    lines.push('');
  }
  lines.push('لەگەڵ ڕێزدا،');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

router.get('/documents/:id(\\d+)/reply', requireAuth, async (req, res, next) => {
  try {
    if (!may(req.user, WRITERS)) {
      return refuse(res, req.user, 'نووسینی وەڵام بۆ ئەم هەژمارە کراوە نییە.');
    }
    const id = Number(req.params.id);
    const data = await withActor(req.user, async q => {
      const doc = await getDocument(q, id);
      if (!doc) return null;
      return { doc, steps: await trail(q, id) };
    });
    if (!data) { await logRefusal(req, 'document', req.params.id); return notFound(req, res, 'ئەم کتابە نەدۆزرایەوە.'); }

    const { doc, steps } = data;
    const said = opinions(steps);
    const draft = doc.outgoing_summary ?? starter(doc, said);
    const closed = Boolean(doc.outgoing_no);

    const notice = req.query.saved ? { kind: 'ok', text: 'ڕەشنووسی وەڵام پاشەکەوتکرا.' }
                 : req.query.error ? { kind: 'error', text: String(req.query.error) }
                 : null;

    res.send(page({
      user: req.user,
      title: `وەڵامی ${ltrText(doc.incoming_no)}`,
      current: '/documents',
      notice,
      // One action in the top bar. With two, the bar wrapped on a phone and
      // stood 218px tall (design test, 13 September); going back to the letter
      // is under the text instead.
      actions: html`
        <a class="btn secondary" href="/documents/${doc.id}/reply/print" target="_blank">چاپی وەڵام</a>`,
      body: html`
        <div class="grid cols-2">
          <div>
            <form method="post" action="/documents/${doc.id}/reply">
              <input type="hidden" name="_csrf" value="${res.locals.csrf}">
              <div class="card">
                ${closed ? html`
                  <div class="notice info">
                    ئەم کتابە داخراوە بە ژمارەی دەرچوو <span class="mono" dir="ltr">${doc.outgoing_no}</span>.
                    دەقەکە بۆ خوێندنەوەیە و ناتوانرێت بگۆڕدرێت.
                  </div>` : ''}

                <div class="field">
                  <label for="recipient" class="required">وەرگر</label>
                  <input id="recipient" name="recipient" type="text" required maxlength="200"
                         value="${doc.outgoing_recipient ?? doc.sender_name}" ${closed ? 'disabled' : ''}>
                </div>

                <div class="field">
                  <label for="body" class="required">دەقی وەڵام</label>
                  <textarea id="body" name="body" rows="18" required maxlength="12000"
                            ${closed ? 'disabled' : ''}>${draft}</textarea>
                  <div class="hint">
                    وەک لەسەر کاغەز دەینووسیت. لە چاپکردندا لەسەر سەرپەڕەی شارەوانی دەردەکەوێت.
                  </div>
                </div>

                <div class="row">
                  ${closed ? '' : html`<button class="btn" type="submit">پاشەکەوتکردنی ڕەشنووس</button>`}
                  <a class="btn secondary" href="/documents/${doc.id}">گەڕانەوە بۆ کتابەکە</a>
                </div>
              </div>
            </form>

            ${closed || !may(req.user, CLOSERS) ? '' : html`
              <form method="post" action="/documents/${doc.id}/reply/send">
                <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                <div class="card">
                  <h2>داخستنی کتاب</h2>
                  <p class="card-sub">
                    ژمارەی دەرچوو دەدرێت و کتابەکە دادەخرێت. ژمارە جارێکی تر
                    بەکارناهێنرێتەوە، بۆیە دوای واژووکردن ئەمە لێبدە، نەک پێشی.
                  </p>
                  <div class="grid cols-2">
                    <div class="field">
                      <label for="recipient2" class="required">وەرگر</label>
                      <input id="recipient2" name="recipient" type="text" required maxlength="200"
                             value="${doc.outgoing_recipient ?? doc.sender_name}">
                    </div>
                    <div class="field">
                      <label for="channel">ڕێگای ناردن</label>
                      <select id="channel" name="channel">${options(CHANNELS, 'hand')}</select>
                    </div>
                  </div>
                  <button class="btn" type="submit">وەرگرتنی ژمارەی دەرچوو و داخستن</button>
                </div>
              </form>`}
          </div>

          <div>
            <div class="card">
              <h2>ئەوەی ژوورەکان نووسیویانە</h2>
              ${said.length === 0 ? html`
                <div class="empty">هێشتا هیچ ژوورێک ڕایەکی نەنووسیوە لەسەر ئەم کتابە.</div>` : html`
                <ul class="trail">
                  ${said.map(o => html`<li class="done">
                    <div class="when">${date(o.when)} · ${o.room}${o.who ? ` · ${o.who}` : ''}</div>
                    <div>${o.text}</div>
                  </li>`)}
                </ul>
                <p class="muted" style="margin-bottom:0">
                  ئەمانە خۆکار لە ڕەشنووسەکەدا دانراون. ئەوەی پێویست نییە بیسڕەوە.
                </p>`}
            </div>
          </div>
        </div>
      `,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Saving the draft
// ---------------------------------------------------------------------------

router.post('/documents/:id(\\d+)/reply', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    if (!may(req.user, WRITERS)) return refuse(res, req.user, 'ڕێگەپێنەدراو.');
    const body = (req.body.body ?? '').toString().trim();
    const recipient = (req.body.recipient ?? '').toString().trim();
    if (!body) throw new DocumentError('دەقی وەڵام بەتاڵە.', 'empty_reply');
    if (body.length > 12000) throw new DocumentError('دەقی وەڵام زۆر درێژە.', 'long_reply');

    await withActor(req.user, async q => {
      const { rows: [doc] } = await q(
        `SELECT id, outgoing_no, status FROM document WHERE id = $1`, [id]);
      if (!doc) throw new DocumentError('ئەم کتابە نەدۆزرایەوە.', 'not_found');
      // A closed letter's reply is the record of what was sent. Editing it
      // afterwards would let the file disagree with the paper the citizen holds.
      if (doc.outgoing_no) throw new DocumentError('ئەم کتابە داخراوە و ناتوانرێت وەڵامەکەی بگۆڕدرێت.', 'already_out');
      if (doc.status === 'cancelled') throw new DocumentError('ئەم کتابە هەڵوەشێنراوەتەوە.', 'cancelled');

      await q(`UPDATE document
                  SET outgoing_summary = $2,
                      outgoing_recipient = coalesce(nullif($3, ''), outgoing_recipient),
                      updated_at = now()
                WHERE id = $1`, [id, body, recipient]);

      // The text itself never reaches the log. Its length does, which is enough
      // to show that a draft was written and roughly how much of it.
      await logEvent(q, {
        action: 'document.updated', req, userId: req.user.id, roomId: req.user.roomId,
        documentId: id, detail: { field: 'reply_draft', length: body.length },
      });
    });

    res.redirect(303, `/documents/${id}/reply?saved=1`);
  } catch (err) {
    if (err instanceof DocumentError) {
      return res.redirect(303, `/documents/${id}/reply?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Issuing the number and closing
// ---------------------------------------------------------------------------

router.post('/documents/:id(\\d+)/reply/send', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    if (!may(req.user, CLOSERS)) return refuse(res, req.user, 'دەرکردنی ژمارەی دەرچوو بۆ ئەم هەژمارە نییە.');

    await withActor(req.user, async q => {
      const { rows: [doc] } = await q(`SELECT outgoing_summary FROM document WHERE id = $1`, [id]);
      if (!doc?.outgoing_summary || !doc.outgoing_summary.trim()) {
        throw new DocumentError('سەرەتا دەقی وەڵام بنووسە و پاشەکەوتی بکە.', 'no_reply');
      }
      // The existing close path, unchanged: it is what issues the number, closes
      // any step still open and writes the log row. Passing the draft back in as
      // the summary means the column keeps exactly what was drafted.
      return registerOutgoingAndClose(q, {
        documentId: id,
        recipient: req.body.recipient,
        summary: doc.outgoing_summary,
        channel: req.body.channel || 'hand',
        byUser: req.user, req,
      });
    });

    res.redirect(303, `/documents/${id}?closed=1`);
  } catch (err) {
    if (err instanceof DocumentError) {
      return res.redirect(303, `/documents/${id}/reply?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// The printed letter
// ---------------------------------------------------------------------------
//
// Printed by the browser, like everything else here, because the browser is the
// only thing in the stack that shapes Kurdish text correctly. A PDF written
// server-side would need a font embedded and the joining rules applied by hand,
// and would come out as disconnected letters on the mayor's desk.

router.get('/documents/:id(\\d+)/reply/print', requireAuth, async (req, res, next) => {
  try {
    if (!may(req.user, WRITERS)) return refuse(res, req.user, 'ڕێگەپێنەدراو.');
    const id = Number(req.params.id);

    const data = await withActor(req.user, async q => {
      const doc = await getDocument(q, id);
      if (!doc) return null;
      // A cancelled letter has no reply and never will. Printing one would put a
      // blank sheet of municipal letterhead, carrying a real subject line, in
      // somebody's hand. The screen already hides the button; this is the rule
      // behind it.
      if (doc.status === 'cancelled') return { cancelled: true };
      await logEvent(q, {
        action: 'document.printed', req, userId: req.user.id,
        roomId: req.user.roomId, documentId: id, detail: { what: 'reply' },
      });
      // Only a letter with an outgoing number gets one; a draft stays a draft.
      const code = doc.outgoing_no ? await ensureVerifyCode(q, id, req) : null;
      return { doc, code };
    });
    if (!data) { await logRefusal(req, 'document', req.params.id); return notFound(req, res); }
    if (data.cancelled) {
      return refuse(res, req.user, 'ئەم کتابە هەڵوەشێنراوەتەوە، بۆیە وەڵامی نییە.');
    }
    const { doc, code } = data;

    const base = process.env.PUBLIC_BASE_URL
      || `${req.protocol}://${req.get('host') ?? 'localhost'}`;

    const text = (doc.outgoing_summary ?? '').toString();

    res.send(bare({
      title: `وەڵامی ${ltrText(doc.incoming_no)}`,
      body: html`
        <style>
          @page { size: A4; margin: 22mm 20mm 18mm; }
          /* The values every printed sheet uses: pt sizes, a 17pt title over an
             11.5pt body, the green rule under the letterhead, #555 for muted text. */
          body { font-family: Vazirmatn, "Noto Sans Arabic", Tahoma, sans-serif; color:#111;
                 font-size: 11.5pt; line-height: 1.9; margin: 0; }
          .head { display:flex; align-items:center; gap:10.5pt; border-bottom:2px solid #0E3A28;
                  padding-bottom:7.5pt; margin-bottom:4.5pt; }
          .seal { width:39pt; height:39pt; border-radius:50%; background:#C99A2E; flex:0 0 39pt; }
          .head h1 { font-size:17pt; margin:0; }
          .head .sub { font-size:10pt; color:#555; }
          .nos { margin-inline-start:auto; text-align:left; font-size:10pt; line-height:1.6; }
          .nos b { font-size:13pt; }
          .draft { color:#b00; font-weight:600; }
          .meta { display:flex; justify-content:space-between; font-size:10pt; color:#555;
                  margin: 7.5pt 0 16.5pt; }
          .subject { font-weight:700; margin-bottom:10.5pt; }
          .body { white-space: pre-wrap; min-height: 90mm; }
          .sign { margin-top: 19.5pt; display:flex; justify-content:space-between; align-items:flex-end; }
          .sign .line { width: 70mm; border-top:1px solid #555; padding-top:4pt; text-align:center;
                        font-size:10pt; color:#555; }
          .sealbox { width:38mm; height:38mm; border:1px dashed #999; border-radius:50%;
                     display:flex; align-items:center; justify-content:center; font-size:9pt; color:#555; }
          .foot { margin-top:12pt; border-top:1px solid #ddd; padding-top:4.5pt;
                  font-size:9pt; color:#555; display:flex; justify-content:space-between; align-items:center; }
          .foot .qr { text-align:center; }
          .foot .qr svg { display:block; margin:0 auto; }
          .foot .qr.verify { display:flex; flex-direction:column; align-items:center; gap:1pt; font-size:8pt; line-height:1.35; }
          .foot .qr.verify b { font-family: monospace; font-size:10pt; letter-spacing:1px; color:#111; }
          @media screen { body { max-width:190mm; margin:15pt auto; padding:0 9pt; } }
        </style>

        <div class="head">
          <div class="seal"></div>
          <div>
            <h1>شارەوانی ڕانیە</h1>
            <div class="sub">هەرێمی کوردستان — عێراق</div>
          </div>
          <div class="nos">
            ژمارە:
            ${doc.outgoing_no
              ? html`<b dir="ltr">${doc.outgoing_no}</b>`
              : html`<span class="draft">ڕەشنووس — ژمارە نەدراوە</span>`}
            <div>بەروار: ${date(doc.outgoing_date ?? new Date())}</div>
          </div>
        </div>

        <div class="meta">
          <div>بۆ / <strong>${doc.outgoing_recipient ?? doc.sender_name}</strong></div>
          <div>ئاماژە: کتابی ژمارە <span dir="ltr">${doc.incoming_no}</span> — ${date(doc.incoming_date)}</div>
        </div>

        <div class="subject">ب/ ${doc.subject}</div>

        <div class="body">${text}</div>

        <div class="sign">
          <div class="sealbox">مۆر</div>
          <div class="line">واژووی سەرۆکی شارەوانی</div>
        </div>

        <div class="foot">
          <div>
            شارەوانی ڕانیە · سیستەمی بەڕێوەبردنی دۆکیومێنت
            ${doc.outgoing_no ? '' : html`<div class="draft">ئەم پەڕەیە ڕەشنووسە. تا ژمارەی دەرچووی پێنەدرێت فەرمی نییە.</div>`}
          </div>
          ${code ? html`
            <!-- Anyone handed this letter can check it against the register
                 (routes/verify.mjs). The QR opens the check; the code under it
                 is for typing in by hand. -->
            <div class="qr verify">
              ${raw(qrSvg(`${base}/v/${code}`, { sizeMm: 20 }))}
              <span>پشتڕاستکردنەوەی ئەم کتابە</span>
              <b dir="ltr">${groupCode(code)}</b>
              <span dir="ltr">${base.replace(/^https?:\/\//, '')}/verify</span>
            </div>` : html`
            <div class="qr">
              ${raw(qrSvg(`${base}/documents/${doc.id}`, { sizeMm: 18 }))}
              <span>فایلی کتاب</span>
            </div>`}
        </div>
      `,
    }));
  } catch (err) { next(err); }
});

export default router;
