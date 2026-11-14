// Extra: stale "not for our room" after the letter moved on; a waiting room pulls a letter; tracking for in-flow and cancelled.
import { browser, as, note, register, MARK, shot, problems, noticeText, ROOM, sendTo, seqTo, press, bell, trailText, sleep } from './lib.mjs';

const b = await browser();
const shilan = (await as(b, 'shilan')).page;
const sozan = (await as(b, 'sozan')).page;
const hersh = (await as(b, 'hersh')).page;

// 1. stale return
const T = await register(shilan, { subject: `${MARK} گەڕاندنەوەی پەڕەی کۆن دوای جوڵان`, sender: `هاووڵاتی گەڕاندنەوەی کۆن ${MARK}` });
note('T sequence ->', await seqTo(shilan, T.id, [ROOM.accounts, ROOM.land, ROOM.admin], { returnToMe: false }));
const tabA = sozan, tabB = await sozan.context().newPage();
await tabA.goto(`/documents/${T.id}`);
await tabB.goto(`/documents/${T.id}`);
note('sozan tab A complete ->', await press(tabA, 'form[action$="/complete"] button'));
await tabB.locator('details summary', { hasText: 'بۆ ژووری ئێمە نییە' }).click();
await tabB.fill('#reason', 'پەڕەی کۆن: ئەمە بۆ ئێمە نییە');
note('sozan stale tab B return ->', await press(tabB, 'form[action$="/return"] button'));
await tabB.goto(`/documents/${T.id}`);
note('T trail', await trailText(tabB));
await shot(tabB, 's11-stale-return', { fullPage: true });
note('hersh bell (land) about T', (await bell(hersh)).filter(s => s.includes('گەڕاندنەوەی پەڕەی کۆن')).slice(0, 3));

// 2. a room further down a sequence takes the letter before its turn
const W = await register(shilan, { subject: `${MARK} ژووری چاوەڕوان پێش نۆرەی خۆی دەیبات`, sender: `هاووڵاتی نۆرە ${MARK}` });
note('W sequence ->', await seqTo(shilan, W.id, [ROOM.accounts, ROOM.land], { returnToMe: true }));
await hersh.goto(`/documents/${W.id}`);
note('hersh (land, waiting 2 of 2) sees send card', await hersh.locator('#to_room').count());
note('hersh sends W to legal before his turn ->', await sendTo(hersh, W.id, ROOM.legal));
await hersh.goto(`/documents/${W.id}`);
note('W trail', await trailText(hersh));
await shot(hersh, 's11-waiting-room-takes-letter', { fullPage: true });
note('sozan bell about W', (await bell(sozan)).filter(s => s.includes('ژووری چاوەڕوان پێش')).slice(0, 3));
await shilan.goto('/my-day');
note('shilan my-day row W', (await shilan.locator('table tbody tr', { hasText: 'ژووری چاوەڕوان پێش' }).allTextContents()).map(s => s.replace(/\s+/g, ' ')));

// 3. tracking: in-flow sequence letter and the cancelled one (2 requests)
const S2 = 1203;
await shilan.goto(`/documents/${S2}`);
const bc2 = (await shilan.locator('tr:has(th:text("بارکۆد")) td').textContent()).trim();
const rp = await shilan.context().newPage();
await rp.goto(`/documents/${S2}/receipt`);
const pin2 = (await rp.locator('.slip .pin b').textContent()).trim();
const pub = await b.newContext({ baseURL: 'http://localhost:3111' });
const tp = await pub.newPage();
for (const [bc, pin, label] of [[bc2, pin2, 'in-flow sequence S2'], ['20260007107', '619992', 'cancelled X1']]) {
  await tp.goto('/track');
  await tp.fill('#barcode', bc);
  await tp.fill('#pin', pin);
  await Promise.all([tp.waitForLoadState('domcontentloaded'), tp.click('form[action="/track"] button')]);
  await tp.waitForLoadState('domcontentloaded');
  const card = tp.locator('.login-card .card');
  note(`track ${label} ->`, (await card.count()) ? (await card.innerText()).replace(/\s+/g, ' ') : await tp.locator('.notice').innerText());
  await shot(tp, `s11-track-${label.replace(/\W+/g, '-')}`, { fullPage: true });
}

for (const p of [shilan, sozan, hersh, tp]) problems(p, 'extra');
console.log(JSON.stringify({ T, W }));
await b.close();
