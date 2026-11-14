// The one way a screen says "not found" or "not for you".
//
// There were four: a green sign-in card with no menu, the application shell with
// an empty card, the English words "not found" on a white page, and a bare line
// of Kurdish. Somebody who followed an old link or typed an address wrongly lost
// the menu and every way back except the browser's Back button. Found by the
// browser audit of 13 September.
//
// Signed in, the answer is the ordinary page with the menu. Signed out, it is the
// small card, because there is no menu to show and the sign-in page is the way on.

import { html } from './html.mjs';
import { page, authPage } from '../views/layout.mjs';

export function statusPage(req, res, status, { title, text, back = '/', backLabel = 'گەڕانەوە' }) {
  // A refusal is not something to keep either; see the no-store note in server.mjs.
  res.setHeader('Cache-Control', 'no-store');
  if (req.user && req.user.csrf !== undefined) {
    return res.status(status).send(String(page({
      user: req.user, title, current: null,
      body: html`<div class="card status-card">
        <div class="empty">${text}</div>
        <div class="row" style="justify-content:center"><a class="btn secondary" href="${back}">${backLabel}</a></div>
      </div>`,
    })));
  }
  return res.status(status).send(String(authPage({
    title,
    body: html`<div class="auth-form">
      <div class="auth-head"><h1>${title}</h1></div>
      <p class="auth-sub">${text}</p>
      <a class="btn auth-submit" href="${req.user ? back : '/login'}">${req.user ? backLabel : 'چوونەژوورەوە'}</a>
    </div>`,
  })));
}

export const notFound = (req, res, text = 'ئەوەی داوات کرد نەدۆزرایەوە، یان ڕێگەت پێنەدراوە بیبینیت.') =>
  statusPage(req, res, 404, { title: 'نەدۆزرایەوە', text });

export const refused = (req, res, text = 'ئەم بەشە بۆ ڕۆڵی تۆ نییە.') =>
  statusPage(req, res, 403, { title: 'ڕێگەپێنەدراو', text });

export const badRequest = (req, res, text, back) =>
  statusPage(req, res, 400, { title: 'نەکرا', text, back: back ?? '/' });

/**
 * Write down that somebody asked for a letter or an attachment and was not shown
 * it: it does not exist, or it is not theirs to see. Refusals were not logged at
 * all, so IT opening letter addresses or somebody walking the numbers left no
 * trace. Migration 0530 watches these rows and tells the mayor.
 *
 * Never throws: a refusal page must not become an error page because the log
 * could not be written.
 */
export async function logRefusal(req, what, targetId) {
  if (!req.user) return;
  try {
    const { withActor } = await import('./db.mjs');
    const { logEvent } = await import('./log.mjs');
    await withActor(req.user, q => logEvent(q, {
      action: 'access.refused', req, userId: req.user.id, roomId: req.user.roomId ?? null,
      detail: { what, target_id: Number(targetId) || null, path: String(req.path).slice(0, 120) },
    }));
  } catch (err) {
    console.error('[refusal] could not be logged:', err.message);
  }
}
