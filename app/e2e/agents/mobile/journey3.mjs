// Similar-letters panel on a phone; file error announcements; the photo screen.
import { launch, ctxFor, overflow, shot, shotAround, mark, inkPng, HERE } from './lib.mjs';
import { join } from 'path';

const M = mark();
const browser = await launch();
const rec = o => console.log(JSON.stringify(o).slice(0, 1500));

{
  const { context, page } = await ctxFor(browser, 'shilan', 'i390');
  await page.goto('/registry/new');
  // Scroll so the subject field is near the top of the visible area, as it is while typing.
  await page.fill('#subject', 'MOBk3elo نامەی تاقیکردنەوەی مۆبایل');
  await page.waitForTimeout(800);
  await page.locator('#sender_name').evaluate(e => e.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -200));
  await page.tap('#sender_name');
  const before = await page.locator('#sender_name').boundingBox();
  await page.keyboard.type('نێردەر MOBk3elo');
  await page.waitForTimeout(1600);
  const after = await page.locator('#sender_name').boundingBox();
  const panel = await page.evaluate(() => {
    const slot = document.querySelector('[data-similar-live]');
    const card = slot.querySelector('.card');
    const r = card?.getBoundingClientRect();
    return { shown: !!card, ariaLive: slot.getAttribute('aria-live'), role: slot.getAttribute('role'), panelTop: r && Math.round(r.top), panelH: r && Math.round(r.height), scrollY, focus: document.activeElement.id, senderTop: Math.round(document.querySelector('#sender_name').getBoundingClientRect().top), tbBottom: Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom), ih: innerHeight };
  });
  rec({ check: 'similar panel while typing on phone', before, after, panel, fieldMovedBy: after && before ? Math.round(after.y - before.y) : null });
  await shot(page, 'sim-i390-while-typing');
  // With the keyboard up (400px tall), where is the field now?
  await page.setViewportSize({ width: 390, height: 400 });
  await page.waitForTimeout(200);
  const kb = await page.evaluate(() => { const r = document.querySelector('#sender_name').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), ih: innerHeight, tb: Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom) }; });
  rec({ check: 'similar panel, keyboard up', kb });
  await shot(page, 'sim-i390-keyboard-up');
  await context.close();
}

{
  // A wrong file type on the archive form: is the error announced?
  const { context, page } = await ctxFor(browser, 'karwan', 'i390');
  await page.goto('/archive/new');
  await page.locator('#file').setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
  await page.waitForTimeout(200);
  const err = await page.evaluate(() => {
    const e = document.querySelector('#file').parentElement.querySelector('.file-error');
    return { text: e.textContent, hidden: e.hidden, role: e.getAttribute('role'), live: e.getAttribute('aria-live') || e.closest('[aria-live]')?.getAttribute('aria-live') || null, describedby: document.querySelector('#file').getAttribute('aria-describedby'), invalid: document.querySelector('#file').getAttribute('aria-invalid') };
  });
  rec({ check: 'file type error semantics', err });
  await shotAround(page, page.locator('#file').locator('xpath=..'), 'file-error-i390', { above: 10, height: 190 });
  await context.close();
}

{
  // The photo screen on a phone: take a "photo", then register.
  const { context, page } = await ctxFor(browser, 'shilan', 'i390');
  await page.goto('/registry/photo');
  const cap = await page.$eval('#photo', i => ({ capture: i.getAttribute('capture'), accept: i.accept }));
  await page.locator('#photo').setInputFiles([{ name: `IMG_${M}.png`, mimeType: 'image/png', buffer: inkPng(400) }]);
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.locator('form[action="/registry/photo"] button[type=submit]').tap()]);
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
  const o = await overflow(page);
  const url = page.url();
  await page.screenshot({ path: join(HERE, 'shots', 'photo-i390-result.png'), fullPage: true, scale: 'css' });
  let reg = null;
  if (await page.locator('form[action="/registry/new"] #subject').count()) {
    await page.fill('#subject', `${M} وێنەی مۆبایل`);
    await page.fill('#sender_name', `نێردەر ${M}`);
    await Promise.all([page.waitForNavigation({ timeout: 30000 }), page.locator('form[action="/registry/new"] button[type=submit]').last().tap()]);
    await page.waitForLoadState('load');
    if (!/\/documents\/\d+/.test(page.url()) && await page.locator('input[name=confirm_similar]').count()) await Promise.all([page.waitForNavigation({ timeout: 30000 }), page.locator('form[action="/registry/new"] button[type=submit]').last().tap()]);
    await page.waitForLoadState('load');
    reg = { url: page.url(), notice: await page.locator('.content > .notice').textContent().catch(() => null), attachments: await page.locator('#attachments .attach-list li').count() };
  }
  rec({ check: 'photo screen', cap, url, sw: o.sw, iw: o.iw, offenders: o.offenders.slice(0, 3), reg });
  await context.close();
}
await browser.close();
