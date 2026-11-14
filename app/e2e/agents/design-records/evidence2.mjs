import { launch, signedIn } from './lib.mjs';
const browser = await launch();
const lines = el => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; };
{
  const ctx = await signedIn(browser, 'aram');
  const p = await ctx.newPage();
  await p.goto('/companies/93');
  console.log('company doc date cell', await p.evaluate(() => { const td = document.querySelectorAll('main table')[1].querySelector('tbody td:nth-child(3)'); const r = document.createRange(); r.selectNodeContents(td); return { text: td.textContent.trim(), w: Math.round(td.getBoundingClientRect().width), lines: new Set([...r.getClientRects()].map(x => Math.round(x.top))).size }; }));
  await p.goto('/dashboard');
  console.log('dashboard oldest cells wrapped', await p.evaluate(() => { const tds = [...document.querySelectorAll('.grid.cols-2 table tbody td:nth-child(4)')]; return tds.filter(td => { const r = document.createRange(); r.selectNodeContents(td); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1; }).length + ' of ' + tds.length; }));
  await ctx.close();
}
{
  const ctx = await signedIn(browser, 'karwan');
  const p = await ctx.newPage();
  await p.goto('/archive/new');
  console.log('archive/new gap between grid rows (field bottom -> next field top)', await p.evaluate(() => { const g = document.querySelectorAll('.grid.cols-3'); const a = g[0].querySelector('.field input').getBoundingClientRect().bottom; const f1 = g[0].querySelector('.field:nth-child(2)'); const inp = f1.querySelector('input').getBoundingClientRect().bottom; const next = g[1].querySelector('label').getBoundingClientRect().top; return Math.round(next - inp); }));
  console.log('archive/new gap stacked (owner field after grid)', await p.evaluate(() => { const g = document.querySelectorAll('.grid.cols-3')[1]; const inp = g.querySelector('input').getBoundingClientRect().bottom; const next = document.querySelector('#owner_names').closest('.field').querySelector('label').getBoundingClientRect().top; return Math.round(next - inp); }));
  await ctx.close();
}
{
  const ctx = await signedIn(browser, 'itadmin');
  const p = await ctx.newPage();
  await p.goto('/admin/users');
  console.log('users form stacked gap', await p.evaluate(() => Math.round(document.querySelector('label[for=role]').getBoundingClientRect().top - document.querySelector('#username').closest('.field').querySelector('.hint').getBoundingClientRect().bottom)));
  await ctx.close();
}
await browser.close();
