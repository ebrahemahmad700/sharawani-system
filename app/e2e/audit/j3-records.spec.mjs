// Journey 3: the registers that are not letters.
//
// The map archive (a DWG with a PDF preview, verified on the shelf, moved), the
// company register (a company, a letter linked to it, a licence file), a form
// template filled in and printed, a leave request decided, and a new kind of
// transaction added and switched off again.

import { test } from '@playwright/test';
import { as, shot, noticeText, pickFirst, pickByText, inkPdf, mark, ok, visible, noProblems, dwgBytes } from './lib.mjs';

test.describe.configure({ mode: 'serial' });

const M = mark();

test('map archive: a new DWG with its PDF preview, searched, verified, moved', async ({ browser }) => {
  const { context, page } = await as(browser, 'karwan');
  await page.goto('/archive/new');
  await shot(page, 'j3-archive-new');

  // First, the empty form sent as it is: the browser should stop it with its own
  // messages rather than a server error.
  await page.click('form[action="/archive/new"] button[type=submit]');
  await ok(/\/archive\/new/.test(page.url()), 'an empty archive form leaves the page', { page });

  // Then the server's own checks, with the browser's switched off.
  await page.evaluate(() => document.querySelector('form[action="/archive/new"]').noValidate = true);
  await page.click('form[action="/archive/new"] button[type=submit]');
  await page.waitForLoadState('load');
  const body = await page.locator('body').innerText();
  await ok(!/داواکارییەکەت تەواو نەبوو/.test(body), 'an empty archive form (without browser checks) gives the error page', { page });
  await shot(page, 'j3-archive-empty-server');

  await page.goto('/archive/new');
  await page.setInputFiles('#file', { name: `plan-${M}.dwg`, mimeType: 'application/octet-stream', buffer: dwgBytes() });
  await page.setInputFiles('#preview', { name: `plan-${M}.pdf`, mimeType: 'application/pdf', buffer: inkPdf() });
  const plot = `77/${Math.floor(Math.random() * 900) + 100}`;
  await page.fill('#plot_no', plot);
  await page.fill('#title', `نەخشەی خانووی تاقیکردنەوە ${M}`);
  await page.fill('#year', '٢٠٢٤');
  await page.fill('#owner_names', `خاوەنی تاقیکردنەوە ${M}`);
  await page.fill('#shelf', '٤');
  await page.fill('#section', 'B');
  await page.fill('#folder_no', '12');
  for (const sel of ['#file_kind', '#kind', 'select[name=kind]', 'select[name=file_kind]']) {
    if (await page.locator(sel).count()) { await pickFirst(page, sel); break; }
  }
  await page.click('form[action="/archive/new"] button[type=submit]');
  await page.waitForLoadState('load');
  await shot(page, 'j3-archive-saved');
  const saved = /\/archive\/\d+/.test(page.url());
  if (!await ok(saved, 'a complete DWG archive entry was not saved (last report, item 3)', { page, detail: await noticeText(page) })) { await context.close(); return; }
  const archiveUrl = new URL(page.url()).pathname;

  const dl = await page.request.get(`${archiveUrl}/download`);
  await ok(dl.status() === 200, 'the DWG does not download', { detail: dl.status() });
  const pv = await page.request.get(`${archiveUrl}/preview`);
  await ok(pv.status() === 200 && (pv.headers()['content-type'] ?? '').includes('pdf'), 'the PDF preview does not open', { detail: [pv.status(), pv.headers()['content-type']] });

  // The uploader may not verify their own map; the other archive room does.
  const checker = await as(browser, 'zhyan');
  await checker.page.goto(archiveUrl);
  const verify = checker.page.locator('form[action$="/verify"] button');
  if (await ok(await verify.count() > 0, 'room 9 is not offered «found it on the shelf» for room 8’s map', { page: checker.page })) {
    await verify.click();
    await checker.page.waitForLoadState('load');
    await shot(checker.page, 'j3-archive-verified');
  }
  await checker.context.close();
  await page.fill('form[action$="/location"] #shelf', '٥');
  await page.click('form[action$="/location"] button[type=submit]');
  await page.waitForLoadState('load');
  await shot(page, 'j3-archive-moved');
  await ok((await page.locator('.content').innerText()).includes('٥') || (await page.locator('.content').innerText()).includes('5'), 'the new shelf is not shown after moving', { page });

  await page.goto(`/archive?q=${encodeURIComponent(plot)}`);
  await shot(page, 'j3-archive-search');
  await ok(await visible(page.getByText(`نەخشەی خانووی تاقیکردنەوە ${M}`)), 'archive search by plot does not find the new entry', { page, detail: plot });

  await page.goto(`/plots?p=${encodeURIComponent(plot)}`);
  await shot(page, 'j3-plot-with-map');
  await ok(await visible(page.getByText(`نەخشەی خانووی تاقیکردنەوە ${M}`)), 'the plot file does not show the archived map', { page, detail: plot });

  // Room 9 can see room 8's archive (one archive, two rooms).
  const nine = await as(browser, 'zhyan');
  await nine.page.goto(archiveUrl);
  await ok((await nine.page.locator('body').innerText()).includes(M), 'room 9 cannot open a map archived by room 8', { page: nine.page, severity: 'question' });
  await nine.context.close();

  await noProblems(page, 'archive');
  await context.close();
});

