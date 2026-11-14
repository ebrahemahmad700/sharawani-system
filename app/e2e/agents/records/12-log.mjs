// Activity log: filters and paging.
import { launch, close, as, note, shot } from './lib.mjs';

const b = await launch();
const { page: a } = await as('aram');
const ids = async p => p.locator('tbody tr td:first-child').evaluateAll(tds => tds.map(t => Number(t.innerText.replace(/\D/g, ''))));

await a.goto('/log');
const p1 = await ids(a);
note('log', 'page 1', { rows: p1.length, first: p1[0], last: p1[p1.length - 1], links: await a.locator('.card .row a.btn').allInnerTexts() });
// some activity happens while reading page 1 (another person opens a few pages)
const { page: s } = await as('shilan');
for (const path of ['/registry', '/companies', '/my-day', '/templates', '/inbox']) await s.goto(path);
await a.locator('a.btn', { hasText: 'کۆنتر' }).click(); await a.waitForLoadState('domcontentloaded');
const p2 = await ids(a);
const dup = p2.filter(x => p1.includes(x));
note('log', 'page 2 after new activity', { url: a.url(), rows: p2.length, first: p2[0], last: p2[p2.length - 1], duplicatesOfPage1: dup.length, expectedFirstBelow: p1[p1.length - 1] });
await shot(a, 'log-page2-top', { clip: { x: 0, y: 60, width: 1170, height: 300 } });

for (const [label, qs] of [['company group', 'action=company.'], ['user shilan', 'user=shilan'], ['user Kurdish name', `user=${encodeURIComponent('شیلان')}`], ['user upper', 'user=Shilan'], ['both', 'action=auth.&user=shilan'], ['page 0', 'p=0'], ['page huge', 'p=99999'], ['page negative', 'p=-5'], ['bad action', 'action=zzz']]) {
  await a.goto(`/log?${qs}`);
  const rows = await a.locator('tbody tr').evaluateAll(ts => ts.slice(0, 3).map(t => t.innerText.replace(/\s+/g, ' ').slice(0, 90)));
  note('log-filter', label, { count: await a.locator('tbody tr').count(), rows, selected: await a.locator('select[name=action] option:checked').innerText(), empty: await a.locator('.empty').count(), links: await a.locator('.card .row a.btn').allInnerTexts() });
}
await a.goto(`/log?user=${encodeURIComponent('شیلان')}`);
await shot(a, 'log-kurdish-user', { clip: { x: 0, y: 60, width: 1170, height: 260 } });

const { page: h } = await as('hemin');
await h.goto('/log');
note('log-roles', 'hemin log', { count: await h.locator('tbody tr').count(), sample: await h.locator('tbody tr').evaluateAll(ts => ts.slice(0, 4).map(t => t.innerText.replace(/\s+/g, ' ').slice(0, 90))) });
const { page: it } = await as('itadmin');
await it.goto('/log');
note('log-roles', 'itadmin log', { count: await it.locator('tbody tr').count(), withLetterNumbers: await it.locator('tbody tr td:nth-child(5) a').count() });
await close();
