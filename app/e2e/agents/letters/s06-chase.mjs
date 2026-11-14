// Chasing from the letter page and from My day; twice a day; what the chased room sees; odd rows in My day.
import { browser, as, note, register, MARK, shot, locShot, problems, noticeText, ROOM, sendTo, press, myDay, bell, trailText, sleep } from './lib.mjs';

const b = await browser();
const shilan = (await as(b, 'shilan')).page;
const sozan = (await as(b, 'sozan')).page;
const sakar = (await as(b, 'sakar')).page;

// 1. chase from the letter page, twice
const c1 = await register(shilan, { subject: `${MARK} بەدواداچوون لە پەڕەی کتابەوە`, sender: `هاووڵاتی چەیس ${MARK}` });
await sendTo(shilan, c1.id, ROOM.accounts);
await shilan.goto(`/documents/${c1.id}`);
note('c1 chase card present', await shilan.locator('form[action$="/chase"]').count());
await locShot(shilan.locator('.card:has(form[action$="/chase"])'), 's06-chase-card');
await shilan.fill('#chase_note', 'تکایە ئەمڕۆ وەڵام بدەنەوە');
note('c1 chase #1 ->', await press(shilan, 'form[action$="/chase"] button'));
note('c1 url after chase', shilan.url());
note('c1 notes', (await shilan.locator('.card:has(h2:text-matches("تێبینی")) li').allTextContents()).map(s => s.replace(/\s+/g, ' ')));
note('c1 chase card still offered', await shilan.locator('form[action$="/chase"]').count());
note('c1 chase #2 same day ->', await press(shilan, 'form[action$="/chase"] button'));
await shot(shilan, 's06-chase-twice');
note('sozan bell', (await bell(sozan)).slice(0, 2));
await sozan.goto('/inbox');
note('sozan inbox row for c1', (await sozan.locator('table tbody tr', { hasText: `${MARK} بەدواداچوون لە پەڕەی` }).allTextContents()).map(s => s.replace(/\s+/g, ' ')));
await sozan.goto(`/documents/${c1.id}`);
note('sozan sees chase note on letter', (await sozan.locator('.card:has(h2:text-matches("تێبینی")) li').allTextContents()).map(s => s.replace(/\s+/g, ' ')));

// 2. chase from My day, then from the letter page
const c2 = await register(shilan, { subject: `${MARK} بەدواداچوون لە ڕۆژی منەوە`, sender: `هاووڵاتی ڕۆژ ${MARK}` });
await sendTo(shilan, c2.id, ROOM.accounts);
await shilan.goto('/my-day');
const row2 = shilan.locator('table tbody tr', { hasText: `${MARK} بەدواداچوون لە ڕۆژی منەوە` });
note('my-day row c2', (await row2.innerText()).replace(/\s+/g, ' '));
note('c2 chase from my-day ->', await press(shilan, `table tbody tr:has-text("${MARK} بەدواداچوون لە ڕۆژی منەوە") form[action$="/chase"] button`));
note('my-day row c2 after', (await shilan.locator('table tbody tr', { hasText: `${MARK} بەدواداچوون لە ڕۆژی منەوە` }).innerText()).replace(/\s+/g, ' '));
await shilan.goto(`/documents/${c2.id}`);
note('c2 letter page chase offered after my-day chase', await shilan.locator('form[action$="/chase"]').count());
if (await shilan.locator('form[action$="/chase"]').count()) note('c2 chase from page ->', await press(shilan, 'form[action$="/chase"] button'));

