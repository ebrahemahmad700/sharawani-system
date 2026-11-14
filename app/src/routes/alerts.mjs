// Security alerts (ئاگادارییە ئەمنییەکان).
//
// The patterns migration 0530 watches for in the activity log, for the mayor and
// the deputy: somebody opening letters by the fifty, signing in at two in the
// morning, the IT account asking for a letter, a room downloading copies of
// letters that have left it, or somebody trying numbers.
//
// An alert is a pointer, not a verdict. The night sign-in may be the mayor's
// own driver sending a letter for him; the fifty letters may be the archive
// clerk doing the year-end check. So each line says what happened, who, when,
// and how many times, and links to that person's rows in the log where the
// actual story is. Marking it seen records who looked, which is itself logged.
//
// Only ids and counts reach this page from the alert. The letter number in an
// "other room" alert comes from a join to document under the mayor's own
// row-level security, the same way a notification shows a subject.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { ALERT_KINDS } from '../lib/notify.mjs';
import { page, ROLE_NAMES } from '../views/layout.mjs';
import { html, num, date, time, ltr } from '../lib/html.mjs';

const router = Router();

const WATCHERS = ['mayor', 'deputy_mayor'];

// The thresholds the rules read (system_setting), with what each means.
const SETTINGS = [
  ['alert_bulk_opens', 50, 'ژمارەی کتاب لە کاتژمێرێکدا', 5, 1000],
  ['alert_night_from', 22, 'شەو دەست پێدەکات (کاتژمێر)', 0, 23],
  ['alert_night_to',   6,  'شەو کۆتایی دێت (کاتژمێر)', 0, 23],
  ['alert_refusals',   10, 'ڕێگەپێنەدان لە نیو کاتژمێردا', 3, 500],
];

const DONE = { seen: 'وەک بینراو نیشانکرا.', all: 'هەموویان وەک بینراو نیشانکران.', settings: 'پاشەکەوتکرا.' };
// By name, never the text itself: a link must not be able to write on this page.
const ERRORS = {
  range: 'ژمارەکان لە سنووری ڕێگەپێدراو دەرچوون.',
  night: 'دەستپێک و کۆتایی شەو نابێت یەک کاتژمێر بن.',
};

const pad = n => String(n).padStart(2, '0');

/** One sentence of what the numbers in an alert mean. */
function what(a) {
  const d = a.detail ?? {};
  switch (a.kind) {
    case 'bulk_open':
      return html`${num(d.count ?? a.hits)} کتابی جیاوازی لە ماوەی کاتژمێرێکدا کردەوە.`;
    case 'night_login':
      return html`لە کاتژمێر ${num(`${pad(d.hour ?? 0)}:${pad(d.minute ?? 0)}`)} چووە ژوورەوە.`;
    case 'it_letter': {
      // The letter's own number when there is such a letter; an address with no
      // letter behind it is said as that, not as a number that looks like one.
      const which = a.target_no
        ? html`${d.what === 'attachment' ? 'هاوپێچێکی کتابی' : 'کتابی'} <a class="mono" href="/documents/${a.target_doc_id}">${ltr(a.target_no)}</a>`
        : html`${d.what === 'attachment' ? 'هاوپێچێک' : 'کتابێک'} کە بوونی نییە`;
      return html`هەوڵی کردنەوەی ${which} دا${a.hits > 1 ? ' (دوایین هەوڵ)' : ''}. هەژماری IT ڕێگەی خوێندنەوەی کتابی نییە.`;
    }
    case 'refusals':
      return html`${num(d.count ?? a.hits)} جار لە نیو کاتژمێردا داوای کتابێکی کرد کە ڕێگەی پێنەدرا.`;
    case 'other_room_download':
      return html`هاوپێچی کتابی ${a.incoming_no ? html`<a class="mono" href="/documents/${d.document_id}">${ltr(a.incoming_no)}</a>` : html`ژمارە ${num(d.document_id ?? '—')}`}
        داگرت${a.doc_room_name ? html`، کە ئێستا لە «${a.doc_room_name}»دایە` : ''}${a.hits > 1 ? ' (دوایینیان)' : ''}.`;
    default:
      return '';
  }
}

