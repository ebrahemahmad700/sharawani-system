// Keyboard only: tab order, visible focus, drawer, file pickers, details, traps.
import { launch, ctxFor, HERE, SHOTS, inkPng, PASSWORD } from './lib.mjs';
import { writeFileSync } from 'fs';
import { join } from 'path';

const DOC = process.env.DOC || '1240';
const OUT = [];
const rec = o => { OUT.push(o); console.log(JSON.stringify(o).slice(0, 2500)); };
const browser = await launch();

/** Describe the focused element, and whether focusing it changed any pixels around it. */
async function focusInfo(page, { diff = true } = {}) {
  const info = await page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { el: 'body' };
    const r = a.getBoundingClientRect();
    // For a visually-hidden file input, the visible thing is the label after it.
    const vis = a.classList.contains('file-native') ? a.nextElementSibling : a;
    const vr = vis.getBoundingClientRect();
    const cs = getComputedStyle(vis);
    const sb = document.querySelector('.sidebar');
    const tb = document.querySelector('.topbar');
    const inClosedDrawer = !!(sb && sb.contains(a) && sb.getBoundingClientRect().left >= innerWidth - 1);
    const underTopbar = !!(tb && !tb.contains(a) && getComputedStyle(tb).position === 'sticky' && vr.top < tb.getBoundingClientRect().bottom && vr.bottom > 0);
    const d = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '') + (e.tagName === 'INPUT' ? `[${e.type}]` : '');
    return {
      el: d(a), text: (a.getAttribute('aria-label') || a.textContent || a.value || a.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 30),
      x: Math.round(vr.left), y: Math.round(vr.top), w: Math.round(vr.width), h: Math.round(vr.height),
      offscreen: vr.right <= 0 || vr.left >= innerWidth || vr.bottom <= 0 || vr.top >= innerHeight || vr.width === 0,
      inClosedDrawer, underTopbar,
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow !== 'none',
      focusVisible: a.matches(':focus-visible'),
    };
  });
  if (!diff || info.el === 'body' || info.offscreen) return info;
  // Pixel comparison: focused vs not focused, same clip.
  const pad = 6;
  const vp = page.viewportSize();
  const clip = { x: Math.max(0, info.x - pad), y: Math.max(0, info.y - pad), width: Math.min(vp.width - Math.max(0, info.x - pad), info.w + pad * 2), height: Math.min(vp.height - Math.max(0, info.y - pad), info.h + pad * 2) };
  if (clip.width <= 0 || clip.height <= 0) return info;
  const a = (await page.screenshot({ clip, scale: 'css' })).toString('base64');
  const handle = await page.evaluateHandle(() => document.activeElement);
  await page.evaluate(el => { el.dataset.kbdRefocus = '1'; el.blur(); }, handle);
  const b = (await page.screenshot({ clip, scale: 'css' })).toString('base64');
  await page.evaluate(el => { el.focus({ preventScroll: true }); delete el.dataset.kbdRefocus; }, handle);
  info.changedPixels = await page.evaluate(async ([a, b]) => {
    const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
    const x = c.getContext('2d');
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) n++;
    return n;
  }, [a, b]);
  info.clip = clip;
  return info;
}

async function tabWalk(page, n, { diff = true, shotPrefix = null, reverse = false } = {}) {
  const seq = [];
  let prev = null, same = 0;
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    await page.waitForTimeout(40);
    const f = await focusInfo(page, { diff });
    seq.push(f);
    if (shotPrefix && f.clip && (f.changedPixels ?? 1) < 25) {
      await page.screenshot({ path: join(SHOTS, `${shotPrefix}-${i}.png`), clip: { x: Math.max(0, f.clip.x - 30), y: Math.max(0, f.clip.y - 20), width: Math.min(page.viewportSize().width - Math.max(0, f.clip.x - 30), f.clip.width + 60), height: f.clip.height + 40 }, scale: 'css' });
    }
    const key = `${f.el}|${f.text}|${f.x},${f.y}`;
    if (key === prev) { same++; if (same > 3) { seq.push({ trap: key }); break; } } else same = 0;
    prev = key;
    if (f.el === 'body' && i > 2) break;
  }
  return seq;
}
const brief = seq => seq.map(f => f.trap ? `TRAP ${f.trap}` : `${f.el}«${f.text}»${f.offscreen ? ' OFFSCREEN' : ''}${f.inClosedDrawer ? ' IN-CLOSED-DRAWER' : ''}${f.underTopbar ? ' UNDER-TOPBAR' : ''}${f.changedPixels !== undefined && f.changedPixels < 25 ? ` NO-VISIBLE-FOCUS(${f.changedPixels})` : ''}`);