// 3. an ordinary note blocks chasing
const c3 = await register(shilan, { subject: `${MARK} تێبینی ئاسایی پێش بەدواداچوون`, sender: `هاووڵاتی تێبینی ${MARK}` });
await sendTo(shilan, c3.id, ROOM.accounts);
await shilan.goto(`/documents/${c3.id}`);
await shilan.fill('#note_body', 'هاووڵاتییەکە تەلەفۆنی کرد و پرسیاری کرد');
note('c3 ordinary note ->', await press(shilan, 'form[action$="/notes"] button'));
await shilan.goto('/my-day');
note('my-day row c3 after an ordinary note', (await shilan.locator('table tbody tr', { hasText: `${MARK} تێبینی ئاسایی` }).innerText()).replace(/\s+/g, ' '));
await shilan.goto(`/documents/${c3.id}`);
note('c3 chase after ordinary note ->', await press(shilan, 'form[action$="/chase"] button'));
await shot(shilan, 's06-chase-after-note');

// 4. a letter that came back to my own desk is listed as waiting on other rooms
const c4 = await register(shilan, { subject: `${MARK} گەڕایەوە بۆ مێزی خۆم`, sender: `هاووڵاتی گەڕانەوە ${MARK}` });
await sendTo(shilan, c4.id, ROOM.accounts, { returnToMe: true });
await sozan.goto(`/documents/${c4.id}`);
note('sozan completes c4 ->', await press(sozan, 'form[action$="/complete"] button'));
await shilan.goto('/my-day');
const row4 = shilan.locator('table tbody tr', { hasText: `${MARK} گەڕایەوە بۆ مێزی خۆم` });
note('my-day rows c4 (count, text)', await row4.count(), (await row4.allTextContents()).map(s => s.replace(/\s+/g, ' ')));
await shot(shilan, 's06-myday-own-desk-in-waiting', { fullPage: true });
const chaseOwn = shilan.locator(`table tbody tr:has-text("${MARK} گەڕایەوە بۆ مێزی خۆم") form[action$="/chase"] button`);
if (await chaseOwn.count()) note('chase my own-desk letter from my-day ->', await press(shilan, `table tbody tr:has-text("${MARK} گەڕایەوە بۆ مێزی خۆم") form[action$="/chase"] button`));

// 5. a letter the room returned as "not ours" appears in the returner's waiting list
const c5 = await register(shilan, { subject: `${MARK} گەڕاندنەوە و لیستی چاوەڕوانی`, sender: `هاووڵاتی بونس ${MARK}` });
await sendTo(shilan, c5.id, ROOM.legal);
await sakar.goto(`/documents/${c5.id}`);
await sakar.locator('details summary', { hasText: 'بۆ ژووری ئێمە نییە' }).click();
await sakar.fill('#reason', 'ئەمە بۆ ژووری ئێمە نییە');
note('sakar returns c5 ->', await press(sakar, 'form[action$="/return"] button'));
await sakar.goto('/my-day');
const row5 = sakar.locator('table tbody tr', { hasText: `${MARK} گەڕاندنەوە و لیستی چاوەڕوانی` });
note('sakar my-day rows for c5 (he returned it)', await row5.count(), (await row5.allTextContents()).map(s => s.replace(/\s+/g, ' ')));
await sakar.goto(`/documents/${c5.id}`);
note('sakar letter page chase card for c5', await sakar.locator('form[action$="/chase"]').count());
await shot(sakar, 's06-sakar-myday-returned', { fullPage: true });

// 6. my-day numbers vs lists
await shilan.goto('/my-day');
const tiles = await shilan.locator('.stats .stat').evaluateAll(ss => ss.map(s => s.innerText.replace(/\s+/g, ' ')));
const heads = (await shilan.locator('.card h2').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
const waitingRows = await shilan.locator('.card:has(h2:text-matches("چاوەڕوانی ژوورەکانی تر")) tbody tr').count();
const waitingOwnDesk = await shilan.locator('.card:has(h2:text-matches("چاوەڕوانی ژوورەکانی تر")) tbody tr', { hasText: 'ژووری هات و دەرچوو' }).count();
note('shilan my-day tiles', tiles, 'headings', heads, 'waiting rows', waitingRows, 'of which at own room', waitingOwnDesk);

for (const p of [shilan, sozan, sakar]) problems(p, 'chase');
console.log(JSON.stringify({ c1, c2, c3, c4, c5 }));
await b.close();
