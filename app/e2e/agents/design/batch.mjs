// node batch.mjs WxH [filter]  — top-of-page shots (and a full-page copy) for every screen in SCREENS.
import { launch, ctxFor, shotPath, settle, loadJson, BASE } from './lib.mjs';

const data = loadJson('data.json');
const D = data.docs;
export const SCREENS = [
  ['anon', '/login', 'login'],
  ['shilan', '/login', 'login-signed-in'],
  ['shilan', '/registry', 'registry'],
  ['shilan', '/registry/new', 'registry-new'],
  ['shilan', '/inbox', 'inbox'],
  ['shilan', '/my-day', 'my-day'],
  ['shilan', '/outgoing', 'outgoing'],
  ['shilan', `/documents?q=${data.mark}`, 'search'],
  ['shilan', '/documents?q=zzzznothing', 'search-empty'],
  ['shilan', '/plots?p=247/5', 'plot'],
  ['shilan', '/plots', 'plots'],
  ['shilan', '/tray', 'tray'],
  ['shilan', data.tray, 'tray-item'],
  ['shilan', '/barcode', 'barcode'],
  ['shilan', '/manifests', 'manifests'],
  ['shilan', '/manifests/46', 'manifest'],
  ['shilan', '/manifests/46/print', 'manifest-print'],
  ['shilan', '/companies', 'companies'],
  ['shilan', `/companies/${data.company}`, 'company'],
  ['shilan', `/companies/${data.company}/edit`, 'company-edit'],
  ['shilan', '/companies/new', 'company-new'],
  ['shilan', '/templates', 'templates'],
  ['shilan', `/templates/${data.template}`, 'template-fill'],
  ['shilan', '/fills/106/print', 'fill-print'],
  ['shilan', '/leave', 'leave-clerk'],
  ['shilan', '/admin/doc-types', 'doc-types'],
  ['shilan', '/notifications', 'notifications'],
  ['shilan', '/password', 'password'],
  ['shilan', `/documents/${D.ready}/reply`, 'reply-draft'],
  ['shilan', `/documents/${D.closed}/reply`, 'reply-sent'],
  ['shilan', `/documents/${D.closed}/reply/print`, 'reply-print'],
  ['shilan', `/documents/${D.registered}/print`, 'print'],
  ['shilan', `/documents/${D.registered}/receipt`, 'receipt'],
  ['shilan', `/documents/${D.registered}`, 'doc-registered'],
  ['shilan', `/documents/${D.flow}`, 'doc-flow'],
  ['shilan', `/documents/${D.ready}`, 'doc-ready'],
  ['shilan', `/documents/${D.closed}`, 'doc-closed'],
  ['shilan', `/documents/${D.cancelled}`, 'doc-cancelled'],
  ['shilan', `/documents/${D.eight}`, 'doc-eight'],
  ['shilan', '/registry/photo', 'photo'],
  ['shilan', '/scan', 'scan'],
  ['shilan', '/this-page-does-not-exist', 'not-found'],
  ['shilan', '/documents/99999999', 'doc-not-found'],
  ['shilan', '/admin/users', 'not-allowed'],
  ['shilan', '/log', 'not-allowed-log'],
  ['aram', '/dashboard', 'dashboard'],
  ['aram', '/rooms', 'rooms'],
  ['aram', '/log', 'log'],
  ['aram', '/archive', 'archive'],
  ['aram', '/admin/scanners', 'scanners'],
  ['aram', '/templates/new', 'template-new'],
  ['aram', '/leave', 'leave-approver'],
  ['aram', '/inbox', 'inbox-mayor'],
  ['karwan', '/archive', 'archive-clerk'],
  ['karwan', data.archive.replace(BASE, '').replace(/\?.*/, ''), 'archive-entry'],
  ['karwan', '/archive/new', 'archive-new'],
  ['itadmin', '/admin/users', 'admin-users'],
  ['itadmin', '/admin/rooms', 'admin-rooms'],
  ['itadmin', '/admin/doc-types', 'admin-doc-types'],
  ['itadmin', '/admin/scanners', 'admin-scanners'],
  ['itadmin', '/log', 'log-it'],
  ['hemin', '/inbox', 'inbox-legal'],
  ['hemin', '/my-day', 'my-day-head'],
  ['sakar', '/leave', 'leave-sakar'],
  ['dana', '/rooms', 'rooms-directorate'],
];

const [size = '1366x768', filter = ''] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const browser = await launch();
const ctxs = {};
for (const [user, path, name] of SCREENS) {
  if (filter && !new RegExp(filter).test(name)) continue;
  if (!path) { console.log('skip', name); continue; }
  if (!ctxs[user]) ctxs[user] = user === 'anon'
    ? await browser.newContext({ viewport: { width: W, height: H }, locale: 'ckb', baseURL: BASE })
    : await ctxFor(browser, user, { width: W, height: H });
  const page = await ctxs[user].newPage();
  page.on('pageerror', e => console.log('  pageerror', name, String(e).slice(0, 200)));
  const r = await page.goto(path).catch(e => null);
  await settle(page);
  await page.screenshot({ path: shotPath('batch', size, `${name}.png`) });
  await page.screenshot({ path: shotPath('batch', size, 'full', `${name}.png`), fullPage: true });
  const m = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent.trim().slice(0, 80),
    sh: document.documentElement.scrollHeight,
    ox: document.documentElement.scrollWidth - window.innerWidth,
    over: [...document.querySelectorAll('.content *, .topbar *')].filter(e => {
      const s = getComputedStyle(e); if (s.overflowX !== 'visible' || e.closest('.table-wrap')) return false;
      return e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName);
    }).length,
  }));
  console.log(r?.status(), name, page.url().replace(BASE, ''), JSON.stringify(m));
  await page.close();
}
await browser.close();