test('company register: add, link a letter, attach a licence, edit, search', async ({ browser }) => {
  const { context, page } = await as(browser, 'shilan');
  await page.goto('/companies/new');
  await shot(page, 'j3-company-new');
  const name = `کۆمپانیای تاقیکردنەوە ${M}`;
  await page.fill('#name', name);
  await page.fill('#registration_no', `REG-${M}`);
  await page.fill('#phone', '0750 111 2233');
  await page.fill('#licence_expires_on', '2027-03-01');
  await page.click('.content form[method=post]:not([action$="/link"]):not([action$="/files"]):not([action$="/unlink"]) button[type=submit]');
  await page.waitForLoadState('load');
  await shot(page, 'j3-company-saved');
  if (!await ok(/\/companies\/\d+/.test(page.url()), 'a new company was not saved', { page, detail: await noticeText(page) })) { await context.close(); return; }
  const companyUrl = new URL(page.url()).pathname;

  // Link the most recent letter by its number.
  const reg = await context.newPage();
  await reg.goto('/registry');
  const no = (await reg.locator('table td.mono, table .mono').first().textContent()).trim();
  await reg.close();
  await page.fill('#link_no', no);
  await page.click('form[action$="/link"] button[type=submit]');
  await page.waitForLoadState('load');
  await shot(page, 'j3-company-linked');
  const n = await noticeText(page);
  await ok(!/هەڵە|نەدۆزرایەوە/.test(n ?? '') && (await page.locator('.content').innerText()).includes(no), 'linking a letter by the number shown on the register fails', { page, detail: { no, notice: n } });

  await page.fill('form[action$="/files"] #title', 'مۆڵەتی کار');
  await page.setInputFiles('form[action$="/files"] #file', { name: `licence-${M}.pdf`, mimeType: 'application/pdf', buffer: inkPdf() });
  await page.click('form[action$="/files"] button[type=submit]');
  await page.waitForLoadState('load');
  await shot(page, 'j3-company-file');
  await ok((await page.locator('.content').innerText()).includes('مۆڵەتی کار'), 'the company file was not added', { page, detail: await noticeText(page) });

  await page.goto(`${companyUrl}/edit`);
  await page.fill('#representative', 'نوێنەری تاقیکردنەوە');
  await page.click('.content form[method=post]:not([action$="/link"]):not([action$="/files"]):not([action$="/unlink"]) button[type=submit]');
  await page.waitForLoadState('load');
  await ok((await page.locator('.content').innerText()).includes('نوێنەری تاقیکردنەوە'), 'editing a company did not save', { page });

  await page.goto(`/companies?q=${encodeURIComponent(M)}`);
  await shot(page, 'j3-company-search');
  await ok(await visible(page.getByText(name)), 'company search does not find the new company', { page });

  // The same registration number twice.
  await page.goto('/companies/new');
  await page.fill('#name', `${name} دووەم`);
  await page.fill('#registration_no', `REG-${M}`);
  await page.click('.content form[method=post]:not([action$="/link"]):not([action$="/files"]):not([action$="/unlink"]) button[type=submit]');
  await page.waitForLoadState('load');
  await shot(page, 'j3-company-duplicate');
  await ok(!/داواکارییەکەت تەواو نەبوو/.test(await page.locator('body').innerText()), 'a duplicate registration number gives the error page', { page });

  await noProblems(page, 'companies');
  await context.close();
});

