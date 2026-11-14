// Checking a letter (پشتڕاستکردنەوەی کتاب). Public, no account.
//
// Whoever is handed a letter from the municipality (a bank, a court, another
// directorate, the citizen's lawyer) scans the QR code on it or types the code
// printed under it, and this page says what the register holds for that code:
// the outgoing number, the date, who it was sent to, and whether it has since
// been cancelled. If the paper says something different, the paper is not ours.
//
// Built like the tracking page (routes/track.mjs), because it is the same kind
// of door: one SECURITY DEFINER function that can only ever return those five
// things, every attempt logged, and an address that keeps guessing is slowed
// down. It never shows the subject, the reply, or anything else in the letter.
//
// GET rather than POST so that the QR code can be a plain link. Nothing here
// changes anything except the log.

import { Router } from 'express';
import { withoutActor } from '../lib/db.mjs';
import { logEvent, clientIp } from '../lib/log.mjs';
import { normaliseCode, groupCode } from '../lib/verify.mjs';
import { authPage } from '../views/layout.mjs';
import { html, num, date, ltr } from '../lib/html.mjs';

const router = Router();

function shell({ typed = '', notice = null, result = null }) {
  return authPage({
    title: 'پشتڕاستکردنەوەی کتاب',
    wide: Boolean(result),
    body: html`
      <div class="auth-form">
        <div class="auth-head">
          <div class="auth-welcome">بۆ هەر کەسێک کتابێکی شارەوانی پێیە</div>
          <h1>پشتڕاستکردنەوەی کتاب</h1>
        </div>
        <p class="auth-sub">
          کۆدی سەر کتابەکە بنووسە، یان کۆدی QR ەکە بە مۆبایل بخوێنەرەوە، بۆ زانینی ئەوەی
          ئەم کتابە بەڕاستی لە شارەوانی ڕانیەوە دەرچووە.
        </p>

        ${notice ? html`<div class="notice ${notice.kind}">${notice.text}</div>` : ''}
        ${result ? resultCard(result) : ''}

        <form method="get" action="/verify" class="auth-form">
          <div class="field">
            <label for="code" class="required">کۆدی پشتڕاستکردنەوە</label>
            <input id="code" name="code" dir="ltr" autocomplete="off" autocapitalize="characters"
                   spellcheck="false" maxlength="16" required value="${typed}" placeholder="ABCD-EFGH-JK">
          </div>
          <button class="btn auth-submit" type="submit">پشتڕاستکردنەوە</button>
        </form>

        <div class="auth-note">
          ئەم پەڕەیە تەنها ژمارە و بەرواری کتاب و ناوی وەرگرەکەی پیشان دەدات، هیچ شتێکی ناوەڕۆکەکەی نا.
          هەموو هەوڵێک تۆمار دەکرێت.
        </div>
      </div>`,
  });
}

function resultCard(r) {
  if (r.cancelled) {
    return html`<div class="verify-result bad" role="status">
      <div class="verify-mark" aria-hidden="true">!</div>
      <div>
        <strong>ئەم کتابە هەڵوەشێنراوەتەوە</strong>
        <p>کتابی ژمارە <span class="mono">${ltr(r.outgoing_no)}</span> لە تۆماری شارەوانیدا هەڵوەشێنراوەتەوە و ئیتر بەکارنایەت.</p>
      </div>
    </div>`;
  }
  return html`<div class="verify-result good" role="status">
    <div class="verify-mark" aria-hidden="true">✓</div>
    <div>
      <strong>ئەم کتابە لە شارەوانی ڕانیەوە دەرچووە</strong>
      <table class="kv">
        <tbody>
          <tr><th>ژمارەی دەرچوو</th><td class="mono">${ltr(r.outgoing_no)}</td></tr>
          <tr><th>بەروار</th><td>${date(r.outgoing_date)}</td></tr>
          <tr><th>بۆ</th><td>${r.recipient ?? '—'}</td></tr>
        </tbody>
      </table>
      <p class="verify-compare">
        ئەم زانیارییانە لەگەڵ کتابە کاغەزییەکە بەراورد بکە. ئەگەر ژمارە، بەروار یان ناوی وەرگر جیاواز بوو،
        کتابەکە ساختەیە: پەیوەندی بە شارەوانییەوە بکە.
      </p>
    </div>
  </div>`;
}

async function check(req, res, next, typed) {
  const code = normaliseCode(typed);
  try {
    const outcome = await withoutActor(async q => {
      const { rows: [t] } = await q(`SELECT * FROM verify_throttle($1::inet)`, [clientIp(req)]);
      if (!t.allowed) {
        await logEvent(q, { action: 'verify.throttled', req, detail: { wait_seconds: t.wait_seconds } });
        return { kind: 'throttled', wait: t.wait_seconds };
      }
      if (!code) {
        await logEvent(q, { action: 'verify.miss', req, detail: { reason: 'malformed' } });
        return { kind: 'miss' };
      }
      const { rows: [r] } = await q(`SELECT * FROM public_verify($1)`, [code]);
      if (!r?.matched) {
        await logEvent(q, { action: 'verify.miss', req, detail: { reason: 'no_match' } });
        return { kind: 'miss' };
      }
      await logEvent(q, { action: 'verify.hit', req, detail: { cancelled: r.cancelled } });
      return { kind: 'hit', row: r };
    });

    res.setHeader('Cache-Control', 'no-store');
    if (outcome.kind === 'throttled') {
      return res.status(429).send(String(shell({
        typed,
        notice: { kind: 'error', text: `هەوڵی زۆر دراوە. تکایە ${num(outcome.wait)} چرکە چاوەڕێ بکە.` },
      })));
    }
    if (outcome.kind === 'miss') {
      return res.status(404).send(String(shell({
        typed,
        notice: { kind: 'error', text: 'هیچ کتابێک بەم کۆدە لە تۆماری شارەوانیدا نییە. کۆدەکە بپشکنە؛ ئەگەر دروستە، ئەم کتابە ساختەیە.' },
      })));
    }
    res.send(String(shell({ typed: groupCode(code), result: outcome.row })));
  } catch (err) { next(err); }
}

router.get('/verify', (req, res, next) => {
  if (!req.query.code) return res.send(String(shell({})));
  return check(req, res, next, String(req.query.code));
});

// What the QR code on the letter opens.
router.get('/v/:code', (req, res, next) => check(req, res, next, String(req.params.code)));

export default router;
