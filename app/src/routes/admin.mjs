// Administration: staff accounts and rooms.
//
// Screen: design/Admin.dc.html.
//
// The system administrator manages accounts and rooms and reads the log. That is
// the whole job. Row-level security stops this role from reading a single letter,
// and nothing in this file tries to. Rooms are never deleted, only deactivated,
// because a room that once held letters stays in the trail forever.

import { Router } from 'express';
import { randomBytes } from 'crypto';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole, hashPassword } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { page, ROLE_NAMES } from '../views/layout.mjs';
import { html, num, date, ltr, initials } from '../lib/html.mjs';
import { foldDigits } from '../lib/ku.mjs';

const router = Router();
const IT = requireRole('sysadmin');

const ROOM_KINDS = [['office', 'ژووری ئاسایی'], ['archive', 'ئەرشیف'], ['registry', 'هات و دەرچوو'], ['executive', 'سەرۆکایەتی']];

// The green line after a form says which thing happened. It said «تۆمارکرا.»
// for adding, saving and switching off alike (design rules, 13 September).
// ?ok=1 stays in the address beside ?done=, because scripts look for it.
const DONE = { created: 'زیادکرا.', saved: 'پاشەکەوتکرا.', deactivated: 'ناچالاککرا.', activated: 'چالاککرایەوە.' };
const doneText = d => (typeof d === 'string' && Object.hasOwn(DONE, d) ? DONE[d] : DONE.saved);

// A temporary password the person must change at first sign-in. Readable over the
// phone: no ambiguous characters.
const tempPassword = () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('').replace(/(.{4})/g, '$1-').slice(0, 14);
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

router.get('/admin/users', requireAuth, IT, (req, res, next) => usersPage(req, res).catch(next));

/**
 * The staff screen.
 *
 * A new or reset temporary password is shown on this page as the answer to the
 * form that made it, and nowhere else. It used to travel as ?temp=… in a redirect,
 * which left it in the browser's history and address-bar suggestions on the IT
 * computer, and in any proxy log on the way. Found by the browser audit of 13
 * September. The page itself is sent no-store (server.mjs), so Back does not
 * bring it up again either.
 */
