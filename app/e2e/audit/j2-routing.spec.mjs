// Journey 2: the other ways a letter moves.
//
// Recall before it is opened; a room sending it back as not theirs; a sequence of
// rooms in turn; a room clerk starting a letter of their own and sending it; a
// delivery list for the paper folders; the scan tray; the simulated scanner.

import { test } from '@playwright/test';
import { as, shot, noticeText, pickByText, docIdFrom, inkPdf, inkPng, mark, ok, visible, noProblems } from './lib.mjs';

test.describe.configure({ mode: 'serial' });

const M = mark();

async function register(page, subject) {
  await page.goto('/registry/new');
  await page.fill('#subject', subject);
  await page.fill('#sender_name', `نێردەر ${M}`);
  await page.click('form[data-similar-form] button[type=submit]');
  if (await page.locator('input[name="confirm_similar"]').count()) {
    await page.click('form[data-similar-form] .row button[type=submit]');
  }
  await page.waitForURL(/\/documents\/\d+/);
  return docIdFrom(page.url());
}

async function sendTo(page, roomText, { back = false } = {}) {
  await pickByText(page, '#to_room', roomText);
  if (back) await page.check('form[action$="/route"]:has(input[value=single]) input[name=return_to_assigner]');
  await page.click('form[action$="/route"]:has(input[value=single]) button[type=submit]');
  await page.waitForLoadState('load');
}

test('recall before it is opened, then a room sends it back as not theirs', async ({ browser }) => {
  const desk = await as(browser, 'shilan');
  const id = await register(desk.page, `کتابی گەڕاندنەوە ${M}`);
  await sendTo(desk.page, 'یاسا');
  const recall = desk.page.locator('form[action$="/recall"] button');
  if (await ok(await recall.count() > 0, 'no recall button straight after sending', { page: desk.page })) {
    await recall.click();
    await desk.page.waitForLoadState('load');
    await shot(desk.page, 'j2-recalled');
    const n = await noticeText(desk.page);
    await ok(!/کتاب نێردرا/.test(n ?? ''), 'recalling a letter says «کتاب نێردرا» (letter sent)', { page: desk.page, detail: n });
    await ok(await desk.page.locator('#to_room').count() > 0, 'after recall the letter cannot be sent again', { page: desk.page });
  }

  await sendTo(desk.page, 'گرێبەستە');
  const dler = await as(browser, 'dler');
  await dler.page.goto(`/documents/${id}`);
  const summary = dler.page.locator('summary:has-text("ئەمە بۆ ژووری ئێمە نییە")');
  if (await ok(await summary.count() > 0, 'the «not for our room» option is missing', { page: dler.page })) {
    await summary.click();
    await dler.page.fill('#reason', 'ئەمە کاری ژووری زەوییە');
    await dler.page.click('form[action$="/return"] button[type=submit]');
    await dler.page.waitForLoadState('load');
    await shot(dler.page, 'j2-returned');
    const n = await noticeText(dler.page);
    await ok(!/^کتاب نێردرا\.?$/.test(n ?? ''), 'returning a letter says «کتاب نێردرا» (letter sent)', { page: dler.page, detail: n });
  }
  await desk.page.goto('/registry');
  await desk.page.goto(`/documents/${id}`);
  await shot(desk.page, 'j2-desk-after-return');
  await ok((await desk.page.locator('ol.trail').textContent()).includes('زەوی'), 'the reason for returning is not shown on the trail', { page: desk.page });

  // A letter cannot be cancelled from any screen (there is a route, no button).
  await ok(await desk.page.locator('form[action$="/cancel"]').count() > 0, 'there is no way to cancel a registered letter from the screens', { page: desk.page, severity: 'missing' });

  await noProblems(desk.page, 'recall'); await noProblems(dler.page, 'return');
  await desk.context.close(); await dler.context.close();
});

