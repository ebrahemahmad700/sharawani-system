// Journey 4: people, accounts and the building around the letters.
//
// IT adds a member of staff, who signs in with the temporary password and is made
// to choose their own; IT resets and closes the account; a room is added and
// closed; the mayor locks the system and opens it again; the sign-in screen's own
// messages; notifications arriving in another person's open page; the board, the
// log, the assistant, registration from a photo; and the most common jobs done on
// a phone.

import { test } from '@playwright/test';
import { as, shot, noticeText, pickByText, docIdFrom, inkPng, mark, ok, visible, noProblems, PASSWORD } from './lib.mjs';

test.describe.configure({ mode: 'serial' });

const M = mark();
const NEW_USER = `e2e.${M}`.slice(0, 32);
let tempPassword;

test('IT adds a member of staff; they sign in and must choose a password', async ({ browser }) => {
  const it = await as(browser, 'itadmin');
  await it.page.goto('/admin/users');
  await shot(it.page, 'j4-users');
  await it.page.fill('#full_name', `کارمەندی تاقیکردنەوە ${M}`);
  await it.page.fill('#username', NEW_USER);
  await it.page.selectOption('#role', 'room_clerk');
  await pickByText(it.page, '#room_id', 'یاسا');
  await it.page.click('form[action="/admin/users"] button[type=submit]');
  await it.page.waitForLoadState('load');
  await shot(it.page, 'j4-user-created');
  const n = await noticeText(it.page) ?? await it.page.locator('.content').innerText();
  tempPassword = /([A-Za-z0-9-]{8,})/.exec((await it.page.locator('.content .notice, .content .card').first().innerText()).replace(/\s+/g, ' '))?.[1];
  const url = new URL(it.page.url());
  tempPassword = url.searchParams.get('temp') ?? tempPassword;
  await ok(!!tempPassword, 'the temporary password is not shown after creating an account', { page: it.page, detail: n });
  await ok(!url.search.includes('temp='), 'the temporary password is put in the address bar (stays in browser history)', { page: it.page, severity: 'security', detail: url.pathname + url.search.replace(/temp=[^&]+/, 'temp=…') });

  // Wrong kinds of username.
  await it.page.fill('#full_name', 'x');
  await it.page.fill('#username', 'Bad Name!');
  await it.page.evaluate(() => document.querySelector('form[action="/admin/users"]').noValidate = true);
  await it.page.click('form[action="/admin/users"] button[type=submit]');
  await it.page.waitForLoadState('load');
  await ok(/دروست نییە/.test(await noticeText(it.page) ?? ''), 'a bad username is not refused clearly', { page: it.page });

  if (!tempPassword) { await it.context.close(); return; }
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('/login');
  await p.fill('#username', NEW_USER);
  await p.fill('#password', tempPassword);
  await p.click('button[type=submit]');
  await p.waitForLoadState('load');
  await shot(p, 'j4-forced-password');
  await ok(/\/password/.test(p.url()), 'a new account is not sent to choose a password', { page: p, detail: p.url() });
  const r = await p.goto('/inbox');
  await ok(/\/password/.test(p.url()), 'a new account can use the system before changing the temporary password', { page: p, severity: 'security', detail: [r.status(), p.url()] });

  await p.goto('/password');
  await p.fill('#current', tempPassword);
  await p.fill('#next', 'short');
  await p.fill('#confirm', 'short');
  await p.evaluate(() => document.querySelectorAll('form').forEach(f => f.noValidate = true));
  await p.click('.content form button[type=submit]');
  await p.waitForLoadState('load');
  await ok(!!(await p.locator('.notice.error').count()), 'a too-short new password is not refused', { page: p });

  const chosen = `تاقیکردنەوە-${M}-باش`;
  await p.fill('#current', tempPassword);
  await p.fill('#next', chosen);
  await p.fill('#confirm', chosen);
  await p.click('.content form button[type=submit]');
  await p.waitForLoadState('load');
  await shot(p, 'j4-password-changed');
  await ok(/\/inbox/.test(p.url()), 'after choosing a password the new person does not land on their inbox', { page: p, detail: p.url() });
  await ok(!!(await noticeText(p)), 'no word that the password was changed', { page: p, severity: 'minor' });

  // IT closes the account; the open page is signed out.
  await it.page.goto('/admin/users');
  const row = it.page.locator('tr', { hasText: NEW_USER });
  const close = row.locator('form[action$="/deactivate"] button');
  if (await ok(await close.count() > 0, 'no way to close an account on the staff list', { page: it.page })) {
    await close.click();
    await it.page.waitForLoadState('load');
    await shot(it.page, 'j4-user-closed');
    await p.goto('/inbox');
    await ok(/\/login/.test(p.url()), 'a closed account stays signed in', { page: p, severity: 'security', detail: p.url() });
    await p.goto('/login');
    await p.fill('#username', NEW_USER);
    await p.fill('#password', chosen);
    await p.click('button[type=submit]');
    await p.waitForLoadState('load');
    await ok(/\/login/.test(p.url()), 'a closed account can still sign in', { page: p, severity: 'security' });
  }
  await ctx.close();
  await noProblems(it.page, 'accounts');
  await it.context.close();
});

