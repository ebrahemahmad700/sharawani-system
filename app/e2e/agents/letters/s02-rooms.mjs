// Registering from a room: sakar (legal clerk), karwan (archive), bafrin (hr), dana (directorate head).
import { browser, as, note, MARK, shot, problems, noticeText, docId, ROOM, sendTo, press } from './lib.mjs';

const b = await browser();
const made = {};
for (const who of ['sakar', 'karwan', 'bafrin', 'dana']) {
  const { page, context } = await as(b, who);
  note(`--- ${who} landed`, page.url());
  const menu = await page.locator('.sidebar .nav a span:first-of-type').allTextContents();
  note(who, 'menu', menu.join(' | '));
  await page.goto('/registry/new');
  note(who, 'form title', await page.locator('header h1').textContent(),
    'sender kind', await page.inputValue('#sender_kind'), 'sender name', await page.inputValue('#sender_name'),
    'intro', (await page.locator('form p.muted').first().textContent().catch(() => '')).replace(/\s+/g, ' ').trim());
  await page.fill('#subject', `${MARK} کتابی ناوخۆیی لە ژووری ${who} بۆ تاقیکردنەوە`);
  const resp = page.waitForResponse(r => r.url().endsWith('/registry/new') && r.request().method() === 'POST');
  await page.click('form[data-similar-form] > .row button[type=submit]');
  const r = await resp;
  await page.waitForLoadState('domcontentloaded');
  if (r.status() === 200 && await page.locator('input[name=confirm_similar]').count()) {
    await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[data-similar-form] > .row button[type=submit]')]);
  }
  note(who, 'register ->', r.status(), page.url(), await noticeText(page));
  const id = docId(page.url());
  made[who] = id;
  if (id) {
    const cards = await page.locator('.card h2').allTextContents();
    note(who, 'cards on own new letter', cards.map(s => s.replace(/\s+/g, ' ').trim()).join(' | '));
    note(who, 'cancel offered', await page.locator('details.danger-zone').count(), 'reply button', await page.locator('header a', { hasText: 'وەڵام' }).count());
    await page.goto('/inbox');
    note(who, 'inbox unsent card has letter', await page.locator(`.card a[href="/documents/${id}"]`).count());
    await shot(page, `s02-inbox-${who}`);
  }
  problems(page, `register ${who}`);
  await context.close();
}

// sakar sends his own new letter to his own room (legal): the room list does not exclude it.
{
  const { page, context } = await as(b, 'sakar');
  await page.goto(`/documents/${made.sakar}`);
  const opts = await page.locator('#to_room option').evaluateAll(os => os.map(o => o.textContent.trim()).slice(0, 10));
  note('sakar to_room options (first 10)', opts);
  const res = await sendTo(page, made.sakar, ROOM.legal);
  note('sakar sends own letter to own room (legal) ->', res);
  await shot(page, 's02-sakar-send-own-room');
  page.problems.length = 0;
  // sequence starting with own room
  await page.goto(`/documents/${made.sakar}`);
  const selects = page.locator('select[name=seq_room]');
  await selects.nth(0).selectOption(ROOM.legal);
  await selects.nth(1).selectOption(ROOM.contracts);
  const r2 = await press(page, 'form:has(input[name=mode][value=sequence]) button[type=submit]');
  note('sakar sequence starting with own room ->', r2);
  page.problems.length = 0;
  await context.close();
}
{
  const { page, context } = await as(b, 'shilan');
  const { register } = await import('./lib.mjs');
  const L = await register(page, { subject: `${MARK} ناردن بۆ هەمان ژووری هات و دەرچوو`, sender: `هاووڵاتی ${MARK}` });
  const res = await sendTo(page, L.id, ROOM.desk);
  note('shilan sends new letter to front desk (own room) ->', res);
  await shot(page, 's02-shilan-send-own-room');
  page.problems.length = 0;
  await context.close();
}
console.log(JSON.stringify(made));
await b.close();
