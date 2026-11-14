// Templates: authoring validation, every field type, filling with/without letter, printing, versioning.
import { launch, close, as, note, shot, notice, invalidField, MARK, toKu, BASE, localDay } from './lib.mjs';

const L1 = { no: 'ه/2026/690', barcode: '20260006901' };
const b = await launch();
const { page: hr } = await as('bafrin');
const dialogs = [];

async function author(p, v) {
  await p.goto('/templates/new');
  for (const [k, val] of Object.entries(v)) await p.fill(`#${k}`, val);
  const inv = await invalidField(p, 'form[action="/templates/new"]');
  if (inv) return { invalid: inv };
  const [resp] = await Promise.all([p.waitForResponse(r => r.url().endsWith('/templates/new') && r.request().method() === 'POST'), p.click('form[action="/templates/new"] button[type=submit]')]);
  await p.waitForLoadState('domcontentloaded');
  return { status: resp.status(), url: p.url(), id: /\/templates\/(\d+)$/.exec(p.url())?.[1], errors: await p.locator('.notice.error').allInnerTexts(), keptFields: await p.inputValue('#fields').catch(() => null) };
}

const allFields = ['employee | ناوی کارمەند | text', 'reason | هۆکار | textarea', 'from | لە بەرواری | date', 'days | ژمارەی ڕۆژ | number', 'kind | جۆری مۆڵەت | select'].join('\n');
const body = 'بەڕێز {{employee}}، مۆڵەتی {{kind}} بۆ ماوەی {{days}} ڕۆژ لە {{from}}ەوە پێدرا.\nهۆکار: {{reason}}';

// 1. Every type including select
let r = await author(hr, { name: `مۆڵەتی تاقیکردنەوە ${MARK}`, category: `تاقیکردنەوە ${MARK}`, description: 'هەموو جۆرەکان', fields: allFields, body });
note('templates', 'create all types', r);
const tAll = r.id;
if (tAll) await shot(hr, 'tpl-all-fill-form', { fullPage: true });
if (tAll) note('templates', 'select options offered', { options: await hr.locator('#f_kind option').allInnerTexts(), required: await hr.locator('#f_kind').getAttribute('required') });

// 2. Without select, for filling
r = await author(hr, { name: `مۆڵەتی ساکار ${MARK}`, category: `تاقیکردنەوە ${MARK}`, fields: allFields.split('\n').slice(0, 4).join('\n'), body: 'بەڕێز {{employee}}، مۆڵەتی {{days}} ڕۆژ لە {{from}}ەوە پێدرا.\nهۆکار: {{reason}}' });
note('templates', 'create 4 types', r);
const tPlain = r.id;

// 3. Wrong field names / types
for (const [label, fields] of [
  ['kurdish name', 'ناو | ناو | text'], ['space in name', 'employee name | ناو | text'], ['unknown type', 'employee | ناو | checkbox'],
  ['no pipes', 'employee'], ['empty type', 'employee | ناو |'], ['upper type', 'employee | ناو | TEXT'], ['dash name', 'employee-name | ناو | text'],
]) {
  r = await author(hr, { name: `هەڵە ${label} ${MARK}`, category: 'تاقیکردنەوە', fields, body: 'دەق {{employee}}' });
  note('templates-bad', label, { fields, status: r.status, id: r.id, errors: r.errors, keptFields: r.keptFields });
}
await shot(hr, 'tpl-bad-last');

// 4. Placeholders not in the fields
r = await author(hr, { name: `بێ خانە ${MARK}`, category: 'تاقیکردنەوە', fields: 'employee | ناو | text', body: 'بەڕێز {{employee}} و {{manager}}' });
note('templates-bad', 'placeholder missing', { status: r.status, errors: r.errors });
r = await author(hr, { name: `خانەی کوردی ${MARK}`, category: 'تاقیکردنەوە', fields: 'employee | ناو | text', body: 'بەڕێز {{employee}} و {{ناوی بەڕێوەبەر}} و {{ manager }} و {employee}' });
note('templates-bad', 'kurdish placeholder', { status: r.status, id: r.id, errors: r.errors });
const tKu = r.id;
r = await author(hr, { name: `خانەی بەکارنەهاتوو ${MARK}`, category: 'تاقیکردنەوە', fields: 'employee | ناو | text\nunused | بەکارنەهاتوو | text', body: 'بەڕێز {{employee}}' });
note('templates-bad', 'field not used in body', { status: r.status, id: r.id, errors: r.errors });
r = await author(hr, { name: `خانەی دووبارە ${MARK}`, category: 'تاقیکردنەوە', fields: 'employee | ناو | text\nemployee | ناوی دووەم | date', body: 'بەڕێز {{employee}}' });
note('templates-bad', 'duplicate field name', { status: r.status, id: r.id, errors: r.errors });
const tDupField = r.id;

// 5. Duplicate template name
r = await author(hr, { name: `مۆڵەتی ساکار ${MARK}`, category: 'تاقیکردنەوە', fields: 'employee | ناو | text', body: '{{employee}}' });
note('templates-bad', 'duplicate name', { status: r.status, errors: r.errors });
r = await author(hr, { name: `  مۆڵەتی ساکار ${MARK}  `, category: 'تاقیکردنەوە', fields: 'employee | ناو | text', body: '{{employee}}' });
note('templates-bad', 'duplicate name with spaces', { status: r.status, errors: r.errors });

