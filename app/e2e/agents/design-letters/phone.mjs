// Phone crops: the top of each screen (first ~700px) at 390x844.
import { launch, ctxFor, settle, shot } from './lib.mjs';
const SPECS = [
  ['p-inbox', 'aram', '/inbox?room=6'],
  ['p-myday', 'aram', '/my-day'],
  ['p-outgoing', 'shilan', '/outgoing'],
  ['p-search', 'shilan', '/documents?q=' + encodeURIComponent('داواکاری')],
  ['p-registry', 'shilan', '/registry'],
  ['p-new', 'sakar', '/registry/new'],
  ['p-photo', 'shilan', '/registry/photo'],
  ['p-doc', 'sakar', '/documents/542'],
  ['p-doc-closed', 'shilan', '/documents/1519'],
  ['p-reply', 'shilan', '/documents/1528/reply'],
  ['p-barcode-hit', 'shilan', '/barcode?q=20260009665'],
  ['p-manifests', 'sakar', '/manifests'],
  ['p-manifest', 'sakar', '/manifests/59'],
  ['p-tray', 'shilan', '/tray'],
  ['p-tray-312', 'shilan', '/tray/312'],
  ['p-scan', 'shilan', '/scan?to=tray'],
  ['p-notifications', 'shilan', '/notifications'],
  ['p-plots', 'shilan', '/plots'],
  ['p-plot', 'shilan', '/plots?p=240%2F612'],
];
const only = process.argv.slice(2);
const browser = await launch();
const ctxs = {};
for (const [name, user, url] of SPECS) {
  if (only.length && !only.includes(name)) continue;
  ctxs[user] ??= await ctxFor(browser, user, { width: 390, height: 844 });
  const p = await ctxs[user].newPage();
  await p.goto(url); await settle(p); await p.waitForTimeout(500);
  const y = Number(process.env.Y || 0);
  await p.screenshot({ path: shot('crop-390', `${name}.png`), fullPage: true, clip: { x: 0, y, width: 390, height: Number(process.env.HH || 760) } });
  const info = await p.evaluate(() => {
    const cs = e => getComputedStyle(e);
    const card = document.querySelector('main .card');
    const btn = document.querySelector('main .btn');
    const inp = document.querySelector('main input[type=text], main input:not([type]), main textarea, main select');
    return {
      topbarH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
      bodyFs: cs(document.body).fontSize,
      cardPad: card && cs(card).padding, btnPad: btn && cs(btn).padding, btnFs: btn && cs(btn).fontSize,
      inputFs: inp && cs(inp).fontSize, tdFs: document.querySelector('td') && cs(document.querySelector('td')).fontSize,
    };
  });
  console.log(name, JSON.stringify(info));
  await p.close();
}
await browser.close();