test('a sequence of rooms, each in turn', async ({ browser }) => {
  const mayor = await as(browser, 'aram');
  const id = await register(mayor.page, `کتابی ڕیزبەندی ${M}`);
  const seq = mayor.page.locator('form[action$="/route"]:has(input[value=sequence])');
  const selects = seq.locator('select[name=seq_room]');
  for (const [i, room] of [[0, 'یاسا'], [1, 'ژمێریاری']]) {
    const v = await selects.nth(i).locator('option').evaluateAll((os, t) => os.find(o => o.textContent.includes(t))?.value, room);
    await selects.nth(i).selectOption(v);
  }
  await seq.locator('button[type=submit]').click();
  await mayor.page.waitForLoadState('load');
  await shot(mayor.page, 'j2-sequence-sent');
  await ok(/نێردرا/.test(await noticeText(mayor.page) ?? ''), 'no notice after sending in sequence', { page: mayor.page });

  const accounts = await as(browser, 'sozan');
  await accounts.page.goto(`/documents/${id}`);
  await ok(!(await accounts.page.locator('body').innerText()).includes('ئەم کتابە لای ژووری تۆیە'), 'the second room can act before the first has finished', { page: accounts.page });

  const legal = await as(browser, 'hemin');
  await legal.page.goto(`/documents/${id}`);
  await legal.page.selectOption('#action', 'opinion');
  await legal.page.fill('#reply_note', 'یەکەم');
  await legal.page.click('form[action$="/complete"] button[type=submit]');
  await legal.page.waitForLoadState('load');

  await accounts.page.goto('/inbox');
  await accounts.page.goto(`/documents/${id}`);
  await shot(accounts.page, 'j2-sequence-second-room');
  await ok(await visible(accounts.page.getByText('ئەم کتابە لای ژووری تۆیە')), 'after the first room finishes, the second room does not get it', { page: accounts.page });

  for (const p of [mayor, accounts, legal]) { await noProblems(p.page, 'sequence'); await p.context.close(); }
});

test('a legal clerk starts a letter of their own and sends it (last report, item 8)', async ({ browser }) => {
  const clerk = await as(browser, 'sakar');
  await clerk.page.goto('/inbox');
  const newBtn = clerk.page.locator('.topbar a.btn:has-text("کتابی نوێ")');
  await ok(await newBtn.count() > 0, 'no «new letter» button on a room\'s inbox', { page: clerk.page });
  await clerk.page.goto('/registry/new');
  await shot(clerk.page, 'j2-room-new-letter-form');
  await clerk.page.fill('#subject', `یادداشتی ناوخۆیی یاسا ${M}`);
  await clerk.page.click('form[data-similar-form] button[type=submit]');
  if (await clerk.page.locator('input[name="confirm_similar"]').count()) await clerk.page.click('form[data-similar-form] .row button[type=submit]');
  const reached = await clerk.page.waitForURL(/\/documents\/\d+/, { timeout: 10_000 }).then(() => true, () => false);
  if (!await ok(reached, 'a legal clerk cannot register a letter', { page: clerk.page, detail: await noticeText(clerk.page) })) { await clerk.context.close(); return; }
  const id = docIdFrom(clerk.page.url());

  await clerk.page.goto('/inbox');
  await ok(await visible(clerk.page.getByText(`یادداشتی ناوخۆیی یاسا ${M}`)), 'the unsent letter is not listed on the room\'s inbox', { page: clerk.page });
  await clerk.page.goto(`/documents/${id}`);
  if (await ok(await clerk.page.locator('#to_room').count() > 0, 'a clerk cannot send the letter their room started', { page: clerk.page })) {
    await sendTo(clerk.page, 'سەرۆکی شارەوانی');
    await ok(/نێردرا/.test(await noticeText(clerk.page) ?? ''), 'no notice after the clerk sends it', { page: clerk.page });
  }
  await noProblems(clerk.page, 'room letter');
  await clerk.context.close();
});

