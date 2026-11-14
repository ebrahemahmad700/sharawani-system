// Admin as itadmin, only on users and rooms created here. Temporary password flow end to end.
import { launch, close, as, note, shot, notice, invalidField, MARK, toKu, BASE, saveJson, signIn } from './lib.mjs';

const b = await launch();
const { page: it } = await as('itadmin');
const R = { mark: MARK, users: {}, rooms: {} };
const m = MARK.toLowerCase();

// ---- Rooms first (users need a room)
async function createRoom(v) {
  await it.goto('/admin/rooms');
  for (const [k, val] of Object.entries(v)) {
    if (k === 'kind') await it.selectOption('form[action="/admin/rooms"] #kind', val);
    else await it.fill(`form[action="/admin/rooms"] #${k}`, val);
  }
  const inv = await invalidField(it, 'form[action="/admin/rooms"]');
  if (inv) return { invalid: inv };
  await it.click('form[action="/admin/rooms"] button[type=submit]'); await it.waitForLoadState('domcontentloaded');
  return { url: it.url(), notices: await notice(it) };
}
const code = `REC${m.replace(/[^a-z0-9]/g, '').toUpperCase()}`.slice(0, 14);
let r = await createRoom({ name: `ژووری تاقیکردنەوە ${MARK}`, code: `${code}A`, room_number: toKu('77'), kind: 'office', default_due_days: '5' });
note('admin-rooms', 'create A', r);
r = await createRoom({ name: `ژووری بێ کتاب ${MARK}`, code: `${code}B`, room_number: '78', kind: 'office', default_due_days: '2' });
note('admin-rooms', 'create B', r);
for (const [label, v] of [
  ['lowercase code', { name: `هەڵە ${MARK}`, code: `${code.toLowerCase()}c` }],
  ['dash code', { name: `هەڵە ${MARK}`, code: `${code}-C` }],
  ['kurdish code', { name: `هەڵە ${MARK}`, code: 'یاسا' }],
  ['17 chars', { name: `هەڵە ${MARK}`, code: 'ABCDEFGHIJKLMNOPQ' }],
  ['duplicate code', { name: `دووبارە ${MARK}`, code: `${code}A` }],
  ['duplicate fixture code', { name: `دووبارە ${MARK}`, code: 'LEGAL' }],
  ['whitespace name', { name: '   ', code: `${code}D` }],
  ['due days 0', { name: `ماوە سفر ${MARK}`, code: `${code}E`, default_due_days: '0' }],
  ['due days 99', { name: `ماوە ٩٩ ${MARK}`, code: `${code}F`, default_due_days: '99' }],
]) {
  r = await createRoom(v);
  note('admin-rooms', `bad: ${label}`, r);
}
await it.goto('/admin/rooms');
const roomRows = await it.locator('tbody tr').evaluateAll(trs => trs.map(t => ({ text: t.innerText.replace(/\s+/g, ' ').slice(0, 120), action: t.querySelector('form[action^="/admin/rooms/"]')?.getAttribute('action') })));
const mine = roomRows.filter(x => x.text.includes(MARK));
note('admin-rooms', 'my rooms', { mine });
const roomA = /\/admin\/rooms\/(\d+)/.exec(mine.find(x => x.text.includes('تاقیکردنەوە'))?.action ?? '')?.[1];
const roomB = /\/admin\/rooms\/(\d+)/.exec(mine.find(x => x.text.includes('بێ کتاب'))?.action ?? '')?.[1];
R.rooms = { roomA, roomB, code };

// ---- Users of every role
async function createUser(v) {
  await it.goto('/admin/users');
  await it.fill('#full_name', v.full_name);
  await it.fill('#username', v.username);
  await it.selectOption('#role', v.role);
  await it.selectOption('#room_id', v.room ?? '');
  const inv = await invalidField(it, 'form[action="/admin/users"]');
  if (inv) return { invalid: inv };
  await it.click('form[action="/admin/users"] button[type=submit]'); await it.waitForLoadState('domcontentloaded');
  const ns = await notice(it);
  const temp = /وشەی نهێنی کاتی: ([a-z0-9-]+)/.exec(ns.join(' '))?.[1] ?? null;
  return { url: it.url(), notices: ns, temp };
}
const roles = ['room_head', 'room_clerk', 'registry_clerk', 'archive_clerk', 'hr', 'directorate_head', 'deputy_mayor', 'mayor', 'sysadmin'];
for (const role of roles) {
  const u = `${m}.${role.replace('_', '')}`.slice(0, 32);
  r = await createUser({ full_name: `${role} ${MARK}`, username: u, role, room: role === 'sysadmin' ? '' : roomA });
  R.users[role] = { username: u, temp: r.temp };
  note('admin-users', `create ${role}`, { username: u, url: r.url, notices: r.notices, gotTemp: !!r.temp, invalid: r.invalid });
}
await shot(it, 'admin-user-created', { clip: { x: 0, y: 60, width: 1170, height: 200 } });
// the temp password is not in the address, and Back does not show it
note('admin-users', 'temp not in URL', { url: it.url() });
for (const [label, v] of [
  ['clerk without room', { full_name: `بێ ژوور ${MARK}`, username: `${m}.noroom`, role: 'room_clerk', room: '' }],
  ['sysadmin with room', { full_name: `ئای تی ${MARK}`, username: `${m}.itroom`, role: 'sysadmin', room: roomA }],
  ['2 chars', { full_name: `کورت ${MARK}`, username: 'ab', role: 'room_clerk', room: roomA }],
  ['space', { full_name: `بۆشایی ${MARK}`, username: `${m} x`, role: 'room_clerk', room: roomA }],
  ['uppercase', { full_name: `گەورە ${MARK}`, username: `${m}.UPPER`, role: 'room_clerk', room: roomA }],
  ['kurdish', { full_name: `کوردی ${MARK}`, username: 'ئاراس', role: 'room_clerk', room: roomA }],
  ['33 chars', { full_name: `درێژ ${MARK}`, username: `${m}.${'x'.repeat(40)}`.slice(0, 33), role: 'room_clerk', room: roomA }],
  ['duplicate', { full_name: `دووبارە ${MARK}`, username: R.users.room_clerk.username, role: 'room_clerk', room: roomA }],
  ['whitespace full name', { full_name: '   ', username: `${m}.blank`, role: 'room_clerk', room: roomA }],
]) {
  r = await createUser(v);
  note('admin-users', `bad: ${label}`, { username: v.username, invalid: r.invalid, url: r.url, notices: r.notices });
}