// ---- desktop 1366 ----------------------------------------------------------
if (!process.env.SKIP_A) {
  const { context, page } = await ctxFor(browser, null, 'd1366');
  await page.goto('/login');
  const seq = await tabWalk(page, 8, { shotPrefix: 'kb-d-login' });
  rec({ where: 'desktop /login', seq: brief(seq) });
  await context.close();
}
{
  const { context, page } = await ctxFor(browser, 'shilan', 'd1366');
  if (!process.env.SKIP_A) {
  await page.goto('/inbox');
  const seq = await tabWalk(page, 30, { shotPrefix: 'kb-d-inbox' });
  rec({ where: 'desktop /inbox first 30 stops', seq: brief(seq), firstContentStop: seq.findIndex(f => f.el && !/nav|bell|sound|topbar|search|whoami|logout/.test(f.el) && f.y > 60 && f.x < 1100) });

  await page.goto(`/documents/${DOC}`);
  const seq2 = await tabWalk(page, 90, { shotPrefix: 'kb-d-letter' });
  rec({ where: `desktop /documents/${DOC}`, count: seq2.length, seq: brief(seq2) });
  }

  // details/summary with keyboard
  await page.goto('/documents/1230');
  const sum = page.locator('#attachments details.attach-more summary').first();
  await sum.focus();
  await page.keyboard.press('Enter');
  const openAfterEnter = await sum.evaluate(s => s.parentElement.open);
  await page.keyboard.press('Tab');
  const nextAfterSummary = await focusInfo(page, { diff: false });
  // file picker with keyboard
  const fileInput = page.locator('#attachments input[type=file]');
  await fileInput.focus();
  const fi = await focusInfo(page);
  let chooser = null;
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null), page.keyboard.press('Space')]);
  chooser = !!fc;
  if (fc) await fc.setFiles([{ name: 'kbd-wrong.png', mimeType: 'image/png', buffer: inkPng(40) }]);
  await page.waitForTimeout(200);
  // Remove it with the keyboard: Tab to the remove button
  let removeReached = null;
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    const f = await focusInfo(page, { diff: i === 0 });
    if (/remove/.test(f.el)) { removeReached = f; break; }
  }
  if (removeReached) await page.keyboard.press('Enter');
  const afterRemove = await page.evaluate(() => ({ files: document.querySelector('#attachments input[type=file]').files.length, focus: document.activeElement.className || document.activeElement.tagName }));
  rec({ where: 'desktop letter: details + file picker', openAfterEnter, nextAfterSummary: nextAfterSummary.el, fileInputFocus: fi, chooserOpenedBySpace: chooser, removeReached, afterRemove });
  await context.close();
}
{
  // Registration form, with the similar-letters panel appearing while typing.
  const { context, page } = await ctxFor(browser, 'shilan', 'd1366');
  await page.goto('/registry/new');
  const seq = await tabWalk(page, 40, { shotPrefix: 'kb-d-register' });
  rec({ where: 'desktop /registry/new', seq: brief(seq) });
  await page.goto('/registry/new');
  await page.locator('#subject').focus();
  await page.keyboard.type('داواکاری مۆڵەتی بیناسازی');
  await page.waitForTimeout(1500);
  const panel = await page.evaluate(() => {
    const slot = document.querySelector('[data-similar-live]');
    const card = slot.querySelector('.card');
    return { shown: !!card, live: slot.getAttribute('aria-live') || slot.closest('[aria-live]')?.getAttribute('aria-live') || null, role: slot.getAttribute('role'), links: card ? card.querySelectorAll('a').length : 0, beforeSubject: card ? !!(card.compareDocumentPosition(document.querySelector('#subject')) & Node.DOCUMENT_POSITION_FOLLOWING) : null, focusStill: document.activeElement.id };
  });
  // Reaching the panel by keyboard: Shift+Tab from subject
  const back = await tabWalk(page, 6, { diff: false, reverse: true });
  rec({ where: 'desktop similar panel', panel, shiftTabFromSubject: brief(back) });
  await context.close();
}
{
  const { context, page } = await ctxFor(browser, 'karwan', 'd1366');
  await page.goto('/archive/new');
  const seq = await tabWalk(page, 30, { shotPrefix: 'kb-d-archive' });
  rec({ where: 'desktop /archive/new', seq: brief(seq) });
  await context.close();
}