async function usersPage(req, res, { issued = null } = {}) {
  {
    const { users, rooms } = await withActor(req.user, async q => {
      const { rows: users } = await q(`
        SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.must_change_password, u.last_login_at,
               u.job_title, u.phone_extension,
               r.name AS room_name, r.room_number
          FROM app_user u LEFT JOIN room r ON r.id = u.room_id
         ORDER BY u.is_active DESC, r.sort_order NULLS LAST, ku_sort_key(u.full_name)`);
      const { rows: rooms } = await q(`SELECT id, name, room_number FROM room WHERE is_active ORDER BY sort_order, ku_sort_key(name)`);
      return { users, rooms };
    });

    res.send(page({
      user: req.user, title: 'کارمەندان', current: '/admin/users',
      notice: issued
        ? { kind: 'ok', text: `${issued.created ? 'هەژمار زیادکرا' : 'وشەی نهێنی نوێکرایەوە'} بۆ ${issued.name}. وشەی نهێنی کاتی: ${issued.temp} — ئێستا بینووسە یان بیدە بە خاوەنەکەی؛ دووبارە نیشان نادرێتەوە. لە یەکەم چوونەژوورەوە دەبێت بیگۆڕێت.` }
        : req.query.ok ? { kind: 'ok', text: doneText(req.query.done) }
        : req.query.error ? { kind: 'error', text: String(req.query.error) } : null,
      body: html`
        ${issued ? html`<span hidden data-replace-url="/admin/users"></span>` : ''}
        <div class="card">
          <h2>هەژماری نوێ</h2>
          <p class="card-sub">وشەیەکی نهێنی کاتی دەدرێت و لە یەکەم چوونەژوورەوە دەگۆڕدرێت.</p>
          <form method="post" action="/admin/users">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            <div class="grid cols-4">
              <div class="field"><label for="full_name" class="required">ناوی تەواو</label><input id="full_name" name="full_name" type="text" required maxlength="120"></div>
              <div class="field"><label for="username" class="required">ناوی بەکارهێنەر</label>
                <input id="username" name="username" type="text" dir="ltr" required pattern="(?:[a-z0-9._]|-){3,32}" maxlength="32" autocapitalize="off">
                <div class="hint">پیتی ئینگلیزی بچووک و ژمارە، ٣ بۆ ٣٢ پیت.</div></div>
              <div class="field"><label for="role" class="required">ڕۆڵ</label>
                <select id="role" name="role">${Object.entries(ROLE_NAMES).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></div>
              <div class="field"><label for="room_id">ژوور</label>
                <select id="room_id" name="room_id"><option value="">— (تەنها بۆ بەڕێوەبەری سیستەم) —</option>
                  ${rooms.map(r => html`<option value="${r.id}">${r.name}${r.room_number ? ` (${num(r.room_number)})` : ''}</option>`)}</select></div>
            </div>
            <button class="btn" type="submit">زیادکردن</button>
          </form>
        </div>

        <div class="card">
          <div class="table-wrap"><table>
            <thead><tr><th><span class="sr-only">وێنە</span></th><th>ناو</th><th>ناوی بەکارهێنەر</th><th>ڕۆڵ</th><th>ژوور</th><th>پەیوەندی</th><th>دوایین چوونەژوورەوە</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
            <tbody>${users.map(u => html`<tr class="${u.is_active ? '' : 'inactive'}">
              <td><span class="avatar sm">${initials(u.full_name)}</span></td>
              <td>${u.full_name}${u.must_change_password ? html` <span class="pill warn">وشەی کاتی</span>` : ''}</td>
              <td class="mono">${ltr(u.username)}</td>
              <td>${ROLE_NAMES[u.role] ?? u.role}</td>
              <td class="muted">${u.room_name ?? '—'}${u.room_number ? ` (${num(u.room_number)})` : ''}</td>
              <td>
                <form method="post" action="/admin/users/${u.id}/contact" class="row">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <input name="job_title" type="text" class="inline-field w-md" maxlength="120"
                         placeholder="پلە" aria-label="پلەی ${u.full_name}" value="${u.job_title ?? ''}">
                  <input name="phone_extension" type="text" class="inline-field w-sm" dir="ltr" maxlength="20" inputmode="numeric"
                         placeholder="ناوخۆ" aria-label="ژمارەی ناوخۆی ${u.full_name}" value="${u.phone_extension ?? ''}">
                  <button class="btn small secondary" type="submit">پاشەکەوتکردن</button>
                </form>
              </td>
              <td class="muted">${u.last_login_at ? date(u.last_login_at) : 'هەرگیز'}</td>
              <td>
                <div class="row">
                ${u.is_active ? html`
                  <form method="post" action="/admin/users/${u.id}/reset"><input type="hidden" name="_csrf" value="${res.locals.csrf}">
                    <button class="btn small secondary" type="submit" title="وشەی نهێنی کاتی نوێ">نوێکردنەوەی وشە</button></form>
                  ${u.id !== req.user.id ? html`<form method="post" action="/admin/users/${u.id}/deactivate"><input type="hidden" name="_csrf" value="${res.locals.csrf}">
                    <button class="btn small danger-outline" type="submit">ناچالاککردن</button></form>` : ''}`
                : html`<form method="post" action="/admin/users/${u.id}/activate"><input type="hidden" name="_csrf" value="${res.locals.csrf}">
                    <button class="btn small secondary" type="submit">چالاککردن</button></form>`}
                </div>
              </td>
            </tr>`)}</tbody>
          </table></div>
        </div>`,
    }));
  }
}

