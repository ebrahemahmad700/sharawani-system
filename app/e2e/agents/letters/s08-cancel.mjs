// Cancel: who is offered, who can do it, what the cancelled letter looks like everywhere.
import { browser, as, note, register, MARK, shot, locShot, problems, noticeText, ROOM, sendTo, seqTo, press, myDay, bell, trailText, sleep } from './lib.mjs';

const b = await browser();
const shilan = (await as(b, 'shilan')).page;
const aram = (await as(b, 'aram')).page;
const hemin = (await as(b, 'hemin')).page;
const sakar = (await as(b, 'sakar')).page;
const sozan = (await as(b, 'sozan')).page;

const offered = async (p, id) => { await p.goto(`/documents/${id}`); return p.locator('details.danger-zone form[action$="/cancel"]').count(); };

// letters
const plot = `C-${Math.floor(Math.random() * 9000 + 1000)}/7`;
const X1 = await register(shilan, { subject: `${MARK} هەڵوەشاندنەوە لەلایەن سەرۆکی شارەوانی`, sender: `هاووڵاتی هەڵوەشاندن ${MARK}`, plot });
await sendTo(shilan, X1.id, ROOM.accounts);
await sozan.goto(`/documents/${X1.id}`); // accounts opens it
const X2 = await register(hemin, { subject: `${MARK} نامەی ژووری یاسا کە نەنێردراوە`, sender: 'ژووری یاسا' });
const X3 = await register(sakar, { subject: `${MARK} نامەی ساکار کە نەنێردراوە`, sender: 'ژووری یاسا' });
const X4 = await register(hemin, { subject: `${MARK} نامەی ژووری یاسا کە نێردراوە`, sender: 'ژووری یاسا' });
await sendTo(hemin, X4.id, ROOM.accounts);

note('offered X1 (front desk letter, in accounts): aram', await offered(aram, X1.id), 'shilan', await offered(shilan, X1.id), 'hemin', await offered(hemin, X1.id), 'sakar', await offered(sakar, X1.id), 'sozan (holding)', await offered(sozan, X1.id));
note('offered X2 (legal, unsent, by hemin): hemin', await offered(hemin, X2.id), 'sakar', await offered(sakar, X2.id));
note('offered X3 (legal, unsent, by sakar): sakar', await offered(sakar, X3.id), 'hemin', await offered(hemin, X3.id));
note('offered X4 (legal, sent): hemin', await offered(hemin, X4.id));

