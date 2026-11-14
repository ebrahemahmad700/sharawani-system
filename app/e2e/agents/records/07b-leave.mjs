// Leave: future dates only (30+ days). Self and others, overlap, end<start, one day, approvals, deputy cover, wording.
import { launch, close, as, note, shot, notice, invalidField, BASE, localDay, signIn, saveJson } from './lib.mjs';


const MARK = 'rad1';
const b = await launch();
const S = localDay;
const rowFor = (p, text) => p.locator('.kv tbody tr', { hasText: text });
async function decide(p, key, decision) {
  await p.goto('/leave');
  const row = rowFor(p, `${MARK} ${key}`).first();
  if (!(await row.count())) return { notVisible: true };
  const btn = row.locator(`button[value=${decision}]`);
  if (!(await btn.count())) return { noButton: true, row: (await row.innerText()).replace(/\s+/g, ' ') };
  await btn.click(); await p.waitForLoadState('domcontentloaded');
  return { notices: await notice(p), row: (await rowFor(p, `${MARK} ${key}`).first().innerText()).replace(/\s+/g, ' ') };
}
const { page: dn } = await as('dana');
await dn.goto('/leave');
note('leave-see', 'dana leave page', { total: await dn.locator('.kv tbody tr').count(), mine: (await dn.locator('.kv tbody tr', { hasText: MARK }).allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 90)), pendingBadge: await dn.locator('nav a[href="/leave"]').innerText().catch(() => null) });
await dn.goto('/notifications');
note('leave-see', 'dana notifications', { items: (await dn.locator('.notif-list li').allInnerTexts()).slice(0, 8).map(t => t.replace(/\s+/g, ' ')) });
const firstLeaveNotif = dn.locator('.notif-list li a', { hasText: 'مۆڵەت' }).first();
if (await firstLeaveNotif.count()) { await firstLeaveNotif.click(); await dn.waitForLoadState('domcontentloaded'); note('leave-see', 'dana opens leave notification', { url: dn.url() }); }
await shot(dn, 'leave-dana-view', { fullPage: true });

const { page: hr } = await as('bafrin');
note('leave-decide', 'bafrin approves G nodeputy', await decide(hr, 'G nodeputy', 'approved'));
note('leave-decide', 'dana rejects H clerk', await decide(dn, 'H clerk', 'rejected'));
note('leave-decide', 'bafrin rejects H clerk', await decide(hr, 'H clerk', 'rejected'));

const { page: a } = await as('aram');
await a.goto('/leave');
for (const k of ['A', 'C same', 'E oneday', 'F head', 'G nodeputy', 'B overlap', 'H clerk']) {
  note('leave-wording', k, { row: (await rowFor(a, `${MARK} ${k}`).first().innerText().catch(() => '—')).replace(/\s+/g, ' ') });
}
await shot(a, 'leave-wording-oneday', { locator: rowFor(a, `${MARK} E oneday`).first() });
await shot(a, 'leave-wording-head', { locator: rowFor(a, `${MARK} F head`).first() });
await shot(a, 'leave-wording-nodeputy', { locator: rowFor(a, `${MARK} G nodeputy`).first() });
await shot(a, 'leave-wording-dupes', { clip: { x: 0, y: 0, width: 1170, height: 900 } });

const { page: rc } = await as(null);
await signIn(rc, `${MARK}.roomclerk`, `Clerk-${MARK}-2026!`);
await rc.goto('/notifications');
note('leave-see', 'room A clerk (deputy) notifications', { url: rc.url(), items: (await rc.locator('.notif-list li').allInnerTexts()).slice(0, 5).map(t => t.replace(/\s+/g, ' ')) });
await rc.goto('/leave');
note('leave-see', 'room A clerk leave page', { h2: await rc.locator('.card h2').nth(1).innerText(), rows: (await rc.locator('.kv tbody tr').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 120)).slice(0, 8), total: await rc.locator('.kv tbody tr').count(), userSelect: await rc.locator('#user_id').count() });
await shot(rc, 'leave-clerk-view', { fullPage: true });
const { page: hd } = await as(null);
await signIn(hd, `${MARK}.roomhead`, `Head-${MARK}-2026!`);
await hd.goto('/notifications');
note('leave-see', 'room A head notifications', { url: hd.url(), items: (await hd.locator('.notif-list li').allInnerTexts()).slice(0, 4).map(t => t.replace(/\s+/g, ' ')) });
await hd.goto('/leave');
note('leave-see', 'room A head leave page', { rows: (await hd.locator('.kv tbody tr').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 120)).slice(0, 5), total: await hd.locator('.kv tbody tr').count() });
const htok = await hd.locator('input[name=_csrf]').first().inputValue();
const forged = await hd.request.post(`${BASE}/leave/new`, { form: { _csrf: htok, user_id: '1', start_date: S(80), end_date: S(80), leave_type: 'annual', note: `${MARK} forged-for-other` }, maxRedirects: 0 });
note('leave-see', 'head forged user_id', { status: forged.status() });
await hd.goto('/leave');
note('leave-see', 'forged row', { row: (await rowFor(hd, 'forged-for-other').first().innerText().catch(() => '—')).replace(/\s+/g, ' ') });
await hr.goto('/notifications');
note('leave-see', 'bafrin notifications', { items: (await hr.locator('.notif-list li').allInnerTexts()).slice(0, 6).map(t => t.replace(/\s+/g, ' ')) });
await hr.goto('/leave');
note('leave-see', 'cancel controls', { buttons: [...new Set(await hr.locator('.kv button').allInnerTexts())] });
console.log('problems', hr.problems, a.problems, rc.problems, hd.problems, dn.problems);
await close();
