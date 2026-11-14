// Find ids to look at. Only GET requests.
import { launch, signedIn } from './lib.mjs';

const browser = await launch();
const out = {};

{
  const ctx = await signedIn(browser, 'karwan');
  const p = await ctx.newPage();
  await p.goto('/archive');
  out.archive = await p.$$eval('table a[href^="/archive/"]', as => as.slice(0, 8).map(a => [a.getAttribute('href'), a.textContent.trim()]));
  await ctx.close();
}
{
  const ctx = await signedIn(browser, 'aram');
  const p = await ctx.newPage();
  await p.goto('/companies');
  out.companies = await p.$$eval('table a[href^="/companies/"]', as => as.slice(0, 12).map(a => [a.getAttribute('href'), a.textContent.trim()]));
  await ctx.close();
}
{
  const ctx = await signedIn(browser, 'bafrin');
  const p = await ctx.newPage();
  await p.goto('/templates');
  out.templates = await p.$$eval('a[href^="/templates/"]', as => as.slice(0, 12).map(a => [a.getAttribute('href'), a.closest('tr')?.querySelector('td')?.textContent.trim()]));
  out.fills = await p.$$eval('a[href^="/fills/"]', as => as.slice(0, 5).map(a => [a.getAttribute('href'), a.closest('tr')?.querySelector('td')?.textContent.trim()]));
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
