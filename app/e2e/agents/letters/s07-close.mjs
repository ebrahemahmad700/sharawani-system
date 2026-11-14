// Reply and close: draft, save, print preview, close with outgoing number; sent list; closed letter for every room; prints; tracking.
import { browser, as, note, register, MARK, shot, locShot, problems, noticeText, ROOM, sendTo, seqTo, press, myDay, bell, trailText, sleep } from './lib.mjs';

const S1 = Number(process.argv[2]); // the four-room sequence letter from s04, ready to close
const b = await browser();
const shilan = (await as(b, 'shilan')).page;

if (S1) {
// 1. composer on S1
await shilan.goto(`/documents/${S1}/reply`);
const draft = await shilan.inputValue('#body');
note('S1 starter draft', draft.replace(/\n/g, ' ⏎ '));
note('S1 opinions panel', (await shilan.locator('ul.trail li').allTextContents()).map(s => s.replace(/\s+/g, ' ')));
await shot(shilan, 's07-composer', { fullPage: true });
await shilan.fill('#body', draft + '\nداواکارییەکەت پەسەندکرا بە مەرجی پابەندبوون بە نەخشەکە.');
await shilan.fill('#recipient', `بەڕێز هاووڵاتی ${MARK}`);
note('save draft ->', await press(shilan, 'form[action$="/reply"] button[type=submit]'));
const printP0 = await shilan.context().newPage();
await printP0.goto(`/documents/${S1}/reply/print`);
await sleep(700);
note('draft print: number cell', (await printP.locator('.nos').innerText()).replace(/\s+/g, ' '));
await shot(printP, 's07-reply-print-draft', { fullPage: true });
// close through the composer
await shilan.goto(`/documents/${S1}/reply`);
note('close via composer ->', await press(shilan, 'form[action$="/reply/send"] button'));
const outNo = (await shilan.locator('tr:has(th:text("ژمارەی دەرچوو")) td').textContent().catch(() => '')).trim();
note('S1 closed, outgoing no', outNo, 'reply row', (await shilan.locator('tr:has(th:text("وەڵامی نێردراو")) td').innerText().catch(() => 'MISSING')).slice(0, 80));
await shot(shilan, 's07-closed-letter-shilan', { fullPage: true });
await printP.goto(`/documents/${S1}/reply/print`);
await sleep(500);
note('closed reply print: number cell', (await printP.locator('.nos').innerText()).replace(/\s+/g, ' '), 'body len', (await printP.locator('.body').innerText()).length);
await printP.goto(`/documents/${S1}/print`);
await sleep(500);
await shot(printP, 's07-letter-print-closed', { fullPage: true });
await printP.goto(`/documents/${S1}/receipt`);
const pin = (await printP.locator('.slip .pin b').textContent()).trim();
const barcode = (await shilan.locator('tr:has(th:text("بارکۆد")) td').textContent()).trim();
note('receipt pin', pin, 'barcode', barcode);

// 2. sent list
await shilan.goto('/outgoing');
note('outgoing sent row for S1', (await shilan.locator('table tbody tr', { hasText: outNo.replace(/[^\d/]/g, '').split('/').pop() }).filter({ hasText: MARK }).allTextContents()).map(s => s.replace(/\s+/g, ' ')));
await shot(shilan, 's07-outgoing');

// 3. every room it passed through
for (const who of ['sakar', 'hemin', 'dler', 'shne', 'bafrin', 'hersh', 'dana']) {
  const { page, context } = await as(b, who);
  const resp = await page.goto(`/documents/${S1}`);
  const cards = (await page.locator('.card h2').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
  const actions = (await page.locator('header .topbar-tools a.btn').allTextContents()).map(s => s.trim());
  const reply = await page.locator('tr:has(th:text("وەڵامی نێردراو"))').count();
  note(`closed S1 as ${who}: http ${resp.status()} cards`, cards.join(' | '), 'topbar', actions.join(','), 'reply row', reply);
  await page.goto('/outgoing');
  note(`  ${who} /outgoing lists S1?`, await page.locator('table tbody tr', { hasText: 'ڕیزبەندی چوار ژوور' }).count());
  if (['hemin', 'dana'].includes(who)) {
    await page.goto(`/documents/${S1}/reply`);
    note(`  ${who} composer on closed letter: closed notice`, await page.locator('.notice.info').count(), 'close form', await page.locator('form[action$="/reply/send"]').count());
  }
  problems(page, `closed view ${who}`);
  await context.close();
}

// 4. tracking page with the receipt PIN (1 request)
const pub = await b.newContext({ baseURL: 'http://localhost:3111' });
const tp = await pub.newPage();
await tp.goto('/track');
await tp.fill('#barcode', barcode);
await tp.fill('#pin', pin);
await Promise.all([tp.waitForLoadState('domcontentloaded'), tp.click('form[action="/track"] button')]);
await tp.waitForLoadState('domcontentloaded');
note('track closed S1 ->', (await tp.locator('.card').last().innerText().catch(() => (tp.locator('.notice').innerText()))).replace(/\s+/g, ' '));
await shot(tp, 's07-track-closed', { fullPage: true });

}
const printP = await shilan.context().newPage();
// 5. DATA LOSS: reply draft, then close from the letter page (the Outgoing list's "داخستن" button)
const R = await register(shilan, { subject: `${MARK} ڕەشنووسی وەڵام و داخستن لە پەڕەی کتاب`, sender: `هاووڵاتی ڕەشنووس ${MARK}` });
await sendTo(shilan, R.id, ROOM.accounts);
const sozan = (await as(b, 'sozan')).page;
await sozan.goto(`/documents/${R.id}`);
await sozan.fill('#reply_note', 'هیچ قەرزێکی لەسەر نییە');
note('sozan completes R ->', await press(sozan, 'form[action$="/complete"] button'));
await shilan.goto(`/documents/${R.id}/reply`);
const myReply = 'بۆ بەڕێز هاووڵاتی\nوەڵامی تەواو: هیچ قەرزێک لەسەر پارچەکەت نییە. ئەم دەقە بە وردی نووسراوە.';
await shilan.fill('#body', myReply);
note('R save draft ->', await press(shilan, 'form[action$="/reply"] button[type=submit]'));
await shilan.goto('/outgoing');
const closeBtn = shilan.locator('table tbody tr', { hasText: `${MARK} ڕەشنووسی وەڵام` }).locator('a.btn', { hasText: 'داخستن' });
note('R in outgoing ready list with close button', await closeBtn.count());
await closeBtn.click();
await shilan.waitForLoadState('domcontentloaded');
note('close card: summary prefilled with the draft?', JSON.stringify(await shilan.inputValue('#summary')));
await shilan.fill('#recipient', 'هاووڵاتی');
note('R close from letter page ->', await press(shilan, 'form[action$="/close"] button'));
note('R reply row after close', await shilan.locator('tr:has(th:text("وەڵامی نێردراو"))').count());
await shilan.goto(`/documents/${R.id}/reply`);
note('R composer after close shows', JSON.stringify((await shilan.inputValue('#body')).slice(0, 120)));
await shot(shilan, 's07-R-draft-lost', { fullPage: true });
await printP.goto(`/documents/${R.id}/reply/print`);
await sleep(400);
note('R reply print body', JSON.stringify((await printP.locator('.body').innerText()).slice(0, 80)), 'nos', (await printP.locator('.nos').innerText()).replace(/\s+/g, ' '));
await shot(printP, 's07-R-reply-print-empty', { fullPage: true });

// 6. double-click on "issue outgoing number and close"
const R2 = await register(shilan, { subject: `${MARK} دووجار کرتە لەسەر داخستن`, sender: `هاووڵاتی داخستن ${MARK}` });
await shilan.goto(`/documents/${R2.id}`);
await shilan.fill('#recipient', 'هاووڵاتی');
await shilan.locator('form[action$="/close"] button').dblclick();
await sleep(2000);
await shilan.goto(`/documents/${R2.id}`);
note('R2 after dblclick close: outgoing no', (await shilan.locator('tr:has(th:text("ژمارەی دەرچوو")) td').textContent().catch(() => '')).trim(), 'notice', await noticeText(shilan));

for (const p of [shilan, sozan]) problems(p, 'close');
console.log(JSON.stringify({ R, R2 }));
await b.close();
