// The transaction type catalogue (جۆرەکانی مامەڵە).
//
// The nine values in the doc_type enum are what the rules and the reports are
// written against, and they do not change. What the clerk at the counter ticks
// is finer than that and grows every few months, and until now the only way to
// add one was to alter an enum, which is a deployment.
//
// So this screen edits a table instead. Every row names one of the nine as its
// base_kind, which is what keeps a new type from escaping the rules: adding
// "مۆڵەتی بیناسازی" as a citizen_request changes the form and changes nothing
// about how the system reasons.
//
// A row can be switched off but never deleted, because letters point at it and a
// letter whose type has vanished is worse than one with an old type name.
//
// The default room and default days are the reason this pays for itself. For
// most letters the answer to "where does this go" is always the same, and a
// clerk who does not have to decide does not decide wrongly.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { page } from '../views/layout.mjs';
import { html, num, ltr } from '../lib/html.mjs';
import { DOC_TYPES } from './registry.mjs';

const router = Router();

const EDITORS = ['registry_clerk', 'mayor', 'deputy_mayor', 'sysadmin'];

// The green line after a form. It used to show whatever text ?ok= carried, so
// any link could put words of its choosing on this page; now the address names
// what happened and the words are these (design rules, 13 September).
const DONE = { created: 'زیادکرا.', deactivated: 'ناچالاککرا.', activated: 'چالاککرایەوە.', timing: 'پاشەکەوتکرا.', ladder: 'پاشەکەوتکرا.' };

// Who sets the escalation ladder for the whole municipality (migration 0520):
// how long before a late letter reaches a room head, and the mayor. The mayor's
// own bell, so the mayor's decision.
const LADDER_EDITORS = ['mayor', 'deputy_mayor'];

