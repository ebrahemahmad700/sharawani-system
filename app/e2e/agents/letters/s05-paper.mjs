// Paper folders: letter page, barcode screen, delivery lists, "paper not arrived" counts.
import { browser, as, note, register, MARK, shot, locShot, problems, noticeText, ROOM, sendTo, press, myDay, bell, sleep } from './lib.mjs';

const b = await browser();
const shilan = (await as(b, 'shilan')).page;
const sakar = (await as(b, 'sakar')).page;
const sozan = (await as(b, 'sozan')).page;
const dana = (await as(b, 'dana')).page;

async function counts(p, label) {
  await p.goto('/inbox');
  const tiles = await p.locator('.stats .stat').evaluateAll(ss => ss.map(s => s.innerText.replace(/\s+/g, ' ')));
  const notices = (await p.locator('.content > .notice').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
  const rowsNotArrived = await p.locator('.card table tbody tr .pill.warn', { hasText: 'نەگەیشتووە' }).count();
  const rows = await p.locator('.card table tbody tr').count();
  const day = await myDay(p);
  const dayPaper = await p.locator('h2', { hasText: 'کاغەزەکەیان نەگەیشتووە' }).textContent().catch(() => 'none');
  note(`${label} (${p.who}) inbox tiles`, tiles, 'notices', notices, 'rows', rows, 'rows not arrived', rowsNotArrived, '| my-day', day, dayPaper.trim());
}

await counts(sozan, 'accounts before');

// three letters to accounts
const L = [];
for (let i = 1; i <= 3; i++) {
  const d = await register(shilan, { subject: `${MARK} پەڕگەی کاغەز بۆ ژمێریاری ${i}`, sender: `هاووڵاتی کاغەز ${MARK} ${i}` });
  note(`paper letter ${i}`, d, await sendTo(shilan, d.id, ROOM.accounts));
  L.push(d);
}
await counts(sozan, 'accounts after 3 sent');

// 1. paper on the letter page (letter 1)
await sozan.goto(`/documents/${L[0].id}`);
note('sozan letter1 paper pill', (await sozan.locator('tr:has(th:text("پەڕگەی کاغەزی")) td').innerText()).replace(/\s+/g, ' '));
note('sozan letter1 paper-received ->', await press(sozan, 'form[action$="/paper-received"] button'));
note('after: pill', (await sozan.locator('tr:has(th:text("پەڕگەی کاغەزی")) td').innerText()).replace(/\s+/g, ' '));
note('shilan bell after paper received', (await bell(shilan)).slice(0, 1));

// 2. barcode screen: shilan (not holding) and sozan (holding) scan letter 2
const barcode2 = await (async () => { await shilan.goto(`/documents/${L[1].id}`); return (await shilan.locator('tr:has(th:text("بارکۆد")) td').textContent()).trim(); })();
await shilan.goto('/barcode');
await shilan.fill('#q', barcode2);
await shilan.press('#q', 'Enter');
await shilan.waitForLoadState('domcontentloaded');
note('shilan barcode scan letter2: receive button?', await shilan.locator('form[action$="/paper-received"]').count(), 'rows', (await shilan.locator('.card table tr').allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' | '));
await sozan.goto('/barcode');
await sozan.fill('#q', barcode2);
await sozan.press('#q', 'Enter');
await sozan.waitForLoadState('domcontentloaded');
note('sozan barcode scan letter2: receive button?', await sozan.locator('form[action$="/paper-received"]').count());
await shot(sozan, 's05-barcode-sozan');
note('sozan barcode receive ->', await press(sozan, 'form[action$="/paper-received"] button'));
note('sozan barcode after: rows', (await sozan.locator('.card table tr').allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' | '));
// dana (directorate head, land) scanning a folder that sits with accounts
await dana.goto(`/barcode?q=${barcode2}`);
note('dana barcode letter2 (accounts): found?', await dana.locator(`a[href="/documents/${L[1].id}"]`).count());

// 3. delivery list from the front desk for letter 3 (+ letter 1 whose paper already arrived, not offered)
await shilan.goto('/manifests');
const group = shilan.locator('.card', { hasText: 'ناردن بۆ ژووری ژمێریاری' });
note('shilan manifests: accounts group present', await group.count());
note('letter1 (paper arrived) offered?', await group.locator(`input[value="${L[0].id}"]`).count(), 'letter3 offered?', await group.locator(`input[value="${L[2].id}"]`).count());
// untick everything except letter 3
const boxes = group.locator('input[name=document_id]');
const n = await boxes.count();
for (let i = 0; i < n; i++) {
  const v = await boxes.nth(i).getAttribute('value');
  if (v !== String(L[2].id)) await boxes.nth(i).uncheck();
}
await group.locator('input[name=courier]').fill(`گەیەنەر ${MARK}`);
note('create manifest ->', await press(shilan, `.card:has-text("ناردن بۆ ژووری ژمێریاری") button[type=submit]`));
const manUrl = shilan.url();
note('manifest page', manUrl, 'buttons for sender:', (await shilan.locator('.card button').allTextContents()).map(s => s.trim()));
await shot(shilan, 's05-manifest-sender-view');
const printP = await shilan.context().newPage();
await printP.goto(manUrl.replace(/\?.*$/, '') + '/print');
await sleep(600);
await shot(printP, 's05-manifest-print', { fullPage: true });
await printP.close();

await counts(sozan, 'accounts with manifest on the way');
await sozan.goto('/manifests');
note('sozan manifests incoming rows', (await sozan.locator('.card', { hasText: 'لە ڕێگەدا' }).first().locator('tbody tr').allTextContents()).map(s => s.replace(/\s+/g, ' ')).slice(0, 3));
note('sozan nav manifest badge', await sozan.locator('.sidebar a[href="/manifests"] .count').textContent().catch(() => 'none'));
note('sozan bell', (await bell(sozan)).slice(0, 2));

// the SENDER presses "receive all" on her own manifest
await shilan.goto(manUrl.replace(/\?.*$/, ''));
if (await shilan.locator('form[action$="/receive"] button').count()) {
  note('shilan (sender) receives her own manifest ->', await press(shilan, 'form[action$="/receive"] button'));
  await shot(shilan, 's05-manifest-sender-received');
  await sozan.goto(`/documents/${L[2].id}`);
  note('letter3 paper pill as sozan after sender self-receipt', (await sozan.locator('tr:has(th:text("پەڕگەی کاغەزی")) td').innerText()).replace(/\s+/g, ' '));
}

// 4. a second manifest, cancelled by the RECEIVING room
const d4 = await register(shilan, { subject: `${MARK} پەڕگەی کاغەز بۆ هەڵوەشاندنەوەی لیست`, sender: `هاووڵاتی لیست ${MARK}` });
await sendTo(shilan, d4.id, ROOM.accounts);
await shilan.goto('/manifests');
const g2 = shilan.locator('.card', { hasText: 'ناردن بۆ ژووری ژمێریاری' });
const b2 = g2.locator('input[name=document_id]');
for (let i = 0; i < await b2.count(); i++) if (await b2.nth(i).getAttribute('value') !== String(d4.id)) await b2.nth(i).uncheck();
await g2.locator('input[name=courier]').fill(`گەیەنەر دوو ${MARK}`);
note('create manifest 2 ->', await press(shilan, `.card:has-text("ناردن بۆ ژووری ژمێریاری") button[type=submit]`));
const man2 = shilan.url().replace(/\?.*$/, '');
await sozan.goto(man2);
note('sozan (receiver) sees on manifest 2:', (await sozan.locator('.card button').allTextContents()).map(s => s.trim()));
if (await sozan.locator('form[action$="/cancel"] button').count()) {
  note('sozan (receiver) cancels manifest 2 ->', await press(sozan, 'form[action$="/cancel"] button'));
}
// receive-after-cancel from a stale page
await shilan.goto(man2);
note('shilan manifest2 status', (await shilan.locator('tr:has(th:text("دۆخ")) td').innerText()).replace(/\s+/g, ' '), 'items', await shilan.locator('.card:has(h2:text-matches("کتابەکان")) tbody tr').count());

// 5. a manifest whose letter moves on before it is received
const d5 = await register(shilan, { subject: `${MARK} پەڕگەی کاغەز کە پێش وەرگرتن جوڵا`, sender: `هاووڵاتی جوڵان ${MARK}` });
await sendTo(shilan, d5.id, ROOM.accounts);
await shilan.goto('/manifests');
const g3 = shilan.locator('.card', { hasText: 'ناردن بۆ ژووری ژمێریاری' });
const b3 = g3.locator('input[name=document_id]');
for (let i = 0; i < await b3.count(); i++) if (await b3.nth(i).getAttribute('value') !== String(d5.id)) await b3.nth(i).uncheck();
await g3.locator('input[name=courier]').fill(`گەیەنەر سێ ${MARK}`);
note('create manifest 3 ->', await press(shilan, `.card:has-text("ناردن بۆ ژووری ژمێریاری") button[type=submit]`));
const man3 = shilan.url().replace(/\?.*$/, '');
await sozan.goto(`/documents/${d5.id}`);
note('sozan completes d5 ->', await press(sozan, 'form[action$="/complete"] button'));
await sozan.goto(man3);
note('sozan receives manifest 3 after letter moved ->', await press(sozan, 'form[action$="/receive"] button'));
await shot(sozan, 's05-manifest3-received');

await counts(sozan, 'accounts at end');
for (const p of [shilan, sakar, sozan, dana]) problems(p, 'paper');
console.log(JSON.stringify({ L, d4, d5, man2, man3, manUrl }));
await b.close();
