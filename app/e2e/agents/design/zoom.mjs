// Browser zoom, emulated faithfully: a 1366x768 laptop at 150% is a 911x512 CSS
// viewport drawn at device scale 1.5; at 200% it is 683x384 at scale 2.
import { launch, ctxFor, settle, shotPath, loadJson, BASE } from './lib.mjs';
const data = loadJson('data.json');
const D = data.docs;
const SCREENS = [
  ['shilan', '/registry', 'registry'],
  ['shilan', '/registry/new', 'registry-new'],
  ['shilan', `/documents/${D.flow}`, 'doc-flow'],
  ['sakar', `/documents/${D.flow}`, 'doc-flow-holder'],
  ['hemin', '/inbox', 'inbox-legal'],
  ['shilan', '/my-day', 'my-day'],
  ['aram', '/dashboard', 'dashboard'],
  ['shilan', '/tray', 'tray'],
  ['aram', '/archive', 'archive'],
  ['itadmin', '/admin/users', 'admin-users'],
  ['shilan', `/companies/${data.company}`, 'company'],
  ['shilan', '/manifests', 'manifests'],
  ['anon', '/login', 'login'],
];
const BW = Number(process.argv[3] || 1366), BH = Number(process.argv[4] || 768);
const MODES = (process.argv[2] || '150,200').split(',').map(z => ({ z: BW === 1366 ? z : `${BW}-${z}`, W: Math.round(BW / (z / 100)), H: Math.round(BH / (z / 100)), s: z / 100 }));
const browser = await launch();
for (const m of MODES) {
  const ctxs = {};
  for (const [user, path, name] of SCREENS) {
    if (!ctxs[user]) ctxs[user] = user === 'anon'
      ? await browser.newContext({ viewport: { width: m.W, height: m.H }, deviceScaleFactor: m.s, locale: 'ckb', baseURL: BASE })
      : await ctxFor(browser, user, { width: m.W, height: m.H, scale: m.s });
    const page = await ctxs[user].newPage();
    await page.goto(path); await settle(page);
    const cdp = await ctxs[user].newCDPSession(page);
    const { data: png } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const { writeFileSync } = await import('fs');
    writeFileSync(shotPath('zoom', `${m.z}`, `${name}.png`), Buffer.from(png, 'base64'));
    const info = await page.evaluate(() => ({
      ox: document.documentElement.scrollWidth - innerWidth,
      topbar: Math.round(document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0),
      tables: [...document.querySelectorAll('.table-wrap')].filter(t => t.scrollWidth > t.clientWidth + 1).length,
    }));
    console.log(m.z, name, JSON.stringify(info));
    await page.close();
  }
  for (const c of Object.values(ctxs)) await c.close();
}
await browser.close();
