// The public tracking page (بەدواداچوونی داواکاری).
//
// The only screen in this system that a person with no account can open, which
// makes it the only one an attacker can reach. It is therefore written to a
// different rule from everything else: not "hide what this user may not see",
// but "there is nothing here to see".
//
// Everything it can return comes out of public_track() in migration 0360, which
// selects a stage, a room name and three dates and cannot be made to select
// anything else. This file adds no query of its own against document.
//
// Three defences, in order of how much they matter:
//
//   1. The PIN. The barcode is sequential and guessable; the six digits printed
//      on the applicant's receipt are not.
//   2. The throttle. Eight wrong tries from one address and the wait begins.
//      Without it, a million guesses is an afternoon.
//   3. Every miss is logged, which is also what feeds the throttle.
//
// POST rather than GET, so the PIN is not left in a browser history, a proxy log
// or a link somebody pastes into a chat.

import { Router } from 'express';
import { withoutActor } from '../lib/db.mjs';
import { logEvent, clientIp } from '../lib/log.mjs';
import { normaliseBarcode } from '../lib/barcode.mjs';
import { authPage, asset } from '../views/layout.mjs';
import { html, num, date, escapeHtml } from '../lib/html.mjs';

const router = Router();

// The five stages an applicant is told about. Deliberately coarser than the
// internal status: 'ready_to_close' is an internal distinction and an applicant
// asking where their paper is does not need to learn the difference.
const STAGE = {
  registered:     { label: 'تۆمارکرا',           step: 1, tone: 'info' },
  in_flow:        { label: 'لە بەردەستی ژوورەکاندایە', step: 2, tone: 'warn' },
  ready_to_close: { label: 'ئامادەی وەڵامدانەوەیە', step: 3, tone: 'warn' },
  closed:         { label: 'تەواوبوو',            step: 4, tone: 'ok' },
  cancelled:      { label: 'هەڵوەشێنراوە',        step: 0, tone: 'muted' },
};

const STEPS = ['تۆمارکردن', 'لێکۆڵینەوە', 'وەڵام', 'تەواو'];

function shell({ notice = null, result = null, barcode = '', csrf, scanned = false }) {
  return authPage({
    title: 'بەدواداچوونی داواکاری',
    wide: Boolean(result),
    body: html`
      <div class="auth-form">
        <div class="auth-head">
          <div class="auth-welcome">بۆ هاووڵاتیان</div>
          <h1>بەدواداچوونی داواکاری</h1>
        </div>
        <p class="auth-sub">
          ژمارەی بارکۆد و ژمارەی نهێنی سەر پسوولەکەت بنووسە بۆ زانینی ئەوەی
          داواکارییەکەت گەیشتووەتە کوێ.
        </p>

        ${notice ? html`<div class="notice ${notice.kind}">${notice.text}</div>` : ''}
        ${scanned && !notice ? html`<div class="notice info" data-scanned>
          ژمارەی بارکۆد خوێندرایەوە. تەنها ژمارەی نهێنی بنووسە.
        </div>` : ''}

        <form method="post" action="/track" class="auth-form">
          <input type="hidden" name="_csrf" value="${csrf}">
          <div class="field">
            <label for="barcode" class="required">ژمارەی بارکۆد</label>
            <input id="barcode" name="barcode" dir="ltr" inputmode="numeric"
                   autocomplete="off" maxlength="20" required
                   value="${barcode}" placeholder="20260000253">
          </div>
          <div class="field">
            <label for="pin" class="required">ژمارەی نهێنی</label>
            <input id="pin" name="pin" dir="ltr" inputmode="numeric"
                   autocomplete="off" maxlength="6" required placeholder="••••••">
          </div>
          <button class="btn auth-submit" type="submit">پیشاندان</button>
        </form>

        ${result ? resultCard(result) : ''}

        <div class="auth-note">
          ئەم پەڕەیە تەنها دۆخی داواکارییەکەت پیشان دەدات. ناوەڕۆکی هیچ کتابێک
          لێرەوە دەرناکەوێت.
        </div>
        <a href="/login">چوونەژوورەوەی کارمەندان</a>
      </div>
      <script src="${asset('/track.js')}"></script>`,
  });
}

// Where the paper is, in one sentence, because that is the question the person
// came to ask. The room name comes from public_track(), which names a room only
// while the letter is genuinely with one; before the first send and after the
// answer there is no room to name, and saying so plainly beats saying nothing.
function whereLine(r) {
  if (r.stage === 'cancelled') return { text: 'داواکارییەکە هەڵوەشێنراوەتەوە.', tone: 'muted' };
  if (r.stage === 'closed') {
    return { text: 'داواکارییەکەت تەواوبووە و وەڵامەکەی دەرچووە.', tone: 'ok' };
  }
  if (r.room_name) return { room: r.room_name, text: null, tone: 'warn' };
  return { text: 'تۆمارکراوە و هێشتا بۆ هیچ ژوورێک نەنێردراوە.', tone: 'info' };
}