test('a form template: written, filled in, printed', async ({ browser }) => {
  const { context, page } = await as(browser, 'bafrin');
  await page.goto('/templates');
  await shot(page, 'j3-templates');
  await page.goto('/templates/new');
  await page.fill('#name', `مۆڵەتی کارمەند ${M}`);
  await page.fill('#category', 'مۆڵەت');
  await page.fill('#fields', 'employee | ناوی کارمەند | text\ndays | ژمارەی ڕۆژ | number\nfrom | لە بەرواری | date');
  await page.fill('#body', 'بەڕێز {{employee}} مۆڵەتی {{days}} ڕۆژی پێدرا لە {{from}}ەوە.');
  await page.click('form[action="/templates/new"] button[type=submit]');
  await page.waitForLoadState('load');
  await shot(page, 'j3-template-saved');
  if (!await ok(/\/templates\/\d+(\?|$)/.test(page.url()), 'a new template was not saved', { page, detail: await noticeText(page) })) { await context.close(); return; }
  const tUrl = page.url();

  await page.fill('#f_employee', 'شنە عەبدوڵا');
  await page.fill('#f_days', '3');
  await page.fill('#f_from', '2026-09-20');
  await page.click(`form[action="${new URL(tUrl).pathname}"] button[type=submit]`);
  await page.waitForLoadState('load');
  await shot(page, 'j3-template-print');
  await ok(/\/fills\/\d+\/print/.test(page.url()) && (await page.locator('body').innerText()).includes('شنە عەبدوڵا'), 'filling a template does not print it', { page });
  const printed = await page.locator('body').innerText();
  const withoutMark = printed.replaceAll(M, '');
  await ok(!/[0-9]/.test(withoutMark) || !/[٠-٩]/.test(withoutMark), 'the printed form mixes Latin and Kurdish digits', { page, severity: 'minor', detail: withoutMark.slice(0, 300) });

  // Linking to a letter that is not there.
  await page.goto(tUrl);
  await page.fill('#f_employee', 'x'); await page.fill('#f_days', '1'); await page.fill('#f_from', '2026-09-20');
  await page.fill('#reference', 'ه/1999/99999');
  await page.click(`form[action="${new URL(tUrl).pathname}"] button[type=submit]`);
  await page.waitForLoadState('load');
  await shot(page, 'j3-template-bad-letter');
  await ok(await page.locator('.sidebar').count() > 0 && /نەدۆزرایەوە/.test(await noticeText(page) ?? ''), 'a template linked to a missing letter does not come back as the form with a message', { page });

  await noProblems(page, 'templates');
  await context.close();
});

