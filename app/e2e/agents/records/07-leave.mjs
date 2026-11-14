// Leave: future dates only (30+ days). Self and others, overlap, end<start, one day, approvals, deputy cover, wording.
import { launch, close, as, note, shot, notice, invalidField, BASE, localDay, signIn, saveJson } from './lib.mjs';

const MARK = 'rad1';
const b = await launch();
const R = {};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- setup with IT: a head for room B (no deputy), and the room A clerk's password
const { page: it } = await as('itadmin');
const userRow = u => it.locator('tbody tr').filter({ has: it.locator('td.mono', { hasText: new RegExp(`^\\W*${esc(u)}\\W*$`) }) });
await it.goto('/admin/users');
await it.fill('#full_name', `بەرپرسی ژووری ب ${MARK}`); await it.fill('#username', `${MARK}.bhead`);
await it.selectOption('#role', 'room_head'); await it.selectOption('#room_id', '155');
await it.click('form[action="/admin/users"] button[type=submit]'); await it.waitForLoadState('domcontentloaded');
const bTemp = /وشەی نهێنی کاتی: ([a-z0-9-]+)/.exec((await notice(it)).join(' '))?.[1];
note('leave-setup', 'bhead created', { bTemp: !!bTemp, notices: await notice(it) });
await it.goto('/admin/rooms');
const fB = it.locator('form[action="/admin/rooms/155"]');
await fB.locator('select[name=head_user_id]').selectOption({ label: `بەرپرسی ژووری ب ${MARK}` });
await fB.locator('button').click(); await it.waitForLoadState('domcontentloaded');
note('leave-setup', 'room B head set', { notices: await notice(it) });
// room clerk: reset gave z3pz-pgfg-dws2; change it
const { page: rc } = await as(null);
await signIn(rc, `${MARK}.roomclerk`, 'z3pz-pgfg-dws2');
const rcPw = `Clerk-${MARK}-2026!`;
if (rc.url().includes('/password')) {
  await rc.fill('#current', 'z3pz-pgfg-dws2'); await rc.fill('#next', rcPw); await rc.fill('#confirm', rcPw);
  await rc.click('form[action="/password"] button'); await rc.waitForLoadState('domcontentloaded');
}
note('leave-setup', 'room clerk signed in', { url: rc.url() });

// --- requests
const { page: hr } = await as('bafrin');
async function request(p, { forName = null, start, end, type = 'annual', noteText = '' }) {
  await p.goto('/leave');
  if (forName) await p.locator('#user_id').selectOption({ label: forName });
  await p.fill('#start_date', start); await p.fill('#end_date', end);
  await p.selectOption('#leave_type', type);
  await p.fill('#note', noteText);
  const inv = await invalidField(p, 'form[action="/leave/new"]');
  if (inv) return { invalid: inv };
  await p.click('form[action="/leave/new"] button'); await p.waitForLoadState('domcontentloaded');
  return { url: p.url(), notices: await notice(p) };
}
const rowFor = (p, text) => p.locator('.kv tbody tr', { hasText: text });
const S = localDay;
note('leave', 'bafrin self 35-37', await request(hr, { start: S(35), end: S(37), noteText: `خۆم ${MARK} A` }));
note('leave', 'bafrin self overlap 36-40', await request(hr, { start: S(36), end: S(40), noteText: `خۆم ${MARK} B overlap` }));
note('leave', 'bafrin self identical 35-37', await request(hr, { start: S(35), end: S(37), noteText: `خۆم ${MARK} C same` }));
note('leave', 'end before start', await request(hr, { start: S(50), end: S(45), noteText: `${MARK} D backwards` }));
await shot(hr, 'leave-backwards');
note('leave', 'one day 45', await request(hr, { start: S(45), end: S(45), type: 'necessity', noteText: `${MARK} E oneday` }));
note('leave', 'for room A head 60-62', await request(hr, { forName: `room_head ${MARK}`, start: S(60), end: S(62), noteText: `${MARK} F head` }));
note('leave', 'for room B head (no deputy) 64-65', await request(hr, { forName: `بەرپرسی ژووری ب ${MARK}`, start: S(64), end: S(65), noteText: `${MARK} G nodeputy` }));
note('leave', 'for room A clerk 70-70', await request(hr, { forName: `room_clerk ${MARK}`, start: S(70), end: S(70), type: 'sick', noteText: `${MARK} H clerk` }));

await hr.goto('/leave');
for (const k of ['A', 'B overlap', 'C same', 'E oneday', 'F head', 'G nodeputy', 'H clerk']) {
  note('leave-list', `pending ${k}`, { row: (await rowFor(hr, `${MARK} ${k}`).first().innerText().catch(() => '—')).replace(/\s+/g, ' ') });
}
await shot(hr, 'leave-pending-head', { locator: rowFor(hr, `${MARK} F head`).first() });
await shot(hr, 'leave-pending-nodeputy', { locator: rowFor(hr, `${MARK} G nodeputy`).first() });

