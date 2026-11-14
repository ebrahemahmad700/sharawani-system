// Form templates (تێمپلەیتەکان).
//
// The forms a municipality fills in by hand all day: a leave request, an internal
// memo, a decision, an attendance note. Each template is a piece of HTML with
// {{field}} placeholders and a schema saying what the fields are. Filling one in
// produces a template_fill row and a printable page.
//
// Why it prints rather than emails: the paper copy is the record. The building
// runs on signed paper, the same reason the document print sheet exists. A filled
// form that only lives on a screen has not been issued.
//
// Two rules the schema already sets and this file honours:
//
//   A fill is never edited. The template's version is copied onto the fill, so a
//   form printed last year still shows the wording that was on it last year, even
//   after the template is revised. This is why template_fill has no update path.
//
//   Row-level security on template_fill lets HR and the mayor see every fill,
//   everyone else only their own, and anyone who can see the letter a fill was
//   attached to. That is the database's rule, not this file's.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { page, bare, asset } from '../views/layout.mjs';
import { html, raw, escapeHtml, num, date, ltr } from '../lib/html.mjs';
import { notFound } from '../lib/respond.mjs';
import { findByReference } from '../lib/documents.mjs';
import { foldDigits } from '../lib/ku.mjs';

const router = Router();

const USERS = ['hr', 'mayor', 'deputy_mayor', 'room_head', 'directorate_head', 'registry_clerk', 'room_clerk'];
const AUTHORS = ['hr', 'mayor', 'deputy_mayor'];

const FIELD_TYPES = new Set(['text', 'textarea', 'date', 'number', 'select']);
// The same types in Kurdish, so an author need not type English words.
const FIELD_TYPE_KU = { 'دەق': 'text', 'دەقی درێژ': 'textarea', 'بەروار': 'date', 'ژمارە': 'number', 'هەڵبژاردن': 'select' };

/**
 * Render a template body with the values filled in.
 *
 * Every value is escaped. The body itself is authored by HR or the mayor through
 * the form below and stored as written, so it may carry the layout a municipal
 * form needs; the values a clerk types are not trusted and never become markup.
 */
/**
 * A template's body is written by HR or the mayor's office as HTML, for layout:
 * paragraphs, bold, lists, a table. Only those tags are kept, and never an
 * attribute, so a body cannot carry a script, an event handler, a link or an
 * image; the content security policy was the only thing stopping a <script> in a
 * body from running (security test, 13 September). Applied when a template is
 * saved and again when it is printed, so templates written before this are
 * cleaned too.
 */
const LAYOUT_TAGS = new Set(['p', 'b', 'strong', 'i', 'em', 'u', 'br', 'h1', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'span', 'hr', 'small']);
export function cleanTemplateHtml(input) {
  return String(input ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript|textarea|select|button|form)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript|link|meta|base|img|input|form)\b[^>]*>/gi, '')
    .replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_m, close, tag) => {
      const t = tag.toLowerCase();
      return LAYOUT_TAGS.has(t) ? `<${close}${t}>` : '';
    })
    .replace(/<(?![\/a-z])/gi, '&lt;');
}

function renderBody(bodyHtml, schema, values) {
  // A body written as plain lines keeps its lines. Only the filled-in values kept
  // theirs, and a form typed one item per line printed as one paragraph (design
  // test, 13 September). A body that uses paragraph tags is left as written.
  let body = cleanTemplateHtml(bodyHtml);
  if (!/<(p|br|div|li|tr|h[1-4])\b/i.test(body)) body = body.replace(/\r?\n/g, '<br>');
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name) => {
    const field = schema.find(f => f.name === name);
    const v = values?.[name];
    if (v === undefined || v === null || v === '') {
      // A blank in a printed form is a line to write on, not the word "undefined".
      return '<span class="blank-inline">&nbsp;</span>';
    }
    if (field?.type === 'date') return escapeHtml(formatDate(v));
    if (field?.type === 'number') return escapeHtml(num(v));
    return escapeHtml(String(v)).replace(/\n/g, '<br>');
  });
}