router.post('/admin/users', requireAuth, IT, async (req, res, next) => {
  try {
    const b = req.body;
    const username = String(b.username ?? '').trim().toLowerCase();
    const roomId = b.room_id ? Number(b.room_id) : null;
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || !String(b.full_name ?? '').trim()) {
      return res.redirect(303, '/admin/users?error=' + encodeURIComponent('ناوی بەکارهێنەر یان ناوی تەواو دروست نییە.'));
    }
    if ((b.role === 'sysadmin') === !!roomId) {
      return res.redirect(303, '/admin/users?error=' + encodeURIComponent('بەڕێوەبەری سیستەم ژووری نییە؛ هەموو ڕۆڵەکانی تر پێویستیان بە ژوورە.'));
    }
    const temp = tempPassword();
    const hash = await hashPassword(temp);
    await withActor(req.user, async q => {
      const { rows: [u] } = await q(`
        INSERT INTO app_user (username, full_name, password_hash, role, room_id, must_change_password, created_by)
        VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
        [username, b.full_name.trim(), hash, b.role, roomId, req.user.id]);
      await logEvent(q, { action: 'user.created', req, userId: req.user.id, detail: { new_user_id: u.id, username, role: b.role, room_id: roomId } });
    });
    await usersPage(req, res, { issued: { temp, name: b.full_name.trim(), created: true } });
  } catch (err) {
    if (err.code === '23505') return res.redirect(303, '/admin/users?error=' + encodeURIComponent('ئەم ناوی بەکارهێنەرە پێشتر هەیە.'));
    next(err);
  }
});

// A title and an extension. Not a permission of any kind: the role decides what
// a person may do, and this decides what is printed beside their name and who
// answers when the folder needs chasing.
router.post('/admin/users/:id/contact', requireAuth, IT, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = v => (v ?? '').toString().trim() || null;
    await withActor(req.user, async q => {
      // Folded to Latin digits: the column's check accepts 0-9, and ٢١٤ typed on
      // a Kurdish keyboard is the same extension (browser audit, 13 September).
      await q(`UPDATE app_user SET job_title = $2, phone_extension = $3 WHERE id = $1`,
        [id, t(req.body.job_title), t(foldDigits(req.body.phone_extension ?? ''))]);
      await logEvent(q, { action: 'user.updated', req, userId: req.user.id,
        detail: { target_user_id: id, field: 'contact' } });
    });
    res.redirect(303, '/admin/users?ok=1&done=saved');
  } catch (err) {
    if (err.code === '23514') {
      return res.redirect(303, '/admin/users?error=' + encodeURIComponent('ژمارەی ناوخۆ تەنها ژمارە و - و ( ) قبوڵ دەکات.'));
    }
    next(err);
  }
});

router.post('/admin/users/:id/reset', requireAuth, IT, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const temp = tempPassword();
    const hash = await hashPassword(temp);
    let name = '';
    await withActor(req.user, async q => {
      await q(`UPDATE app_user SET password_hash = $2, must_change_password = true WHERE id = $1`, [id, hash]);
      await q(`UPDATE user_session SET revoked_at = now(), revoked_reason = 'password reset by administrator'
                WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
      await logEvent(q, { action: 'user.password_reset', req, userId: req.user.id, detail: { target_user_id: id } });
      const { rows: [who] } = await q(`SELECT full_name FROM app_user WHERE id = $1`, [id]);
      name = who?.full_name ?? '';
    });
    await usersPage(req, res, { issued: { temp, name, created: false } });
  } catch (err) { next(err); }
});

