import { launch, ctxFor, SHOTS } from './lib.mjs';
import { join } from 'path';
const browser = await launch();
const { context, page } = await ctxFor(browser, 'shilan', 'd1366');
await page.goto('/documents/1230');
const targets = [
  ['sidebar-link', '.sidebar .nav a:nth-child(3)'],
  ['logout', '.sidebar .logout-btn'],
  ['whoami-link', '.sidebar .whoami-link'],
  ['topbar-search', '.topbar-search input'],
  ['primary-btn', '.topbar-tools a.btn:not(.secondary)'],
  ['note-textarea', '#note_body'],
  ['select-kind', '#attachments select[name=kind]'],
  ['file-choose', '#attachments input[type=file]'],
  ['summary-more', '#attachments details.attach-more summary'],
  ['gold-btn', 'button.btn.gold'],
  ['checkbox', 'input[name=return_to_assigner]'],
  ['pill-link', '#attachments .attach-name'],
];
// Put the page in keyboard mode first.
await page.keyboard.press('Tab');
for (const [name, sel] of targets) {
  const loc = page.locator(sel).first();
  if (!(await loc.count())) continue;
  await loc.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await loc.focus();
  await page.waitForTimeout(80);
  const box = await page.evaluate(() => { const a = document.activeElement; const v = a.classList.contains('file-native') ? a.nextElementSibling : a; const r = v.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.screenshot({ path: join(SHOTS, `focus-${name}.png`), clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 12), width: box.w + 32, height: box.h + 24 }, scale: 'device' });
}
await context.close();
await browser.close();