router.get('/alerts', requireAuth, requireRole(...WATCHERS), async (req, res, next) => {
  try {
    const show = req.query.show === 'all' ? 'all' : 'unseen';
    const { alerts, counts, settings } = await withActor(req.user, async q => {
      const { rows: alerts } = await q(`
        SELECT a.*, u.full_name AS user_name, u.username, u.role AS user_role,
               r.name AS user_room_name, s.full_name AS seen_by_name,
               d.incoming_no, dr.name AS doc_room_name,
               coalesce(td.id, ad.id) AS target_doc_id, coalesce(td.incoming_no, ad.incoming_no) AS target_no
          FROM security_alert a
          JOIN app_user u ON u.id = a.user_id
          LEFT JOIN room r ON r.id = u.room_id
          LEFT JOIN app_user s ON s.id = a.seen_by
          LEFT JOIN document d ON d.id = (a.detail ->> 'document_id')::bigint
          LEFT JOIN room dr ON dr.id = (a.detail ->> 'room_id')::bigint
          LEFT JOIN document td ON a.kind = 'it_letter' AND a.detail ->> 'what' = 'document'
                               AND td.id = (a.detail ->> 'target_id')::bigint
          LEFT JOIN attachment att ON a.kind = 'it_letter' AND a.detail ->> 'what' = 'attachment'
                                  AND att.id = (a.detail ->> 'target_id')::bigint
          LEFT JOIN document ad ON ad.id = att.document_id
         WHERE ($1 = 'all' OR a.seen_at IS NULL)
         ORDER BY a.last_at DESC
         LIMIT 200`, [show]);
      const { rows: [counts] } = await q(`
        SELECT count(*) FILTER (WHERE seen_at IS NULL) AS unseen, count(*) AS total FROM security_alert`);
      const { rows: [settings] } = await q(`
        SELECT ${SETTINGS.map(([k, d]) => `setting_int('${k}', ${d}) AS ${k}`).join(', ')}`);
      return { alerts, counts, settings };
    });

    const notice = DONE[req.query.done] ? { kind: 'ok', text: DONE[req.query.done] }
                 : ERRORS[req.query.error] ? { kind: 'error', text: ERRORS[req.query.error] } : null;

    res.send(page({
      user: req.user, title: 'ئاگادارییە ئەمنییەکان', current: '/alerts', notice,
      counts: { alerts: Number(counts.unseen) || null },
      body: html`
        <div class="card">
          <p class="card-sub">
            سیستەم تۆماری چالاکی دەپشکنێت و ئەم شتانە بە سەرۆک و جێگر ڕادەگەیەنێت: کردنەوەی ژمارەیەکی زۆر کتاب،
            چوونەژوورەوە لە کاتی شەودا، هەوڵی هەژماری IT بۆ کردنەوەی کتاب، داگرتنی هاوپێچی کتابی ژوورێکی تر،
            و هەوڵی دووبارە بۆ کتابی ڕێگەپێنەدراو. ئاگاداری بەڵگە نییە: بۆ زانینی چیرۆکەکە تۆماری ئەو کەسە ببینە.
          </p>
          <nav class="tabs" aria-label="پاڵاوتن">
            <a class="tab" href="/alerts"${show === 'unseen' ? html` aria-current="page"` : ''}>نەبینراو <span class="tab-count">${num(counts.unseen)}</span></a>
            <a class="tab" href="/alerts?show=all"${show === 'all' ? html` aria-current="page"` : ''}>هەمووی <span class="tab-count">${num(counts.total)}</span></a>
          </nav>
          ${alerts.length === 0 ? html`<div class="empty">${show === 'all' ? 'هێشتا هیچ ئاگادارییەک نییە.' : 'هیچ ئاگادارییەکی نەبینراو نییە.'}</div>` : html`
            <ul class="alert-list">
              ${alerts.map(a => html`<li class="${a.seen_at ? 'seen' : ''}">
                <div class="alert-main">
                  <div class="row">
                    <strong>${ALERT_KINDS[a.kind] ?? a.kind}</strong>
                    ${a.hits > 1 ? html`<span class="pill muted">${num(a.hits)} جار</span>` : ''}
                    ${a.seen_at ? html`<span class="pill ok">بینرا</span>` : html`<span class="pill danger">نوێ</span>`}
                  </div>
                  <div>
                    <strong>${a.user_name}</strong>
                    <span class="muted">(${ROLE_NAMES[a.user_role] ?? a.user_role}${a.user_room_name ? html` · ${a.user_room_name}` : ''})</span>
                    ${what(a)}
                  </div>
                  <div class="cell-sub">
                    ${date(a.first_at)} ${time(a.first_at)}${a.hits > 1 ? html` تا ${time(a.last_at)}` : ''}
                    ${a.seen_at ? html` · بینرا لەلایەن ${a.seen_by_name ?? '—'}، ${date(a.seen_at)} ${time(a.seen_at)}` : ''}
                  </div>
                </div>
                <div class="alert-actions">
                  <a class="btn small secondary" href="/log?user=${encodeURIComponent(a.username)}">تۆماری ئەم کەسە</a>
                  ${a.seen_at ? '' : html`
                    <form method="post" action="/alerts/${a.id}/seen">
                      <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                      <button class="btn small" type="submit">بینرا</button>
                    </form>`}
                </div>
              </li>`)}
            </ul>
            ${Number(counts.unseen) > 1 && show === 'unseen' ? html`
              <form method="post" action="/alerts/seen-all" class="after">
                <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                <button class="btn secondary" type="submit">هەموویان بینران</button>
              </form>` : ''}`}
        </div>

        <details class="card">
          <summary><strong>سنوورەکان</strong> <span class="muted">— کەی ئاگادار بکرێیتەوە</span></summary>
          <form method="post" action="/alerts/settings" class="after">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            <div class="grid cols-4">
              ${SETTINGS.map(([k, , label, min, max]) => html`
                <div class="field">
                  <label for="${k}" class="required">${label}</label>
                  <input id="${k}" name="${k}" type="number" min="${min}" max="${max}" required value="${settings[k]}">
                </div>`)}
            </div>
            <button class="btn" type="submit">پاشەکەوتکردن</button>
          </form>
        </details>`,
    }));
  } catch (err) { next(err); }
});

