// Registering: front desk and rooms, every field, edges.
import { browser, as, note, register, MARK, shot, locShot, problems, noticeText, docId, inkPng, sleep } from './lib.mjs';

const b = await browser();
const { page } = await as(b, 'shilan');

// 1. Required-field messages: press register on an empty form.
await page.goto('/registry/new');
await page.click('form[data-similar-form] > .row button[type=submit]');
await sleep(400);
const vm = await page.evaluate(() => ({
  subject: document.querySelector('#subject').validationMessage,
  sender: document.querySelector('#sender_name').validationMessage,
  url: location.href,
}));
note('empty submit validation', vm);
await shot(page, 's01-empty-submit');

// Whitespace-only subject/sender pass the browser check: what does the server say?
await page.fill('#subject', '   ');
await page.fill('#sender_name', '   ');
await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[data-similar-form] > .row button[type=submit]')]);
await page.waitForLoadState('domcontentloaded');
note('whitespace-only submit ->', page.url(), await noticeText(page));
await shot(page, 's01-whitespace-submit');
const kept = await page.evaluate(() => ({
  subject: document.querySelector('#subject')?.value, type: document.querySelector('#doc_type_option_id')?.value,
}));
note('form after whitespace error keeps', kept);

// 2. Long subject / sender, mixed text, mixed digits.
const unit = `${MARK} داواکاری مۆڵەتی بیناسازی Building permit ژمارە 12 `;
let longSubject = ''; while (longSubject.length < 420) longSubject += unit;
let longSender = ''; while (longSender.length < 220) longSender += `کاک ئازاد Azad ${MARK} `;
await page.goto('/registry/new');
await page.fill('#subject', longSubject);
await page.fill('#sender_name', longSender);
const lens = await page.evaluate(() => [document.querySelector('#subject').value.length, document.querySelector('#sender_name').value.length]);
note('typed lengths after maxlength (subject, sender)', lens);
const plotTyped = '2٤7/' + Math.floor(Math.random() * 900 + 100);
await page.locator('#plot_no').pressSequentially(plotTyped);
note('plot field shows while typing', await page.inputValue('#plot_no'), 'typed', plotTyped);
await page.locator('#sender_contact').pressSequentially('٠٧٥٠ 123 ٤٥٦٧');
await page.fill('#neighbourhood', 'گەڕەکی ئازادی Azadi');
await page.locator('#physical_shelf').pressSequentially('ب٣');
await page.locator('#physical_section').pressSequentially('A-١2');
await page.locator('#physical_folder').pressSequentially('٤٥');
await page.selectOption('#priority', 'very_urgent');
await page.selectOption('#sender_kind', 'company');
await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[data-similar-form] > .row button[type=submit]')]);
await page.waitForLoadState('domcontentloaded');
if (!/\/documents\/\d+/.test(page.url())) {
  note('long letter: similar panel shown first?', await page.locator('input[name=confirm_similar]').count());
  await Promise.all([page.waitForURL(/\/documents\/\d+/), page.click('form[data-similar-form] > .row button[type=submit]')]);
}
const longId = docId(page.url());
note('long letter id', longId, await noticeText(page));
const details = await page.locator('.card').first().locator('table tr').evaluateAll(trs => trs.map(t => t.innerText.replace(/\s+/g, ' ')));
note('long letter details', details);
await shot(page, 's01-long-letter', { fullPage: true });
problems(page, 'long letter');

// the register list, the print sheet and the receipt with the long subject
await page.goto('/registry');
await shot(page, 's01-registry-list-long');
const printPage = await page.context().newPage();
await printPage.goto(`/documents/${longId}/print`);
await sleep(800);
await shot(printPage, 's01-print-long', { fullPage: true });
await printPage.goto(`/documents/${longId}/receipt`);
await sleep(800);
await shot(printPage, 's01-receipt-long', { fullPage: true });
const receiptOverflow = await printPage.evaluate(() => {
  const s = document.querySelector('.slip'); return s ? { scrollW: s.scrollWidth, clientW: s.clientWidth, h: s.scrollHeight } : null;
});
note('receipt slip size', receiptOverflow);
await printPage.close();

// 3. Similar letters: same plot typed in Kurdish digits.
const plotKu = plotTyped.replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d)));
await page.goto('/registry/new');
await page.locator('#subject').pressSequentially(`${MARK} داواکاری دووەم بۆ هەمان پارچە`);
await page.locator('#plot_no').pressSequentially(plotKu);
await page.locator('#sender_name').pressSequentially('کەسێکی تر');
await sleep(1500);
const live = page.locator('[data-similar-live]');
note('live panel text', (await live.innerText()).replace(/\s+/g, ' ').slice(0, 300));
await locShot(live, 's01-similar-live');
await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[data-similar-form] > .row button[type=submit]')]);
await page.waitForLoadState('domcontentloaded');
note('after submit url', page.url(), 'confirm_similar present', await page.locator('input[name=confirm_similar]').count());
await shot(page, 's01-similar-server', { fullPage: true });
const valuesKept = await page.evaluate(() => ({
  subject: document.querySelector('#subject')?.value, plot: document.querySelector('#plot_no')?.value,
  sender: document.querySelector('#sender_name')?.value,
}));
note('values kept on panel page', valuesKept);
const follow = page.locator(`button[name=related_document_id][value="${longId}"]`);
note('follow-up button for long letter present', await follow.count());
if (await follow.count()) {
  await Promise.all([page.waitForURL(/\/documents\/\d+/), follow.click()]);
  const relId = docId(page.url());
  const relRow = page.locator('tr:has(th:text("بەدواداچوونی"))');
  note('follow-up letter', relId, 'related row', (await relRow.count()) ? (await relRow.innerText()).replace(/\s+/g, ' ') : 'MISSING');
  await shot(page, 's01-followup-letter');
  // does the original show anything about its follow-up?
  await page.goto(`/documents/${longId}`);
  note('original letter mentions follow-up?', await page.locator(`a[href="/documents/${relId}"]`).count());
}
problems(page, 'similar');

