// Transaction types: create, invalid/duplicate code, default room and days, switching off and on.
import { launch, close, as, note, shot, notice, invalidField, MARK, BASE, registerLetter, saveJson, localDay } from './lib.mjs';

const ROOM_A_NAME = 'ژووری تاقیکردنەوە rad1';
const ROOM_A = '154';
const b = await launch();
const { page: s } = await as('shilan');
const R = { mark: MARK };
const code = `REC-${MARK.toUpperCase()}`;

async function create(p, v) {
  await p.goto('/admin/doc-types');
  const f = 'form[action="/admin/doc-types"]';
  for (const [k, val] of Object.entries(v)) {
    if (['base_kind', 'default_room_id'].includes(k)) await p.selectOption(`${f} #${k}`, val);
    else if (k === 'requires_seal') await p.check(`${f} [name=requires_seal]`);
    else await p.fill(`${f} #${k}`, val);
  }
  const inv = await invalidField(p, f);
  if (inv) return { invalid: inv };
  await p.click(`${f} button[type=submit]`); await p.waitForLoadState('domcontentloaded');
  return { url: p.url(), notices: await notice(p), nameField: await p.inputValue(`${f} #name`) };
}
const roomOpt = await (async () => { await s.goto('/admin/doc-types'); return s.locator('#default_room_id option').evaluateAll((os, n) => os.find(o => o.textContent.includes(n))?.value, ROOM_A_NAME); })();
note('doctypes', 'room A option value', { roomOpt });

let r = await create(s, { name: `مۆڵەتی تاقیکردنەوە ${MARK}`, code, base_kind: 'citizen_request', category: 'تاقیکردنەوە', default_room_id: roomOpt, default_due_days: '7', description: 'جۆری تاقیکردنەوە', requires_seal: true });
note('doctypes', 'create', r);
await s.goto('/admin/doc-types');
const row = s.locator('tbody tr', { hasText: code });
note('doctypes', 'row', { text: (await row.innerText()).replace(/\s+/g, ' ') });
await shot(s, 'dt-created-row', { locator: row });

for (const [label, v] of [
  ['starts with digit', { name: `هەڵە ${MARK}`, code: `1${code}` }],
  ['space', { name: `هەڵە ${MARK}`, code: 'AB CD' }],
  ['kurdish', { name: `هەڵە ${MARK}`, code: 'مۆڵەت' }],
  ['one char', { name: `هەڵە ${MARK}`, code: 'A' }],
  ['underscore', { name: `هەڵە ${MARK}`, code: 'AB_CD' }],
  ['duplicate', { name: `دووبارە ${MARK}`, code }],
  ['duplicate lowercase', { name: `دووبارە ${MARK}`, code: code.toLowerCase() }],
  ['whitespace name', { name: '   ', code: `${code}-W` }],
  ['days 0', { name: `ڕۆژ ${MARK}`, code: `${code}-D0`, default_due_days: '0' }],
  ['days 61', { name: `ڕۆژ ${MARK}`, code: `${code}-D61`, default_due_days: '61' }],
  ['days 2.5', { name: `ڕۆژ ${MARK}`, code: `${code}-D25`, default_due_days: '2.5' }],
]) {
  r = await create(s, v);
  note('doctypes-bad', label, r);
}
await create(s, { name: 'x', code: 'AB CD' }); // leave form filled for a screenshot of the browser message

// Registration form offers it?
await s.goto('/registry/new');
const opt = await s.locator('#doc_type_option_id option').evaluateAll((os, n) => { const o = os.find(o => o.textContent.includes(n)); return o ? { value: o.value, text: o.textContent.trim(), selectedIndex: os.indexOf(o) } : null; }, MARK);
note('doctypes-use', 'registration offers it', { opt, dataAttrs: await s.locator('#doc_type_option_id option').first().evaluate(o => Object.keys(o.dataset)) });
R.typeId = opt?.value;
await s.selectOption('#doc_type_option_id', opt.value);
await s.waitForTimeout(500);
note('doctypes-use', 'after choosing: anything prefilled?', { formText: (await s.locator('form[data-similar-form]').innerText()).includes(ROOM_A_NAME) });

