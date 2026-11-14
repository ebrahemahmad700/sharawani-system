// Cross-check the numbers on dashboard, rooms overview, board, inbox, my day, bell, against counts made by hand.
import { launch, close, as, note, shot, notice, BASE, registerLetter, fromKu, signIn, saveJson } from './lib.mjs';

const MARK = 'rnum2';
const b = await launch();
const n = s => Number(fromKu(String(s ?? '').replace(/[^\d٠-٩۰-۹-]/g, '')) || 0);
const { page: a } = await as('aram', { });
const ctxBaghdad = await b.newContext({ viewport: { width: 1400, height: 900 }, baseURL: BASE, locale: 'ckb', timezoneId: 'Asia/Baghdad' });

async function dashboard(p) {
  await p.goto('/dashboard');
  const stats = await p.locator('.stats .stat').evaluateAll(ss => ss.map(s => [s.querySelector('.k').innerText.trim(), s.querySelector('.n').innerText.trim()]));
  const rooms = await p.locator('.card:has(h2:text-is("ژوورەکان")) tbody tr').evaluateAll(trs => trs.map(t => { const c = [...t.cells].map(x => x.innerText.trim()); const href = t.querySelector('a')?.getAttribute('href'); return { id: Number(/room=(\d+)/.exec(href)?.[1]), name: c[0], pending: c[2], status: c[4] }; }));
  const late = await p.locator('.card:has(h2:text("پێویستی بە سەرنجە")) tbody tr').count();
  return { stats: Object.fromEntries(stats.map(([k, v]) => [k, n(v)])), rooms: rooms.map(r => ({ ...r, pending: n(r.pending), late: /دواکەوتوو/.test(r.status) ? n(r.status) : 0 })), lateRows: late };
}
async function roomsPage(p) {
  await p.goto('/rooms');
  return p.locator('tbody tr').evaluateAll(trs => trs.map(t => { const c = [...t.cells].map(x => x.innerText.trim()); return { id: Number(/room=(\d+)/.exec(t.querySelector('a')?.getAttribute('href'))?.[1]), name: c[0], pending: c[2], status: c[4] }; }));
}
async function inboxStats(p, roomId) {
  await p.goto(`/inbox?room=${roomId}`);
  const tiles = await p.locator('.stats .stat').evaluateAll(ss => ss.map(s => [s.querySelector('.k').innerText.trim(), s.querySelector('.n').innerText.trim()]));
  const rows = await p.locator('.card table tbody tr').count();
  const badge = await p.locator('nav a[href="/inbox"]').first().innerText({ timeout: 2000 }).catch(() => null);
  const unsent = await p.locator('.card:has(h2:text("هێشتا نەنێردراون")) li').count();
  return { tiles: tiles.map(([k, v]) => [k, n(v)]), rows, badge, unsent, notices: await notice(p) };
}
async function boardData(p) { const r = await p.request.get(`${BASE}/board/data`); return r.json(); }

// --- 1. before
const board0 = await boardData(a);
const dash0 = await dashboard(a);
note('numbers', 'dashboard before', { stats: dash0.stats, lateRows: dash0.lateRows });
note('numbers', 'board before', { today: board0.today });

// --- 2. my own letters: two registered today, one sent to room B
const { page: s } = await as('shilan');
const L1 = await registerLetter(s, `شمارەی داشبۆرد ${MARK} یەک`);
const L2 = await registerLetter(s, `شمارەی داشبۆرد ${MARK} دوو`);
await s.goto(`/documents/${L2.id}`);
await s.selectOption('#to_room', '155');
await s.click('form[action$="/route"]:has(input[value=single]) button[type=submit]'); await s.waitForLoadState('domcontentloaded');
note('numbers', 'my letters', { L1, L2, sent: await notice(s) });
const board1 = await boardData(a);
note('numbers', 'board after my 2 letters', { before: board0.today, after: board1.today, roomB: board1.rooms.find(r => r.name.includes('بێ کتاب')) });

