// Small edges: short return reason, sequence with one room / gaps, close while a room holds the letter.
import { browser, as, note, register, MARK, shot, problems, noticeText, ROOM, sendTo, seqTo, press, bell, trailText } from './lib.mjs';

const b = await browser();
const shilan = (await as(b, 'shilan')).page;
const sozan = (await as(b, 'sozan')).page;

// short return reasons
for (const reason of ['نا', 'no', 'هەڵە']) {
  const L = await register(shilan, { subject: `${MARK} هۆکاری کورتی گەڕاندنەوە ${reason}`, sender: `هاووڵاتی کورت ${MARK}` });
  await sendTo(shilan, L.id, ROOM.accounts);
  await sozan.goto(`/documents/${L.id}`);
  await sozan.locator('details summary', { hasText: 'بۆ ژووری ئێمە نییە' }).click();
  await sozan.fill('#reason', reason);
  note(`return with reason «${reason}» ->`, await press(sozan, 'form[action$="/return"] button'));
  if (reason === 'نا') await shot(sozan, 's12-short-return-reason');
  sozan.problems.length = 0;
}

// sequence: one room only; rooms 1 and 3 with a gap
const Q = await register(shilan, { subject: `${MARK} ڕیزبەندی بە یەک ژوور`, sender: `هاووڵاتی یەک ${MARK}` });
note('sequence with one room ->', await seqTo(shilan, Q.id, [ROOM.accounts]));
await shilan.goto(`/documents/${Q.id}`);
const sel = shilan.locator('select[name=seq_room]');
await sel.nth(0).selectOption(ROOM.accounts);
await sel.nth(2).selectOption(ROOM.land);
note('sequence rooms 1 and 3 (gap) ->', await press(shilan, 'form:has(input[name=mode][value=sequence]) button[type=submit]'));
note('Q trail', await trailText(shilan));

// close from the front desk while accounts holds the letter
const C = await register(shilan, { subject: `${MARK} داخستن کاتێک ژوورێک کتابەکەی لایە`, sender: `هاووڵاتی داخستن زوو ${MARK}` });
await sendTo(shilan, C.id, ROOM.land);
await shilan.goto(`/documents/${C.id}`);
await shilan.fill('#recipient', 'هاووڵاتی');
note('close while land holds it ->', await press(shilan, 'form[action$="/close"] button'));
const hersh = (await as(b, 'hersh')).page;
note('hersh bell about C', (await bell(hersh)).filter(s => s.includes('داخستن کاتێک')).slice(0, 3));
await hersh.goto('/inbox');
note('hersh inbox lists C', await hersh.locator('table tbody tr', { hasText: 'داخستن کاتێک' }).count());

for (const p of [shilan, sozan, hersh]) problems(p, 'edges');
await b.close();
