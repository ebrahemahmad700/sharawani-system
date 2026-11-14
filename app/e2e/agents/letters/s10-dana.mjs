// Directorate head (dana): what she sees and can do across rooms.
import { browser, as, note, register, MARK, shot, locShot, problems, noticeText, ROOM, sendTo, seqTo, press, myDay, bell, trailText, sleep } from './lib.mjs';

const b = await browser();
const dana = (await as(b, 'dana')).page;
const aram = (await as(b, 'aram')).page;
const shilan = (await as(b, 'shilan')).page;

const roomsTable = async p => {
  await p.goto('/rooms');
  return p.locator('table tbody tr').evaluateAll(trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()).filter(s => !s.includes('تاقیکردنەوە')));
};
const dr = await roomsTable(dana);
const ar = await roomsTable(aram);
note('dana /rooms', dr);
note('aram /rooms', ar);
await shot(dana, 's10-dana-rooms', { fullPage: true });

const switcher = async p => { await p.goto('/inbox'); return p.locator('.topbar-rooms option').evaluateAll(os => os.map(o => o.textContent.trim())); };
note('dana room switcher', await switcher(dana));

// dana opens each fixture room's inbox by the link on /rooms
for (const [name, id, who] of [['accounts', ROOM.accounts, 'sozan'], ['legal', ROOM.legal, 'sakar'], ['land', ROOM.land, 'hersh'], ['contracts', ROOM.contracts, 'dler']]) {
  await dana.goto(`/inbox?room=${id}`);
  const t = await dana.locator('.stats .stat').evaluateAll(ss => ss.map(s => s.innerText.replace(/\s+/g, ' ')));
  const rows = await dana.locator('.content > .card:last-child table tbody tr').count();
  const { page: own, context } = await as(b, who);
  await own.goto('/inbox');
  const t2 = await own.locator('.stats .stat').evaluateAll(ss => ss.map(s => s.innerText.replace(/\s+/g, ' ')));
  note(`inbox ${name}: dana sees tiles`, t.slice(0, 3), 'rows', rows, `| ${who} sees tiles`, t2.slice(0, 3), '| title', (await dana.locator('header h1').textContent()).trim());
  await context.close();
}
await dana.goto(`/inbox?room=${ROOM.accounts}`);
await shot(dana, 's10-dana-accounts-inbox');

// a letter in land (dana's own room) and one in another room
const L1 = await register(shilan, { subject: `${MARK} نامە بۆ زەوی و زار بۆ دانا`, sender: `هاووڵاتی دانا ${MARK}` });
await sendTo(shilan, L1.id, ROOM.land);
const L2 = await register(shilan, { subject: `${MARK} نامە بۆ ژمێریاری کە دانا دەیبینێت`, sender: `هاووڵاتی دانا دوو ${MARK}` });
await sendTo(shilan, L2.id, ROOM.accounts);
note('dana bell (L1 arrived in land?)', (await bell(dana)).filter(s => s.includes(MARK)).slice(0, 2));
await dana.goto(`/documents/${L1.id}`);
note('dana opens L1 (land): complete form', await dana.locator('form[action$="/complete"]').count(), 'send card', await dana.locator('#to_room').count(), 'cancel', await dana.locator('details.danger-zone').count(), 'paper btn', await dana.locator('form[action$="/paper-received"]').count());
const r2 = await dana.goto(`/documents/${L2.id}`);
note('dana opens L2 (accounts, not routed via land): http', r2.status(), (await dana.locator('header h1').textContent()).trim());
await dana.goto(`/documents?q=${encodeURIComponent(MARK + ' نامە بۆ ژمێریاری')}`);
note('dana search finds L2?', await dana.locator('table tbody tr').count());

// dana completes L1 as land, forwards to legal
await dana.goto(`/documents/${L1.id}`);
note('dana forwards L1 to legal ->', await sendTo(dana, L1.id, ROOM.legal));
note('dana my-day', await myDay(dana));
note('L1 trail', await trailText(dana));

for (const p of [dana, aram, shilan]) problems(p, 'dana');
console.log(JSON.stringify({ L1, L2 }));
await b.close();
