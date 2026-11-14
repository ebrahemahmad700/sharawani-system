// Search and finding: top bar, barcode screen, plot file, My day numbers.
import { browser, as, note, register, MARK, shot, locShot, problems, noticeText, ROOM, sendTo, press, myDay, sleep } from './lib.mjs';

const [X1id, X1bc, plotX1] = [1231, '20260007107', 'C-4947/7'];
const b = await browser();
const shilan = (await as(b, 'shilan')).page;
const sakar = (await as(b, 'sakar')).page;

const toKu = s => s.replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d)));

async function top(p, q) {
  await p.goto('/my-day');
  await p.fill('.topbar-search input[name=q]', q);
  await Promise.all([p.waitForLoadState('domcontentloaded'), p.press('.topbar-search input[name=q]', 'Enter')]);
  await p.waitForLoadState('domcontentloaded');
  const url = decodeURIComponent(p.url().replace('http://localhost:3111', ''));
  const rows = (await p.locator('.content table tbody tr').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim().slice(0, 70));
  const notice = await noticeText(p);
  const empty = await p.locator('.empty').allTextContents();
  return { url, n: rows.length, rows: rows.slice(0, 4), notice, empty: empty.join('|').trim().slice(0, 80) };
}

// a fresh letter to look for, with a plot and a distinctive sender
const plot = `${Math.floor(Math.random() * 900 + 100)}/${Math.floor(Math.random() * 90 + 10)}`;
const F = await register(shilan, { subject: `${MARK} دۆزینەوەی کتاب بە ڕێگای جیاواز مۆڵەتی حەوشە`, sender: `کاک هەڤاڵ کەریم ${MARK}`, plot });
await shilan.goto(`/documents/${F.id}`);
const bc = (await shilan.locator('tr:has(th:text("بارکۆد")) td').textContent()).trim();
const serial = F.no.split('/').pop();
note('F', F, 'barcode', bc, 'plot', plot);

const queries = [
  ['barcode', bc],
  ['barcode kurdish digits', toKu(bc)],
  ['barcode with spaces', bc.replace(/(\d{4})(\d{4})(\d{3})/, '$1 $2 $3')],
  ['full number', F.no],
  ['full number kurdish digits', toKu(F.no)],
  ['number with ە prefix (Kurdish letter)', F.no.replace('ه', 'ە')],
  ['year/serial', `2026/${serial}`],
  ['serial only', serial],
  ['serial kurdish', toKu(serial)],
  ['plot', plot],
  ['plot kurdish', toKu(plot)],
  ['plot with dash', plot.replace('/', '-')],
  ['sender name', `هەڤاڵ کەریم ${MARK}`],
  ['sender arabic spelling', `هەڤال كەريم ${MARK}`],
  ['subject word', 'حەوشە'],
  ['subject word + mark', `${MARK} حەوشە`],
  ['cancelled barcode', X1bc],
  ['outgoing number d/2026/79', 'د/2026/79'],
  ['incoming ه/2026/79', 'ه/2026/79'],
];
for (const [label, q] of queries) {
  const r = await top(shilan, q);
  note(`top-bar [${label}] «${q}» ->`, r);
}
await top(shilan, 'ه/2026/79');
await shot(shilan, 's09-search-h-79');

// barcode screen typed numbers
for (const q of [F.no, serial, 'ه/2026/79', 'د/2026/79', '79', F.no.replace('ه', 'ە'), '12345678901']) {
  await shilan.goto('/barcode');
  await shilan.fill('#q', q);
  await Promise.all([shilan.waitForLoadState('domcontentloaded'), shilan.press('#q', 'Enter')]);
  await shilan.waitForLoadState('domcontentloaded');
  const hit = await shilan.locator('.card h2 a[href^="/documents/"]').first().textContent().catch(() => null);
  note(`barcode screen «${q}» ->`, await noticeText(shilan), 'hit', hit?.trim(), 'subject', (await shilan.locator('.card h2 + div').first().textContent().catch(() => '')).trim().slice(0, 50));
}
await shilan.goto('/barcode?q=' + encodeURIComponent('ه/2026/79'));
await shot(shilan, 's09-barcode-h-79-ambiguous');

// plot file for F and X1, typed differently
for (const q of [plot, toKu(plot), plot.replace('/', ' / '), plotX1.toLowerCase()]) {
  await shilan.goto('/plots?p=' + encodeURIComponent(q));
  note(`plots «${q}» ->`, (await shilan.locator('header h1').textContent()).trim(), await shilan.locator('.stats .stat').evaluateAll(ss => ss.map(s => s.innerText.replace(/\s+/g, ' '))));
}

// sakar: My day vs inbox vs real list
await sakar.goto('/inbox');
const inboxTiles = await sakar.locator('.stats .stat').evaluateAll(ss => ss.map(s => s.innerText.replace(/\s+/g, ' ')));
const inboxRows = await sakar.locator('.content > .card:last-child table tbody tr').count();
const inboxNotices = (await sakar.locator('.content > .notice').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
const badge = await sakar.locator('.sidebar a[href="/inbox"] .count').textContent().catch(() => 'none');
const inboxNotArrivedRows = await sakar.locator('.content > .card:last-child table tbody tr .pill.warn', { hasText: 'نەگەیشتووە' }).count();
await sakar.goto('/inbox?all=1');
const allRows = await sakar.locator('.content > .card:last-child table tbody tr').count();
const allNotArrived = await sakar.locator('.content > .card:last-child table tbody tr .pill.warn', { hasText: 'نەگەیشتووە' }).count();
const day = await myDay(sakar);
const dayHeads = (await sakar.locator('.card h2').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
note('sakar inbox tiles', inboxTiles, 'badge', badge, 'rows', inboxRows, 'rows not arrived', inboxNotArrivedRows, 'notices', inboxNotices, '| all=1 rows', allRows, 'not arrived', allNotArrived, '| my-day', day, dayHeads);
await sakar.goto('/inbox');
await shot(sakar, 's09-sakar-inbox-top');

for (const p of [shilan, sakar]) problems(p, 'search');
await b.close();