test('IT adds a room, sets its extension, and closes it again', async ({ browser }) => {
  const it = await as(browser, 'itadmin');
  const r = await it.page.goto('/admin/rooms');
  await shot(it.page, 'j4-rooms');
  await ok(await it.page.locator(`.sidebar a[href="/admin/rooms"]`).count() > 0, 'the rooms screen is not in IT\'s menu (reachable only by typing /admin/rooms)', { page: it.page, severity: 'missing' });
  if (r.status() !== 200) { await it.context.close(); return; }
  const name = `ژووری تاقیکردنەوە ${M}`;
  await it.page.fill('#name', name);
  await it.page.fill('#code', `E2E_${M}`.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 16));
  await it.page.click('form[action="/admin/rooms"] button[type=submit]');
  await it.page.waitForLoadState('load');
  await shot(it.page, 'j4-room-created');
  const row = it.page.locator('tr', { hasText: name });
  if (!await ok(await row.count() > 0, 'the new room is not listed', { page: it.page, detail: await noticeText(it.page) })) { await it.context.close(); return; }

  await row.locator('input[name=phone_extension]').fill('٢١٤');
  await row.locator('form:has(input[name=phone_extension]) button').first().click();
  await it.page.waitForLoadState('load');
  const n = await noticeText(it.page);
  await ok(!/هەڵە|تەنها ژمارە/.test(n ?? ''), 'a room extension typed in Kurdish digits (٢١٤) is refused', { page: it.page, detail: n });

  const close = it.page.locator('tr', { hasText: name }).locator('form[action$="/deactivate"] button');
  if (await close.count()) { await close.click(); await it.page.waitForLoadState('load'); }
  await noProblems(it.page, 'rooms');
  await it.context.close();
});

test('the mayor locks the system and opens it again', async ({ browser }) => {
  const mayor = await as(browser, 'aram');
  const desk = await as(browser, 'shilan');
  await mayor.page.goto('/dashboard');
  const lockForm = mayor.page.locator('form[action="/admin/lock"]');
  if (!await ok(await lockForm.count() > 0, 'no lock box on the mayor\'s dashboard', { page: mayor.page })) { await mayor.context.close(); await desk.context.close(); return; }
  try {
    await lockForm.locator('input[name=message]').fill(`چاککردنەوە ${M}`);
    await lockForm.locator('button').click();
    await mayor.page.waitForLoadState('load');
    await shot(mayor.page, 'j4-locked');

    await desk.page.goto('/registry');
    await shot(desk.page, 'j4-locked-desk');
    await ok(/\/login/.test(desk.page.url()), 'an open session keeps working while the system is locked', { page: desk.page, severity: 'security' });
    await desk.page.goto('/login');
    await desk.page.fill('#username', 'shilan');
    await desk.page.fill('#password', PASSWORD);
    await desk.page.click('button[type=submit]');
    await desk.page.waitForLoadState('load');
    await shot(desk.page, 'j4-locked-login');
    await ok((await desk.page.locator('body').innerText()).includes(`چاککردنەوە ${M}`), 'the lock message is not shown to someone trying to sign in', { page: desk.page });

    await mayor.page.goto('/dashboard');
    await ok(/\/dashboard/.test(mayor.page.url()), 'the mayor is signed out by his own lock', { page: mayor.page });
  } finally {
    const unlock = mayor.page.locator('form[action="/admin/unlock"] button');
    if (await unlock.count()) { await unlock.click(); await mayor.page.waitForLoadState('load'); }
    else {
      // Signed out by the lock: sign in again and open it.
      await mayor.page.goto('/login');
      await mayor.page.fill('#username', 'aram'); await mayor.page.fill('#password', PASSWORD);
      await mayor.page.click('button[type=submit]'); await mayor.page.waitForLoadState('load');
      await mayor.page.goto('/dashboard');
      await mayor.page.locator('form[action="/admin/unlock"] button').click().catch(() => {});
    }
  }
  const again = await browser.newContext();
  const p = await again.newPage();
  await p.goto('/login'); await p.fill('#username', 'shilan'); await p.fill('#password', PASSWORD);
  await p.click('button[type=submit]'); await p.waitForLoadState('load');
  await ok(!/\/login/.test(p.url()), 'after unlocking, people still cannot sign in', { page: p, severity: 'blocker' });
  await again.close();
  await noProblems(mayor.page, 'lock');
  await mayor.context.close(); await desk.context.close();
});