const formatDate = v => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return num(d.toLocaleDateString('en-GB').split('/').reverse().join('/'));
};

/** One input, built from a field definition. */
function fieldInput(f, value = '') {
  const req = f.required ? 'required' : '';
  const id = `f_${f.name}`;
  if (f.type === 'textarea') {
    return html`<textarea id="${id}" name="${f.name}" rows="4" ${raw(req)}>${value}</textarea>`;
  }
  if (f.type === 'select') {
    return html`<select id="${id}" name="${f.name}" ${raw(req)}>
      <option value="">—</option>
      ${(f.options ?? []).map(o => html`<option value="${o}" ${raw(String(value) === String(o) ? 'selected' : '')}>${o}</option>`)}
    </select>`;
  }
  // A number is typed in a text box that takes either kind of digit. type=number
  // refused ٥ and left the field empty (records test, 13 September).
  if (f.type === 'number') {
    return html`<input id="${id}" name="${f.name}" type="text" inputmode="decimal" dir="ltr" data-digits
      pattern="[0-9٠-٩۰-۹.,٫]+" value="${value}" ${raw(req)}>`;
  }
  const type = f.type === 'date' ? 'date' : 'text';
  const dir = type === 'text' ? '' : 'dir="ltr"';
  return html`<input id="${id}" name="${f.name}" type="${type}" value="${value}" ${raw(dir)} ${raw(req)}>`;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

router.get('/templates', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    const { templates, recent } = await withActor(req.user, async q => {
      const { rows: templates } = await q(`
        SELECT t.id, t.name, t.category, t.description, t.version, r.name AS room_name
          FROM template t LEFT JOIN room r ON r.id = t.room_id
         WHERE t.is_active
           AND (t.room_id IS NULL OR t.room_id = $1 OR $2 IN ('mayor', 'deputy_mayor', 'hr'))
         ORDER BY ku_sort_key(t.category), ku_sort_key(t.name)`,
        [req.user.roomId, req.user.role]);
      // Row-level security decides which of these the reader may see.
      const { rows: recent } = await q(`
        SELECT f.id, f.filled_at, f.template_version, t.name AS template_name, u.full_name AS filled_by_name
          FROM template_fill f JOIN template t ON t.id = f.template_id
          JOIN app_user u ON u.id = f.filled_by
         ORDER BY f.filled_at DESC LIMIT 12`);
      return { templates, recent };
    });

    const byCategory = new Map();
    for (const t of templates) {
      if (!byCategory.has(t.category)) byCategory.set(t.category, []);
      byCategory.get(t.category).push(t);
    }

    res.send(page({
      user: req.user, title: 'تێمپلەیتەکان', current: '/templates',
      notice: req.query.ok ? { kind: 'ok', text: String(req.query.ok) } : null,
      actions: AUTHORS.includes(req.user.role)
        ? html`<a class="btn" href="/templates/new">تێمپلەیتی نوێ</a>` : null,
      body: html`
        ${templates.length === 0 ? html`
          <div class="card"><div class="empty">هیچ تێمپلەیتێک نییە.</div></div>` : ''}

        ${[...byCategory].map(([category, list]) => html`
          <div class="card">
            <h2>${category}</h2>
            <div class="table-wrap"><table>
              <thead><tr><th>ناو</th><th>ڕوونکردنەوە</th><th>ژوور</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
              <tbody>${list.map(t => html`<tr>
                <td><strong>${t.name}</strong><span class="cell-sub">وەشانی ${num(t.version)}</span></td>
                <td class="muted">${t.description ?? ''}</td>
                <td class="muted">${t.room_name ?? 'هەمووان'}</td>
                <td><a class="btn small" href="/templates/${t.id}">پڕکردنەوە</a></td>
              </tr>`)}</tbody>
            </table></div>
          </div>`)}

        ${recent.length ? html`
          <div class="card">
            <h2>دوایین پڕکراوەکان</h2>
            <div class="table-wrap"><table>
              <thead><tr><th>فۆڕم</th><th>لەلایەن</th><th>بەروار</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead>
              <tbody>${recent.map(f => html`<tr>
                <td>${f.template_name}<span class="cell-sub">وەشانی ${num(f.template_version)}</span></td>
                <td>${f.filled_by_name}</td>
                <td class="muted">${date(f.filled_at)}</td>
                <td><a class="btn small" href="/fills/${f.id}/print" target="_blank">چاپ</a></td>
              </tr>`)}</tbody>
            </table></div>
          </div>` : ''}`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Authoring. Before /templates/:id so that "new" is not read as an id.
// ---------------------------------------------------------------------------

/**
 * The field definitions and body, checked. Shared by writing a new template and
 * editing one.
 *
 * One field per line: name | label | type | options
 *   - the type may be written in Kurdish (دەق، دەقی درێژ، بەروار، ژمارە، هەڵبژاردن)
 *   - a select lists its choices after a fourth bar, separated by commas
 *   - a name ending in ? is optional
 *
 * A select with nowhere to give its choices, and every field forced required,
 * made a form that could never be submitted; a placeholder in Kurdish, or a
 * field defined twice, passed the check and printed wrongly (records test, 13
 * September).
 */
function parseTemplate(b) {
  const name = String(b.name ?? '').trim();
  const category = String(b.category ?? '').trim();
  const body = cleanTemplateHtml(String(b.body ?? '')).trim();
  if (!name || !category || !body) return { error: 'ناو، جۆر و دەقی فۆڕم پێویستن.' };

  const schema = [];
  for (const line of String(b.fields ?? '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const [rawName, label, typed = 'text', optionText = ''] = t.split('|').map(s => s.trim());
    const optional = /\?$/.test(rawName ?? '');
    const fname = (rawName ?? '').replace(/\?$/, '');
    const type = FIELD_TYPE_KU[typed] ?? typed;
    if (!/^[a-zA-Z0-9_]+$/.test(fname)) return { error: `ناوی خانە دروست نییە: «${fname}». تەنها پیتی ئینگلیزی، ژمارە و _.` };
    if (!FIELD_TYPES.has(type)) return { error: `جۆری خانە نەناسراوە: «${typed}». دەق، دەقی درێژ، بەروار، ژمارە یان هەڵبژاردن.` };
    if (schema.some(f => f.name === fname)) return { error: `خانەی «${fname}» دوو جار پێناسە کراوە.` };
    const field = { name: fname, label: label || fname, type, required: !optional };
    if (type === 'select') {
      const options = optionText.split(/[,،]/).map(o => o.trim()).filter(Boolean);
      if (options.length < 2) return { error: `خانەی «${fname}» هەڵبژاردنە: دوای بەشی چوارەم لانیکەم دوو هەڵبژاردن بنووسە، بە کۆما جیا بکرێنەوە.` };
      field.options = options;
    }
    schema.push(field);
  }
  if (schema.length === 0) return { error: 'لانیکەم یەک خانە پێویستە.' };

  // Every {{...}} in the body must be a field that exists: in any script, not only
  // Latin, so {{بەڕێوەبەر}} is refused rather than printed as it is.
  const used = [...body.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map(m => m[1]);
  const missing = used.filter(u => !schema.some(f => f.name === u));
  if (missing.length) return { error: `ئەم خانانە لە دەقەکەدان بەڵام پێناسە نەکراون: ${[...new Set(missing)].join('، ')}` };

  return { name, category, description: String(b.description ?? '').trim() || null, body, schema };
}

/** A template's fields written back as the lines the author typed. */
const fieldsText = schema => (schema ?? []).map(f =>
  [`${f.name}${f.required === false ? '?' : ''}`, f.label, f.type, ...(f.options ? [f.options.join('، ')] : [])].join(' | ')).join('\n');

function authorPage({ user, csrf, error = null, values = {}, action = '/templates/new', title = 'تێمپلەیتی نوێ' }) {
  return page({
    user, title, current: '/templates',
    notice: error ? { kind: 'error', text: error } : null,
    // No heading in the card: the top bar already says «تێمپلەیتی نوێ» or which
    // template is being edited (design test, 13 September).
    body: html`
      <div class="card form">
        <form method="post" action="${action}">
          <input type="hidden" name="_csrf" value="${csrf}">
          <div class="grid cols-2">
            <div class="field">
              <label for="name" class="required">ناوی فۆڕم</label>
              <input id="name" name="name" type="text" required value="${values.name ?? ''}">
            </div>
            <div class="field">
              <label for="category" class="required">جۆر</label>
              <input id="category" name="category" type="text" required value="${values.category ?? ''}"
                     placeholder="نامەی ناوخۆیی · داواکاری مۆڵەت · بڕیار">
            </div>
          </div>
          <div class="field">
            <label for="description">ڕوونکردنەوە</label>
            <input id="description" name="description" type="text" value="${values.description ?? ''}">
          </div>
          <div class="field">
            <label for="fields" class="required">خانەکان</label>
            <textarea id="fields" name="fields" rows="6" required
              placeholder="یەک خانە لە هەر دێڕێکدا: ناو | ناونیشان | جۆر&#10;employee | ناوی کارمەند | دەق&#10;days | ژمارەی ڕۆژ | ژمارە&#10;from | لە بەرواری | بەروار&#10;kind | جۆری مۆڵەت | هەڵبژاردن | ساڵانە، نەخۆشی&#10;note? | تێبینی | دەقی درێژ">${values.fields ?? ''}</textarea>
            <div class="hint">
              یەک لە هەر دێڕێک: <span dir="ltr">name | label | type</span>. جۆرەکان: دەق، دەقی درێژ، بەروار، ژمارە، هەڵبژاردن
              (هەڵبژاردنەکان دوای بەشی چوارەم، بە کۆما). ناوێک کە بە <span dir="ltr">?</span> کۆتایی بێت ئارەزوومەندانەیە.
            </div>
          </div>
          <div class="field">
            <label for="body" class="required">دەقی فۆڕم</label>
            <textarea id="body" name="body" rows="10" required
              placeholder="بەڕێز {{employee}} مۆڵەتی {{days}} ڕۆژی پێدرا لە {{from}}ەوە.">${values.body ?? ''}</textarea>
            <div class="hint">ناوی خانەکان لە نێوان دوو کەوانەدا بنووسە، وەک <span dir="ltr">{{employee}}</span>. هەر دێڕێک وەک خۆی چاپ دەکرێت.</div>
          </div>
          <button class="btn" type="submit">پاشەکەوتکردن</button>
        </form>
      </div>`,
  });
}

router.get('/templates/new', requireAuth, requireRole(...AUTHORS), (req, res) =>
  res.send(String(authorPage({ user: req.user, csrf: res.locals.csrf }))));

router.post('/templates/new', requireAuth, requireRole(...AUTHORS), async (req, res, next) => {
  try {
    const b = req.body;
    const t = parseTemplate(b);
    if (t.error) return res.status(400).send(String(authorPage({ user: req.user, csrf: res.locals.csrf, error: t.error, values: b })));

    const id = await withActor(req.user, async q => {
      const { rows: [row] } = await q(`
        INSERT INTO template (name, category, description, body_html, field_schema, created_by)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [t.name, t.category, t.description, t.body, JSON.stringify(t.schema), req.user.id]);
      await logEvent(q, { action: 'template.created', req, userId: req.user.id, detail: { template_id: row.id, fields: t.schema.length } });
      return row.id;
    });
    res.redirect(303, `/templates/${id}?created=1`);
  } catch (err) {
    if (err.code === '23505') return res.status(400).send(String(authorPage({ user: req.user, csrf: res.locals.csrf, error: 'ئەم ناوە پێشتر بەکارهاتووە.', values: req.body })));
    next(err);
  }
});

// Editing a template makes its next version. Forms already filled keep printing
// the version they were filled from (migration 0490 copies it onto each fill).
// There was no way to correct a template or take one out of the list.
router.get('/templates/:id(\\d+)/edit', requireAuth, requireRole(...AUTHORS), async (req, res, next) => {
  try {
    const t = await withActor(req.user, async q =>
      (await q(`SELECT * FROM template WHERE id = $1 AND is_active`, [Number(req.params.id)])).rows[0]);
    if (!t) return notFound(req, res, 'ئەم تێمپلەیتە نەدۆزرایەوە.');
    res.send(String(authorPage({
      user: req.user, csrf: res.locals.csrf, action: `/templates/${t.id}/edit`,
      title: `دەستکاری ${t.name} (وەشانی ${num(t.version + 1)})`,
      values: { name: t.name, category: t.category, description: t.description ?? '', fields: fieldsText(t.field_schema), body: t.body_html },
    })));
  } catch (err) { next(err); }
});

router.post('/templates/:id(\\d+)/edit', requireAuth, requireRole(...AUTHORS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const b = req.body;
    const t = parseTemplate(b);
    const again = error => res.status(400).send(String(authorPage({
      user: req.user, csrf: res.locals.csrf, error, values: b, action: `/templates/${id}/edit`, title: 'دەستکاری تێمپلەیت' })));
    if (t.error) return again(t.error);
    const done = await withActor(req.user, async q => {
      const { rows: [row] } = await q(`
        UPDATE template SET name = $2, category = $3, description = $4, body_html = $5, field_schema = $6,
                            version = version + 1
         WHERE id = $1 AND is_active RETURNING id, version`,
        [id, t.name, t.category, t.description, t.body, JSON.stringify(t.schema)]);
      if (row) await logEvent(q, { action: 'template.updated', req, userId: req.user.id, detail: { template_id: id, version: row.version, fields: t.schema.length } });
      return row;
    });
    if (!done) return notFound(req, res, 'ئەم تێمپلەیتە نەدۆزرایەوە.');
    res.redirect(303, `/templates/${id}?saved=1`);
  } catch (err) {
    if (err.code === '23505') return res.status(400).send(String(authorPage({ user: req.user, csrf: res.locals.csrf, error: 'ئەم ناوە پێشتر بەکارهاتووە.', values: req.body, action: `/templates/${id}/edit`, title: 'دەستکاری تێمپلەیت' })));
    next(err);
  }
});

router.post('/templates/:id(\\d+)/retire', requireAuth, requireRole(...AUTHORS), async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    await withActor(req.user, async q => {
      const { rowCount } = await q(`UPDATE template SET is_active = false WHERE id = $1 AND is_active`, [id]);
      if (rowCount) await logEvent(q, { action: 'template.deactivated', req, userId: req.user.id, detail: { template_id: id } });
    });
    res.redirect(303, `/templates?ok=${encodeURIComponent('تێمپلەیتەکە لە لیست لابرا. فۆڕمە پڕکراوەکانی پێشووی وەک خۆیان دەمێننەوە.')}`);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Filling one in
// ---------------------------------------------------------------------------

router.get('/templates/:id(\\d+)', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await withActor(req.user, async q => {
      const { rows: [t] } = await q(`SELECT * FROM template WHERE id = $1 AND is_active`, [id]);
      return t;
    });
    if (!t) return notFound(req, res, 'ئەم تێمپلەیتە نەدۆزرایەوە.');
    fillPage(req, res, t);
  } catch (err) { next(err); }
});

/**
 * The form to fill in. Shown again with what was typed and a message when the
 * letter it names cannot be found, instead of the white page with one line of
 * text that used to come back.
 */
function fillPage(req, res, t, { values = {}, error = null, status = 200 } = {}) {
    const schema = Array.isArray(t.field_schema) ? t.field_schema : [];
    res.status(status).send(page({
      user: req.user, title: t.name, current: '/templates',
      notice: error ? { kind: 'error', text: error }
            : req.query.created ? { kind: 'ok', text: 'زیادکرا.' }
            : req.query.saved ? { kind: 'ok', text: `پاشەکەوتکرا. ئێستا وەشانی ${num(t.version)}یە.` } : null,
      actions: AUTHORS.includes(req.user.role) ? html`
        <a class="btn secondary" href="/templates/${t.id}/edit">دەستکاریکردن</a>
        <form method="post" action="/templates/${t.id}/retire" style="display:inline">
          <input type="hidden" name="_csrf" value="${res.locals.csrf}">
          <button class="btn danger-outline" type="submit">لابردن لە لیست</button>
        </form>` : null,
      // The template's name is the page title; the card does not repeat it.
      body: html`
        <div class="card form">
          ${t.description ? html`<p class="card-sub">${t.description}</p>` : ''}
          <form method="post" action="/templates/${t.id}">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            ${schema.map(f => html`
              <div class="field">
                <label for="f_${f.name}" class="${f.required ? 'required' : ''}">${f.label}</label>
                ${fieldInput(f, values[f.name] ?? '')}
              </div>`)}
            <div class="field">
              <label for="reference">بەستنەوە بە کتابێک (ئارەزوومەندانە)</label>
              <input id="reference" name="reference" type="text" dir="ltr" data-digits
                     placeholder="ه/2026/25 یان بارکۆد" value="${values.reference ?? ''}">
              <div class="hint">ژمارەی کتاب یان بارکۆدەکەی. بەتاڵی بهێڵەوە ئەگەر بە هیچ کتابێکەوە نابەستێتەوە.</div>
            </div>
            <button class="btn" type="submit">پڕکردنەوە و چاپ</button>
          </form>
        </div>`,
    }));
}

router.post('/templates/:id(\\d+)', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const fillId = await withActor(req.user, async q => {
      const { rows: [t] } = await q(`SELECT * FROM template WHERE id = $1 AND is_active`, [id]);
      if (!t) return null;

      const reference = String(req.body.reference ?? '').trim();
      let docId = null;
      if (reference) {
        const found = await findByReference(q, reference);
        if (found.length !== 1) {
          return { retry: t, error: found.length
            ? 'دوو کتاب بەم ژمارەیە هەن. پێشگرەکەشی بنووسە (ه/ یان د/) یان بارکۆدەکە.'
            : 'کتابێک بەم ژمارە یان بارکۆدە نەدۆزرایەوە، یان ڕێگەت پێنەدراوە بیبینیت.' };
        }
        docId = Number(found[0].id);
      }
      const schema = Array.isArray(t.field_schema) ? t.field_schema : [];

      // Only the fields the template declares. A stray form field cannot become
      // part of the record.
      const values = {};
      for (const f of schema) {
        const v = req.body[f.name];
        if (v !== undefined) values[f.name] = f.type === 'number' ? foldDigits(String(v)).slice(0, 40) : String(v).slice(0, 4000);
      }

      const { rows: [f] } = await q(`
        INSERT INTO template_fill (template_id, template_version, document_id, filled_by, values, body_html, field_schema)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [t.id, t.version, docId, req.user.id, JSON.stringify(values), t.body_html, JSON.stringify(schema)]);
      await logEvent(q, {
        action: 'template.filled', req, userId: req.user.id, roomId: req.user.roomId,
        documentId: docId, detail: { template_id: t.id, fill_id: f.id, version: t.version, fields: Object.keys(values).length },
      });
      return f.id;
    });
    if (!fillId) return notFound(req, res, 'ئەم تێمپلەیتە نەدۆزرایەوە.');
    if (fillId.retry) return fillPage(req, res, fillId.retry, { values: req.body, error: fillId.error, status: 400 });
    res.redirect(303, `/fills/${fillId}/print`);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// The printed form
// ---------------------------------------------------------------------------

router.get('/fills/:id(\\d+)/print', requireAuth, requireRole(...USERS), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const f = await withActor(req.user, async q => {
      const { rows: [f] } = await q(`
        SELECT f.*, t.name AS template_name,
               coalesce(f.body_html, t.body_html) AS body_html,
               coalesce(f.field_schema, t.field_schema) AS field_schema,
               u.full_name AS filled_by_name,
               d.incoming_no
          FROM template_fill f JOIN template t ON t.id = f.template_id
          JOIN app_user u ON u.id = f.filled_by
          LEFT JOIN document d ON d.id = f.document_id
         WHERE f.id = $1`, [id]);
      if (f) {
        await q(`UPDATE template_fill SET printed_at = coalesce(printed_at, now()) WHERE id = $1`, [id]);
        await logEvent(q, {
          action: 'template.printed', req, userId: req.user.id, documentId: f.document_id,
          detail: { fill_id: id, template_id: f.template_id },
        });
      }
      return f;
    });
    if (!f) return notFound(req, res, 'ئەم فۆڕمە پڕکراوەیە نەدۆزرایەوە.');

    const schema = Array.isArray(f.field_schema) ? f.field_schema : [];
    const bodyHtml = renderBody(f.body_html, schema, f.values);

    res.send(String(bare({
      title: f.template_name,
      // Same shape as the document print sheet: no sidebar, no buttons, prints on
      // load, and a signature block because a municipal form is not issued until
      // somebody has signed it. The same measures as every other sheet too: pt,
      // a 17pt title beside the gold seal, the green rule under the letterhead. It
      // was the one sheet in px with a brown rule and no seal (design test).
      body: html`
        <style>
          @page { size: A4; margin: 18mm 16mm; }
          body { background: #fff; color: #111; font-family: Vazirmatn, "Noto Sans Arabic", Tahoma, sans-serif; margin: 0; }
          .sheet { max-width: 180mm; margin: 0 auto; font-size: 11.5pt; line-height: 1.9; }
          @media screen { .sheet { padding: 12pt; } }
          .head { display: flex; align-items: center; gap: 10pt; border-bottom: 2px solid #0E3A28; padding-bottom: 8pt; margin-bottom: 14pt; }
          .seal { width: 33pt; height: 33pt; border-radius: 50%; background: #C99A2E; flex: 0 0 33pt; }
          .head h1 { font-size: 17pt; line-height: 1.4; margin: 0; }
          .meta { font-size: 9.5pt; color: #555; }
          .body { margin: 16pt 0 30pt; }
          .body h1, .body h2, .body h3, .body h4 { font-size: 12.5pt; margin: 10pt 0 4pt; }
          .body table { width: 100%; border-collapse: collapse; font-size: 11.5pt; }
          .body th, .body td { text-align: right; padding: 4pt 6pt; border-bottom: 1px solid #ddd; vertical-align: top; }
          .body th { background: #f6f5f0; color: #555; font-weight: 600; white-space: normal; }
          .blank-inline { display: inline-block; min-width: 68pt; border-bottom: 1px dotted #555; }
          .sign { display: flex; justify-content: space-between; margin-top: 34pt; gap: 22pt; }
          .sign div { flex: 1; border-top: 1px solid #555; padding-top: 4pt; font-size: 9.5pt; color: #555; text-align: center; }
          @media screen and (max-width: 600px) { .sign { flex-wrap: wrap; gap: 14pt; } .sign div { flex: 1 1 40%; } }
          @media print { .noprint { display: none } }
        </style>
        <div class="sheet">
          <div class="head">
            <div class="seal"></div>
            <div>
              <h1>شارەوانی ڕانیە</h1>
              <div class="meta">${f.template_name} · وەشانی ${num(f.template_version)}</div>
            </div>
          </div>
          <div class="body">${raw(bodyHtml)}</div>
          <div class="meta">
            پڕکراوەتەوە لەلایەن ${f.filled_by_name} · ${date(f.filled_at)}
            ${f.incoming_no ? html` · بەستراوە بە کتابی ${ltr(f.incoming_no)}` : ''}
          </div>
          <div class="sign">
            <div>واژووی داواکار</div>
            <div>واژووی بەڕێوەبەر</div>
            <div>مۆری شارەوانی</div>
          </div>
        </div>
        <script src="${asset('/print.js')}"></script>`,
    })));
  } catch (err) { next(err); }
});

export default router;
