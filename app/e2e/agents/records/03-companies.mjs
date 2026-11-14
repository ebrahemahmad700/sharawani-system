// Companies: create, validation, expiry pills, edit, link letters, files, search.
import { launch, close, as, note, shot, notice, invalidField, MARK, toKu, BASE, registerLetter, localDay, inkPdf, inkPng, saveJson } from './lib.mjs';

const b = await launch();
const { page: s } = await as('shilan');
const R = { mark: MARK, companies: {} };
const reg = n => `RC-${MARK}-${n}`.toUpperCase().slice(0, 40);

async function createCompany(p, v) {
  await p.goto('/companies/new');
  for (const [k, val] of Object.entries(v)) {
    if (k === 'status') await p.selectOption('#status', val);
    else await p.fill(`#${k}`, val);
  }
  const inv = await invalidField(p, 'form[action="/companies/new"]');
  if (inv) return { invalid: inv };
  const [resp] = await Promise.all([
    p.waitForResponse(r => r.url().endsWith('/companies/new') && r.request().method() === 'POST').catch(() => null),
    p.click('form[action="/companies/new"] button[type=submit]'),
  ]);
  await p.waitForLoadState('domcontentloaded');
  const id = /\/companies\/(\d+)$/.exec(p.url())?.[1];
  return { status: resp?.status(), url: p.url(), id, notices: await notice(p), h1: await p.locator('h1').first().innerText().catch(() => null) };
}

// 1. Every field
const full = {
  name: `کۆمپانیای ئاسۆ ${MARK}`, legal_name: `شەریکەی ئاسۆ بۆ بازرگانی ${MARK}`, registration_no: reg(1), tax_no: `TX-${MARK}`,
  status: 'under_review', licence_expires_on: localDay(90), representative: `نوێنەر ${MARK}`, phone: '0750 123 4567',
  email: `info-${MARK}@aso.com`, capital: '٥٠٠ ملیۆن دینار', address: 'ڕانیە، گەڕەکی سەرچنار', note: 'تێبینی تاقیکردنەوە',
};
let r = await createCompany(s, full);
R.companies.full = r; note('companies', 'create full', r);
if (r.id) await shot(s, 'co-full-detail', { fullPage: true });

// 2. Duplicate registration number
r = await createCompany(s, { ...full, name: `کۆمپانیای دووبارە ${MARK}` });
note('companies', 'duplicate reg no', { ...r, nameFieldAfter: await s.locator('#name').count() });
await shot(s, 'co-duplicate');

// 3. Invalid email: browser and database
r = await createCompany(s, { name: `ئیمەیڵی هەڵە ${MARK}`, registration_no: reg(3), email: 'not-an-email' });
note('companies', 'email not-an-email', r);
r = await createCompany(s, { name: `ئیمەیڵی گەورە ${MARK}`, registration_no: reg(4), email: `INFO@ASO-${MARK}.COM` });
note('companies', 'email upper-case', r);
await shot(s, 'co-email-upper');
r = await createCompany(s, { name: `ئیمەیڵی کوردی ${MARK}`, registration_no: reg(5), email: `a@b.c` });
note('companies', 'email a@b.c', r);

// 4. Registration number in Kurdish digits, with a space, and whitespace-only name
r = await createCompany(s, { name: `ژمارەی کوردی ${MARK}`, registration_no: toKu('55' + Math.floor(Math.random() * 1e6)) });
note('companies', 'reg no kurdish digits', r);
await shot(s, 'co-regno-kurdish');
r = await createCompany(s, { name: `بۆشایی ${MARK}`, registration_no: `12 ${MARK}` });
note('companies', 'reg no with space', r);
r = await createCompany(s, { name: '   ', registration_no: reg(6) });
note('companies', 'name whitespace', r);
await shot(s, 'co-name-whitespace');
r = await createCompany(s, { name: 'ئ', registration_no: reg(7) });
note('companies', 'name one letter', r);

// 5. Licence expiry: past, today, tomorrow, 15, 30, 31, 45, far future, and no date
const days = { past: -10, today: 0, tomorrow: 1, d15: 15, d30: 30, d31: 31, d45: 45, d59: 59, d60: 60, far: 400 };
for (const [label, off] of Object.entries(days)) {
  r = await createCompany(s, { name: `مۆڵەت ${label} ${MARK}`, registration_no: reg(`E${label}`), licence_expires_on: localDay(off) });
  R.companies[label] = r;
  const pill = r.id ? (await s.locator('tr:has(th:text-is("بەسەرچوونی مۆڵەت")) td').innerText()).trim() : null;
  note('companies-expiry', label, { id: r.id, date: localDay(off), detailPill: pill, notices: r.notices });
}
await s.goto('/companies');
const expiringCard = s.locator('.card:has(h2:text("مۆڵەتی بەسەرچوو"))');
const expiring = await expiringCard.locator('tbody tr').evaluateAll(trs => trs.map(t => t.innerText.replace(/\s+/g, ' ')));
note('companies-expiry', 'expiring list', { rows: expiring.filter(x => x.includes(MARK)), total: expiring.length });
await shot(s, 'co-expiring', { locator: expiringCard });
await s.goto(`/companies?q=${encodeURIComponent('مۆڵەت')}`);
const listRows = await s.locator('.card:has(h2:text-is("کۆمپانیاکان")) tbody tr').evaluateAll(trs => trs.map(t => t.innerText.replace(/\s+/g, ' ')));
note('companies-expiry', 'main list pills', { rows: listRows.filter(x => x.includes(MARK)) });
await shot(s, 'co-list-pills', { fullPage: true });

