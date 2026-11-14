// Cropped screenshots of specific regions. Usage: node crops.mjs <width> <spec-name>...
import { launch, ctxFor, settle, shot } from './lib.mjs';

const W = Number(process.argv[2] || 1366);
const H = W < 600 ? 844 : 768;
const only = process.argv.slice(3);

// [name, user, url, selector or clip function, options]
const SPECS = [
  ['inbox-rows', 'hemin', '/inbox', 'main .card table', { rows: 3 }],
  ['inbox-unsent', 'hemin', '/inbox', 'main .card:has(.attach-list)', { maxH: 260 }],
  ['inbox-top', 'hemin', '/inbox', 'main', { maxH: 420 }],
  ['myday-heads', 'aram', '/my-day', 'main', { maxH: 480 }],
  ['outgoing-head', 'shilan', '/outgoing', 'main .card', { maxH: 260 }],
  ['search', 'shilan', '/documents?q=' + encodeURIComponent('داواکاری'), 'main .card', { maxH: 300 }],
  ['search-empty', 'shilan', '/documents', 'main', { maxH: 250 }],
  ['search-none', 'shilan', '/documents?q=zzqqxx', 'main', { maxH: 350 }],
  ['registry', 'shilan', '/registry', 'main .card', { maxH: 300 }],
  ['barcode', 'shilan', '/barcode', 'main', { maxH: 350 }],
  ['barcode-hit', 'shilan', '/barcode?q=20260009665', 'main', { maxH: 800 }],
  ['plots', 'shilan', '/plots', 'main', { maxH: 300 }],
  ['plot-file', 'shilan', '/plots?p=240%2F612', 'main', { maxH: 560 }],
  ['tray', 'shilan', '/tray', 'main .card', { maxH: 300 }],
  ['tray-mine', 'shilan', '/tray', 'main .card >> nth=-1', { maxH: 300 }],
  ['tray-312', 'shilan', '/tray/312', 'main', { maxH: 760 }],
  ['manifests-sakar', 'sakar', '/manifests', 'main', { maxH: 700 }],
  ['manifests-recent', 'sakar', '/manifests', 'main .card >> nth=-1', { maxH: 300 }],
  ['manifest-59', 'sakar', '/manifests/59', 'main', { maxH: 600 }],
  ['notifications', 'shilan', '/notifications', 'main', { maxH: 400 }],
  ['doc-holder', 'sakar', '/documents/542', 'main', { maxH: 1300 }],
  ['doc-closed', 'shilan', '/documents/1519', 'main', { maxH: 1300 }],
  ['doc-cancelled', 'shilan', '/documents/1504', 'main', { maxH: 950 }],
  ['doc-ready', 'shilan', '/documents/1515', 'main', { maxH: 1250 }],
  ['reply', 'shilan', '/documents/1528/reply', 'main', { maxH: 1100 }],
  ['new-shilan', 'shilan', '/registry/new', 'main', { maxH: 1000 }],
  ['new-sakar', 'sakar', '/registry/new', 'main', { maxH: 1000 }],
  ['photo', 'shilan', '/registry/photo', 'main', { maxH: 450 }],
  ['scan', 'shilan', '/scan?to=tray', 'main', { maxH: 520 }],
  ['topbar-inbox', 'hemin', '/inbox', '.topbar', {}],
  ['topbar-registry', 'shilan', '/registry', '.topbar', {}],
  ['topbar-doc', 'shilan', '/documents/1515', '.topbar', {}],
  ['topbar-tray', 'shilan', '/tray', '.topbar', {}],
  ['topbar-new', 'sakar', '/registry/new', '.topbar', {}],
  ['topbar-manifest', 'sakar', '/manifests/59', '.topbar', {}],
  ['myday-hemin', 'hemin', '/my-day', 'main', { maxH: 900 }],
];

const browser = await launch();
const ctxs = {};
for (const [name, user, url, sel, o] of SPECS) {
  if (only.length && !only.includes(name)) continue;
  ctxs[user] ??= await ctxFor(browser, user, { width: W, height: H });
  const p = await ctxs[user].newPage();
  await p.goto(url); await settle(p); await p.waitForTimeout(500);
  const el = p.locator(sel).first();
  const box = await el.boundingBox({ timeout: 5000 }).catch(() => null);
  if (!box) { console.log('no box', name); await p.close(); continue; }
  let h = box.height;
  if (o.rows) {
    const rows = await el.locator('tr').evaluateAll((trs, n) => trs.slice(0, n + 1).reduce((a, t) => a + t.getBoundingClientRect().height, 0), o.rows);
    h = rows;
  }
  if (o.maxH) h = Math.min(h, o.maxH);
  await p.screenshot({ path: shot(`crop-${W}`, `${name}.png`), fullPage: true, clip: { x: box.x, y: box.y + await p.evaluate(() => 0), width: box.width, height: h } });
  console.log('ok', name, Math.round(box.width), Math.round(h));
  await p.close();
}
await browser.close();