// 4. Double click on register: duplicates?
const dupSubject = `${MARK} دووجار کرتەکردن لەسەر تۆمارکردن`;
await page.goto('/registry/new');
await page.fill('#subject', dupSubject);
await page.fill('#sender_name', `نێردەری ${MARK} دووجار`);
await page.locator('form[data-similar-form] > .row button[type=submit]').dblclick();
await page.waitForURL(/\/documents\/\d+/, { timeout: 15000 }).catch(() => {});
await sleep(1500);
note('after dblclick url', page.url(), await noticeText(page));
await page.goto(`/documents?q=${encodeURIComponent(dupSubject)}`);
const dupRows = await page.locator('table tbody tr').allTextContents();
note('search rows for dblclick subject', dupRows.length, dupRows.map(s => s.replace(/\s+/g, ' ').slice(0, 60)));
await shot(page, 's01-dblclick-register');

// 5. Photo screen, with "other" as sender kind.
await page.goto('/registry/photo');
await page.setInputFiles('#photo', { name: `photo-${MARK}.png`, mimeType: 'image/png', buffer: inkPng(220) });
await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[action="/registry/photo"] button[type=submit]')]);
await page.waitForLoadState('domcontentloaded');
note('photo result url', page.url(), 'title', await page.title());
await shot(page, 's01-photo-suggestions', { fullPage: true });
const kinds = await page.locator('#sender_kind option').evaluateAll(os => os.map(o => `${o.value}=${o.textContent}`));
note('photo sender kinds', kinds);
if (await page.locator('#sender_kind').count()) {
  await page.fill('#subject', `${MARK} لە وێنەوە تۆمارکرا جۆری نێردەر تر`);
  await page.fill('#sender_name', `نێردەری وێنە ${MARK}`);
  await page.selectOption('#sender_kind', 'other');
  const resp = page.waitForResponse(r => r.url().endsWith('/registry/new') && r.request().method() === 'POST');
  await page.click('form[action="/registry/new"] button[type=submit]');
  const r = await resp;
  await page.waitForLoadState('domcontentloaded');
  note('photo register with sender kind other -> status', r.status(), 'url', page.url(), 'h1', await page.locator('h1').first().textContent());
  await shot(page, 's01-photo-other-kind');
  page.problems.length = 0;
}

// 5b. Photo screen, a normal kind: does the photo attach?
await page.goto('/registry/photo');
await page.setInputFiles('#photo', { name: `photo2-${MARK}.png`, mimeType: 'image/png', buffer: inkPng(240) });
await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[action="/registry/photo"] button[type=submit]')]);
await page.waitForLoadState('domcontentloaded');
await page.fill('#subject', `${MARK} لە وێنەوە تۆمارکرا هاووڵاتی`);
await page.fill('#sender_name', `نێردەری وێنە دوو ${MARK}`);
await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[action="/registry/new"] button[type=submit]')]);
await page.waitForLoadState('domcontentloaded');
if (!/\/documents\/\d+/.test(page.url()) && await page.locator('input[name=confirm_similar]').count()) {
  note('photo: similar panel shown; tray kept?', await page.locator('input[name=tray_id]').count());
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[data-similar-form] > .row button[type=submit]')]);
}
note('photo normal register ->', page.url(), await noticeText(page), 'attachments:', await page.locator('#attachments .attach-list li').count());
problems(page, 'photo');

// 6. Tray scan registration by address (the scanner flow's redirect).
await page.goto('/tray');
await page.setInputFiles('#file', { name: `tray-${MARK}.png`, mimeType: 'image/png', buffer: inkPng(210) });
await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[action="/tray/upload"] button[type=submit]')]);
await page.waitForLoadState('domcontentloaded');
note('tray upload', await noticeText(page));
const trayLink = page.locator('a[href^="/tray/"]', { hasText: 'بینین' }).first();
const trayHref = await trayLink.getAttribute('href');
await page.goto(trayHref);
note('tray item page: any "register new letter from this scan" link?', await page.locator('a[href*="/registry/new"]').count());
await shot(page, 's01-tray-item', { fullPage: true });
const trayId = Number(/\/tray\/(\d+)/.exec(trayHref)[1]);
await page.goto(`/registry/new?tray_id=${trayId}`);
note('registry/new with tray notice', (await page.locator('.notice.ok').allTextContents()).join('|').replace(/\s+/g, ' '));
await page.fill('#subject', `${MARK} لە سینیی سکانەوە تۆمارکرا`);
await page.fill('#sender_name', `نێردەری سینی ${MARK}`);
await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[data-similar-form] > .row button[type=submit]')]);
await page.waitForLoadState('domcontentloaded');
note('tray register ->', page.url(), 'attachments', await page.locator('#attachments .attach-list li').count());
problems(page, 'tray');

await b.close();
