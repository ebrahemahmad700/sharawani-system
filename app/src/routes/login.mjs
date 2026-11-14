// Sign in, sign out, forced password change.
//
// The screen is design/Login.dc.html. Every failure says the same thing, so the
// form cannot be used to work out which usernames exist. The log records the
// difference; the screen does not.

import { Router } from 'express';
import { login, logout, setSessionCookie, clearSessionCookie, COOKIE, hashPassword, requireAuth } from '../lib/auth.mjs';
import { withActor } from '../lib/db.mjs';
import { logEvent } from '../lib/log.mjs';
import { authPage, page } from '../views/layout.mjs';
import { html, raw } from '../lib/html.mjs';
import { toArabicIndic } from '../lib/ku.mjs';

const router = Router();

const icon = d => raw(`<svg class="auth-field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
const USER_ICON = icon('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>');
const LOCK_ICON = icon('<rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>');
const ARROW = raw(`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6 8 12l6 6"/><path d="M20 12H8.5"/></svg>`);

function loginPage({ error = null, notice = null, csrf, username = '' }) {
  return authPage({
    title: 'چوونەژوورەوە',
    body: html`
      <form method="post" action="/login" autocomplete="on" class="auth-form">
        <div class="auth-head">
          <div class="auth-welcome">بەخێربێیتەوە</div>
          <h1>چوونەژوورەوە بۆ سیستەم</h1>
        </div>

        ${error  ? html`<div class="notice error">${error}</div>` : ''}
        ${notice ? html`<div class="notice info">${notice}</div>` : ''}

        <input type="hidden" name="_csrf" value="${csrf}">

        <div class="field">
          <label for="username" class="required">ناوی بەکارهێنەر</label>
          <div class="auth-input">${USER_ICON}
            <input id="username" name="username" type="text" dir="ltr" required
                   autocomplete="username" autocapitalize="off" spellcheck="false"
                   value="${username}">
          </div>
        </div>

        <div class="field">
          <label for="password" class="required">وشەی نهێنی</label>
          <div class="auth-input">${LOCK_ICON}
            <input id="password" name="password" type="password" dir="ltr" required autocomplete="current-password">
          </div>
        </div>

        <button class="btn auth-submit" type="submit"><span>چوونەژوورەوە</span>${ARROW}</button>

        <div class="auth-note">
          هەژمار تەنها لەلایەن بەڕێوەبەرایەتی تەکنەلۆژیای زانیاری دروست دەکرێت. ئەگەر وشەی نهێنیت
          لەبیر چووە یان هەژمارت نییە، پەیوەندی بەوانەوە بکە.
        </div>
      </form>`,
  });
}

/**
 * Somebody opened the sign-in page while already signed in on this browser.
 *
 * Reported from the demo as "Shilan and Aram cannot be signed in at the same
 * time". On two computers they always could. On one browser they cannot, and no
 * website can: a browser holds one sign-in cookie per site, every tab shares it,
 * and signing in as Aram in a second tab turns the first tab into Aram as well.
 * What made it look broken was that this page used to jump straight back to the
 * first person's home screen, so there was no way even to try, and nothing said
 * why.
 *
 * So it says why, offers to carry on or to switch, and says how two people share
 * one computer: a private window, or a second browser, each of which keeps its
 * own cookie.
 */
function signedInPage({ user, csrf }) {
  return authPage({
    title: 'چوونەژوورەوە',
    body: html`
      <div class="auth-form">
        <div class="auth-head">
          <div class="auth-welcome">بەخێربێیتەوە</div>
          <h1>ئێستا چوویتە ژوورەوە</h1>
        </div>
        <p class="auth-sub">لەم وێبگەڕەدا وەک <strong>${user.fullName}</strong> چوویتە ژوورەوە.</p>
        <a class="btn auth-submit" href="/"><span>بەردەوامبوون وەک ${user.fullName}</span>${ARROW}</a>
        <form method="post" action="/login/switch">
          <input type="hidden" name="_csrf" value="${csrf}">
          <button class="btn secondary auth-submit" type="submit">چوونەژوورەوە وەک کەسێکی تر</button>
        </form>
        <div class="auth-note">
          <strong>دوو کەس لەسەر یەک کۆمپیوتەر؟</strong>
          هەموو تابەکانی یەک وێبگەڕ یەک هەژمار بەکاردەهێنن. بۆ ئەوەی دوو کەس لە هەمان کاتدا کار بکەن،
          کەسی دووەم پەنجەرەیەکی تایبەت بکاتەوە (<span dir="ltr">Ctrl+Shift+N</span>) یان وێبگەڕێکی تر
          (بۆ نموونە Edge و Chrome). لەسەر دوو کۆمپیوتەری جیا هیچ کێشەیەک نییە.
        </div>
      </div>`,
  });
}

router.get('/login', (req, res) => {
  if (req.user) return res.send(String(signedInPage({ user: req.user, csrf: res.locals.csrf })));
  res.send(String(loginPage({ csrf: res.locals.csrf, notice: req.query.switched ? 'چوویتە دەرەوە. ئێستا دەتوانیت بە هەژمارێکی تر بچیتە ژوورەوە.' : null })));
});

// Sign the current person out of this browser, and show the empty sign-in form.
router.post('/login/switch', async (req, res, next) => {
  try {
    if (req.user) await logout({ token: req.cookies?.[COOKIE], user: req.user, req });
    clearSessionCookie(res);
    res.redirect(303, '/login?switched=1');
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    // Signing in over somebody else's session in this browser ends that session
    // properly rather than leaving it valid with nobody holding its cookie.
    if (req.user) await logout({ token: req.cookies?.[COOKIE], user: req.user, req }).catch(() => {});
    const result = await login({ username: req.body.username, password: req.body.password, req });

    if (!result.ok) {
      // One message for every kind of failure. The log knows the difference.
      //
      // The throttle is the exception, and deliberately so: telling someone to
      // wait is not telling them whether the account exists, and a person who has
      // genuinely forgotten their password needs to know why the screen has
      // stopped responding to them rather than assume the system is broken.
      let error;
      let status = 401;
      if (result.reason === 'locked') {
        error = result.message || 'سیستەم بۆ چاککردن داخراوە. تکایە دواتر هەوڵبدەوە.';
      } else if (result.reason === 'throttled') {
        const secs = result.waitSeconds ?? 60;
        const when = secs >= 60
          ? `${toArabicIndic(Math.ceil(secs / 60))} خولەک`
          : `${toArabicIndic(secs)} چرکە`;
        error = `چەندین هەوڵی هەڵە دراوە. تکایە دوای ${when} هەوڵبدەوە.`;
        status = 429;
      } else {
        error = 'ناوی بەکارهێنەر یان وشەی نهێنی هەڵەیە.';
      }
      return res.status(status).send(String(loginPage({
        error, csrf: res.locals.csrf, username: String(req.body.username ?? '').slice(0, 32),
      })));
    }

    setSessionCookie(res, result.token);
    res.redirect(303, '/');
  } catch (err) { next(err); }
});

router.post('/logout', async (req, res, next) => {
  try {
    await logout({ token: req.cookies?.[COOKIE], user: req.user, req });
    clearSessionCookie(res);
    res.redirect(303, '/login');
  } catch (err) { next(err); }
});

// --- forced password change -------------------------------------------------
// A new account is created with must_change_password. requireAuth sends the
// person here and refuses to let them anywhere else until it is done.

// Forced after IT creates or resets an account; offered to everyone else from the
// name card in the sidebar. There was no way to reach it by choice, so somebody
// who thought their password had been seen had to ask IT for a reset (browser
// audit, 13 September).
function passwordPage({ user, csrf, error = null, forced = false, done = false }) {
  return page({
    user, title: 'گۆڕینی وشەی نهێنی', current: null,
    notice: error ? { kind: 'error', text: error } : done ? { kind: 'ok', text: 'وشەی نهێنی گۆڕدرا. دانیشتنەکانی تری ئەم هەژمارە کۆتایییان پێهێنرا.' } : null,
    body: html`
      <div class="card narrow">
        ${forced ? html`<h2>پێویستە وشەی نهێنیت بگۆڕیت</h2>` : ''}
        <p class="card-sub">${forced
          ? 'ئەم هەژمارە بە وشەیەکی نهێنی کاتی دروستکراوە. پێش بەکارهێنانی سیستەم بیگۆڕە.'
          : 'دوای گۆڕین، هەر شوێنێکی تر کە بەم هەژمارە چوویتە ژوورەوە دادەخرێت.'}</p>
        <form method="post" action="/password">
          <input type="hidden" name="_csrf" value="${csrf}">
          <div class="field">
            <label for="current" class="required">وشەی نهێنی ئێستا</label>
            <input id="current" name="current" type="password" required autocomplete="current-password">
          </div>
          <div class="field">
            <label for="next" class="required">وشەی نهێنی نوێ</label>
            <input id="next" name="next" type="password" required minlength="10" autocomplete="new-password">
            <div class="hint">لانیکەم ١٠ پیت.</div>
          </div>
          <div class="field">
            <label for="confirm" class="required">دووبارەکردنەوەی وشەی نوێ</label>
            <input id="confirm" name="confirm" type="password" required minlength="10" autocomplete="new-password">
          </div>
          <button class="btn" type="submit">پاشەکەوتکردن</button>
        </form>
      </div>`,
  });
}

router.get('/password', requireAuth, (req, res) => {
  res.send(String(passwordPage({ user: req.user, csrf: res.locals.csrf, forced: req.mustChangePassword, done: Boolean(req.query.changed) })));
});

router.post('/password', requireAuth, async (req, res, next) => {
  try {
    const { current, next: nextPw, confirm } = req.body;
    const fail = msg => res.status(400).send(String(
      passwordPage({ user: req.user, csrf: res.locals.csrf, error: msg, forced: req.mustChangePassword })));

    if (String(nextPw ?? '').length < 10) return fail('وشەی نوێ دەبێت لانیکەم ١٠ پیت بێت.');
    if (nextPw !== confirm)               return fail('وشە نوێیەکان وەک یەک نین.');
    if (nextPw === current)               return fail('وشەی نوێ نابێت وەک وشەی کۆن بێت.');

    // Re-check the current password rather than trusting the session alone: this
    // is the one action that would let someone at an unattended machine take the
    // account over permanently.
    const ok = await login({ username: req.user.username, password: current, req });
    if (!ok.ok) {
      // Without this, someone who mistypes their current password five times is
      // told the password is wrong when the truth is that they have been slowed
      // down, and they keep trying because the screen is lying to them.
      if (ok.reason === 'throttled') {
        const secs = ok.waitSeconds ?? 60;
        return fail(`چەندین هەوڵی هەڵە دراوە. تکایە دوای ${secs >= 60 ? `${toArabicIndic(Math.ceil(secs / 60))} خولەک` : `${toArabicIndic(secs)} چرکە`} هەوڵبدەوە.`);
      }
      return fail('وشەی نهێنی ئێستا هەڵەیە.');
    }

    const hash = await hashPassword(nextPw);
    await withActor(req.user, async q => {
      await q(`UPDATE app_user SET password_hash = $2, must_change_password = false WHERE id = $1`,
              [req.user.id, hash]);
      // Every other session for this person is ended. If the reason for changing
      // the password was that someone else knew it, this is what removes them.
      await q(`UPDATE user_session SET revoked_at = now()
                WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
              [req.user.id, req.sessionId]);
      await logEvent(q, { action: 'auth.password_changed', req, userId: req.user.id, sessionId: req.sessionId });
    });

    // A new person goes on to their own screen; somebody who chose to change it
    // is told it worked.
    res.redirect(303, req.mustChangePassword ? '/' : '/password?changed=1');
  } catch (err) { next(err); }
});

export default router;
