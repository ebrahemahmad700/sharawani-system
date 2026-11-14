// Single sends: return to me, recall before/after opening, return as not ours, send again, forward by head vs clerk.
import { browser, as, note, register, MARK, shot, problems, noticeText, ROOM, sendTo, seqTo, press, myDay, bell, trailText, sleep } from './lib.mjs';

const b = await browser();
const S = await as(b, 'shilan');
const SK = await as(b, 'sakar');
const HM = await as(b, 'hemin');
const DL = await as(b, 'dler');
const shilan = S.page, sakar = SK.page, hemin = HM.page, dler = DL.page;

// ---------- A. single to legal with return-to-me ----------
const A = await register(shilan, { subject: `${MARK} ناردنی تاک بۆ یاسا لەگەڵ گەڕانەوە`, sender: `هاووڵاتی ئەی ${MARK}` });
note('A registered', A);
const beforeDay = await myDay(shilan);
note('shilan my-day before send', beforeDay);
const sent = await sendTo(shilan, A.id, ROOM.legal, { note: 'تکایە ڕای یاسایی بنووسن', returnToMe: true });
note('A send ->', sent);
note('A trail after send', await trailText(shilan));
note('A recall button for shilan', await shilan.locator('form[action$="/recall"]').count());
note('shilan my-day after send', await myDay(shilan));
const waitingRow = shilan.locator('table tbody tr', { hasText: A.no.split('/').pop() }).filter({ hasText: MARK });
note('shilan my-day waiting row', (await waitingRow.allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' || '));
await shot(shilan, 's03-A-shilan-myday');

// legal sees it (without opening the letter)
await sakar.goto('/inbox');
const sakarRow = sakar.locator('table tbody tr', { hasText: `${MARK} ناردنی تاک` });
note('sakar inbox row', (await sakarRow.allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' || '));
note('sakar inbox tiles', await sakar.locator('.stats .stat').evaluateAll(ss => ss.map(s => s.innerText.replace(/\s+/g, ' '))));
note('sakar inbox nav badge', await sakar.locator('.sidebar a[href="/inbox"] .count').textContent().catch(() => 'none'));
note('sakar bell', (await bell(sakar)).slice(0, 2));
note('hemin bell', (await bell(hemin)).slice(0, 2));
note('sakar my-day', await myDay(sakar));

// shilan keeps the letter page open (stale), sakar opens it, then shilan presses recall
await shilan.goto(`/documents/${A.id}`);
await sakar.goto(`/documents/${A.id}`);
note('sakar opened A; complete form', await sakar.locator('form[action$="/complete"]').count(), 'return form', await sakar.locator('form[action$="/return"]').count(), 'send card', await sakar.locator('#to_room').count(), 'paper button', await sakar.locator('form[action$="/paper-received"]').count());
const recallStale = await press(shilan, 'form[action$="/recall"] button');
note('shilan stale recall after sakar opened ->', recallStale);
note('A trail after recall attempt', await trailText(shilan));

// sakar completes with an opinion -> return leg to front desk
note('sakar complete opinion ->', await press(sakar, 'form[action$="/complete"] button'));
note('A trail after sakar complete', await trailText(sakar));
note('sakar still sees A page? status', await sakar.locator('.card .pill').first().textContent());
note('shilan bell after return leg', (await bell(shilan)).slice(0, 3));
await shilan.goto('/inbox');
note('shilan inbox has A', await shilan.locator('table tbody tr', { hasText: `${MARK} ناردنی تاک` }).count());
note('shilan my-day after return', await myDay(shilan));
await shilan.goto(`/documents/${A.id}`);
note('shilan A page cards', (await shilan.locator('.card h2').allTextContents()).map(s => s.trim()).join(' | '));
await shot(shilan, 's03-A-back-at-desk', { fullPage: true });
problems(shilan, 'A'); problems(sakar, 'A');

// ---------- B. recall before opening ----------
const B = await register(shilan, { subject: `${MARK} گەڕاندنەوەی ناردن پێش کردنەوە`, sender: `هاووڵاتی بی ${MARK}` });
note('B send ->', await sendTo(shilan, B.id, ROOM.legal));
note('B recall ->', await press(shilan, 'form[action$="/recall"] button'));
note('B trail', await trailText(shilan));
note('B status pill', await shilan.locator('.card .pill').first().textContent());
note('sakar bell after recall', (await bell(sakar)).slice(0, 2));
await sakar.goto('/inbox');
note('sakar inbox still has B?', await sakar.locator('table tbody tr', { hasText: `${MARK} گەڕاندنەوەی ناردن` }).count());
// the recalled room follows the notification link
const recallNotif = sakar.locator('ul.notif-list > li a', { hasText: 'وەرگیرایەوە' }).first();
await bell(sakar);
if (await recallNotif.count()) {
  await recallNotif.click(); await sakar.waitForLoadState('domcontentloaded');
  note('sakar follows recall notification ->', sakar.url(), (await sakar.locator('header h1').textContent()).trim(), 'complete form?', await sakar.locator('form[action$="/complete"]').count());
}
// send again after recall
note('B send again to contracts ->', await sendTo(shilan, B.id, ROOM.contracts));
note('B trail after resend', await trailText(shilan));
problems(shilan, 'B'); problems(sakar, 'B');

