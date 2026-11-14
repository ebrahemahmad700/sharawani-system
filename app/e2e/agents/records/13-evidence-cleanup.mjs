// Evidence for the room-deactivation finding, then switch off what this tester created.
import { launch, close, as, note, shot, notice } from './lib.mjs';

const b = await launch();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { page: it } = await as('itadmin');
const roomRow = id => it.locator(`tr:has(form[action="/admin/rooms/${id}"])`);
await it.goto('/admin/rooms');
note('evidence', 'room A row', { text: (await roomRow(154).innerText()).replace(/\s+/g, ' ').slice(-60), activateButton: await roomRow(154).locator('form[action$="/activate"]').count() });
await shot(it, 'evidence-roomA-inactive', { locator: roomRow(154) });
const { page: s } = await as('shilan');
await s.goto('/my-day');
const row = s.locator('tr', { hasText: 'ه/2026/730' }).first();
note('evidence', 'letter 730 still waiting in room A', { row: (await row.innerText()).replace(/\s+/g, ' ') });
await shot(s, 'evidence-730-in-roomA', { locator: row });
await s.goto('/documents/1251');
note('evidence', 'send list offers room A?', { count: await s.locator('#to_room option', { hasText: 'تاقیکردنەوە rad1' }).count() });

// Tray picker: only 25 newest open letters
const { page: h } = await as('ahang');
await h.goto('/tray');
const item = h.locator('.card:has(h2:text("سکانە نوێیەکان")) tbody tr a').first();
if (await item.count()) {
  await item.click(); await h.waitForLoadState('domcontentloaded');
  const opts = await h.locator('#document_id option').allInnerTexts();
  note('evidence', 'tray picker', { count: opts.length - 1, oldest: opts[opts.length - 1], newest: opts[1], searchBox: await h.locator('aside input[type=text], aside input[type=search]').count() });
  await shot(h, 'evidence-tray-picker', { locator: h.locator('form[action$="/claim"]') });
}

// ---- cleanup
await it.goto('/admin/rooms');
await roomRow(154).locator('form[action$="/activate"] button').click().catch(() => {}); await it.waitForLoadState('domcontentloaded');
await it.goto('/admin/rooms');
if (await roomRow(156).locator('form[action$="/deactivate"]').count()) { await roomRow(156).locator('form[action$="/deactivate"] button').click(); await it.waitForLoadState('domcontentloaded'); }
note('cleanup', 'rooms', { A: (await roomRow(154).innerText()).replace(/\s+/g, ' ').slice(-20), junk: (await (await it.goto('/admin/rooms'), roomRow(156)).innerText()).replace(/\s+/g, ' ').slice(-20) });
await it.goto('/admin/users');
const mine = await it.locator('tbody tr td.mono').evaluateAll(tds => tds.map(t => t.innerText.replace(/[^\x20-\x7e]/g, '').trim()).filter(u => u.startsWith('rad1.')));
for (const u of mine) {
  await it.goto('/admin/users');
  const r = it.locator('tbody tr').filter({ has: it.locator('td.mono', { hasText: new RegExp(`^\\W*${esc(u)}\\W*$`) }) });
  if (await r.locator('form[action$="/deactivate"]').count()) { await r.locator('form[action$="/deactivate"] button').click(); await it.waitForLoadState('domcontentloaded'); }
}
note('cleanup', 'users deactivated', { mine });
const { page: sh } = await as('shilan');
await sh.goto('/admin/doc-types');
const dt = sh.locator('tbody tr', { hasText: 'REC-RDT1' });
if ((await dt.innerText()).includes('ناچالاککردن')) { await dt.locator('form[action$="/toggle"] button').click(); await sh.waitForLoadState('domcontentloaded'); }
note('cleanup', 'doc type', { row: (await sh.locator('tbody tr', { hasText: 'REC-RDT1' }).innerText()).replace(/\s+/g, ' ') });
await close();