// --- 3. today's letters counted by hand: numbers are consecutive, find the first one dated today
const seqOf = no => Number(String(no).split('/').pop());
const top = seqOf(L2.no);
async function dateOf(seq) {
  await a.goto(`/documents?q=${encodeURIComponent(`ه/2026/${seq}`)}`);
  const row = a.locator('tbody tr').filter({ hasText: new RegExp(`/${seq}\\b`) }).first();
  if (!(await row.count())) return null;
  return (await row.locator('td').nth(1).innerText()).trim();
}
const todayKu = await dateOf(top);
let lo = 1, hi = top;
while (lo < hi) { const mid = Math.floor((lo + hi) / 2); const d = await dateOf(mid); if (d === todayKu) hi = mid; else lo = mid + 1; }
const firstToday = lo;
const handCount = top - firstToday + 1;
const dash1 = await dashboard(a);
note('numbers', 'today letters: by hand vs dashboard vs board', { firstToday, top, handCount, dashboard: dash1.stats['هاتووی ئەمڕۆ'], board: (await boardData(a)).today.registered, todayKu, dayBefore: await dateOf(firstToday - 1) });

// --- 4. per room: dashboard vs rooms page vs inbox vs board tiles
const roomsP = await roomsPage(a);
const board2 = await boardData(a);
const cmp = [];
for (const r of roomsP) {
  const ib = await inboxStats(a, r.id);
  const open = ib.tiles.find(t => t[0] === 'کراوە')?.[1];
  const late = ib.tiles.find(t => t[0] === 'دواکەوتوو')?.[1];
  const paper = ib.tiles.find(t => t[0] === 'پەڕگەی نەگەیشتوو')?.[1];
  const tile = board2.rooms.find(x => x.name === r.name.replace(/\s*\(.*\)\s*$/, ''));
  const d = dash1.rooms.find(x => x.id === r.id);
  cmp.push({ id: r.id, name: r.name.slice(0, 30), roomsPending: n(r.pending), roomsLate: /دواکەوتوو/.test(r.status) ? n(r.status) : 0, dashPending: d?.pending ?? '-', inboxOpen: open, inboxLate: late, inboxRows: ib.rows, inboxPaper: paper, boardOpen: tile ? Number(tile.open) : '-', boardLate: tile ? Number(tile.late) : '-', boardPaper: tile ? Number(tile.paper_waiting) : '-', unsent: ib.unsent });
}
const mism = cmp.filter(c => c.roomsPending !== c.inboxOpen || (c.boardOpen !== '-' && c.boardOpen !== c.inboxOpen) || c.roomsLate !== c.inboxLate || (c.boardPaper !== '-' && c.boardPaper !== c.inboxPaper) || (c.dashPending !== '-' && c.dashPending !== c.roomsPending) || (c.inboxRows < 100 && c.inboxRows !== c.inboxOpen));
note('numbers', 'per-room comparison mismatches', { rooms: cmp.length, mism });
note('numbers', 'per-room table', { cmp });
const sumLate = cmp.reduce((t, c) => t + c.roomsLate, 0);
const sumOpen = cmp.reduce((t, c) => t + c.roomsPending, 0);
const boardSumLate = board2.rooms.reduce((t, r) => t + Number(r.late), 0);
note('numbers', 'totals', { dashOverdue: dash1.stats['دواکەوتوو لە ژوورەکان'], sumRoomsLate: sumLate, boardLate: board2.today.late, boardSumTilesLate: boardSumLate, lateTableRows: dash1.lateRows, sumOpen, boardInFlow: board2.today.in_flow, boardTiles: board2.rooms.length, roomsListed: roomsP.length });

// room A (inactive, holds a letter): where does it show?
note('numbers', 'inactive room A', { inRoomsPage: roomsP.some(r => r.id === 154), inBoard: board2.rooms.some(r => r.name.includes('تاقیکردنەوە rad1')), inbox: await inboxStats(a, 154) });
await a.goto('/rooms'); await shot(a, 'num-rooms-page', { fullPage: true });
await a.goto('/dashboard'); await shot(a, 'num-dashboard', { fullPage: true });

// waiting for me: executive room
const exec = cmp.find(c => /سەرۆک/.test(c.name));
note('numbers', 'waiting for me vs mayor room inbox', { dash: dash1.stats['چاوەڕوانی بڕیاری من'], execRoom: exec });