test('a delivery list for the paper folders, signed for at the other end', async ({ browser }) => {
  const desk = await as(browser, 'shilan');
  const subjects = [`پەڕگەی گەیاندن ١ ${M}`, `پەڕگەی گەیاندن ٢ ${M}`];
  for (const s of subjects) { await register(desk.page, s); await sendTo(desk.page, 'ژمێریاری'); }
  await desk.page.goto('/manifests');
  await shot(desk.page, 'j2-manifests');
  const form = desk.page.locator('form[action="/manifests/new"]:has(input[name=courier])').filter({ hasText: subjects[0] });
  if (!await ok(await form.count() > 0, 'the folders just sent are not offered for a delivery list', { page: desk.page })) { await desk.context.close(); return; }
  await form.locator('input[name=courier]').fill('کاوە (گەیەنەر)');
  await form.locator('button[type=submit]').click();
  await desk.page.waitForLoadState('load');
  await shot(desk.page, 'j2-manifest-created');
  const manifestUrl = desk.page.url();
  await ok(/\/manifests\/\d+/.test(manifestUrl), 'creating a delivery list does not open it', { page: desk.page, detail: manifestUrl });

  const print = await desk.page.goto(manifestUrl.replace(/(\/manifests\/\d+).*/, '$1/print'));
  await ok(print.status() === 200, 'the delivery list does not print', { page: desk.page });
  await shot(desk.page, 'j2-manifest-print');

  const acc = await as(browser, 'sozan');
  await acc.page.goto('/manifests');
  await shot(acc.page, 'j2-manifests-receiving');
  const receive = acc.page.locator('form[action$="/receive"] button').first();
  if (await ok(await receive.count() > 0, 'the receiving room is not offered the delivery list to sign for', { page: acc.page })) {
    await receive.click();
    await acc.page.waitForLoadState('load');
    await shot(acc.page, 'j2-manifest-received');
    await ok(!!(await noticeText(acc.page)), 'no notice after signing for a delivery list', { page: acc.page, severity: 'minor' });
  }
  await noProblems(desk.page, 'manifest'); await noProblems(acc.page, 'manifest receive');
  await desk.context.close(); await acc.context.close();
});