function resultCard(r) {
  const stage = STAGE[r.stage] ?? { label: r.stage, step: 0, tone: 'muted' };
  const where = whereLine(r);

  return html`
    <div class="card" style="margin-top:18px;text-align:start">
      <div class="card-head">
        <h2>دۆخی داواکاری</h2>
        <div class="end"><span class="pill ${stage.tone}">${stage.label}</span></div>
      </div>

      <!-- The answer first. Everything under this is detail. -->
      <div class="track-where ${where.tone}">
        ${where.room
          ? html`<span class="k">ئێستا لە</span>
                 <strong class="v">${where.room}</strong>
                 ${r.last_moved_on ? html`<span class="s">دوایین جووڵە لە ${date(r.last_moved_on)}</span>` : ''}`
          : html`<strong class="v">${where.text}</strong>`}
      </div>

      <ol style="list-style:none;padding:0;margin:0">
        ${STEPS.map((label, i) => {
          const n = i + 1;
          const done = stage.step > n;
          const now = stage.step === n;
          return html`<li style="display:flex;gap:10px;align-items:center;padding:6px 0">
            <span style="width:22px;height:22px;border-radius:50%;flex:none;display:grid;place-items:center;
                         font-size:11px;font-weight:600;
                         background:${done ? 'var(--ok-bg)' : now ? 'var(--warn-bg)' : '#EFEDE5'};
                         color:${done ? 'var(--ok-fg)' : now ? 'var(--warn-fg)' : 'var(--muted)'}">
              ${done ? '✓' : num(n)}
            </span>
            <span style="${now ? 'font-weight:600' : done ? '' : 'color:var(--muted)'}">${label}</span>
          </li>`;
        })}
      </ol>

      <div class="table-wrap kv" style="margin-top:12px"><table><tbody>
        <tr><th>بەرواری تۆمار</th><td>${date(r.registered_on)}</td></tr>
        ${r.closed_on ? html`<tr><th>بەرواری وەڵام</th><td>${date(r.closed_on)}</td></tr>` : ''}
        ${where.room ? '' : html`<tr><th>دوایین جووڵە</th><td>${date(r.last_moved_on)}</td></tr>`}
        ${r.step_position && r.step_total
          ? html`<tr><th>ڕیزبەندی</th><td>${num(r.step_position)} لە ${num(r.step_total)}</td></tr>`
          : ''}
      </tbody></table></div>
    </div>`;
}

// ---------------------------------------------------------------------------

router.get('/track', (req, res) => {
  res.send(String(shell({ csrf: res.locals.csrf })));
});

/*
 * What the QR code on the receipt opens.
 *
 * The barcode is in the path, so the page can fill that box in. The PIN is in
 * the fragment after the hash, which a browser never sends to a server: it is
 * not in this request, not in the access log, and not in the referrer of
 * anything the phone opens afterwards. track.js reads it out of the address bar
 * and submits the form.
 *
 * With scripting off, or if the fragment was lost by whatever opened the link,
 * this is simply the tracking page with the long number already typed in, which
 * is most of the work anyway.
 */
router.get('/t/:barcode', (req, res) => {
  const barcode = normaliseBarcode(req.params.barcode) ?? '';
  res.send(String(shell({ csrf: res.locals.csrf, barcode, scanned: true })));
});

router.post('/track', async (req, res, next) => {
  const barcode = normaliseBarcode(req.body.barcode);
  const pin = String(req.body.pin ?? '').replace(/[^\d]/g, '');
  const ip = clientIp(req);

  try {
    const outcome = await withoutActor(async q => {
      const { rows: [t] } = await q(`SELECT * FROM track_throttle($1::inet)`, [ip]);
      if (!t.allowed) {
        await logEvent(q, { action: 'track.throttled', req, detail: { wait_seconds: t.wait_seconds } });
        return { kind: 'throttled', wait: t.wait_seconds };
      }

      // A barcode that fails its own check digit never reaches the database.
      // Still logged as a miss, because a run of them from one address is
      // exactly the shape of somebody trying numbers.
      if (!barcode || pin.length !== 6) {
        await logEvent(q, { action: 'track.miss', req, detail: { reason: 'malformed' } });
        return { kind: 'miss' };
      }

      const { rows: [r] } = await q(`SELECT * FROM public_track($1, $2)`, [barcode, pin]);

      if (!r?.matched) {
        await logEvent(q, { action: 'track.miss', req, detail: { reason: 'no_match' } });
        return { kind: 'miss' };
      }

      await logEvent(q, { action: 'track.hit', req, detail: { stage: r.stage } });
      return { kind: 'hit', row: r };
    });

    if (outcome.kind === 'throttled') {
      return res.status(429).send(String(shell({
        csrf: res.locals.csrf, barcode: req.body.barcode ?? '',
        notice: { kind: 'error', text: `هەوڵی زۆر دراوە. تکایە ${num(outcome.wait)} چرکە چاوەڕێ بکە.` },
      })));
    }

    if (outcome.kind === 'miss') {
      // One message for a wrong PIN, a wrong barcode and a barcode that does not
      // exist. Three messages would tell an attacker which half was right.
      return res.status(404).send(String(shell({
        csrf: res.locals.csrf, barcode: req.body.barcode ?? '',
        notice: { kind: 'error', text: 'هیچ داواکارییەک بەم ژمارانە نەدۆزرایەوە. تکایە پسوولەکەت بپشکنە.' },
      })));
    }

    res.send(String(shell({ csrf: res.locals.csrf, barcode, result: outcome.row })));
  } catch (err) { next(err); }
});

export default router;
