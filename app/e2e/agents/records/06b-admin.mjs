// Continuation of 06-admin from the contact step (06-admin stopped on a locator).
import { launch, close, as, note, shot, notice, invalidField, toKu, BASE, saveJson, signIn } from './lib.mjs';
const MARK = 'rad1';
const b = await launch();
const { page: it } = await as('itadmin');
const m = 'rad1';
const roomA = '154';
const R = { mark: 'rad1', rooms: { roomA: '154', roomB: '155', junk: '156' }, users: {
  room_head: { username: 'rad1.roomhead', temp: 'q2jh-nwd7-zxna' }, room_clerk: { username: 'rad1.roomclerk', temp: 'dr46-gy8p-rpvf' },
  registry_clerk: { username: 'rad1.registryclerk', temp: 'ggdp-c4sv-6npu' }, archive_clerk: { username: 'rad1.archiveclerk', temp: 'ty7p-x22y-x43w' },
  hr: { username: 'rad1.hr', temp: 'enpq-36kq-ftue' }, directorate_head: { username: 'rad1.directoratehead', temp: 'az6h-bk5g-5hcd' },
  deputy_mayor: { username: 'rad1.deputymayor', temp: 'pf2a-hpcr-cs7e' }, mayor: { username: 'rad1.mayor', temp: '5gk9-drd3-h2bj' }, sysadmin: { username: 'rad1.sysadmin', temp: '9xb3-5dcp-pdas' } } };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const userRow = u => it.locator('tbody tr').filter({ has: it.locator('td.mono', { hasText: new RegExp(`^\\W*${esc(u)}\\W*$`) }) });

// ---- Job title and extension
async function contact(username, title, ext) {
  await it.goto('/admin/users');
  const row = userRow(username);
  await row.locator('[name=job_title]').fill(title);
  await row.locator('[name=phone_extension]').fill(ext);
  await row.locator('form[action$="/contact"] button').click(); await it.waitForLoadState('domcontentloaded');
  const row2 = userRow(username);
  return { notices: await notice(it), title: await row2.locator('[name=job_title]').inputValue(), ext: await row2.locator('[name=phone_extension]').inputValue() };
}
const clerk = R.users.room_clerk.username;
note('admin-users', 'contact kurdish digits', await contact(clerk, 'فەرمانبەری تاقیکردنەوە', '٢١٤'));
note('admin-users', 'contact letters', await contact(clerk, 'فەرمانبەری تاقیکردنەوە', 'abc'));
note('admin-users', 'contact persian digits', await contact(clerk, 'فەرمانبەر', '۲۱۵'));

// ---- Temporary password, forced change, fresh context
const { context: cx, page: u } = await as(null);
await signIn(u, clerk, R.users.room_clerk.temp);
note('admin-temp', 'first sign-in lands on', { url: u.url(), h2: await u.locator('h2').first().innerText().catch(() => null) });
await shot(u, 'admin-forced-change');
await u.goto('/inbox');
note('admin-temp', 'try inbox while forced', { url: u.url() });
const pw = async (current, next, confirm) => {
  await u.goto('/password');
  await u.fill('#current', current); await u.fill('#next', next); await u.fill('#confirm', confirm);
  const inv = await invalidField(u, 'form[action="/password"]');
  if (inv) return { invalid: inv };
  await u.click('form[action="/password"] button'); await u.waitForLoadState('domcontentloaded');
  return { url: u.url(), notices: await notice(u) };
};
const temp = R.users.room_clerk.temp;
note('admin-temp', 'too short (browser)', await pw(temp, 'short1', 'short1'));
await u.goto('/password');
await u.evaluate(() => document.querySelectorAll('input[minlength]').forEach(i => i.removeAttribute('minlength')));
await u.fill('#current', temp); await u.fill('#next', 'short1'); await u.fill('#confirm', 'short1');
await u.click('form[action="/password"] button'); await u.waitForLoadState('domcontentloaded');
note('admin-temp', 'too short (server)', { notices: await notice(u) });
note('admin-temp', 'mismatch', await pw(temp, `newpass-${m}-1`, `newpass-${m}-2`));
note('admin-temp', 'same as old', await pw(temp, temp, temp));
const newPw = `Taqi-${m}-2026!`;
note('admin-temp', 'good change', await pw(temp, newPw, newPw));
await u.goto('/inbox');
note('admin-temp', 'after change inbox', { url: u.url(), title: await u.locator('h1').first().innerText().catch(() => null) });
R.users.room_clerk.password = newPw;
// sign in again in another fresh context with the new password
const { page: u2, context: cx2 } = await as(null);
await signIn(u2, clerk, newPw);
note('admin-temp', 'new password works', { url: u2.url() });
// voluntary change from the name card as the same person, same-as-old check without temp
await u2.goto('/password');
note('admin-temp', 'voluntary page', { h2: await u2.locator('h2').first().innerText() });

// ---- Reset by IT: open sessions end
await it.goto('/admin/users');
await userRow(clerk).locator(`form[action$="/reset"] button`).click(); await it.waitForLoadState('domcontentloaded');
const ns = await notice(it);
const temp2 = /وشەی نهێنی کاتی: ([a-z0-9-]+)/.exec(ns.join(' '))?.[1];
note('admin-reset', 'reset', { gotTemp: !!temp2, url: it.url() });
await it.reload(); // does a reload re-post and issue yet another password?
note('admin-reset', 'reload after reset', { url: it.url(), notices: await notice(it) });
await u2.goto('/my-day');
note('admin-reset', 'open session after reset', { url: u2.url() });
R.users.room_clerk.temp2 = temp2;

// ---- Deactivate: open session ends, activate again
const { page: u3 } = await as(null);
await signIn(u3, R.users.room_head.username, R.users.room_head.temp);
await u3.goto('/password');
const headPw = `Head-${m}-2026!`;
await u3.fill('#current', R.users.room_head.temp); await u3.fill('#next', headPw); await u3.fill('#confirm', headPw);
await u3.click('form[action="/password"] button'); await u3.waitForLoadState('domcontentloaded');
R.users.room_head.password = headPw;
await u3.goto('/inbox');
note('admin-deact', 'head signed in', { url: u3.url() });
await it.goto('/admin/users');
await userRow(R.users.room_head.username).locator(`form[action$="/deactivate"] button`).click(); await it.waitForLoadState('domcontentloaded');
note('admin-deact', 'deactivated', { notices: await notice(it) });
await u3.goto('/inbox');
note('admin-deact', 'open session after deactivate', { url: u3.url() });
await it.goto('/admin/rooms');
note('admin-deact', 'room A after head deactivated', { row: (await it.locator(`tr:has(form[action="/admin/rooms/${roomA}"])`).innerText()).replace(/\s+/g, ' '), headOptions: await it.locator(`form[action="/admin/rooms/${roomA}"] select[name=head_user_id] option`).allInnerTexts(), headSelected: await it.locator(`form[action="/admin/rooms/${roomA}"] select[name=head_user_id] option:checked`).innerText() });
await shot(it, 'admin-room-after-deactivate', { locator: it.locator(`tr:has(form[action="/admin/rooms/${roomA}"])`) });
await it.goto('/admin/users');
await userRow(R.users.room_head.username).locator(`form[action$="/activate"] button`).click(); await it.waitForLoadState('domcontentloaded');
note('admin-deact', 'activated', { notices: await notice(it) });

saveJson('admin.json', R);
console.log('problems', it.problems, u.problems);
await close();