// 6. Edit
const fid = R.companies.full.id;
await s.goto(`/companies/${fid}/edit`);
note('companies-edit', 'edit form values', { name: await s.inputValue('#name'), status: await s.inputValue('#status'), expiry: await s.inputValue('#licence_expires_on'), email: await s.inputValue('#email') });
await s.fill('#representative', `نوێنەری نوێ ${MARK}`);
await s.click('form[action$="/edit"] button[type=submit]'); await s.waitForLoadState('domcontentloaded');
note('companies-edit', 'edit rep', { url: s.url(), notices: await notice(s) });
// edit to a registration number another company has
await s.goto(`/companies/${fid}/edit`);
await s.fill('#registration_no', reg('Epast'));
await s.fill('#note', 'ئەم گۆڕانکارییە دەبێت نەفەوتێت');
const [er] = await Promise.all([s.waitForResponse(x => x.url().includes('/edit') && x.request().method() === 'POST'), s.click('form[action$="/edit"] button[type=submit]')]);
await s.waitForLoadState('domcontentloaded');
note('companies-edit', 'edit duplicate reg', { status: er.status(), url: s.url(), notices: await notice(s), regField: await s.inputValue('#registration_no').catch(() => null), noteField: await s.inputValue('#note').catch(() => null) });
await shot(s, 'co-edit-duplicate');
// edit with Kurdish digits registration number / upper-case email
for (const [label, field, val] of [['kurdish reg', 'registration_no', toKu('778899')], ['upper email', 'email', 'SALES@ASO.COM'], ['whitespace name', 'name', '   ']]) {
  await s.goto(`/companies/${fid}/edit`);
  await s.fill(`#${field}`, val);
  const [x] = await Promise.all([s.waitForResponse(y => y.url().includes('/edit') && y.request().method() === 'POST'), s.click('form[action$="/edit"] button[type=submit]')]);
  await s.waitForLoadState('domcontentloaded');
  const bodyText = (await s.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200);
  note('companies-edit', `edit ${label}`, { status: x.status(), url: s.url(), notices: await notice(s), body: bodyText });
  await shot(s, `co-edit-${label.replace(' ', '-')}`);
}

// 7. Link letters
const L1 = await registerLetter(s, `کتابی کۆمپانیا ${MARK} یەکەم`);
const L2 = await registerLetter(s, `کتابی کۆمپانیا ${MARK} دووەم`);
R.letters = [L1, L2];
note('companies-link', 'letters', { L1, L2 });
async function link(ref) {
  await s.goto(`/companies/${fid}`);
  await s.fill('#link_no', ref);
  await s.click('form[action$="/link"] button'); await s.waitForLoadState('domcontentloaded');
  const count = await s.locator('.card:has(h2:text("کتابەکانی ئەم کۆمپانیایە")) tbody tr').count();
  return { notices: await notice(s), linkedRows: count, h2: await s.locator('h2:text("کتابەکانی ئەم کۆمپانیایە")').innerText() };
}
note('companies-link', 'by number', { ref: L1.no, ...(await link(L1.no)) });
note('companies-link', 'same again', { ref: L1.no, ...(await link(L1.no)) });
note('companies-link', 'by barcode', { ref: L2.barcode, ...(await link(L2.barcode)) });
note('companies-link', 'by kurdish digits number', { ref: toKu(L1.no), ...(await link(toKu(L1.no))) });
const serialOnly = L1.no.split('/').pop();
note('companies-link', 'serial only', { ref: serialOnly, ...(await link(serialOnly)) });
note('companies-link', 'wrong number', { ref: 'ه/2026/999999', ...(await link('ه/2026/999999')) });
note('companies-link', 'garbage', { ref: 'abc', ...(await link('abc')) });
note('companies-link', 'kurdish barcode', { ref: toKu(L2.barcode), ...(await link(toKu(L2.barcode))) });
await s.goto(`/companies/${fid}`); await shot(s, 'co-linked', { fullPage: true });
// Is the company shown on the letter?
await s.goto(`/documents/${L1.id}`);
note('companies-link', 'letter shows company', { row: await s.locator('tr:has(th:text-is("کۆمپانیا")) td').innerText().catch(() => null) });
// Unlink
await s.goto(`/companies/${fid}`);
await s.locator('form[action$="/unlink"] button').first().click(); await s.waitForLoadState('domcontentloaded');
note('companies-link', 'unlink', { notices: await notice(s), linkedRows: await s.locator('.card:has(h2:text("کتابەکانی ئەم کۆمپانیایە")) tbody tr').count() });