// forged cancel by sakar on X3 and by hemin on X4 (real requests with the page's own token)
for (const [p, id] of [[sakar, X3.id], [hemin, X4.id], [sozan, X1.id]]) {
  await p.goto(`/documents/${id}`);
  const r = await p.evaluate(async id => {
    const csrf = document.body.getAttribute('data-csrf');
    const res = await fetch(`/documents/${id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `_csrf=${encodeURIComponent(csrf)}&reason=${encodeURIComponent('هەوڵی دەستکرد')}`, redirect: 'follow' });
    return { status: res.status, url: res.url };
  }, id);
  note(`forged cancel by ${p.who} on ${id} ->`, r, decodeURIComponent(r.url.split('error=')[1] ?? ''));
}

// hemin cancels X2 (allowed)
await hemin.goto(`/documents/${X2.id}`);
await hemin.locator('details.danger-zone summary').click();
await hemin.fill('#cancel_reason', 'بە هەڵە تۆمارکرا');
note('hemin cancels X2 ->', await press(hemin, 'details.danger-zone button'));

// whitespace-only reason
await aram.goto(`/documents/${X1.id}`);
await aram.locator('details.danger-zone summary').click();
await aram.fill('#cancel_reason', '   ');
note('aram cancel X1 with blank reason ->', await press(aram, 'details.danger-zone button'));
// aram cancels X1 while accounts holds it
await aram.goto(`/documents/${X1.id}`);
await aram.locator('details.danger-zone summary').click();
await aram.fill('#cancel_reason', 'دووجار تۆمارکرابوو');
note('aram cancels X1 ->', await press(aram, 'details.danger-zone button'));
await shot(aram, 's08-X1-cancelled-aram', { fullPage: true });
note('X1 page after cancel: cards', (await aram.locator('.card h2').allTextContents()).map(s => s.trim()).join(' | '), 'receipt button', await aram.locator('a[href$="/receipt"]').count(), 'reply button', await aram.locator('header a', { hasText: 'وەڵام' }).count());
note('X1 trail', await trailText(aram));

// what the holding room sees
note('sozan bell after cancel', (await bell(sozan)).slice(0, 2));
await sozan.goto('/inbox');
note('sozan inbox still lists X1?', await sozan.locator('table tbody tr', { hasText: `${MARK} هەڵوەشاندنەوە لەلایەن` }).count());
await sozan.goto(`/documents/${X1.id}`);
note('sozan X1 page: status', await sozan.locator('.card .pill').first().textContent(), 'complete form', await sozan.locator('form[action$="/complete"]').count(), 'notes form', await sozan.locator('form[action$="/notes"]').count());
await shot(sozan, 's08-X1-sozan-view', { fullPage: true });
await sozan.goto('/my-day');
note('sozan my-day lists X1?', await sozan.locator('table tbody tr', { hasText: `${MARK} هەڵوەشاندنەوە لەلایەن` }).count());
await shilan.goto('/my-day');
note('shilan my-day lists X1?', await shilan.locator('table tbody tr', { hasText: `${MARK} هەڵوەشاندنەوە لەلایەن` }).count());

// search, register, plots, outgoing, barcode
await shilan.goto(`/documents?q=${encodeURIComponent(X1.no)}`);
note('search by number X1', (await shilan.locator('table tbody tr').allTextContents()).map(s => s.replace(/\s+/g, ' ')).slice(0, 3));
await shilan.goto(`/registry?q=${encodeURIComponent(MARK + ' هەڵوەشاندنەوە')}`);
note('registry list X1', (await shilan.locator('table tbody tr').allTextContents()).map(s => s.replace(/\s+/g, ' ')).slice(0, 3));
await shilan.goto(`/plots?p=${encodeURIComponent(plot)}`);
note('plots file for X1', (await shilan.locator('.card').first().innerText()).replace(/\s+/g, ' '), '| stats', await shilan.locator('.stats .stat').evaluateAll(ss => ss.map(s => s.innerText.replace(/\s+/g, ' '))), '| rows', (await shilan.locator('table tbody tr').allTextContents()).map(s => s.replace(/\s+/g, ' ')));
await shot(shilan, 's08-plots-cancelled', { fullPage: true });
await shilan.goto('/outgoing');
note('outgoing lists X1?', await shilan.locator('table tbody tr', { hasText: `${MARK} هەڵوەشاندنەوە لەلایەن` }).count());
await shilan.goto(`/documents/${X1.id}`);
const bc = (await shilan.locator('tr:has(th:text("بارکۆد")) td').textContent()).trim();
await shilan.goto(`/barcode?q=${bc}`);
note('barcode X1', (await shilan.locator('.card table tr').allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' | '), 'buttons', (await shilan.locator('.card a.btn').allTextContents()).join(','));

// receipt still printable for a cancelled letter; similar panel ignores cancelled
const rp = await shilan.context().newPage();
const rr = await rp.goto(`/documents/${X1.id}/receipt`);
note('receipt of cancelled X1: http', rr.status(), 'pin shown', (await rp.locator('.slip .pin b').textContent().catch(() => '')).trim());
await rp.close();

// the reply composer for a cancelled letter (room head / front desk) by address
await shilan.goto(`/documents/${X1.id}/reply`);
note('reply composer of cancelled X1 as shilan: http title', (await shilan.locator('header h1').textContent()).trim(), 'save form', await shilan.locator('form[action$="/reply"] button').count(), 'close form', await shilan.locator('form[action$="/reply/send"]').count());

// cancel a letter mid-sequence
const X5 = await register(shilan, { subject: `${MARK} هەڵوەشاندنەوە لە ناوەڕاستی ڕیزبەندی`, sender: `هاووڵاتی ڕیز هەڵوەشاندن ${MARK}` });
await seqTo(shilan, X5.id, [ROOM.accounts, ROOM.land, ROOM.legal]);
await sozan.goto(`/documents/${X5.id}`);
await press(sozan, 'form[action$="/complete"] button');
await shilan.goto(`/documents/${X5.id}`);
await shilan.locator('details.danger-zone summary').click();
await shilan.fill('#cancel_reason', 'داواکار پاشگەز بووەوە');
note('shilan cancels X5 mid-sequence ->', await press(shilan, 'details.danger-zone button'));
note('X5 trail', await trailText(shilan));

for (const p of [shilan, aram, hemin, sakar, sozan]) problems(p, 'cancel');
console.log(JSON.stringify({ X1, X2, X3, X4, X5, plot, bc }));
await b.close();
