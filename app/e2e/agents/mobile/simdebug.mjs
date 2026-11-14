import { launch, ctxFor } from './lib.mjs';
const browser = await launch();
for (const dev of ['d1366', 'i390']) {
  const { context, page } = await ctxFor(browser, 'shilan', dev);
  const reqs = [];
  page.on('request', r => { if (r.url().includes('similar')) reqs.push(r.url().slice(0, 200)); });
  await page.goto('/registry/new');
  const direct = await page.evaluate(async () => { const r = await fetch('/registry/similar?subject=' + encodeURIComponent('MOBk3elo نامەی تاقیکردنەوەی مۆبایل') + '&sender=&plot='); return { s: r.status, len: (await r.text()).length }; });
  const direct2 = await page.evaluate(async () => { const r = await fetch('/registry/similar?subject=' + encodeURIComponent('MOBk3elo نامەی تاقیکردنەوەی مۆبایل') + '&sender=' + encodeURIComponent('نێردەر MOBk3elo') + '&plot='); return { s: r.status, len: (await r.text()).length }; });
  await page.locator('#subject').click();
  await page.keyboard.type('MOBk3elo نامەی تاقیکردنەوەی مۆبایل');
  await page.locator('#sender_name').click();
  await page.keyboard.type('نێردەر MOBk3elo');
  await page.waitForTimeout(2000);
  const shown = await page.evaluate(() => !!document.querySelector('[data-similar-live] .card'));
  console.log(dev, JSON.stringify({ direct, direct2, reqs, shown }));
  await context.close();
}
await browser.close();