test('leave: requested by HR for a room head, decided by the mayor', async ({ browser }) => {
  const hr = await as(browser, 'bafrin');
  await hr.page.goto('/leave');
  await shot(hr.page, 'j3-leave');
  if (await hr.page.locator('#user_id').count()) await pickByText(hr.page, '#user_id', 'هێرش');
  // Far ahead and different every run: the same person cannot have two leaves on the same days.
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const offset = 400 + Math.floor(Math.random() * 3000);
  await hr.page.fill('#start_date', day(offset));
  await hr.page.fill('#end_date', day(offset + 2));
  await hr.page.fill('#note', `مۆڵەتی تاقیکردنەوە ${M}`);
  await hr.page.click('form[action="/leave/new"] button[type=submit]');
  await hr.page.waitForLoadState('load');
  await shot(hr.page, 'j3-leave-requested');
  await ok(/نێردرا/.test(await noticeText(hr.page) ?? ''), 'no notice after requesting leave', { page: hr.page });

  // The date fields are the system's own ساڵ/مانگ/ڕۆژ, not the browser's box.
  await hr.page.fill('#start_date', day(offset + 10));
  await hr.page.locator('#start_date').blur();
  await ok(/^[٠-٩]{4}\/[٠-٩]{2}\/[٠-٩]{2}$/.test(await hr.page.locator('#start_date').inputValue()),
    'a typed date is not written back as ساڵ/مانگ/ڕۆژ', { page: hr.page, detail: await hr.page.locator('#start_date').inputValue() });

  // End before start. The field refuses it before sending, naming «لە»; the
  // server's own refusal is held by test/dates.test.mjs.
  await hr.page.fill('#end_date', day(offset + 5));
  await hr.page.click('form[action="/leave/new"] button[type=submit]');
  await hr.page.waitForLoadState('load');
  const fieldSays = await hr.page.locator('#end_date').evaluate(el => el.validationMessage);
  await ok(/«لە»/.test(fieldSays) || /دروست نین/.test(await noticeText(hr.page) ?? ''), 'leave ending before it starts is not refused clearly', { page: hr.page, detail: fieldSays });

  const mayor = await as(browser, 'aram');
  await mayor.page.goto('/leave');
  const row = mayor.page.locator('tr', { hasText: 'هێرش قادر' }).filter({ hasText: 'چاوەڕوانی بڕیار' }).first();
  await ok((await mayor.page.locator('.content').innerText()).includes(`مۆڵەتی تاقیکردنەوە ${M}`), 'the note written with a leave request is not shown anywhere on the leave list', { page: mayor.page, severity: 'minor' });
  const approve = row.locator('button[value=approved]');
  const waitingBefore = await mayor.page.locator('tr', { hasText: 'هێرش قادر' }).filter({ hasText: 'چاوەڕوانی بڕیار' }).count();
  if (await ok(await approve.count() > 0, 'the mayor is not offered the leave request to decide', { page: mayor.page })) {
    await approve.click();
    await mayor.page.waitForLoadState('load');
    await shot(mayor.page, 'j3-leave-approved');
    // Earlier runs leave requests behind, so count the waiting ones rather than
    // reading whichever row happens to be first.
    const waiting = await mayor.page.locator('tr', { hasText: 'هێرش قادر' }).filter({ hasText: 'چاوەڕوانی بڕیار' }).count();
    await ok(waiting === waitingBefore - 1, 'approving a leave request does not take it off the waiting list', { page: mayor.page, detail: { waitingBefore, waiting } });
  }

  // Somebody who is not HR can open the leave screen by its address.
  const clerk = await as(browser, 'rebwar');
  const r = await clerk.page.goto('/leave');
  await shot(clerk.page, 'j3-leave-as-clerk');
  await ok(r.status() !== 200 || !(await clerk.page.locator('body').innerText()).includes('هێرش قادر'), 'a room clerk can read everybody\'s leave by typing /leave', { page: clerk.page, severity: 'security' });

  for (const p of [hr, mayor, clerk]) { await noProblems(p.page, 'leave'); await p.context.close(); }
});

test('a new kind of transaction, offered on the register, then switched off', async ({ browser }) => {
  const { context, page } = await as(browser, 'shilan');
  await page.goto('/admin/doc-types');
  await shot(page, 'j3-doctypes');
  const name = `جۆری تاقیکردنەوە ${M}`;
  await page.fill('#name', name);
  await page.fill('#code', `T-${M}`.toUpperCase().slice(0, 24));
  await pickFirst(page, '#base_kind');
  await page.click('form[action="/admin/doc-types"] button[type=submit]');
  await page.waitForLoadState('load');
  await shot(page, 'j3-doctype-added');
  await ok(await visible(page.getByText(name)), 'the new kind of transaction is not listed', { page, detail: await noticeText(page) });

  await page.goto('/registry/new');
  const offered = await page.locator('#doc_type_option_id option').evaluateAll((os, n) => os.some(o => o.textContent.includes(n)), name);
  await ok(offered, 'the new kind is not offered on the registration form', { page });

  await page.goto('/admin/doc-types');
  const toggle = page.locator(`tr:has-text("${name}") form[action$="/toggle"] button`);
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForLoadState('load');
    await page.goto('/registry/new');
    const still = await page.locator('#doc_type_option_id option').evaluateAll((os, n) => os.some(o => o.textContent.includes(n)), name);
    await ok(!still, 'a switched-off kind is still offered on the registration form', { page });
  }
  await noProblems(page, 'doc types');
  await context.close();
});