// --- decisions
async function decide(p, key, decision) {
  await p.goto('/leave');
  const row = rowFor(p, `${MARK} ${key}`).first();
  const btn = row.locator(`button[value=${decision}]`);
  if (!(await btn.count())) return { noButton: true, row: (await row.innerText()).replace(/\s+/g, ' ') };
  await btn.click(); await p.waitForLoadState('domcontentloaded');
  return { notices: await notice(p), row: (await rowFor(p, `${MARK} ${key}`).first().innerText()).replace(/\s+/g, ' ') };
}
note('leave-decide', 'bafrin approves her own A', await decide(hr, 'A', 'approved'));
const { page: a } = await as('aram');
note('leave-decide', 'aram rejects B overlap', await decide(a, 'B overlap', 'rejected'));
note('leave-decide', 'aram approves C same (overlaps approved A)', await decide(a, 'C same', 'approved'));
const { page: nb } = await as('nabaz');
note('leave-decide', 'nabaz approves E oneday', await decide(nb, 'E oneday', 'approved'));
note('leave-decide', 'aram approves F head', await decide(a, 'F head', 'approved'));
const { page: dn } = await as('dana');
note('leave-decide', 'dana approves G nodeputy', await decide(dn, 'G nodeputy', 'approved'));
note('leave-decide', 'dana rejects H clerk', await decide(dn, 'H clerk', 'rejected'));
// double decision by forged request on an already decided leave
const tok = await a.locator('input[name=_csrf]').first().inputValue();
const leaveIdOf = async (p, key) => p.evaluate(k => { for (const tr of document.querySelectorAll('.kv tbody tr')) if (tr.innerText.includes(k)) return tr; return null; }, `${MARK} A`);
await shot(a, 'leave-after-decisions', { fullPage: true });

// --- wording after approval
await a.goto('/leave');
for (const k of ['A', 'C same', 'E oneday', 'F head', 'G nodeputy', 'B overlap', 'H clerk']) {
  note('leave-wording', k, { row: (await rowFor(a, `${MARK} ${k}`).first().innerText().catch(() => '—')).replace(/\s+/g, ' ') });
}
await shot(a, 'leave-wording-oneday', { locator: rowFor(a, `${MARK} E oneday`).first() });
await shot(a, 'leave-wording-head', { locator: rowFor(a, `${MARK} F head`).first() });

// --- what the requester / deputy / room see
await rc.goto('/notifications');
note('leave-see', 'room A clerk (deputy) notifications', { items: (await rc.locator('.notif-list li').allInnerTexts()).slice(0, 5).map(t => t.replace(/\s+/g, ' ')) });
await rc.goto('/leave');
note('leave-see', 'room A clerk leave page', { h2: await rc.locator('.card h2').nth(1).innerText(), rows: (await rc.locator('.kv tbody tr').allInnerTexts()).map(t => t.replace(/\s+/g, ' ')).slice(0, 8), total: await rc.locator('.kv tbody tr').count(), userSelect: await rc.locator('#user_id').count() });
await shot(rc, 'leave-clerk-view', { fullPage: true });
const { page: hd } = await as(null);
await signIn(hd, `${MARK}.roomhead`, `Head-${MARK}-2026!`);
await hd.goto('/notifications');
note('leave-see', 'room A head notifications', { url: hd.url(), items: (await hd.locator('.notif-list li').allInnerTexts()).slice(0, 4).map(t => t.replace(/\s+/g, ' ')) });
await hd.goto('/leave');
note('leave-see', 'room A head leave page', { rows: (await hd.locator('.kv tbody tr').allInnerTexts()).map(t => t.replace(/\s+/g, ' ')).slice(0, 5), total: await hd.locator('.kv tbody tr').count() });
// non-approver requests for someone else by forging user_id
const htok = await hd.locator('input[name=_csrf]').first().inputValue();
const forged = await hd.request.post(`${BASE}/leave/new`, { form: { _csrf: htok, user_id: '1', start_date: S(80), end_date: S(80), leave_type: 'annual', note: `${MARK} forged-for-other` }, maxRedirects: 0 });
note('leave-see', 'head forged user_id', { status: forged.status() });
await hd.goto('/leave');
note('leave-see', 'forged row', { row: (await rowFor(hd, 'forged-for-other').first().innerText().catch(() => '—')).replace(/\s+/g, ' ') });
// bafrin's bell and notifications
await hr.goto('/notifications');
note('leave-see', 'bafrin notifications', { items: (await hr.locator('.notif-list li').allInnerTexts()).slice(0, 6).map(t => t.replace(/\s+/g, ' ')) });
// a cancel button anywhere?
await hr.goto('/leave');
note('leave-see', 'cancel controls', { buttons: [...new Set(await hr.locator('.kv button').allInnerTexts())] });

console.log('problems', hr.problems, a.problems, rc.problems, hd.problems);
await close();
