// Keyboard focus: press Tab through a page, record the outline of each focused
// element and take a clipped shot around it.
import { launch, ctxFor, settle, shotPath, loadJson } from './lib.mjs';
const data = loadJson('data.json');
const [user = 'shilan', path = `/documents/${data.docs.registered}`, name = 'doc', max = '45'] = process.argv.slice(2);
const browser = await launch();
const ctx = await ctxFor(browser, user);
const page = await ctx.newPage();
await page.goto(path); await settle(page);
await page.evaluate(() => document.activeElement?.blur());
const seen = [];
for (let i = 0; i < Number(max); i++) {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(60);
  const info = await page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return null;
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return {
      tag: e.tagName, cls: String(e.className).slice(0, 40), text: (e.textContent || e.getAttribute('aria-label') || e.name || '').trim().slice(0, 30),
      outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} off ${s.outlineOffset}`, box: s.boxShadow.slice(0, 40),
      x: r.left, y: r.top, w: r.width, h: r.height, visible: r.width > 0 && r.bottom > 0 && r.top < innerHeight,
    };
  });
  if (!info) continue;
  seen.push(info);
  if (info.visible) {
    const pad = 14;
    const clip = { x: Math.max(0, info.x - pad), y: Math.max(0, info.y - pad), width: Math.min(info.w + pad * 2, 1366 - Math.max(0, info.x - pad)), height: info.h + pad * 2 };
    await page.screenshot({ path: shotPath('focus', name, `${String(i).padStart(2, '0')}-${info.tag}.png`), clip }).catch(() => {});
  }
  console.log(i, info.tag, info.cls, JSON.stringify(info.text), info.outline, info.box);
}
await browser.close();
