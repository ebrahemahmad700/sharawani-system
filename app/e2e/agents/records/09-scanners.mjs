// Scanners admin (aram): test scanner, bad addresses. Bad ones go on my own room and are switched off after.
import { launch, close, as, note, shot, notice, BASE } from './lib.mjs';

const b = await launch();
const { page: a } = await as('aram');
const MY_ROOM = '155';
await a.goto('/admin/scanners');
const listRows = async () => a.locator('table tbody tr').evaluateAll(ts => ts.map(t => t.innerText.replace(/\s+/g, ' ').slice(0, 160)));
note('scanners', 'initial list', { rows: await listRows(), addTestButton: await a.locator('button', { hasText: 'زیادکردنی سکانەری تاقیکردنەوە' }).count() });
await shot(a, 'scan-admin-initial', { fullPage: true });
if (await a.locator('button', { hasText: 'زیادکردنی سکانەری تاقیکردنەوە' }).count()) {
  await a.locator('button', { hasText: 'زیادکردنی سکانەری تاقیکردنەوە' }).click(); await a.waitForLoadState('domcontentloaded');
  note('scanners', 'added test scanner', { notices: await notice(a) });
}
// test the simulator
const simRow = a.locator('table tbody tr', { hasText: 'سکانەری تاقیکردنەوە (ناو سیستەم)' }).first();
if (await simRow.count()) {
  await simRow.locator('form[action$="/test"] button').click(); await a.waitForLoadState('domcontentloaded');
  note('scanners', 'test simulator', { notices: await notice(a) });
}

async function add(name, code, url, room = MY_ROOM) {
  await a.goto('/admin/scanners');
  await a.fill('#name', name); await a.fill('#code', code); await a.fill('#base_url', url);
  await a.selectOption('#room_id', room);
  const t0 = Date.now();
  await a.click('form[action="/admin/scanners"] button[type=submit]');
  await a.waitForLoadState('domcontentloaded', { timeout: 120000 });
  return { ms: Date.now() - t0, url: a.url().slice(0, 60), notices: await notice(a), keptUrl: await a.inputValue('#base_url').catch(() => null) };
}
const M = 'RREC' + Date.now().toString(36).slice(-3).toUpperCase();
for (const [label, url] of [
  ['public ip', 'http://8.8.8.8/eSCL'],
  ['localhost', 'http://localhost/eSCL'],
  ['127.0.0.1', 'http://127.0.0.1:3000/eSCL'],
  ['ftp', 'ftp://192.168.1.5/eSCL'],
  ['credentials', 'http://admin:secret@192.168.1.5/eSCL'],
  ['query', 'http://192.168.1.5/eSCL?x=1'],
  ['not a url', 'scanner in room 8'],
  ['no scheme', '192.168.1.40/eSCL'],
  ['public name', 'http://example.com/eSCL'],
  ['ipv6 loopback', 'http://[::1]/eSCL'],
  ['decimal loopback', 'http://2130706433/eSCL'],
  ['single-label internal name', 'http://db:5432/eSCL'],
  ['private unreachable', 'http://10.255.255.1/eSCL'],
]) {
  const r = await add(`سکانەری هەڵە ${label}`, `${M}-${label.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`, url);
  note('scanners-bad', label, { input: url, ...r });
}
await shot(a, 'scan-admin-after-bad', { fullPage: true });
// duplicate code
let r = await add('سکانەری دووبارە', `${M}-PUBLICIP`, 'http://192.168.1.77/eSCL');
note('scanners-bad', 'duplicate code', r);
// switch off every scanner I added
await a.goto('/admin/scanners');
const mine = a.locator('table tbody tr', { hasText: M });
const count = await mine.count();
for (let i = 0; i < count; i++) {
  await a.goto('/admin/scanners');
  const row = a.locator('table tbody tr', { hasText: M }).filter({ hasText: 'چالاک' }).filter({ has: a.locator('input[name=active][value="0"]') }).first();
  if (!(await row.count())) break;
  await row.locator('form[action$="/active"] button').click(); await a.waitForLoadState('domcontentloaded');
}
note('scanners', 'my scanners after switching off', { rows: (await listRows()).filter(x => x.includes(M)) });
console.log('problems', a.problems);
await close();
