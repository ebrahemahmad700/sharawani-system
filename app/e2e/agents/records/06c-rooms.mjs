// Rooms: deactivating a room with active letters, with only an unsent letter, and a head's deactivation.
import { launch, close, as, note, shot, notice, BASE, signIn, registerLetter } from './lib.mjs';

const MARK = 'rad1';
const b = await launch();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { page: it } = await as('itadmin');
const userRow = u => it.locator('tbody tr').filter({ has: it.locator('td.mono', { hasText: new RegExp(`^\\W*${esc(u)}\\W*$`) }) });
const roomRow = id => it.locator(`tr:has(form[action="/admin/rooms/${id}"])`);

// bhead signs in for the first time and registers a letter from room B, not sent anywhere
const { page: bh } = await as(null);
await signIn(bh, `${MARK}.bhead`, 'gfe3-rnhb-ss79');
const bPw = `Bhead-${MARK}-2026!`;
if (bh.url().includes('/password')) {
  await bh.fill('#current', 'gfe3-rnhb-ss79'); await bh.fill('#next', bPw); await bh.fill('#confirm', bPw);
  await bh.click('form[action="/password"] button'); await bh.waitForLoadState('domcontentloaded');
}
const LB = await registerLetter(bh, `کتابی نەنێردراوی ژووری ب ${MARK}`);
note('rooms-deact', 'room B unsent letter', LB);
await bh.goto('/inbox');
note('rooms-deact', 'room B inbox before', { unsent: (await bh.locator('.card:has(h2:text("هێشتا نەنێردراون")) li').allInnerTexts()).map(t => t.replace(/\s+/g, ' ')) });

// Deactivate room A: has an active letter
await it.goto('/admin/rooms');
await roomRow(154).locator('form[action$="/deactivate"] button').click(); await it.waitForLoadState('domcontentloaded');
note('rooms-deact', 'deactivate room A (active letter)', { notices: await notice(it) });
await shot(it, 'rooms-deact-active', { clip: { x: 0, y: 60, width: 1170, height: 110 } });

// Head deactivated: row shows no head; saving the row for an extension change
await it.goto('/admin/users');
await userRow(`${MARK}.bhead`).locator('form[action$="/deactivate"] button').click(); await it.waitForLoadState('domcontentloaded');
await it.goto('/admin/rooms');
note('rooms-head', 'room B row with head deactivated', { head: await roomRow(155).locator('select[name=head_user_id] option:checked').innerText() });
await roomRow(155).locator('[name=phone_extension]').fill('419');
await roomRow(155).locator('form[action="/admin/rooms/155"] button').click(); await it.waitForLoadState('domcontentloaded');
note('rooms-head', 'saved extension', { notices: await notice(it) });
await it.goto('/admin/users');
await userRow(`${MARK}.bhead`).locator('form[action$="/activate"] button').click(); await it.waitForLoadState('domcontentloaded');
await it.goto('/admin/rooms');
note('rooms-head', 'room B head after re-activation', { head: await roomRow(155).locator('select[name=head_user_id] option:checked').innerText(), ext: await roomRow(155).locator('[name=phone_extension]').inputValue() });
await shot(it, 'rooms-head-wiped', { locator: roomRow(155) });
// put the head back
await roomRow(155).locator('select[name=head_user_id]').selectOption({ label: `بەرپرسی ژووری ب ${MARK}` });
await roomRow(155).locator('form[action="/admin/rooms/155"] button').click(); await it.waitForLoadState('domcontentloaded');

// Deactivate room B: only an unsent letter, and staff
await it.goto('/admin/rooms');
await roomRow(155).locator('form[action$="/deactivate"] button').click(); await it.waitForLoadState('domcontentloaded');
note('rooms-deact', 'deactivate room B (unsent letter, staff)', { notices: await notice(it), row: (await roomRow(155).innerText()).replace(/\s+/g, ' ').slice(-40) });
await it.goto('/admin/users');
note('rooms-deact', 'bhead row after room deactivated', { row: (await userRow(`${MARK}.bhead`).innerText()).replace(/\s+/g, ' ').slice(0, 120) });
note('rooms-deact', 'room options in new-user form include B?', { count: await it.locator('#room_id option', { hasText: 'ژووری بێ کتاب' }).count() });

// What bhead sees in an inactive room
await signIn(bh, `${MARK}.bhead`, bPw);
note('rooms-deact', 'bhead signs in', { url: bh.url() });
await bh.goto('/inbox');
note('rooms-deact', 'bhead inbox in inactive room', { title: await bh.locator('h1').first().innerText(), unsent: await bh.locator('.card:has(h2:text("هێشتا نەنێردراون")) li').count(), notices: await notice(bh) });
await bh.goto(`/documents/${LB.id}`);
note('rooms-deact', 'unsent letter page', { url: bh.url(), sendForm: await bh.locator('form[action$="/route"]').count(), roomOptions: await bh.locator('#to_room option').count() });
const r2 = await registerLetter(bh, `کتابی دوای ناچالاکبوون ${MARK}`).catch(e => ({ error: e.message.slice(0, 100), url: bh.url() }));
note('rooms-deact', 'register from inactive room', { r2, notices: await notice(bh) });
// Is room B still offered as a destination to others?
const { page: s } = await as('shilan');
await s.goto(`/documents/1251`);
note('rooms-deact', 'shilan send list has inactive room B?', { count: await s.locator('#to_room option', { hasText: 'ژووری بێ کتاب' }).count() });
const { page: a } = await as('aram');
await a.goto('/rooms');
note('rooms-deact', 'rooms overview has B?', { count: await a.locator('tbody tr', { hasText: 'ژووری بێ کتاب' }).count() });
await a.goto(`/documents/${LB.id}`);
note('rooms-deact', 'mayor sees stranded letter', { url: a.url(), status: await a.locator('.pill').first().innerText().catch(() => null) });
await a.goto(`/inbox?room=155`);
note('rooms-deact', 'mayor inbox of B', { title: await a.locator('h1').first().innerText(), unsent: await a.locator('.card:has(h2:text("هێشتا نەنێردراون")) li').count() });

// Reactivate B
await it.goto('/admin/rooms');
await roomRow(155).locator('form[action$="/activate"] button').click(); await it.waitForLoadState('domcontentloaded');
note('rooms-deact', 'reactivated B', { notices: await notice(it) });
console.log('problems', it.problems, bh.problems, a.problems);
await close();