// A whole number of days in a range, or null for "use the default".
const days = (v, min, max) => {
  const n = String(v ?? '').trim() === '' ? NaN : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const doneText = d => (typeof d === 'string' && Object.hasOwn(DONE, d) ? DONE[d] : DONE.created);

// The red line, by name, for the same reason: ?error= used to carry the sentence.
const ERRORS = {
  required:   'ناو و پۆلی بنەڕەتی پێویستن.',
  code:       'کۆد دەبێت بە پیتی ئینگلیزی بێت، بێ بۆشایی.',
  duplicate:  'ئەم کۆدە پێشتر هەیە.',
  invalid:    'زانیارییەکان شێوەیان هەڵەیە.',
  order:      'سەرۆک دەبێت دوای بەرپرسی ژوور ئاگادار بکرێتەوە.',
  range:      'ژمارەکان لە سنووری ڕێگەپێدراو دەرچوون: ماوە ١–٦٠، بەرپرس ١–٦٠، سەرۆک ٢–٩٠ ڕۆژ.',
  ladder_missing: 'هەر سێ ژمارەکە پێویستن.',
  ladder_range:   'ژمارەکان دەبێت ژمارەی تەواو بن: بیرخستنەوە ١–٣٠، بەرپرس ١–٦٠، سەرۆک ٢–٩٠.',
  ladder_order:   'ڕیزبەندییەکە دەبێت ئەمە بێت: بیرخستنەوە، پاشان بەرپرسی ژوور، پاشان سەرۆک.',
};
const errorText = e => (typeof e === 'string' && Object.hasOwn(ERRORS, e) ? ERRORS[e] : null);

// A number of days from a form: '' for left empty, null for not a whole number in range.
const daysField = (v, min, max) => {
  if (String(v ?? '').trim() === '') return '';
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

router.get('/admin/doc-types', requireAuth, requireRole(...EDITORS), async (req, res, next) => {
  try {
    const { types, rooms, ladder } = await withActor(req.user, async q => {
      const { rows: types } = await q(`
        SELECT t.*, r.name AS default_room_name,
               (SELECT count(*) FROM document d WHERE d.doc_type_option_id = t.id) AS used
          FROM doc_type_option t
          LEFT JOIN room r ON r.id = t.default_room_id
         ORDER BY t.is_active DESC, t.sort_order, t.name_sort`);
      const { rows: rooms } = await q(
        `SELECT id, name, room_number FROM room WHERE is_active ORDER BY sort_order, name`);
      const { rows: [ladder] } = await q(`
        SELECT setting_int('escalate_reminder_days', 1) AS reminder,
               setting_int('escalate_head_days', 3)     AS head,
               setting_int('escalate_mayor_days', 5)    AS mayor`);
      return { types, rooms, ladder };
    });
    const canLadder = LADDER_EDITORS.includes(req.user.role);

    res.send(page({
      user: req.user, title: 'جۆرەکانی مامەڵە', current: '/admin/doc-types',
      notice: req.query.ok    ? { kind: 'ok',    text: doneText(req.query.done) }
            : errorText(req.query.error) ? { kind: 'error', text: errorText(req.query.error) }
            : null,
      body: html`
        ${canLadder ? html`
        <div class="card" id="ladder">
          <h2>پلەکانی بەرزکردنەوەی دواکەوتن</h2>
          <p class="card-sub">
            کاتێک کتابێک لە کاتی خۆی تێدەپەڕێت، ئەم ژمارانە دیاری دەکەن دوای چەند ڕۆژ کێ ئاگادار دەکرێتەوە.
            هەر جۆرێکی مامەڵە دەتوانێت ژمارەی خۆی هەبێت.
          </p>
          <form method="post" action="/admin/doc-types/ladder">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            <div class="grid cols-3">
              <div class="field">
                <label for="ladder_reminder" class="required">بیرخستنەوەی کەسی بەرپرس دوای (ڕۆژ)</label>
                <input id="ladder_reminder" name="reminder" type="number" min="1" max="30" required value="${ladder.reminder}">
              </div>
              <div class="field">
                <label for="ladder_head" class="required">ئاگادارکردنەوەی بەرپرسی ژوور دوای (ڕۆژ)</label>
                <input id="ladder_head" name="head" type="number" min="1" max="60" required value="${ladder.head}">
              </div>
              <div class="field">
                <label for="ladder_mayor" class="required">گەیشتن بە سەرۆک دوای (ڕۆژ)</label>
                <input id="ladder_mayor" name="mayor" type="number" min="2" max="90" required value="${ladder.mayor}">
              </div>
            </div>
            <button class="btn" type="submit">پاشەکەوتکردن</button>
          </form>
        </div>` : ''}

        <div class="card">
          <h2>جۆری نوێ</h2>
          <form method="post" action="/admin/doc-types">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            <div class="grid cols-3">
              <div class="field">
                <label for="name" class="required">ناو</label>
                <input id="name" name="name" required maxlength="120" placeholder="مۆڵەتی بیناسازی">
              </div>
              <div class="field">
                <label for="code" class="required">کۆد</label>
                <input id="code" name="code" dir="ltr" required maxlength="24"
                       pattern="[A-Za-z](?:[A-Za-z0-9]|-){1,23}" placeholder="BUILD-PERMIT">
              </div>
              <div class="field">
                <label for="base_kind" class="required">پۆلی بنەڕەتی</label>
                <select id="base_kind" name="base_kind" required>
                  ${DOC_TYPES.map(([k, label]) => html`<option value="${k}">${label}</option>`)}
                </select>
                <div class="hint">ئەمە ئەو پۆلەیە کە یاساکانی سیستەم پێی دەزانن.</div>
              </div>
              <div class="field">
                <label for="category">پۆل</label>
                <input id="category" name="category" maxlength="60" placeholder="زەوی و زار">
              </div>
              <div class="field">
                <label for="default_room_id">ژووری بنەڕەت</label>
                <select id="default_room_id" name="default_room_id">
                  <option value="">— هیچ —</option>
                  ${rooms.map(r => html`<option value="${r.id}">${r.name}${r.room_number ? html` (${num(r.room_number)})` : ''}</option>`)}
                </select>
              </div>
              <div class="field">
                <label for="default_due_days">ماوە (ڕۆژ)</label>
                <input id="default_due_days" name="default_due_days" type="number" min="1" max="60">
              </div>
              <div class="field">
                <label for="escalate_head_days">بەرپرسی ژوور دوای (ڕۆژ)</label>
                <input id="escalate_head_days" name="escalate_head_days" type="number" min="1" max="60" placeholder="${num(ladder.head)}">
              </div>
              <div class="field">
                <label for="escalate_mayor_days">سەرۆک دوای (ڕۆژ)</label>
                <input id="escalate_mayor_days" name="escalate_mayor_days" type="number" min="2" max="90" placeholder="${num(ladder.mayor)}">
              </div>
              <div class="field">
                <label for="description">وەسف</label>
                <input id="description" name="description" maxlength="400">
              </div>
            </div>
            <div class="hint after-grid">
              «بەرپرسی ژوور» و «سەرۆک»: دوای چەند ڕۆژ دواکەوتن ئاگادار دەکرێنەوە. بەتاڵ بێت، ژمارەی گشتی بەکاردێت.
            </div>
            <div class="field">
              <label><input type="checkbox" name="requires_seal" value="1"> پێویستی بە مۆری فەرمییە</label>
            </div>
            <button class="btn" type="submit">زیادکردن</button>
          </form>
        </div>

        <div class="card">
          <p class="card-sub">
            ئەمانە ئەو هەڵبژاردانەن کە لە فۆڕمی تۆمارکردندا دەردەکەون. دەتوانیت
            جۆری نوێ زیاد بکەیت، بەڵام ناسڕدرێنەوە، چونکە کتابی کۆن ئاماژەیان پێ دەکات.
          </p>

          <div class="table-wrap"><table>
            <thead><tr>
              <th>ناو</th><th>کۆد</th><th>پۆل</th><th>ژووری بنەڕەت</th>
              <th>ماوە (ڕۆژ)</th><th>بەرزکردنەوە</th><th>مۆر</th><th>بەکارهاتوو</th><th class="actions"><span class="sr-only">کردار</span></th>
            </tr></thead>
            <tbody>${types.map(t => html`<tr class="${t.is_active ? '' : 'inactive'}">
              <td>${t.name}${t.is_builtin ? html` <span class="pill muted">بنەڕەتی</span>` : ''}</td>
              <td class="muted">${ltr(t.code)}</td>
              <td class="muted">${t.category ?? '—'}</td>
              <td class="muted">${t.default_room_name ?? '—'}</td>
              <td class="muted">${t.default_due_days ? num(t.default_due_days) : '—'}</td>
              <td class="muted nowrap">
                ${t.escalate_head_days || t.escalate_mayor_days
                  ? html`${num(t.escalate_head_days ?? ladder.head)} / ${num(Math.max(t.escalate_mayor_days ?? ladder.mayor, (t.escalate_head_days ?? ladder.head) + 1))} ڕۆژ`
                  : 'گشتی'}
                <details class="timing">
                  <summary>گۆڕین</summary>
                  <form method="post" action="/admin/doc-types/${t.id}/timing">
                    <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                    <label for="due-${t.id}">ماوە (ڕۆژ)</label>
                    <input id="due-${t.id}" name="default_due_days" type="number" min="1" max="60" value="${t.default_due_days ?? ''}">
                    <label for="head-${t.id}">بەرپرسی ژوور دوای</label>
                    <input id="head-${t.id}" name="escalate_head_days" type="number" min="1" max="60" value="${t.escalate_head_days ?? ''}" placeholder="${num(ladder.head)}">
                    <label for="mayor-${t.id}">سەرۆک دوای</label>
                    <input id="mayor-${t.id}" name="escalate_mayor_days" type="number" min="2" max="90" value="${t.escalate_mayor_days ?? ''}" placeholder="${num(ladder.mayor)}">
                    <button class="btn small" type="submit">پاشەکەوتکردن</button>
                  </form>
                </details>
              </td>
              <td class="muted">${t.requires_seal ? 'بەڵێ' : '—'}</td>
              <td class="muted">${num(t.used)}</td>
              <td>
                <form method="post" action="/admin/doc-types/${t.id}/toggle">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <button class="btn small ${t.is_active ? 'danger-outline' : 'secondary'}" type="submit">
                    ${t.is_active ? 'ناچالاککردن' : 'چالاککردن'}
                  </button>
                </form>
              </td>
            </tr>`)}</tbody>
          </table></div>
        </div>`,
    }));
  } catch (err) { next(err); }
});

router.post('/admin/doc-types', requireAuth, requireRole(...EDITORS), async (req, res, next) => {
  const t = v => (v ?? '').toString().trim() || null;
  const back = key => res.redirect(303, `/admin/doc-types?error=${key}`);

  const code = (req.body.code ?? '').toString().trim().toUpperCase();
  const name = t(req.body.name);
  const baseKind = DOC_TYPES.some(([k]) => k === req.body.base_kind) ? req.body.base_kind : null;

  if (!name || !baseKind) return back('required');
  if (!/^[A-Z][A-Z0-9-]{1,23}$/.test(code)) return back('code');

  const due = daysField(req.body.default_due_days, 1, 60);
  const head = daysField(req.body.escalate_head_days, 1, 60);
  const mayor = daysField(req.body.escalate_mayor_days, 2, 90);
  if (due === null || head === null || mayor === null) return back('range');
  if (head && mayor && head >= mayor) return back('order');
  const room = Number(req.body.default_room_id);

  try {
    await withActor(req.user, async q => {
      const { rows: [row] } = await q(`
        INSERT INTO doc_type_option
          (code, name, base_kind, category, description, default_room_id,
           default_due_days, requires_seal, created_by, escalate_head_days, escalate_mayor_days)
        VALUES ($1,$2,$3::doc_type,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [code, name, baseKind, t(req.body.category), t(req.body.description),
         Number.isInteger(room) && room > 0 ? room : null,
         due || null, !!req.body.requires_seal, req.user.id, head || null, mayor || null]);
      await logEvent(q, {
        action: 'doc_type.created', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { doc_type_option_id: row.id, code, base_kind: baseKind },
      });
    });
    res.redirect(303, '/admin/doc-types?ok=1&done=created');
  } catch (err) {
    if (err.code === '23505') return back('duplicate');
    if (err.code === '23514') return back('invalid');
    next(err);
  }
});

// A type's deadline and its own rungs on the ladder. Empty means the default.
router.post('/admin/doc-types/:id(\\d+)/timing', requireAuth, requireRole(...EDITORS), async (req, res, next) => {
  const id = Number(req.params.id);
  const back = key => res.redirect(303, `/admin/doc-types?error=${key}`);
  // A number out of range is refused with the ranges, not quietly reset to the
  // default with «پاشەکەوتکرا» (feature test, 13 September).
  const due = daysField(req.body.default_due_days, 1, 60);
  const head = daysField(req.body.escalate_head_days, 1, 60);
  const mayor = daysField(req.body.escalate_mayor_days, 2, 90);
  if (due === null || head === null || mayor === null) return back('range');
  if (head && mayor && head >= mayor) return back('order');
  try {
    await withActor(req.user, async q => {
      const { rowCount } = await q(`
        UPDATE doc_type_option
           SET default_due_days = $2, escalate_head_days = $3, escalate_mayor_days = $4, updated_at = now()
         WHERE id = $1`, [id, due || null, head || null, mayor || null]);
      if (rowCount) {
        await logEvent(q, {
          action: 'doc_type.updated', req, userId: req.user.id, roomId: req.user.roomId,
          detail: { doc_type_option_id: id, due_days: due, escalate_head_days: head, escalate_mayor_days: mayor },
        });
      }
    });
    res.redirect(303, '/admin/doc-types?ok=1&done=timing');
  } catch (err) {
    if (err.code === '23514') return back('range');
    next(err);
  }
});

// The ladder for everything without its own numbers.
router.post('/admin/doc-types/ladder', requireAuth, requireRole(...LADDER_EDITORS), async (req, res, next) => {
  const back = key => res.redirect(303, `/admin/doc-types?error=${key}`);
  const reminder = daysField(req.body.reminder, 1, 30);
  const head = daysField(req.body.head, 1, 60);
  const mayor = daysField(req.body.mayor, 2, 90);
  if (reminder === '' || head === '' || mayor === '') return back('ladder_missing');
  if (reminder === null || head === null || mayor === null) return back('ladder_range');
  if (!(reminder <= head && head < mayor)) return back('ladder_order');
  try {
    await withActor(req.user, async q => {
      for (const [key, value] of [['escalate_reminder_days', reminder], ['escalate_head_days', head], ['escalate_mayor_days', mayor]]) {
        await q(`
          INSERT INTO system_setting (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, JSON.stringify(value), req.user.id]);
      }
      await logEvent(q, {
        action: 'system.setting_changed', req, userId: req.user.id, roomId: req.user.roomId,
        detail: { escalate_reminder_days: reminder, escalate_head_days: head, escalate_mayor_days: mayor },
      });
    });
    res.redirect(303, '/admin/doc-types?ok=1&done=ladder');
  } catch (err) { next(err); }
});

router.post('/admin/doc-types/:id(\\d+)/toggle', requireAuth, requireRole(...EDITORS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const active = await withActor(req.user, async q => {
      const { rows: [row] } = await q(
        `UPDATE doc_type_option SET is_active = NOT is_active, updated_at = now()
          WHERE id = $1 RETURNING is_active`, [id]);
      if (row) {
        await logEvent(q, {
          action: 'doc_type.updated', req, userId: req.user.id, roomId: req.user.roomId,
          detail: { doc_type_option_id: id, is_active: row.is_active },
        });
      }
      return row?.is_active;
    });
    res.redirect(303, `/admin/doc-types?ok=1&done=${active ? 'activated' : 'deactivated'}`);
  } catch (err) { next(err); }
});

export default router;