test('the scan tray: upload two pages, merge, look, attach to a letter, archive another', async ({ browser }) => {
  const clerk = await as(browser, 'ahang');
  const id = await register(clerk.page, `کتابی سینی ${M}`).catch(() => null);
  if (!await ok(!!id, 'a registry room clerk cannot register a letter', { page: clerk.page })) {}
  await clerk.page.goto('/tray');
  await clerk.page.setInputFiles('#file', [
    { name: `page-1-${M}.png`, mimeType: 'image/png', buffer: inkPng() },
    { name: `page-2-${M}.png`, mimeType: 'image/png', buffer: inkPng(160) },
  ]);
  await shot(clerk.page, 'j2-tray-files-picked');
  await clerk.page.click('form[action="/tray/upload"] button[type=submit]');
  await clerk.page.waitForLoadState('load');
  await shot(clerk.page, 'j2-tray-uploaded');
  const n = await noticeText(clerk.page);
  await ok(!!n && !/هەڵە/.test(n), 'no success notice after uploading to the tray', { page: clerk.page, detail: n });
  const open = clerk.page.locator('table a[href^="/tray/"]').first();
  if (!await ok(await open.count() > 0, 'uploaded scan not listed in the tray', { page: clerk.page })) { await clerk.context.close(); return; }
  await open.click();
  await clerk.page.waitForURL(/\/tray\/\d+/);
  await ok(await visible(clerk.page.locator('canvas, .img-view img, .pdf-view canvas'), 20_000), 'the scan is not drawn on the tray page', { page: clerk.page });
  await shot(clerk.page, 'j2-tray-item');

  await clerk.page.click('form[action$="/detect"] button');
  await clerk.page.waitForLoadState('load');
  await shot(clerk.page, 'j2-tray-detect');

  if (id) {
    const opt = await clerk.page.locator('#document_id option').evaluateAll((os, sid) => os.find(o => o.value === String(sid))?.value, id);
    if (await ok(!!opt, 'the letter just registered is not offered in the tray\'s letter list', { page: clerk.page })) {
      await clerk.page.selectOption('#document_id', opt);
      await clerk.page.click('form[action$="/claim"]:has(#document_id) button[type=submit]');
      await clerk.page.waitForLoadState('load');
      await shot(clerk.page, 'j2-tray-claimed');
      await clerk.page.goto(`/documents/${id}`);
      await ok(await clerk.page.locator('.attach-list li').count() === 1, 'the claimed scan is not attached to the letter', { page: clerk.page });
    }
  }

  // Another one, sent to the archive.
  await clerk.page.goto('/tray');
  await clerk.page.setInputFiles('#file', { name: `stray-${M}.pdf`, mimeType: 'application/pdf', buffer: inkPdf() });
  await clerk.page.click('form[action="/tray/upload"] button[type=submit]');
  await clerk.page.waitForLoadState('load');
  const row = clerk.page.locator(`tr:has-text("stray-${M}") a[href^="/tray/"]`).first();
  if (await ok(await row.count() > 0, 'second upload not listed', { page: clerk.page })) {
    await row.click();
    await clerk.page.click('form[action$="/archive"] button');
    await clerk.page.waitForLoadState('load');
    await shot(clerk.page, 'j2-tray-archived');
    await ok(!(await clerk.page.locator('body').innerText()).includes(`stray-${M}`) || /\/tray$/.test(new URL(clerk.page.url()).pathname) === false, 'archived scan still in the tray', { page: clerk.page, severity: 'minor' });
  }

  // Another room's tray does not show these (last report, item 9).
  const legal = await as(browser, 'sakar');
  await legal.page.goto('/tray');
  await ok(!(await legal.page.locator('body').innerText()).includes(M), 'another room\'s tray shows this room\'s scans', { page: legal.page, severity: 'security' });
  await noProblems(clerk.page, 'tray'); await noProblems(legal.page, 'tray other room');
  await clerk.context.close(); await legal.context.close();
});

test('scanning from the simulated scanner into the tray', async ({ browser }) => {
  const mayor = await as(browser, 'aram');
  await mayor.page.goto('/admin/scanners');
  await shot(mayor.page, 'j2-scanners-admin');
  if (!(await mayor.page.locator('body').innerText()).includes('SIMULATOR')) {
    const add = mayor.page.locator('form[action="/admin/scanners"]:has(input[value=SIMULATOR]) button');
    if (await ok(await add.count() > 0, 'no way to add the test scanner (SCANNER_SIMULATOR off?)', { page: mayor.page, severity: 'info' })) {
      await add.click(); await mayor.page.waitForLoadState('load');
    }
  }
  const test_ = mayor.page.locator('form[action$="/test"] button').first();
  if (await test_.count()) {
    await test_.click(); await mayor.page.waitForLoadState('load');
    await shot(mayor.page, 'j2-scanner-tested');
    const n = await noticeText(mayor.page);
    await ok(!!n && !/هەڵە|سەرکەوتوو نەبوو/.test(n), 'testing the scanner did not report success', { page: mayor.page, detail: n });
  }
  await mayor.page.goto('/scan?to=tray');
  await shot(mayor.page, 'j2-scan-form');
  const radio = mayor.page.locator('input[name=scanner_id]').first();
  if (await ok(await radio.count() > 0, 'no scanner offered on the scan screen', { page: mayor.page })) {
    await radio.check();
    await mayor.page.click('form[action="/scan"] button[type=submit]');
    await mayor.page.waitForURL(/\/tray\//, { timeout: 30_000 }).catch(() => {});
    await shot(mayor.page, 'j2-scan-result');
    await ok(/\/tray\/\d+/.test(mayor.page.url()), 'scanning did not produce a tray item', { page: mayor.page, detail: mayor.page.url() });
  }
  await noProblems(mayor.page, 'scanner');
  await mayor.context.close();
});
