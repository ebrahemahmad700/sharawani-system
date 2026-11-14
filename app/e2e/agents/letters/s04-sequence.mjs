// Sequence of four rooms, every action type, what everyone sees; stale pages and two people at once.
import { browser, as, note, register, MARK, shot, problems, noticeText, ROOM, sendTo, seqTo, press, myDay, bell, trailText, sleep } from './lib.mjs';

const b = await browser();
const ppl = {};
for (const u of ['shilan', 'hemin', 'sakar', 'dler', 'rebwar', 'bafrin', 'shne', 'hersh']) ppl[u] = (await as(b, u)).page;
const { shilan, hemin, sakar, dler, rebwar, bafrin, shne, hersh } = ppl;

const subj = `${MARK} ڕیزبەندی چوار ژوور بۆ هەموو کردارەکان`;
const S1 = await register(shilan, { subject: subj, sender: `هاووڵاتی ڕیز ${MARK}` });
note('S1', S1);
note('S1 sequence send ->', await seqTo(shilan, S1.id, [ROOM.legal, ROOM.contracts, ROOM.admin, ROOM.land], { returnToMe: true }));
note('S1 trail', await trailText(shilan));
await shot(shilan, 's04-S1-trail-start', { fullPage: true });

async function look(label) {
  const out = {};
  for (const [u, p] of [['sakar', sakar], ['dler', dler], ['bafrin', bafrin], ['hersh', hersh]]) {
    await p.goto('/inbox');
    const inInbox = await p.locator('table tbody tr', { hasText: subj }).count();
    await p.goto(`/documents?q=${encodeURIComponent(subj)}`);
    const inSearch = await p.locator('table tbody tr', { hasText: subj }).count();
    const n = (await bell(p)).filter(t => t.includes(subj)).length;
    out[u] = `inbox=${inInbox} search=${inSearch} bell=${n}`;
  }
  await shilan.goto('/my-day');
  const w = shilan.locator('table tbody tr', { hasText: subj });
  out.shilanMyDay = (await w.count()) ? (await w.first().innerText()).replace(/\s+/g, ' ') : 'NOT LISTED';
  note(`S1 view @ ${label}`, out);
}
await look('legal active');

// a waiting room opens the letter page directly
await dler.goto(`/documents/${S1.id}`);
note('dler (waiting, contracts) opens S1 page ->', (await dler.locator('header h1').textContent()).trim(), 'complete form', await dler.locator('form[action$="/complete"]').count(), 'send card', await dler.locator('#to_room').count());
await shot(dler, 's04-S1-dler-waiting-view', { fullPage: true });

const actions = [
  [sakar, 'approved', 'ڕەزامەندی یاسایی درا'],
  [dler, 'rejected', 'گرێبەستەکە ڕەتکرایەوە'],
  [shne, 'letter_attached', 'کتابی پەیوەندیدار لکێندرا'],
  [hersh, 'handwritten_reply', 'وەڵامی دەستنووس لەسەر کاغەزەکە'],
];
const labels = ['contracts active', 'admin active', 'land active', 'return leg'];
for (let i = 0; i < actions.length; i++) {
  const [p, action, text] = actions[i];
  await p.goto(`/documents/${S1.id}`);
  if (!(await p.locator('form[action$="/complete"]').count())) { note(`S1 step ${i + 1}: ${p.who} has NO complete form`); continue; }
  await p.selectOption('#action', action);
  await p.fill('#reply_note', text);
  note(`S1 step ${i + 1} ${p.who} ${action} ->`, await press(p, 'form[action$="/complete"] button'));
  await look(labels[i]);
}
note('S1 trail end', await trailText(shilan));
await shilan.goto(`/documents/${S1.id}`);
await shot(shilan, 's04-S1-trail-end', { fullPage: true });
note('shilan bell', (await bell(shilan)).slice(0, 3));
note('S1 shilan complete (no_action) ->', await (async () => {
  await shilan.goto(`/documents/${S1.id}`);
  await shilan.selectOption('#action', 'no_action');
  return press(shilan, 'form[action$="/complete"] button');
})());
note('S1 status', await shilan.locator('.card .pill').first().textContent());
await shilan.goto('/outgoing');
note('S1 in outgoing ready list', await shilan.locator('table tbody tr', { hasText: subj }).count());
for (const [u, p] of Object.entries(ppl)) problems(p, `S1 ${u}`);