router.post('/alerts/:id(\\d+)/seen', requireAuth, requireRole(...WATCHERS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    await withActor(req.user, async q => {
      const { rowCount } = await q(
        `UPDATE security_alert SET seen_by = $2, seen_at = now() WHERE id = $1 AND seen_at IS NULL`,
        [id, req.user.id]);
      if (rowCount) {
        await logEvent(q, { action: 'alert.seen', req, userId: req.user.id, roomId: req.user.roomId, detail: { alert_id: id } });
      }
    });
    res.redirect(303, '/alerts?done=seen');
  } catch (err) { next(err); }
});

router.post('/alerts/seen-all', requireAuth, requireRole(...WATCHERS), async (req, res, next) => {
  try {
    await withActor(req.user, async q => {
      const { rowCount } = await q(
        `UPDATE security_alert SET seen_by = $1, seen_at = now() WHERE seen_at IS NULL`, [req.user.id]);
      if (rowCount) {
        await logEvent(q, { action: 'alert.seen', req, userId: req.user.id, roomId: req.user.roomId, detail: { count: rowCount } });
      }
    });
    res.redirect(303, '/alerts?done=all');
  } catch (err) { next(err); }
});

router.post('/alerts/settings', requireAuth, requireRole(...WATCHERS), async (req, res, next) => {
  const values = {};
  for (const [k, , , min, max] of SETTINGS) {
    const n = Number(req.body[k]);
    if (!Number.isInteger(n) || n < min || n > max) {
      return res.redirect(303, '/alerts?error=range');
    }
    values[k] = n;
  }
  if (values.alert_night_from === values.alert_night_to) {
    return res.redirect(303, '/alerts?error=night');
  }
  try {
    await withActor(req.user, async q => {
      for (const [k, v] of Object.entries(values)) {
        await q(`
          INSERT INTO system_setting (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [k, JSON.stringify(v), req.user.id]);
      }
      await logEvent(q, { action: 'system.setting_changed', req, userId: req.user.id, roomId: req.user.roomId, detail: values });
    });
    res.redirect(303, '/alerts?done=settings');
  } catch (err) { next(err); }
});

export default router;