// ---------- C. return as "not for our room", then send again (single, then sequence) ----------
const C = await register(shilan, { subject: `${MARK} گەڕاندنەوە وەک ئەمە بۆ ئێمە نییە`, sender: `هاووڵاتی سی ${MARK}` });
note('C send ->', await sendTo(shilan, C.id, ROOM.legal));
await sakar.goto(`/documents/${C.id}`);
await sakar.locator('details summary', { hasText: 'بۆ ژووری ئێمە نییە' }).click();
await sakar.fill('#reason', 'ئەمە پەیوەندی بە زەوی و زارەوە هەیە');
note('sakar return ->', await press(sakar, 'form[action$="/return"] button'));
note('sakar page after return: url', sakar.url(), 'title', (await sakar.locator('header h1').textContent()).trim());
note('C trail', await trailText(sakar));
note('shilan bell after bounce', (await bell(shilan)).slice(0, 2));
await shilan.goto(`/documents/${C.id}`);
note('shilan C page: complete form', await shilan.locator('form[action$="/complete"]').count(), 'recall', await shilan.locator('form[action$="/recall"]').count());
await shot(shilan, 's03-C-bounced', { fullPage: true });
// sakar's recall button on his own return?
await sakar.goto(`/documents/${C.id}`);
note('sakar sees recall on his return (bounce)?', await sakar.locator('form[action$="/recall"]').count());
note('shilan C sequence after return ->', await seqTo(shilan, C.id, [ROOM.land, ROOM.accounts]));
note('shilan C single after return ->', await sendTo(shilan, C.id, ROOM.land));
note('C trail after resend', await trailText(shilan));
problems(shilan, 'C'); problems(sakar, 'C');

// ---------- D. forward by head vs clerk ----------
const D = await register(shilan, { subject: `${MARK} ناردن بۆ پێشتر لەلایەن سەرۆکی ژوور`, sender: `هاووڵاتی دی ${MARK}` });
note('D send ->', await sendTo(shilan, D.id, ROOM.legal));
await sakar.goto(`/documents/${D.id}`);
note('sakar (clerk) holding D: send card?', await sakar.locator('#to_room').count());
await hemin.goto(`/documents/${D.id}`);
note('hemin (head) holding D: send card?', await hemin.locator('#to_room').count());
note('hemin forwards D to contracts ->', await sendTo(hemin, D.id, ROOM.contracts, { note: 'بۆ گرێبەستەکان' }));
note('D trail', await trailText(hemin));
note('hemin recall button on D', await hemin.locator('form[action$="/recall"]').count());
const recallFwd = await press(hemin, 'form[action$="/recall"] button').catch(e => 'ERR ' + e.message);
note('hemin recalls forwarded D (before contracts opens) ->', recallFwd);
await shot(hemin, 's03-D-recall-after-forward');
hemin.problems.length = 0;
await hemin.goto(`/documents/${D.id}`);
note('D trail after recall attempt', await trailText(hemin));

// dler opens D (contracts), completes; then hemin (not holding) still sees send card and can pull it
await dler.goto(`/documents/${D.id}`);
note('dler complete D ->', await press(dler, 'form[action$="/complete"] button'));
await hemin.goto(`/documents/${D.id}`);
note('D status now', await hemin.locator('.card .pill').first().textContent(), 'hemin send card', await hemin.locator('#to_room').count());

// E. A room head who does not hold the letter pulls it away from the room that does.
const E = await register(shilan, { subject: `${MARK} سەرۆکی ژوورێکی تر نامەکە دەبات`, sender: `هاووڵاتی ئی ${MARK}` });
note('E send to legal ->', await sendTo(shilan, E.id, ROOM.legal));
await hemin.goto(`/documents/${E.id}`);
note('hemin forwards E to contracts ->', await sendTo(hemin, E.id, ROOM.contracts));
await dler.goto(`/documents/${E.id}`); // contracts receives
await hemin.goto(`/documents/${E.id}`);
note('hemin (legal head) viewing E now held by contracts: send card?', await hemin.locator('#to_room').count(), 'iHold?', await hemin.locator('form[action$="/complete"]').count());
if (await hemin.locator('#to_room').count()) {
  note('hemin sends E (held by contracts) to land ->', await sendTo(hemin, E.id, ROOM.land));
  note('E trail', await trailText(hemin));
  await shot(hemin, 's03-E-pulled-by-other-head', { fullPage: true });
  await dler.goto('/inbox');
  note('dler inbox still has E?', await dler.locator('table tbody tr', { hasText: `${MARK} سەرۆکی ژوورێکی تر` }).count());
  note('dler bell', (await bell(dler)).slice(0, 2));
}
problems(hemin, 'D/E'); problems(dler, 'D/E');

// ---------- F. mayor receives a letter, wants to send it in sequence ----------
const AR = await as(b, 'aram');
const aram = AR.page;
const F = await register(shilan, { subject: `${MARK} بۆ سەرۆکی شارەوانی پاشان ڕیزبەندی`, sender: `هاووڵاتی ئێف ${MARK}` });
note('F send to mayor ->', await sendTo(shilan, F.id, ROOM.mayor));
await aram.goto(`/documents/${F.id}`);
note('aram opens F; sequence ->', await seqTo(aram, F.id, [ROOM.legal, ROOM.land, ROOM.accounts]));
await shot(aram, 's03-F-mayor-sequence-refused');
note('aram single to legal ->', await sendTo(aram, F.id, ROOM.legal));
note('F trail', await trailText(aram));
problems(aram, 'F');

console.log(JSON.stringify({ A, B, C, D, E, F }));
await b.close();
