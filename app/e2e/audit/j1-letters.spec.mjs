// Journey 1: a letter's whole life, through the real screens, by the people who
// would really do each step.
//
// shilan registers it at the front desk with a plot number and a PDF, and sends
// it to the mayor. aram opens it, signs for the paper and sends it to legal
// asking for it back. hemin in legal sees the front desk's PDF and gives an
// opinion. aram writes the reply, saves the draft and closes the letter with an
// outgoing number. Then everybody who should be able to find it looks for it,
// and two people who should not, try.
//
// Anything wrong along the way is written to findings.jsonl by ok() and the
// journey carries on. A hard expect is used only where the next step is
// impossible without it.

import { test, expect } from '@playwright/test';
import { as, shot, noticeText, pickByText, docIdFrom, inkPdf, mark, ok, visible, noProblems } from './lib.mjs';

test.describe.configure({ mode: 'serial' });

const M = mark();
const SUBJECT = `داواکاری مۆڵەتی بیناسازی تاقیکردنەوە ${M}`;
const SENDER = `هاووڵاتی تاقیکردنەوە ${M}`;
const PLOT = `240/${Math.floor(Math.random() * 900) + 100}`;
let docId, incomingNo, barcode;

test('front desk registers a letter with a plot number', async ({ browser }) => {
  const { context, page } = await as(browser, 'shilan');
  await page.goto('/registry/new');
  await page.fill('#subject', SUBJECT);
  await page.selectOption('#sender_kind', 'citizen');
  await page.fill('#sender_name', SENDER);
  await page.fill('#sender_contact', '0750 123 4567');
  // Typed with a mixture of digits on purpose: the old bug was 2٤0/4.
  await page.fill('#plot_no', PLOT.replace('4', '٤'));
  await page.fill('#neighbourhood', 'گەڕەکی تاقیکردنەوە');
  await page.fill('#physical_shelf', '٣');
  await page.click('form[data-similar-form] button[type=submit]');
  if (await page.locator('input[name="confirm_similar"]').count()) {
    await shot(page, 'j1-similar-panel');
    await page.click('form[data-similar-form] .row button[type=submit]');
  }
  await page.waitForURL(/\/documents\/\d+/);
  docId = docIdFrom(page.url());
  await shot(page, 'j1-registered');

  await ok(/کتاب تۆمارکرا/.test(await noticeText(page) ?? ''), 'no success notice after registering', { page });
  incomingNo = (await page.locator('th:has-text("ژمارەی هاتوو") + td').textContent()).trim();
  barcode = (await page.locator('th:has-text("بارکۆد") + td').textContent()).trim();
  expect(incomingNo).toMatch(/\//);
  const plotShown = (await page.locator('th:has-text("پارچە") + td a').first().textContent()).trim();
  await ok(plotShown === PLOT, 'plot number not shown in one kind of digit', { page, detail: { typed: PLOT.replace('4', '٤'), shown: plotShown } });

  await page.goto('/registry');
  await ok(await visible(page.getByText(SUBJECT)), 'new letter not on the register', { page });
  await noProblems(page, 'registering');
  await context.close();
});

test('front desk attaches a PDF, writes a note and sends it to the mayor', async ({ browser }) => {
  const { context, page } = await as(browser, 'shilan');
  await page.goto(`/documents/${docId}`);

  await page.setInputFiles('.attach-upload input[type=file]', { name: `نامە-${M}.pdf`, mimeType: 'application/pdf', buffer: inkPdf() });
  await page.click('.attach-upload button[type=submit]');
  await page.waitForLoadState('load');
  await ok(/هاوپێچ زیادکرا/.test(await noticeText(page) ?? ''), 'no notice after attaching', { page });
  await ok(await page.locator('.attach-list li').count() === 1, 'attachment not listed', { page });

  await page.fill('#note_body', `تێبینی مێزی پێشەوە ${M}`);
  await page.click('form[action$="/notes"] button[type=submit]');
  await page.waitForLoadState('load');
  const afterNote = await noticeText(page);
  await ok(!/کتاب نێردرا/.test(afterNote ?? ''), 'adding a note says «کتاب نێردرا» (letter sent)', { page, detail: afterNote });
  await ok(await visible(page.getByText(`تێبینی مێزی پێشەوە ${M}`)), 'note not shown after adding it', { page });

  await pickByText(page, '#to_room', 'سەرۆکی شارەوانی');
  await page.fill('#note', 'بۆ بڕیاری بەڕێزتان');
  await page.click('form[action$="/route"]:has(input[value=single]) button[type=submit]');
  await page.waitForLoadState('load');
  await ok(/نێردرا/.test(await noticeText(page) ?? ''), 'no notice after sending', { page });
  await ok((await page.locator('ol.trail').textContent()).includes('سەرۆکی شارەوانی'), 'trail does not show the mayor\'s room', { page });
  await shot(page, 'j1-sent-to-mayor');
  await ok(await page.locator('form[action$="/recall"]').count() === 1, 'recall not offered before the letter is opened', { page, severity: 'minor' });
  await noProblems(page, 'attaching, note, sending');
  await context.close();
});

test('the mayor sees it arrive, signs for the paper and sends it to legal', async ({ browser }) => {
  const { context, page } = await as(browser, 'aram');
  await page.goto('/inbox');
  await ok(await visible(page.getByText(SUBJECT)), 'letter not in the mayor\'s inbox', { page });
  await page.goto(`/documents/${docId}`);
  await shot(page, 'j1-mayor-opens');

  await ok(await visible(page.getByText('ئەم کتابە لای ژووری تۆیە')), 'the «this letter is with your room» card is missing for the mayor', { page });
  const paper = page.locator('form[action$="/paper-received"] button');
  if (await ok(await paper.count() > 0, 'no paper-received button for the room holding the letter', { page })) {
    await paper.click();
    await page.waitForLoadState('load');
    const n = await noticeText(page);
    await ok(!/کتاب نێردرا/.test(n ?? ''), 'signing for the paper says «کتاب نێردرا» (letter sent)', { page, detail: n });
    await ok(await visible(page.locator('.pill.ok:has-text("وەرگیراوە")')), 'paper not shown as received', { page });
  }

  await ok(await page.locator('.attach-list li').count() === 1, 'the mayor does not see the front desk\'s attachment', { page });
  await ok((await page.locator('.attach-meta').first().textContent()).includes('هات و دەرچوو'), 'attachment does not say which room attached it', { page, severity: 'minor' });

  await pickByText(page, '#to_room', 'یاسا');
  await page.fill('#note', 'ڕای یاسایی');
  await page.check('form[action$="/route"]:has(input[value=single]) input[name=return_to_assigner]');
  await page.click('form[action$="/route"]:has(input[value=single]) button[type=submit]');
  await page.waitForLoadState('load');
  await ok(/نێردرا/.test(await noticeText(page) ?? ''), 'no notice after the mayor sends it on', { page });
  await shot(page, 'j1-mayor-sent-to-legal');

  await page.goto('/my-day');
  await shot(page, 'j1-mayor-my-day');
  await ok(await visible(page.getByText(incomingNo)), 'my day does not list the letter waiting on legal', { page });
  const chase = page.locator(`tr:has-text("${incomingNo}") form[action$="/chase"] button`);
  if (await ok(await chase.count() > 0, 'no chase button on my day for a letter I sent on', { page })) {
    await chase.click();
    await page.waitForLoadState('load');
    await shot(page, 'j1-chased');
    await ok(!!(await noticeText(page)), 'no notice after chasing', { page, severity: 'minor' });
  }
  await noProblems(page, 'mayor handling');
  await context.close();
});

test('legal sees the letter, the PDF from the front desk, and gives an opinion', async ({ browser }) => {
  const { context, page } = await as(browser, 'hemin');
  await page.goto('/inbox');
  if (!await visible(page.getByText(SUBJECT))) {
    // A room with more than a hundred open letters shows its oldest hundred.
    await page.goto('/inbox?all=1');
    const behindShowAll = await visible(page.getByText(SUBJECT));
    await ok(false, behindShowAll
      ? 'a new letter is not on legal\'s inbox until «show all» is pressed (the room has over 100 open letters)'
      : 'letter not in legal\'s inbox, even with «show all»', { page, severity: behindShowAll ? 'design' : 'bug' });
  }
  await page.goto(`/documents/${docId}`);

  await ok(await page.locator('.attach-list li').count() === 1, 'legal does not see the front desk\'s attachment', { page });
  await page.click('.attach-list a.btn:has-text("بینین")');
  await page.waitForURL(/\/attachments\/\d+\/view/);
  await ok(await visible(page.locator('canvas'), 20_000), 'the PDF is not drawn in the viewer', { page });
  await shot(page, 'j1-legal-views-pdf');
  await page.goBack();
  await page.waitForLoadState('load');

  await ok(await page.locator('.card:has(h2:has-text("تێبینییەکان")) li').count() > 0, 'the mayor\'s chase is not visible to legal as a note', { page });

  await page.selectOption('#action', 'opinion');
  await page.fill('#reply_note', `ڕای یاسایی: ڕێگری نییە ${M}`);
  await page.click('form[action$="/complete"] button[type=submit]');
  await page.waitForLoadState('load');
  const n = await noticeText(page);
  await ok(!/^کتاب نێردرا\.?$/.test(n ?? ''), 'completing a step says «کتاب نێردرا» (letter sent)', { page, detail: n });
  await shot(page, 'j1-legal-completed');
  await ok((await page.locator('ol.trail').textContent()).includes('ڕێگری نییە'), 'the opinion is not on the trail', { page });
  await noProblems(page, 'legal opinion');
  await context.close();
});

test('back with the mayor: the reply is written, saved and the letter closed', async ({ browser }) => {
  const { context, page } = await as(browser, 'aram');
  await page.goto('/inbox');
  await ok(await visible(page.getByText(SUBJECT)), 'letter did not come back to the mayor\'s inbox', { page });
  await page.goto(`/documents/${docId}`);
  await page.click('.topbar a.btn:has-text("نووسینی وەڵام")');
  await page.waitForURL(/\/reply$/);
  await shot(page, 'j1-reply-page');
  await ok((await page.locator('.content').textContent()).includes('ڕێگری نییە'), 'legal\'s opinion not offered on the reply page', { page });

  await page.fill('#body', `بەڕێز ${SENDER}\nداواکارییەکەت پەسەند کرا. ${M}`);
  await page.click('form[action$="/reply"] button[type=submit]');
  await page.waitForLoadState('load');
  await ok(/پاشەکەوت/.test(await noticeText(page) ?? ''), 'no notice after saving the draft', { page });
  await ok((await page.locator('#body').inputValue()).includes(M), 'saved draft not kept', { page });

  const [print] = await Promise.all([
    context.waitForEvent('page'),
    page.click('.topbar a:has-text("چاپی وەڵام")'),
  ]);
  await print.waitForLoadState('load');
  await ok((await print.locator('body').innerText()).includes(M), 'reply print does not show the draft', { page: print });
  await shot(print, 'j1-reply-print');
  await print.close();

  await page.click('form[action$="/reply/send"] button[type=submit]');
  await page.waitForLoadState('load');
  await shot(page, 'j1-closed');
  await ok(/ژمارەی دەرچوو/.test(await page.locator('.content').textContent()), 'no outgoing number after closing', { page });
  await noProblems(page, 'reply and close');
  await context.close();
});

test('everyone who should can find the closed letter, and nobody else can', async ({ browser }) => {
  const { context, page } = await as(browser, 'shilan');

  await page.goto(`/documents/${docId}`);
  await ok(await visible(page.locator('.pill', { hasText: 'داخراو' })), 'status pill does not say closed', { page });

  await page.goto('/outgoing');
  await ok(await visible(page.getByText(SUBJECT)), 'closed letter not in the outgoing list', { page });

  await page.goto(`/documents?q=${encodeURIComponent(M)}`);
  await ok(await visible(page.getByText(SUBJECT)), 'search by a word in the subject does not find it', { page });

  await page.goto(`/documents?q=${encodeURIComponent(incomingNo)}`);
  await ok(await visible(page.getByText(SUBJECT)), 'search by incoming number does not find it', { page, detail: incomingNo });

  await page.goto(`/registry?q=${encodeURIComponent(incomingNo)}`);
  await ok(await visible(page.getByText(SUBJECT)), 'register search by incoming number does not find it', { page, detail: incomingNo });

  await page.fill('.topbar-search input', barcode);
  await page.press('.topbar-search input', 'Enter');
  await page.waitForLoadState('load');
  await shot(page, 'j1-topbar-barcode');
  await ok(await visible(page.getByText(SUBJECT)), 'top bar search with the barcode does not find it', { page, detail: barcode });

  await page.fill('.topbar-search input', PLOT);
  await page.press('.topbar-search input', 'Enter');
  await page.waitForLoadState('load');
  await shot(page, 'j1-topbar-plot');
  await ok(await visible(page.getByText(SUBJECT)), 'top bar search with the plot number does not find it', { page, detail: PLOT });

  await page.goto(`/plots?p=${encodeURIComponent(PLOT)}`);
  await shot(page, 'j1-plot-file');
  await ok(await visible(page.getByText(SUBJECT)), 'plot file does not list it', { page });

  await page.goto(`/barcode?q=${encodeURIComponent(barcode)}`);
  await shot(page, 'j1-barcode-screen');
  await ok(await visible(page.getByText(SUBJECT)), 'barcode screen does not find it', { page });

  for (const path of [`/documents/${docId}/print`, `/documents/${docId}/receipt`, `/documents/${docId}/reply/print`]) {
    const r = await page.goto(path);
    await ok(r.status() === 200, `${path} did not open`, { page, detail: r.status() });
    await shot(page, `j1-print-${path.split('/').pop()}`);
  }

  // The citizen's tracking page, with the PIN from the receipt.
  await page.goto(`/documents/${docId}/receipt`);
  const receiptText = await page.locator('body').innerText();
  const pin = /([0-9٠-٩]{4,8})\s*$/m.exec(receiptText.split(/PIN|پین|کۆد/).slice(1).join(' ') || '')?.[1];
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto('/track');
  await shot(pub, 'j1-track-form');
  await pub.fill('#barcode', barcode);
  if (pin) await pub.fill('#pin', pin);
  await pub.click('form[action="/track"] button[type=submit]');
  await pub.waitForLoadState('load');
  await shot(pub, 'j1-track-result');
  await ok(!(await pub.locator('body').innerText()).includes(SUBJECT), 'public tracking page shows the subject', { page: pub, severity: 'security' });
  await anon.close();

  const it = await as(browser, 'itadmin');
  const r = await it.page.goto(`/documents/${docId}`);
  await ok(r.status() !== 200 && !(await it.page.locator('body').innerText()).includes(SUBJECT), 'IT can open the letter', { page: it.page, severity: 'security' });
  await it.context.close();

  const other = await as(browser, 'sozan');
  await other.page.goto(`/documents/${docId}`);
  await ok(!(await other.page.locator('body').innerText()).includes(SUBJECT), 'a room the letter never went to can read it', { page: other.page, severity: 'security' });
  await other.context.close();

  await noProblems(page, 'finding the letter');
  await context.close();
});