test('the sign-in screen: wrong password, signed-out pages, sign out, unknown page', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const r = await p.goto('/registry');
  await ok(/\/login/.test(p.url()), 'a signed-out visitor is not sent to the sign-in page', { page: p, detail: [r.status(), p.url()] });
  await shot(p, 'j4-login');
  await p.fill('#username', 'shilan');
  await p.fill('#password', 'wrong-password');
  await p.click('button[type=submit]');
  await p.waitForLoadState('load');
  await shot(p, 'j4-login-wrong');
  await ok(/هەڵەیە/.test(await p.locator('body').innerText()), 'a wrong password gives no clear message', { page: p });
  await ok(await p.locator('#username').inputValue() === 'shilan', 'the username is not kept after a wrong password', { page: p, severity: 'minor' });

  await p.fill('#password', PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForURL(u => !/\/login/.test(u.pathname));
  await p.goto('/this-page-does-not-exist');
  await shot(p, 'j4-404');
  await ok(await p.locator('.sidebar').count() > 0, 'the «not found» page for a signed-in person has no menu (dead end)', { page: p, severity: 'minor' });

  await p.goto('/registry');
  await p.locator('.whoami form[action="/logout"] button').click();
  await p.waitForLoadState('load');
  await ok(/\/login/.test(p.url()), 'signing out does not go to the sign-in page', { page: p });
  await p.goBack();
  await p.waitForLoadState('load');
  await shot(p, 'j4-back-after-logout');
  const back = await p.locator('body').innerText();
  await ok(!/کتابی|ژمارەی هاتوو/.test(back) || /\/login/.test(p.url()), 'the browser\'s back button shows the register after signing out', { page: p, severity: 'security' });
  await ctx.close();
});

test('a letter sent to legal rings in legal\'s open page', async ({ browser }) => {
  const legal = await as(browser, 'hemin');
  await legal.page.goto('/inbox');
  const before = Number(await legal.page.locator('[data-bell-count]').textContent().catch(() => '0')) || 0;

  const desk = await as(browser, 'shilan');
  await desk.page.goto('/registry/new');
  await desk.page.fill('#subject', `زەنگی تاقیکردنەوە ${M}`);
  await desk.page.fill('#sender_name', 'نێردەر');
  await desk.page.click('form[data-similar-form] button[type=submit]');
  if (await desk.page.locator('input[name="confirm_similar"]').count()) await desk.page.click('form[data-similar-form] .row button[type=submit]');
  await desk.page.waitForURL(/\/documents\/\d+/);
  await pickByText(desk.page, '#to_room', 'یاسا');
  await desk.page.click('form[action$="/route"]:has(input[value=single]) button[type=submit]');
  await desk.page.waitForLoadState('load');

  const toast = await visible(legal.page.locator('[data-toasts] *'), 15_000);
  await shot(legal.page, 'j4-toast');
  await ok(toast, 'no pop-up appears in legal\'s open page when a letter is sent to them', { page: legal.page });
  const bell = legal.page.locator('[data-bell-count]');
  const rang = await bell.isVisible().catch(() => false);
  await ok(rang, 'the bell count does not appear in legal\'s open page', { page: legal.page, detail: { before } });

  await legal.page.goto('/notifications');
  await shot(legal.page, 'j4-notifications');
  await ok((await legal.page.locator('.content').innerText()).length > 50, 'the notifications screen is empty', { page: legal.page });
  const read = legal.page.locator('form[action="/notifications/read"] button');
  if (await read.count()) {
    await read.click(); await legal.page.waitForLoadState('load');
    await ok(!(await legal.page.locator('[data-bell-count]').isVisible()), 'the bell still shows a count after marking everything read', { page: legal.page, severity: 'minor' });
  }
  await noProblems(legal.page, 'notifications'); await noProblems(desk.page, 'notifications');
  await legal.context.close(); await desk.context.close();
});

