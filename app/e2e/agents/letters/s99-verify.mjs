// Re-verify the main findings against the current server, with evidence screenshots (v-*.png).
import { browser, as, note, register, MARK, shot, locShot, problems, noticeText, ROOM, sendTo, seqTo, press, bell, trailText, inkPng, sleep } from './lib.mjs';

const b = await browser();
const shilan = (await as(b, 'shilan')).page;
const hemin = (await as(b, 'hemin')).page;
const sozan = (await as(b, 'sozan')).page;
const hersh = (await as(b, 'hersh')).page;
const dler = (await as(b, 'dler')).page;
const aram = (await as(b, 'aram')).page;
const out = {};

// V1 stale complete completes the next room's step
{
  const L = await register(shilan, { subject: `${MARK} V1 پەڕەی کۆن`, sender: `V1 ${MARK}` });
  await seqTo(shilan, L.id, [ROOM.accounts, ROOM.land, ROOM.admin], { returnToMe: false });
  const t2 = await sozan.context().newPage();
  await sozan.goto(`/documents/${L.id}`); await t2.goto(`/documents/${L.id}`);
  await press(sozan, 'form[action$="/complete"] button');
  await t2.selectOption('#action', 'rejected'); await t2.fill('#reply_note', 'V1 stale tab');
  const r = await press(t2, 'form[action$="/complete"] button');
  await t2.goto(`/documents/${L.id}`);
  out.V1 = { id: L.id, r, trail: await trailText(t2) };
  await locShot(t2.locator('ol.trail'), 'v1-stale-complete-trail');
  await t2.close();
}
// V2 recall after forwarding
{
  const L = await register(shilan, { subject: `${MARK} V2 گەڕاندنەوە دوای ناردن`, sender: `V2 ${MARK}` });
  await sendTo(shilan, L.id, ROOM.accounts);
  await sozan.goto(`/documents/${L.id}`);
  const SZ = sozan; // sozan is room head of accounts: forwards
  await sendTo(SZ, L.id, ROOM.land);
  await SZ.goto(`/documents/${L.id}`);
  const r = await press(SZ, 'form[action$="/recall"] button');
  out.V2 = { id: L.id, r };
  await shot(SZ, 'v2-recall-after-forward-500');
  SZ.problems.length = 0;
}
// V3 send to own room
{
  const L = await register(shilan, { subject: `${MARK} V3 ناردن بۆ ژووری خۆم`, sender: `V3 ${MARK}` });
  out.V3 = { id: L.id, r: await sendTo(shilan, L.id, ROOM.desk) };
  shilan.problems.length = 0;
}
// V4 reply draft lost when closing from the letter page
{
  const L = await register(shilan, { subject: `${MARK} V4 ڕەشنووس`, sender: `V4 ${MARK}` });
  await shilan.goto(`/documents/${L.id}/reply`);
  await shilan.fill('#body', 'V4 دەقی تەواوی وەڵام کە بە وردی نووسرا');
  await press(shilan, 'form[action$="/reply"] button[type=submit]');
  await shilan.goto(`/documents/${L.id}#close`);
  await shilan.fill('#recipient', 'هاووڵاتی');
  const r = await press(shilan, 'form[action$="/close"] button');
  const replyRow = await shilan.locator('tr:has(th:text("وەڵامی نێردراو"))').count();
  const pp = await shilan.context().newPage();
  await pp.goto(`/documents/${L.id}/reply/print`);
  out.V4 = { id: L.id, r, replyRow, printBody: (await pp.locator('.body').innerText()).trim(), nos: (await pp.locator('.nos').innerText()).replace(/\s+/g, ' ') };
  await pp.close();
}
// V5 a room head who does not hold the letter sends it away
{
  const L = await register(shilan, { subject: `${MARK} V5 بردنی کتاب لە ژوورێکی تر`, sender: `V5 ${MARK}` });
  await seqTo(shilan, L.id, [ROOM.accounts, ROOM.land], { returnToMe: true });
  await sozan.goto(`/documents/${L.id}`); // accounts opens it: it is theirs now
  await hersh.goto(`/documents/${L.id}`);
  const card = await hersh.locator('#to_room').count();
  const r = await sendTo(hersh, L.id, ROOM.legal);
  await hersh.goto(`/documents/${L.id}`);
  out.V5 = { id: L.id, card, r, trail: await trailText(hersh) };
  await locShot(hersh.locator('ol.trail'), 'v5-pulled-trail');
  await sozan.goto('/inbox');
  out.V5.sozanInbox = await sozan.locator('table tbody tr', { hasText: 'V5 بردنی' }).count();
  out.V5.sozanBell = (await bell(sozan)).filter(s => s.includes('V5')).map(s => s.slice(0, 40));
}
// V6 photo screen "تر"
{
  await shilan.goto('/registry/photo');
  await shilan.setInputFiles('#photo', { name: `v6-${MARK}.png`, mimeType: 'image/png', buffer: inkPng(230) });
  await Promise.all([shilan.waitForLoadState('domcontentloaded'), shilan.click('form[action="/registry/photo"] button[type=submit]')]);
  await shilan.waitForLoadState('domcontentloaded');
  await shilan.fill('#subject', `${MARK} V6 وێنە`); await shilan.fill('#sender_name', `V6 ${MARK}`);
  await shilan.selectOption('#sender_kind', 'other');
  out.V6 = await press(shilan, 'form[action="/registry/new"] button[type=submit]');
  await shot(shilan, 'v6-photo-other-500');
  shilan.problems.length = 0;
}
// V7 short return reason
{
  const L = await register(shilan, { subject: `${MARK} V7 هۆکاری کورت`, sender: `V7 ${MARK}` });
  await sendTo(shilan, L.id, ROOM.accounts);
  await sozan.goto(`/documents/${L.id}`);
  await sozan.locator('details summary', { hasText: 'بۆ ژووری ئێمە نییە' }).click();
  await sozan.fill('#reason', 'نا');
  out.V7 = await press(sozan, 'form[action$="/return"] button');
  sozan.problems.length = 0;
}
// V8 sender receives her own delivery list
{
  const L = await register(shilan, { subject: `${MARK} V8 لیستی گەیاندن`, sender: `V8 ${MARK}` });
  await sendTo(shilan, L.id, ROOM.contracts);
  await shilan.goto('/manifests');
  const g = shilan.locator('.card', { hasText: 'ناردن بۆ گرێبەستە' });
  const bx = g.locator('input[name=document_id]');
  for (let i = 0; i < await bx.count(); i++) if (await bx.nth(i).getAttribute('value') !== String(L.id)) await bx.nth(i).uncheck();
  await g.locator('input[name=courier]').fill(`V8 ${MARK}`);
  await press(shilan, '.card:has-text("ناردن بۆ گرێبەستە") button[type=submit]');
  const url = shilan.url().replace(/\?.*$/, '');
  await shot(shilan, 'v8-manifest-sender-sees-receive');
  const r = await press(shilan, 'form[action$="/receive"] button');
  await dler.goto(`/documents/${L.id}`);
  out.V8 = { id: L.id, url, r, dlerPaper: (await dler.locator('tr:has(th:text("پەڕگەی کاغەزی")) td').innerText()).replace(/\s+/g, ' ') };
}
// V9 barcode screen, full number
{
  await shilan.goto('/barcode?q=' + encodeURIComponent('ه/2026/79'));
  out.V9 = await noticeText(shilan);
  await shot(shilan, 'v9-barcode-ambiguous');
}
// V10 mayor sequence refused while letter is in his room
{
  const L = await register(shilan, { subject: `${MARK} V10 سەرۆک`, sender: `V10 ${MARK}` });
  await sendTo(shilan, L.id, ROOM.mayor);
  await aram.goto(`/documents/${L.id}`);
  out.V10 = await seqTo(aram, L.id, [ROOM.legal, ROOM.land]);
}
// V11 chase from the letter page: no message
{
  const L = await register(shilan, { subject: `${MARK} V11 بەدواداچوون`, sender: `V11 ${MARK}` });
  await sendTo(shilan, L.id, ROOM.accounts);
  await shilan.goto(`/documents/${L.id}`);
  const r = await press(shilan, 'form[action$="/chase"] button');
  out.V11 = { r, url: shilan.url() };
  await shot(shilan, 'v11-chase-no-message');
}
note('VERIFY', out);
for (const p of [shilan, hemin, sozan, hersh, dler, aram]) problems(p, 'verify');
await b.close();
