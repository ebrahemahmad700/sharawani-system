// The assistant (aram): questions checked against the screens.
import { launch, close, as, note, shot, notice, BASE, fromKu } from './lib.mjs';

const b = await launch();
const { page: a } = await as('aram');
const n = s => Number(fromKu(String(s ?? '').replace(/[^\d٠-٩-]/g, '')) || 0);

await a.goto('/assistant');
note('assistant', 'page', { intro: (await a.locator('.card p.muted').first().innerText()).replace(/\s+/g, ' ') });
let conv = null;
async function ask(qText) {
  await a.goto(conv ? '/assistant?c=' + conv : '/assistant');
  await a.fill('form[action="/assistant/ask"] input[name=q]', qText);
  const t0 = Date.now();
  const [resp] = await Promise.all([
    a.waitForResponse(r => r.url().endsWith('/assistant/ask') && r.request().method() === 'POST', { timeout: 120000 }),
    a.click('form[action="/assistant/ask"] button'),
  ]);
  await a.waitForLoadState('domcontentloaded');
  const ms = Date.now() - t0;
  if (await a.locator('input[name=conversation]').count()) conv = await a.locator('input[name=conversation]').inputValue();
  const bubbles = await a.locator('.card div[style*="max-width:78%"]').allInnerTexts();
  const answer = (bubbles[bubbles.length - 1] ?? '').replace(/\s+/g, ' ');
  const linkEl = a.locator('a.btn.secondary', { hasText: 'بینینی تەواو' });
  const link = (await linkEl.count()) ? await linkEl.getAttribute('href') : null;
  return { ms, status: resp.status(), answer, link };
}

// Letters: a known one from this session, a front-desk letter, a number that does not exist
const Q = [
  ['where known letter', 'کتابی ٧٤٣ لای کێیە؟'],
  ['where with prefix', 'ه/2026/743 لە کوێیە'],
  ['bare number', '٧٣٠'],
  ['missing number', 'کتابی ٩٩٩٩٩ لای کێیە؟'],
  ['room queue legal', 'چی لە ژووری یاسا چاوەڕوانە؟'],
  ['room queue front desk', 'چی لە ژووری هات و دەرچوو چاوەڕوانە؟'],
  ['overdue', 'کام ژوور دواکەوتووە؟'],
  ['on leave', 'کێ لە مۆڵەتە؟'],
  ['today count', 'ئەمڕۆ چەند کتاب هاتووە؟'],
  ['week count', 'ئەم هەفتەیە چەند کتاب هاتووە؟'],
  ['month count', 'ئەم مانگە چەند کتاب دەرچووە؟'],
  ['company licence (outside)', 'مۆڵەتی کۆمپانیای ئاسۆ کەی بەسەردەچێت؟'],
  ['weather (outside)', 'کەشوهەوای سبەی لە ڕانیە چۆنە؟'],
  ['salary (outside)', 'مووچەی شیلان عومەر چەندە؟'],
  ['plot drawing', 'نەخشەی پارچەی 8567/7 لە کوێیە؟'],
  ['english', 'how many letters arrived today?'],
];
const out = {};
for (const [label, qText] of Q) {
  out[label] = await ask(qText);
  note('assistant-q', label, { q: qText, ...out[label] });
}
await shot(a, 'assistant-conversation', { fullPage: true });

// Check against screens
await a.goto('/dashboard');
const tiles = Object.fromEntries(await a.locator('.stats .stat').evaluateAll(ss => ss.map(s => [s.querySelector('.k').innerText.trim(), s.querySelector('.n').innerText.trim()])));
note('assistant-check', 'dashboard tiles', tiles);
await a.goto('/rooms');
const rooms = await a.locator('tbody tr').evaluateAll(trs => trs.map(t => ({ name: t.cells[0].innerText.trim(), pending: t.cells[2].innerText.trim(), status: t.cells[4].innerText.trim(), href: t.querySelector('a')?.getAttribute('href') })));
const legal = rooms.find(r => r.name.includes('یاسا'));
const desk = rooms.find(r => r.name.includes('هات و دەرچوو'));
note('assistant-check', 'legal and front desk on /rooms', { legal, desk, lateRooms: rooms.filter(r => /دواکەوتوو/.test(r.status)) });
await a.goto(legal.href);
note('assistant-check', 'legal inbox tile', { open: await a.locator('.stats .stat').first().innerText() });
await a.goto('/leave');
note('assistant-check', 'leave page approved now', { rows: (await a.locator('.kv tbody tr', { hasText: 'لە مۆڵەتدایە' }).allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 100)) });
await a.goto('/documents?q=' + encodeURIComponent('ه/2026/743'));
note('assistant-check', 'search 743', { row: (await a.locator('tbody tr').first().innerText().catch(() => '')).replace(/\s+/g, ' ') });

// Reload after an answer re-sends the question?
await a.goto('/assistant');
await a.fill('form[action="/assistant/ask"] input[name=q]', 'کام ژوور دواکەوتووە؟');
await Promise.all([a.waitForResponse(r => r.url().endsWith('/assistant/ask')), a.click('form[action="/assistant/ask"] button')]); await a.waitForLoadState('domcontentloaded');
const before = await a.locator('.card div[style*="max-width:78%"]').count();
await a.reload(); await a.waitForLoadState('domcontentloaded');
note('assistant-misc', 'reload after asking', { url: a.url(), bubblesBefore: before, bubblesAfter: await a.locator('.card div[style*="max-width:78%"]').count() });

// nabaz may ask; dler may not
const { page: d } = await as('dler');
const r = await d.goto('/assistant');
note('assistant-misc', 'dler /assistant', { status: r.status() });
console.log('problems', a.problems);
await close();