// --- 5. my day (nabaz), bell vs notifications page
const { page: nb } = await as('nabaz');
await nb.goto('/my-day');
const myTiles = await nb.locator('.stats .stat').evaluateAll(ss => ss.map(s => [s.querySelector('.k').innerText.trim(), s.querySelector('.n').innerText.trim()]));
const nbInbox = await inboxStats(nb, '');
await nb.goto('/inbox');
const nbInbox2 = await nb.locator('.stats .stat').evaluateAll(ss => ss.map(s => [s.querySelector('.k').innerText.trim(), s.querySelector('.n').innerText.trim()]));
note('numbers', 'nabaz my day vs inbox', { myDay: myTiles.map(([k, v]) => [k, n(v)]), inbox: nbInbox2.map(([k, v]) => [k, n(v)]) });
await nb.goto('/notifications');
await nb.waitForTimeout(3000); const bell = await nb.locator('[data-bell-count]').first().evaluate(e => ({ text: e.textContent, hidden: e.hidden })).catch(() => null);
const unreadOnPage = await nb.locator('.notif-list li.unread').count();
const poll = await (await nb.request.get(`${BASE}/notifications/count`)).json();
note('numbers', 'nabaz bell vs page', { bell, unreadOnPage, totalOnPage: await nb.locator('.notif-list li').count(), apiUnread: poll.unread });
await shot(nb, 'num-bell', { clip: { x: 0, y: 0, width: 1170, height: 70 } });

// --- 6. room B head opens the letter and signs for the paper; counts change?
const { page: bh } = await as(null);
await signIn(bh, 'rad1.bhead', 'Bhead-rad1-2026!');
const bIn = await inboxStats(bh, '');
await bh.goto(`/documents/${L2.id}`);
const paperBtn = bh.locator('form[action$="/paper-received"] button');
if (await paperBtn.count()) { await paperBtn.click(); await bh.waitForLoadState('domcontentloaded'); }
await bh.goto('/inbox');
const bIn2 = await bh.locator('.stats .stat').evaluateAll(ss => ss.map(s => [s.querySelector('.k').innerText.trim(), s.querySelector('.n').innerText.trim()]));
const board3 = await boardData(a);
note('numbers', 'room B after paper signed', { before: bIn.tiles, after: bIn2.map(([k, v]) => [k, n(v)]), boardTile: board3.rooms.find(r => r.name.includes('بێ کتاب')), sidebarBadge: await bh.locator('nav a[href="/inbox"]').innerText() });
await bh.goto('/my-day');
note('numbers', 'room B head my day', { tiles: (await bh.locator('.stats .stat').evaluateAll(ss => ss.map(s => s.innerText.replace(/\s+/g, ' ')))) });

// --- 7. board page itself and time zone
const pb = await ctxBaghdad.newPage();
await signIn(pb, 'aram');
await pb.goto('/board');
await pb.waitForTimeout(4000);
const boardFigs = await pb.locator('.figures .fig').evaluateAll(fs => fs.map(f => f.innerText.replace(/\s+/g, ' ')));
const feed = await pb.locator('[data-feed] li').evaluateAll(ls => ls.slice(0, 3).map(l => l.innerText.replace(/\s+/g, ' ')));
const clock = await pb.locator('[data-clock]').innerText();
note('numbers', 'board page (browser in Baghdad time)', { boardFigs, feed, clock, browserNow: await pb.evaluate(() => new Date().toString()) });
await shot(pb, 'num-board', { fullPage: false });
await pb.goto('/dashboard');
const feedDash = await pb.locator('.card:has(h2:text("دوایین چالاکییەکان")) tbody tr').evaluateAll(ts => ts.slice(0, 3).map(t => t.innerText.replace(/\s+/g, ' ')));
note('numbers', 'dashboard activity times (same browser)', { feedDash });
await shot(pb, 'num-dashboard-times', { locator: pb.locator('.card:has(h2:text("دوایین چالاکییەکان"))') });
await pb.goto('/log');
note('numbers', 'log times', { first: (await pb.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ').slice(0, 120) });

saveJson('numbers.json', { L1, L2, cmp, dash0, dash1, board2 });
console.log('problems', a.problems, s.problems, nb.problems);
await close();