// 6. Markup in the body
r = await author(hr, { name: `نیشانە ${MARK}`, category: 'تاقیکردنەوە', fields: 'employee | ناو | text', body: '<b>بەڕێز</b> {{employee}} <img src=x onerror="alert(\'tpl-xss\')">' });
note('templates', 'markup body', { status: r.status, id: r.id });
const tMarkup = r.id;

// 7. Editing / versioning
for (const path of [`/templates/${tPlain}/edit`]) {
  const x = await hr.goto(path);
  note('templates-version', 'edit route', { path, status: x.status() });
}
await hr.goto(`/templates/${tPlain}`);
note('templates-version', 'fill page links', { links: await hr.locator('.content a, main a').evaluateAll(a => a.map(x => x.getAttribute('href')).filter(h => h && h.includes('template'))) });
await hr.goto('/templates');
note('templates-version', 'list actions', { buttons: await hr.locator('.card:has(h2:text("' + `تاقیکردنەوە ${MARK}` + '")) a, .card:has(h2:text("' + `تاقیکردنەوە ${MARK}` + '")) button').allInnerTexts() });

// 8. Clerk fills
const { page: c } = await as('ahang');
c.on('dialog', d => dialogs.push(d.message()));
async function fill(tid, values, ref, { typeDays = null } = {}) {
  await c.goto(`/templates/${tid}`);
  for (const [k, v] of Object.entries(values)) {
    const el = c.locator(`#f_${k}`);
    const tag = await el.evaluate(e => e.tagName + ':' + (e.type || ''));
    if (tag.startsWith('SELECT')) await el.selectOption(v); else await el.fill(v);
  }
  if (typeDays !== null) { await c.locator('#f_days').click(); await c.keyboard.type(typeDays); }
  if (ref !== null) await c.fill('#reference', ref);
  const inv = await invalidField(c, `form[action="/templates/${tid}"]`);
  const daysVal = await c.locator('#f_days').inputValue().catch(() => null);
  if (inv) return { invalid: inv, daysVal };
  await c.click(`form[action="/templates/${tid}"] button[type=submit]`);
  await c.waitForLoadState('domcontentloaded');
  return { url: c.url(), notices: await notice(c), daysVal, keptRef: await c.inputValue('#reference').catch(() => null), keptEmployee: await c.inputValue('#f_employee').catch(() => null) };
}
const vals = { employee: `هێمن ${MARK}`, reason: 'سەفەر\nبۆ هەولێر', from: localDay(40), days: '3' };
r = await fill(tPlain, vals, '');
note('templates-fill', 'no letter', r);
if (/\/fills\/\d+\/print/.test(r.url)) {
  await c.waitForTimeout(800);
  await shot(c, 'tpl-print-noletter', { fullPage: true });
  note('templates-fill', 'print text', { body: (await c.locator('.sheet').innerText()).replace(/\s+/g, ' ') });
}
for (const [label, ref] of [['by number', L1.no], ['by barcode', L1.barcode], ['kurdish number', toKu(L1.no)], ['serial only', L1.no.split('/').pop()], ['wrong', 'ه/2026/999999']]) {
  r = await fill(tPlain, vals, ref);
  note('templates-fill', label, { ref, ...r });
  if (/\/fills\/\d+\/print/.test(r.url)) note('templates-fill', `${label} print footer`, { meta: (await c.locator('.sheet .meta').last().innerText()).replace(/\s+/g, ' ') });
  else await shot(c, `tpl-fill-${label.replace(' ', '-')}`);
}
// number field typed in Kurdish digits
r = await fill(tPlain, { ...vals, days: '' }, '', { typeDays: '٥' });
note('templates-fill', 'days typed kurdish', r);
await shot(c, 'tpl-days-kurdish');
// select template: can it be filled at all?
r = await fill(tAll, vals, '');
note('templates-fill', 'template with select', r);
await shot(c, 'tpl-select-fill');
// kurdish placeholder print
if (tKu) { r = await fill(tKu, { employee: 'ئاراس' }, ''); note('templates-fill', 'kurdish placeholder print', { body: (await c.locator('.sheet .body').innerText().catch(() => '')).replace(/\s+/g, ' ') }); }
if (tDupField) { await c.goto(`/templates/${tDupField}`); note('templates-fill', 'duplicate field page', { inputs: await c.locator('form[action^="/templates/"] [name=employee]').count() }); }
if (tMarkup) { r = await fill(tMarkup, { employee: '<i>x</i>' }, ''); await c.waitForTimeout(1500); note('templates-fill', 'markup print', { dialogs, html: await c.locator('.sheet .body').innerHTML().catch(() => '') }); }

// who sees which fills
await c.goto('/templates');
note('templates-fill', 'ahang recent fills', { rows: await c.locator('.card:has(h2:text("دواین پڕکراوەکان")) tbody tr').count() });
console.log('problems', hr.problems, c.problems, dialogs);
await close();