// Register with the type, then look at the send form and the due date after sending
const L = await registerLetter(s, `کتابی جۆری تاقیکردنەوە ${MARK}`, { type: opt.value });
R.letter = L;
note('doctypes-use', 'registered', L);
await s.goto(`/documents/${L.id}`);
note('doctypes-use', 'letter shows type', { type: await s.locator('tr:has(th:text-is("جۆر")) td').innerText(), sendDefault: await s.locator('#to_room option:checked').innerText() });
await s.selectOption('#to_room', ROOM_A);
await s.click('form[action$="/route"]:has(input[value=single]) button[type=submit]'); await s.waitForLoadState('domcontentloaded');
note('doctypes-use', 'sent to room A', { url: s.url(), notices: await notice(s) });
await s.goto('/my-day');
const wrow = s.locator('tr', { hasText: L.no });
note('doctypes-use', 'due date after sending', { row: (await wrow.first().innerText()).replace(/\s+/g, ' '), today: localDay(0), plus5: localDay(5), plus7: localDay(7) });

// Used count
await s.goto('/admin/doc-types');
note('doctypes', 'row after use', { text: (await s.locator('tbody tr', { hasText: code }).innerText()).replace(/\s+/g, ' ') });

// Switch off
await s.locator('tbody tr', { hasText: code }).locator('form[action$="/toggle"] button').click(); await s.waitForLoadState('domcontentloaded');
note('doctypes-toggle', 'off', { notices: await notice(s), row: (await s.locator('tbody tr', { hasText: code }).innerText()).replace(/\s+/g, ' ') });
await shot(s, 'dt-switched-off', { fullPage: false });
await s.goto('/registry/new');
note('doctypes-toggle', 'registration after off', { offered: await s.locator('#doc_type_option_id option', { hasText: MARK }).count() });
await s.goto('/registry/photo');
// existing letter
await s.goto(`/documents/${L.id}`);
note('doctypes-toggle', 'existing letter after off', { type: await s.locator('tr:has(th:text-is("جۆر")) td').innerText(), url: s.url() });
// forged registration with the switched-off type
await s.goto('/registry/new');
await s.fill('#subject', `کتاب بە جۆری ناچالاک ${MARK}`);
await s.fill('#sender_name', `نێردەر ${MARK}`);
await s.evaluate(id => { const o = document.createElement('option'); o.value = id; o.textContent = 'off'; document.querySelector('#doc_type_option_id').append(o); document.querySelector('#doc_type_option_id').value = id; }, R.typeId);
await s.click('form[data-similar-form] button[type=submit]'); await s.waitForLoadState('domcontentloaded');
if (await s.locator('input[name="confirm_similar"]').count()) { await s.click('form[data-similar-form] .row button[type=submit]'); await s.waitForLoadState('domcontentloaded'); }
note('doctypes-toggle', 'forged register with off type', { url: s.url(), notices: await notice(s) });
// search filters by type?
await s.goto(`/documents?q=${encodeURIComponent(MARK)}`).catch(() => {});
note('doctypes-toggle', 'search page', { url: s.url(), typeFilterOptions: await s.locator('select option', { hasText: MARK }).count() });

// Mayor switches it back on
const { page: a } = await as('aram');
await a.goto('/admin/doc-types');
note('doctypes-toggle', 'aram sees page', { url: a.url(), rows: await a.locator('tbody tr').count() });
await a.locator('tbody tr', { hasText: code }).locator('form[action$="/toggle"] button').click(); await a.waitForLoadState('domcontentloaded');
note('doctypes-toggle', 'aram on', { notices: await notice(a), row: (await a.locator('tbody tr', { hasText: code }).innerText()).replace(/\s+/g, ' ') });
await s.goto('/registry/new');
note('doctypes-toggle', 'registration after on', { offered: await s.locator('#doc_type_option_id option', { hasText: MARK }).count() });
// toggling a non-existent id
const tok = await a.locator('input[name=_csrf]').first().inputValue();
const x = await a.request.post(`${BASE}/admin/doc-types/999999/toggle`, { form: { _csrf: tok }, maxRedirects: 0 });
note('doctypes-toggle', 'toggle missing id', { status: x.status(), location: decodeURIComponent(x.headers().location ?? '') });

saveJson('doctypes.json', R);
console.log('problems', s.problems, a.problems);
await close();