// dler (contracts head) links a front-desk letter he cannot see
const { page: d } = await as('dler');
await d.goto(`/companies/${fid}`);
note('companies-link', 'dler view', { url: d.url(), edit: await d.locator(`a[href="/companies/${fid}/edit"]`).count(), linked: await d.locator('.card:has(h2:text("کتابەکانی ئەم کۆمپانیایە")) tbody tr').count(), h2: await d.locator('h2:text("کتابەکانی ئەم کۆمپانیایە")').innerText() });
await d.fill('#link_no', L2.no); await d.click('form[action$="/link"] button'); await d.waitForLoadState('domcontentloaded');
note('companies-link', 'dler links invisible letter', { notices: await notice(d) });
const { page: h } = await as('hemin');
await h.goto(`/companies/${fid}`);
note('companies-ro', 'hemin view', { edit: await h.locator(`a[href="/companies/${fid}/edit"]`).count(), newBtn: 0 });

// 8. Files
async function addFile(p, title, validUntil, file) {
  await p.goto(`/companies/${fid}`);
  await p.fill('form[action$="/files"] #title', title);
  if (validUntil) await p.fill('#valid_until', validUntil);
  await p.setInputFiles('form[action$="/files"] #file', file);
  const inv = await invalidField(p, 'form[action$="/files"]');
  if (inv) return { invalid: inv, inlineMsg: await p.locator('form[action$="/files"]').innerText().then(t => t.slice(-160)) };
  await p.click('form[action$="/files"] button[type=submit]'); await p.waitForLoadState('domcontentloaded');
  return { url: p.url(), notices: await notice(p) };
}
note('companies-files', 'pdf past', await addFile(s, `مۆڵەتی کۆن ${MARK}`, localDay(-5), { name: 'licence.pdf', mimeType: 'application/pdf', buffer: inkPdf() }));
note('companies-files', 'png 20 days', await addFile(s, `پاکتاو ${MARK}`, localDay(20), { name: 'tax.png', mimeType: 'image/png', buffer: inkPng() }));
note('companies-files', 'no date', await addFile(s, `پەیماننامە ${MARK}`, null, { name: 'contract.pdf', mimeType: 'application/pdf', buffer: inkPdf() }));
note('companies-files', 'renamed txt as pdf', await addFile(s, `ساختە ${MARK}`, null, { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is plain text, not a pdf at all') }));
note('companies-files', 'dwg', await addFile(s, `نەخشە ${MARK}`, null, { name: 'x.dwg', mimeType: 'application/octet-stream', buffer: Buffer.concat([Buffer.from('AC1032'), Buffer.alloc(100)]) }));
await s.goto(`/companies/${fid}`);
const filesCard = s.locator('.card:has(h2:text("پەڕگەکانی کۆمپانیا"))');
note('companies-files', 'files table', { rows: await filesCard.locator('tbody tr').evaluateAll(t => t.map(x => x.innerText.replace(/\s+/g, ' '))) });
await shot(s, 'co-files', { locator: filesCard });
const firstFile = await filesCard.locator('a[href^="/companies/files/"]').first().getAttribute('href');
const fr = await s.request.get(BASE + firstFile);
note('companies-files', 'open file', { status: fr.status(), type: fr.headers()['content-type'] });
// Does the list count files? ("کتاب" column counts company_document or company_file?)
await s.goto(`/companies?q=${encodeURIComponent(full.name)}`);
note('companies-files', 'list row', { rows: await s.locator('.card:has(h2:text-is("کۆمپانیاکان")) tbody tr').evaluateAll(t => t.map(x => x.innerText.replace(/\s+/g, ' '))) });

// 9. Search
for (const [label, q] of [['name', 'ئاسۆ ' + MARK], ['arabic ya/kaf', `كۆمپانيای ئاسۆ ${MARK}`], ['reg no', reg(1)], ['reg lower', reg(1).toLowerCase()], ['tax', `TX-${MARK}`], ['rep', `نوێنەری نوێ ${MARK}`], ['legal', 'شەریکەی ئاسۆ'], ['phone', '0750 123'], ['kurdish digits reg', toKu(reg(1))]]) {
  await s.goto(`/companies?q=${encodeURIComponent(q)}`);
  const rows = await s.locator('.card:has(h2:text-is("کۆمپانیاکان")) tbody tr').evaluateAll(t => t.map(x => x.innerText.replace(/\s+/g, ' ')));
  note('companies-search', label, { q, total: rows.length, hit: rows.some(x => x.includes('ئاسۆ') && x.includes(MARK)) });
}

saveJson('companies.json', R);
console.log('problems', s.problems, d.problems);
await close();