for (const [verb, active] of [['deactivate', false], ['activate', true]]) {
  router.post(`/admin/users/:id/${verb}`, requireAuth, IT, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (id === req.user.id) return res.redirect(303, '/admin/users?error=' + encodeURIComponent('ناتوانیت هەژماری خۆت دابخەیت.'));
      await withActor(req.user, async q => {
        await q(`UPDATE app_user SET is_active = $2 WHERE id = $1`, [id, active]);
        if (!active) await q(`UPDATE user_session SET revoked_at = now(), revoked_reason = 'account deactivated' WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
        await logEvent(q, { action: active ? 'user.updated' : 'user.deactivated', req, userId: req.user.id, detail: { target_user_id: id, is_active: active } });
      });
      res.redirect(303, `/admin/users?ok=1&done=${active ? 'activated' : 'deactivated'}`);
    } catch (err) { next(err); }
  });
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

router.get('/admin/rooms', requireAuth, IT, async (req, res, next) => {
  try {
    const { rooms, people } = await withActor(req.user, async q => {
      const { rows: rooms } = await q(`
        SELECT r.*, h.full_name AS head_name, d.full_name AS deputy_name,
               (SELECT count(*) FROM app_user u WHERE u.room_id = r.id AND u.is_active) AS staff
          FROM room r LEFT JOIN app_user h ON h.id = r.head_user_id LEFT JOIN app_user d ON d.id = r.deputy_user_id
         ORDER BY r.is_active DESC, r.sort_order, ku_sort_key(r.name)`);
      // The current head and deputy are always offered, even if their account is
      // switched off. Left out, the box showed "— head —" and saving the row for
      // any reason cleared the head for good (records test, 13 September).
      const { rows: people } = await q(`
        SELECT id, full_name, room_id, is_active FROM app_user
         WHERE role <> 'sysadmin'
           AND (is_active OR id IN (SELECT head_user_id FROM room WHERE head_user_id IS NOT NULL
                                    UNION SELECT deputy_user_id FROM room WHERE deputy_user_id IS NOT NULL))
         ORDER BY ku_sort_key(full_name)`);
      return { rooms, people };
    });

    res.send(page({
      user: req.user, title: 'ژوورەکان', current: '/admin/rooms',
      notice: req.query.ok ? { kind: 'ok', text: doneText(req.query.done) } : req.query.error ? { kind: 'error', text: String(req.query.error) } : null,
      body: html`
        <div class="card">
          <h2>ژووری نوێ</h2>
          <form method="post" action="/admin/rooms">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            <div class="grid cols-3">
              <div class="field"><label for="name" class="required">ناو</label><input id="name" name="name" type="text" required maxlength="120"></div>
              <div class="field"><label for="code" class="required">کۆد</label><input id="code" name="code" type="text" dir="ltr" required pattern="[A-Z0-9_]{1,16}" maxlength="16"><div class="hint">پیتی گەورەی ئینگلیزی، وەک LEGAL</div></div>
              <div class="field"><label for="room_number">ژمارەی دەرگا</label><input id="room_number" name="room_number" type="text" dir="ltr" maxlength="10"></div>
            </div>
            <div class="grid cols-2">
              <div class="field"><label for="kind">جۆر</label><select id="kind" name="kind">${ROOM_KINDS.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></div>
              <div class="field"><label for="default_due_days">ماوە (ڕۆژ)</label><input id="default_due_days" name="default_due_days" type="number" min="1" max="60" value="3"></div>
            </div>
            <button class="btn" type="submit">زیادکردن</button>
          </form>
        </div>

        <div class="card">
          <div class="table-wrap"><table>
            <thead><tr><th>ژوور</th><th>کۆد</th><th>بەرپرس</th><th>جێگر</th><th>پەیوەندی</th><th>کارمەند</th><th>ماوە (ڕۆژ)</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
            <tbody>${rooms.map(r => html`<tr class="${r.is_active ? '' : 'inactive'}">
              <td>${r.name}${r.room_number ? html` <span class="muted">(${num(r.room_number)})</span>` : ''}</td>
              <td class="mono">${ltr(r.code)}</td>
              <td colspan="3">
                <form method="post" action="/admin/rooms/${r.id}" class="row">
                  <input type="hidden" name="_csrf" value="${res.locals.csrf}">
                  <select name="head_user_id" class="inline-field" aria-label="بەرپرسی ${r.name}"><option value="">— بەرپرس —</option>
                    ${people.filter(p => p.room_id === r.id || p.id === r.head_user_id).map(p => html`<option value="${p.id}" ${p.id === r.head_user_id ? 'selected' : ''}>${p.full_name}${p.is_active ? '' : ' (ناچالاک)'}</option>`)}</select>
                  <select name="deputy_user_id" class="inline-field" aria-label="جێگری ${r.name}"><option value="">— جێگر —</option>
                    ${people.filter(p => p.room_id === r.id || p.id === r.deputy_user_id).map(p => html`<option value="${p.id}" ${p.id === r.deputy_user_id ? 'selected' : ''}>${p.full_name}${p.is_active ? '' : ' (ناچالاک)'}</option>`)}</select>
                  <input name="phone_extension" type="text" class="inline-field w-sm" dir="ltr" maxlength="20" inputmode="numeric"
                         placeholder="ناوخۆ" aria-label="ژمارەی ناوخۆی ${r.name}" value="${r.phone_extension ?? ''}">
                  <input name="department" type="text" class="inline-field w-md" maxlength="120"
                         placeholder="بەڕێوەبەرایەتی" aria-label="بەڕێوەبەرایەتیی ${r.name}" value="${r.department ?? ''}">
                  <input name="floor_label" type="text" class="inline-field w-sm" maxlength="40"
                         placeholder="نهۆم" aria-label="نهۆمی ${r.name}" value="${r.floor_label ?? ''}">
                  <button class="btn small secondary" type="submit">پاشەکەوتکردن</button>
                </form>
              </td>
              <td>${num(r.staff)}</td>
              <td>${num(r.default_due_days)}</td>
              <td><form method="post" action="/admin/rooms/${r.id}/${r.is_active ? 'deactivate' : 'activate'}"><input type="hidden" name="_csrf" value="${res.locals.csrf}">
                <button class="btn small ${r.is_active ? 'danger-outline' : 'secondary'}" type="submit">${r.is_active ? 'ناچالاککردن' : 'چالاککردن'}</button></form></td>
            </tr>`)}</tbody>
          </table></div>
          <p class="hint">ژوور ناسڕدرێتەوە. ژوورێک کە جارێک کتابی وەرگرتبێت بۆ هەمیشە لە ڕێڕەوەکاندا دەمێنێتەوە.</p>
        </div>`,
    }));
  } catch (err) { next(err); }
});

router.post('/admin/rooms', requireAuth, IT, async (req, res, next) => {
  try {
    const b = req.body;
    const code = String(b.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,16}$/.test(code) || !String(b.name ?? '').trim()) {
      return res.redirect(303, '/admin/rooms?error=' + encodeURIComponent('ناو یان کۆد دروست نییە.'));
    }
    await withActor(req.user, async q => {
      const { rows: [r] } = await q(`
        INSERT INTO room (code, name, room_number, kind, default_due_days, sort_order)
        VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(sort_order), 0) + 10 FROM room)) RETURNING id`,
        [code, b.name.trim(), b.room_number || null, b.kind || 'office', Math.min(60, Math.max(1, Number(b.default_due_days) || 3))]);
      await logEvent(q, { action: 'room.created', req, userId: req.user.id, roomId: r.id, detail: { code, kind: b.kind } });
    });
    res.redirect(303, '/admin/rooms?ok=1&done=created');
  } catch (err) {
    if (err.code === '23505') return res.redirect(303, '/admin/rooms?error=' + encodeURIComponent('ئەم کۆدە پێشتر هەیە.'));
    next(err);
  }
});

router.post('/admin/rooms/:id', requireAuth, IT, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const head = req.body.head_user_id ? Number(req.body.head_user_id) : null;
    const deputy = req.body.deputy_user_id ? Number(req.body.deputy_user_id) : null;
    if (head && deputy && head === deputy) {
      return res.redirect(303, '/admin/rooms?error=' + encodeURIComponent('جێگر ناتوانێت هەمان کەسی بەرپرس بێت.'));
    }
    // Trimmed to NULL rather than stored as an empty string, so "not known yet"
    // is one value and not two that sort differently and print differently.
    const t = v => (v ?? '').toString().trim() || null;
    await withActor(req.user, async q => {
      await q(`UPDATE room
                  SET head_user_id = $2, deputy_user_id = $3,
                      phone_extension = $4, department = $5, floor_label = $6
                WHERE id = $1`,
        [id, head, deputy, t(foldDigits(req.body.phone_extension ?? '')), t(req.body.department), t(req.body.floor_label)]);
      await logEvent(q, { action: 'room.updated', req, userId: req.user.id, roomId: id,
        detail: { head_user_id: head, deputy_user_id: deputy, contact_set: Boolean(t(req.body.phone_extension)) } });
    });
    res.redirect(303, '/admin/rooms?ok=1&done=saved');
  } catch (err) {
    if (err.code === '23514') {
      return res.redirect(303, '/admin/rooms?error=' + encodeURIComponent('ژمارەی ناوخۆ تەنها ژمارە و - و ( ) قبوڵ دەکات.'));
    }
    next(err);
  }
});

for (const [verb, active] of [['deactivate', false], ['activate', true]]) {
  router.post(`/admin/rooms/:id/${verb}`, requireAuth, IT, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await withActor(req.user, async q => {
        if (!active) {
          // Counted by a function that may see the steps; IT itself may not, and
          // the old count was always nought (records test, 13 September).
          const { rows: [w] } = await q(`SELECT * FROM room_workload($1)`, [id]);
          const reasons = [
            w?.open_steps && `${num(w.open_steps)} کتابی چاوەڕوان`,
            w?.unsent && `${num(w.unsent)} کتابی نەنێردراو`,
            w?.staff && `${num(w.staff)} کارمەندی چالاک`,
          ].filter(Boolean);
          if (reasons.length) {
            throw Object.assign(new Error(`ئەم ژوورە هێشتا ${reasons.join(' و ')}ی تێدایە. سەرەتا کتابەکان بنێرە بۆ ژوورێکی تر و کارمەندەکان بگوازەوە.`), { expected: true });
          }
        }
        await q(`UPDATE room SET is_active = $2 WHERE id = $1`, [id, active]);
        await logEvent(q, { action: 'room.updated', req, userId: req.user.id, roomId: id, detail: { is_active: active } });
      });
      res.redirect(303, `/admin/rooms?ok=1&done=${active ? 'activated' : 'deactivated'}`);
    } catch (err) {
      if (err.expected) return res.redirect(303, '/admin/rooms?error=' + encodeURIComponent(err.message));
      next(err);
    }
  });
}

export default router;