test('the board, the log, the assistant', async ({ browser }) => {
  const mayor = await as(browser, 'aram');
  const r = await mayor.page.goto('/board');
  await mayor.page.waitForTimeout(2500);
  await shot(mayor.page, 'j4-board');
  await ok(r.status() === 200, 'the board does not open', { page: mayor.page });

  await mayor.page.goto('/log?action=auth.login');
  await shot(mayor.page, 'j4-log');
  const logText = await mayor.page.locator('.content').innerText();
  await ok(!/\b[a-z]+\.[a-z_]+\b/.test(logText.replace(/auth\.login|step|auth\.login/g, '')), 'the activity log shows raw English action codes', { page: mayor.page, severity: 'design', detail: [...new Set(logText.match(/\b[a-z]+\.[a-z_]+\b/g) || [])].slice(0, 10) });

  await mayor.page.goto('/log');
  const logAll = await mayor.page.locator('.content').innerText();
  const codes = [...new Set(logAll.match(/\b[a-z]+\.[a-z_]+\b/g) || [])];
  await ok(codes.length === 0, 'the activity log shows raw English action codes', { page: mayor.page, severity: 'design', detail: codes.slice(0, 15) });

  const a = await mayor.page.goto('/assistant');
  await shot(mayor.page, 'j4-assistant');
  if (a.status() === 200) {
    await mayor.page.fill('form[action="/assistant/ask"] input[name=q]', 'ئەمڕۆ چەند کتاب هاتووە؟');
    await mayor.page.click('form[action="/assistant/ask"] button[type=submit]');
    await mayor.page.waitForLoadState('load', { timeout: 60_000 });
    await shot(mayor.page, 'j4-assistant-answer');
    const text = await mayor.page.locator('body').innerText();
    await ok(!/داواکارییەکەت تەواو نەبوو/.test(text), 'asking the assistant gives the error page', { page: mayor.page });
  }
  await noProblems(mayor.page, 'board, log, assistant');
  await mayor.context.close();
});

test('registering from a photo of the letter', async ({ browser }) => {
  const desk = await as(browser, 'shilan');
  await desk.page.goto('/registry/photo');
  await desk.page.setInputFiles('#photo', { name: `photo-${M}.png`, mimeType: 'image/png', buffer: inkPng(400) });
  await desk.page.click('form[action="/registry/photo"] button[type=submit]');
  await desk.page.waitForLoadState('load', { timeout: 60_000 });
  await shot(desk.page, 'j4-photo-read');
  const text = await desk.page.locator('body').innerText();
  await ok(!/داواکارییەکەت تەواو نەبوو/.test(text), 'reading a photo gives the error page', { page: desk.page });
  const form = desk.page.locator('form[action="/registry/new"]');
  if (await ok(await form.count() > 0, 'no registration form after reading the photo', { page: desk.page })) {
    await desk.page.fill('#subject', `کتابی وێنە ${M}`);
    await desk.page.fill('#sender_name', 'نێردەری وێنە');
    await form.locator('button[type=submit]').click();
    await desk.page.waitForLoadState('load');
    if (await desk.page.locator('input[name="confirm_similar"]').count()) await desk.page.click('form[data-similar-form] .row button[type=submit]');
    await desk.page.waitForLoadState('load');
    await shot(desk.page, 'j4-photo-registered');
    await ok(/\/documents\/\d+/.test(desk.page.url()), 'registering from the photo form did not create the letter', { page: desk.page, detail: await noticeText(desk.page) });
    if (/\/documents\/\d+/.test(desk.page.url())) {
      await ok(await desk.page.locator('.attach-list li').count() === 1, 'the photo is not attached to the letter registered from it', { page: desk.page });
    }
  }
  await noProblems(desk.page, 'photo');
  await desk.context.close();
});

test('on a phone: open the menu, register a letter, open it, send it', async ({ browser }) => {
  const { context, page } = await as(browser, 'shilan', { viewport: { width: 390, height: 844 } });
  await page.locator('label.nav-toggle').click();
  await page.waitForTimeout(400);
  await shot(page, 'j4-phone-menu');
  const link = page.locator('.sidebar a[href="/registry"]');
  await ok(await link.isVisible(), 'the phone menu does not open', { page });
  await link.click();
  await page.waitForLoadState('load');
  await ok(!(await page.locator('#nav-toggle').isChecked()), 'the phone menu stays open over the page after choosing an item', { page, severity: 'minor' });
  await page.goto('/registry/new');
  await shot(page, 'j4-phone-register-form');
  await page.fill('#subject', `کتابی مۆبایل ${M}`);
  await page.fill('#sender_name', 'نێردەری مۆبایل');
  await page.click('form[data-similar-form] button[type=submit]');
  if (await page.locator('input[name="confirm_similar"]').count()) await page.click('form[data-similar-form] .row button[type=submit]');
  await page.waitForURL(/\/documents\/\d+/);
  await shot(page, 'j4-phone-letter');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await ok(!wide, 'the letter page scrolls sideways on a phone', { page });
  await pickByText(page, '#to_room', 'یاسا');
  await page.locator('form[action$="/route"]:has(input[value=single]) button[type=submit]').scrollIntoViewIfNeeded();
  await page.click('form[action$="/route"]:has(input[value=single]) button[type=submit]');
  await page.waitForLoadState('load');
  await ok(/نێردرا/.test(await noticeText(page) ?? ''), 'sending from a phone did not work', { page });
  await noProblems(page, 'phone');
  await context.close();
});