// ---- phone 390 with a keyboard ----------------------------------------------
{
  const { context, page } = await ctxFor(browser, 'shilan', 'i390');
  await page.goto('/inbox');
  const seq = await tabWalk(page, 26, { diff: false });
  rec({ where: 'phone /inbox first 26 stops', seq: brief(seq), hiddenStops: seq.filter(f => f.inClosedDrawer || f.offscreen).length });

  // Drawer by keyboard
  await page.goto('/inbox');
  await page.locator('.nav-toggle').focus();
  const toggleFocus = await focusInfo(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => ({ checked: document.querySelector('#nav-toggle').checked, focus: document.activeElement.getAttribute('href'), expanded: document.querySelector('.nav-toggle').getAttribute('aria-expanded') }));
  // Tab past the end of the drawer
  const inDrawer = await tabWalk(page, 22, { diff: false });
  const firstOutside = inDrawer.find(f => f.el && !/nav|whoami|logout|sidebar/.test(f.el) && !(f.el.startsWith('a') && f.x > 100 && f.inClosedDrawer === false && f.y < 844 && f.el === 'a'));
  const escaped = await page.evaluate(() => !document.querySelector('.sidebar').contains(document.activeElement));
  // Now Escape
  await page.locator('.sidebar .nav a').nth(2).focus();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterEsc = await page.evaluate(() => ({ checked: document.querySelector('#nav-toggle').checked, focusInSidebar: document.querySelector('.sidebar').contains(document.activeElement), focus: document.activeElement.getAttribute('href') || document.activeElement.className }));
  const afterEscInfo = await focusInfo(page, { diff: false });
  // Space on the toggle
  await page.locator('.nav-toggle').focus();
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  const spaceOpen = await page.evaluate(() => document.querySelector('#nav-toggle').checked);
  await page.screenshot({ path: join(SHOTS, 'kb-p-drawer-open-focus.png'), scale: 'css' });
  rec({ where: 'phone drawer keyboard', toggleFocus, opened, walkFromFirstLink: brief(inDrawer), focusLeftDrawerWhileOpen: escaped, afterEsc, afterEscOffscreen: afterEscInfo.offscreen || afterEscInfo.inClosedDrawer, spaceOpens: spaceOpen });
  await context.close();
}
{
  // Session-changed alert dialog: can focus leave it?
  const { context, page } = await ctxFor(browser, 'shilan', 'd1366');
  await page.goto('/inbox');
  await page.evaluate(() => { localStorage.setItem('docsys:user', JSON.stringify({ id: '999999', name: 'x', at: Date.now() })); window.dispatchEvent(new StorageEvent('storage', { key: 'docsys:user' })); });
  await page.waitForTimeout(300);
  const dlg = await page.evaluate(() => ({ present: !!document.querySelector('.session-changed'), focus: document.activeElement.textContent.trim().slice(0, 20), modal: document.querySelector('.session-changed')?.getAttribute('aria-modal'), labelled: document.querySelector('.session-changed')?.getAttribute('aria-labelledby') || document.querySelector('.session-changed')?.getAttribute('aria-label') }));
  const walk = await tabWalk(page, 5, { diff: false });
  rec({ where: 'session-changed alertdialog', dlg, tabFromButton: brief(walk), focusEscapesDialog: walk.some(f => f.el && !/btn$/.test(f.el) && f.el !== 'button.btn') });
  await page.screenshot({ path: join(SHOTS, 'kb-d-session-dialog-tab.png'), scale: 'css', clip: { x: 0, y: 0, width: 1366, height: 400 } });
  await page.evaluate(() => localStorage.removeItem('docsys:user'));
  await context.close();
}
writeFileSync(join(HERE, 'keyboard.json'), JSON.stringify(OUT, null, 1));
await browser.close();