// ---------- S2: stale page submitted after the letter moved on ----------
const subj2 = `${MARK} پەڕەی کۆن دوای جوڵانی کتاب`;
const S2 = await register(shilan, { subject: subj2, sender: `هاووڵاتی کۆن ${MARK}` });
note('S2 sequence ->', await seqTo(shilan, S2.id, [ROOM.legal, ROOM.contracts, ROOM.land], { returnToMe: false }));
const tabA = hemin; const tabB = await hemin.context().newPage();
await tabA.goto(`/documents/${S2.id}`);
await tabB.goto(`/documents/${S2.id}`);
await tabA.selectOption('#action', 'approved');
await tabA.fill('#reply_note', 'تابی یەکەم');
note('S2 hemin tab A complete ->', await press(tabA, 'form[action$="/complete"] button'));
await tabB.selectOption('#action', 'rejected');
await tabB.fill('#reply_note', 'تابی دووەم کە کۆن بوو');
note('S2 hemin stale tab B complete ->', await press(tabB, 'form[action$="/complete"] button'));
note('S2 trail after stale submit', await trailText(tabB));
await shot(tabB, 's04-S2-stale-complete', { fullPage: true });
await tabB.close();
await dler.goto('/inbox');
note('dler inbox has S2 (should, it is his turn)?', await dler.locator('table tbody tr', { hasText: subj2 }).count());

// ---------- S3: two people in the same room press complete at the same moment ----------
const subj3 = `${MARK} دوو کەس لە یەک کاتدا تەواو دەکەن`;
const S3 = await register(shilan, { subject: subj3, sender: `هاووڵاتی هاوکات ${MARK}` });
note('S3 sequence ->', await seqTo(shilan, S3.id, [ROOM.contracts, ROOM.admin, ROOM.land], { returnToMe: false }));
await dler.goto(`/documents/${S3.id}`);
await rebwar.goto(`/documents/${S3.id}`);
await dler.fill('#reply_note', 'دلێر');
await rebwar.fill('#reply_note', 'ڕێبوار');
const [r1, r2] = await Promise.all([press(dler, 'form[action$="/complete"] button'), press(rebwar, 'form[action$="/complete"] button')]);
note('S3 simultaneous complete dler / rebwar ->', r1, '/', r2);
note('S3 trail', await trailText(dler));

// ---------- S4: double-click on the complete button ----------
const subj4 = `${MARK} دووجار کرتە لەسەر تەواوکردن`;
const S4 = await register(shilan, { subject: subj4, sender: `هاووڵاتی دووکرتە ${MARK}` });
note('S4 sequence ->', await seqTo(shilan, S4.id, [ROOM.accounts, ROOM.land, ROOM.admin], { returnToMe: false }));
const SZ = await as(b, 'sozan');
await SZ.page.goto(`/documents/${S4.id}`);
await SZ.page.locator('form[action$="/complete"] button').dblclick();
await sleep(2500);
await SZ.page.goto(`/documents/${S4.id}`);
note('S4 trail after dblclick', await trailText(SZ.page));

// ---------- S5: recall by the sender after the first room finished (next room not opened) ----------
const subj5 = `${MARK} گەڕاندنەوە دوای تەواوبوونی هەنگاوی یەکەم`;
const S5 = await register(shilan, { subject: subj5, sender: `هاووڵاتی گەڕاندنەوە ${MARK}` });
note('S5 sequence ->', await seqTo(shilan, S5.id, [ROOM.accounts, ROOM.land], { returnToMe: true }));
await SZ.page.goto(`/documents/${S5.id}`);
note('S5 sozan complete ->', await press(SZ.page, 'form[action$="/complete"] button'));
await shilan.goto(`/documents/${S5.id}`);
note('S5 shilan sees recall button?', await shilan.locator('form[action$="/recall"]').count());
if (await shilan.locator('form[action$="/recall"]').count()) {
  note('S5 shilan recall ->', await press(shilan, 'form[action$="/recall"] button'));
  await shot(shilan, 's04-S5-recall-500');
  shilan.problems.length = 0;
}

// ---------- S6: recall while the room opens it, several tries ----------
for (let i = 0; i < 4; i++) {
  const L = await register(shilan, { subject: `${MARK} گەڕاندنەوە و کردنەوە هاوکات ${i}`, sender: `هاووڵاتی ${MARK} ${i}` });
  await sendTo(shilan, L.id, ROOM.accounts);
  await shilan.goto(`/documents/${L.id}`);
  const [rec, open] = await Promise.all([
    press(shilan, 'form[action$="/recall"] button'),
    SZ.page.goto(`/documents/${L.id}`).then(r => `${r.status()} complete=${'?'}`),
  ]);
  await shilan.goto(`/documents/${L.id}`);
  const t = await trailText(shilan);
  note(`S6 try ${i}: recall -> ${rec} | sozan open -> ${open} | trail`, t);
  shilan.problems.length = 0; SZ.page.problems.length = 0;
}

console.log(JSON.stringify({ S1, S2, S3, S4, S5 }));
await b.close();