// ---- Head and deputy of my room
async function saveRoom(id, v) {
  await it.goto('/admin/rooms');
  const f = it.locator(`form[action="/admin/rooms/${id}"]`);
  if ('head' in v) await f.locator('select[name=head_user_id]').selectOption({ label: v.head });
  if ('deputy' in v) await f.locator('select[name=deputy_user_id]').selectOption({ label: v.deputy });
  for (const k of ['phone_extension', 'department', 'floor_label']) if (k in v) await f.locator(`[name=${k}]`).fill(v[k]);
  await f.locator('button').click(); await it.waitForLoadState('domcontentloaded');
  const row = await it.locator(`tr:has(form[action="/admin/rooms/${id}"])`).innerText();
  const f2 = it.locator(`form[action="/admin/rooms/${id}"]`);
  return { notices: await notice(it), head: await f2.locator('select[name=head_user_id] option:checked').innerText(), deputy: await f2.locator('select[name=deputy_user_id] option:checked').innerText(), ext: await f2.locator('[name=phone_extension]').inputValue(), row: row.replace(/\s+/g, ' ').slice(0, 160) };
}
await it.goto('/admin/rooms');
note('admin-rooms', 'people offered for head of A', { options: await it.locator(`form[action="/admin/rooms/${roomA}"] select[name=head_user_id] option`).allInnerTexts() });
note('admin-rooms', 'head = deputy', await saveRoom(roomA, { head: `room_head ${MARK}`, deputy: `room_head ${MARK}` }));
note('admin-rooms', 'head + deputy', await saveRoom(roomA, { head: `room_head ${MARK}`, deputy: `room_clerk ${MARK}`, phone_extension: toKu('٣١٥').replace(/./g, c => c), department: 'بەڕێوەبەرایەتی تاقیکردنەوە', floor_label: 'نهۆمی ٢' }));
note('admin-rooms', 'ext letters', await saveRoom(roomA, { phone_extension: 'ext 12a' }));
note('admin-rooms', 'ext with dash/parens', await saveRoom(roomA, { phone_extension: '(066) 214-5' }));
note('admin-rooms', 'deputy who is a mayor-role user', await saveRoom(roomA, { head: `room_head ${MARK}`, deputy: `mayor ${MARK}` }));
note('admin-rooms', 'restore deputy', await saveRoom(roomA, { head: `room_head ${MARK}`, deputy: `room_clerk ${MARK}`, phone_extension: '315' }));
await shot(it, 'admin-rooms-mine', { locator: it.locator(`tr:has(form[action="/admin/rooms/${roomA}"])`) });

// ---- Job title and extension
async function contact(username, title, ext) {
  await it.goto('/admin/users');
  const row = it.locator(`tr:has(td.mono:text-is("${username}"))`);
  await row.locator('[name=job_title]').fill(title);
  await row.locator('[name=phone_extension]').fill(ext);
  await row.locator('form[action$="/contact"] button').click(); await it.waitForLoadState('domcontentloaded');
  const row2 = it.locator(`tr:has(td.mono:text-is("${username}"))`);
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
await it.locator(`tr:has(td.mono:text-is("${clerk}")) form[action$="/reset"] button`).click(); await it.waitForLoadState('domcontentloaded');
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
await it.locator(`tr:has(td.mono:text-is("${R.users.room_head.username}")) form[action$="/deactivate"] button`).click(); await it.waitForLoadState('domcontentloaded');
note('admin-deact', 'deactivated', { notices: await notice(it) });
await u3.goto('/inbox');
note('admin-deact', 'open session after deactivate', { url: u3.url() });
await it.goto('/admin/rooms');
note('admin-deact', 'room A after head deactivated', { row: (await it.locator(`tr:has(form[action="/admin/rooms/${roomA}"])`).innerText()).replace(/\s+/g, ' '), headOptions: await it.locator(`form[action="/admin/rooms/${roomA}"] select[name=head_user_id] option`).allInnerTexts(), headSelected: await it.locator(`form[action="/admin/rooms/${roomA}"] select[name=head_user_id] option:checked`).innerText() });
await shot(it, 'admin-room-after-deactivate', { locator: it.locator(`tr:has(form[action="/admin/rooms/${roomA}"])`) });
await it.goto('/admin/users');
await it.locator(`tr:has(td.mono:text-is("${R.users.room_head.username}")) form[action$="/activate"] button`).click(); await it.waitForLoadState('domcontentloaded');
note('admin-deact', 'activated', { notices: await notice(it) });

saveJson('admin.json', R);
console.log('problems', it.problems, u.problems);
await close();
