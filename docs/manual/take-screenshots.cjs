// One picture of every screen, for the manual. Signed in as the role that owns
// the screen, at a desk-sized window, cropped to the content rather than the
// whole page so the pictures stay readable when printed.
const { chromium } = require('C:/Users/Ibrahim/Desktop/sharawani_system/app/e2e/node_modules/playwright');
const fs = require('fs');

const BASE = 'http://localhost:3111';
const PW = 'guhare-2026';
const OUT = process.argv[2];

// name, path, who, how much of the page to keep (px)
const SHOTS = [
  ['login',        '/login',                 null,     700],
  ['dashboard',    '/dashboard',             'aram',   1250],
  ['inbox',        '/inbox',                 'hemin',  900],
  ['myday',        '/my-day',                'hemin',  900],
  ['registry',     '/registry',              'shilan', 900],
  ['registry-new', '/registry/new',          'shilan', 1100],
  ['document',     null,                     'shilan', 1400],   // filled in below
  ['reply',        null,                     'shilan', 900],
  ['compare',      null,                     'shilan', 1500],
  ['case',         null,                     'shilan', 900],
  ['margin',       null,                     'aram',   1000],
  ['stamp',        null,                     'shilan', 1000],
  ['outgoing',     '/outgoing',              'shilan', 800],
  ['search',       '/documents?q=%D8%A8%DB%8C%D9%86%D8%A7%D8%B3%D8%A7%D8%B2%DB%8C', 'shilan', 900],
  ['plots',        '/plots',                 'hersh',  900],
  ['map',          '/plots/map',             'hersh',  900],
  ['archive',      '/archive',               'karwan', 800],
  ['tray',         '/tray',                  'shilan', 800],
  ['barcode',      '/barcode',               'shilan', 600],
  ['manifests',    '/manifests',             'shilan', 900],
  ['companies',    '/companies',             'shilan', 800],
  ['templates',    '/templates',             'bafrin', 800],
  ['leave',        '/leave',                 'bafrin', 900],
  ['rooms',        '/rooms',                 'aram',   900],
  ['report',       '/reports/weekly',        'aram',   1100],
  ['alerts',       '/alerts',                'aram',   900],
  ['doctypes',     '/admin/doc-types',       'shilan', 900],
  ['users',        '/admin/users',           'itadmin', 900],
  ['adminrooms',   '/admin/rooms',           'itadmin', 800],
  ['scanners',     '/admin/scanners',        'aram',   700],
  ['board',        '/board',                 'aram',   800],
  ['notifications', '/notifications',        'hemin',  800],
  ['log',          '/log',                   'aram',   900],
  ['assistant',    '/assistant',             'aram',   700],
  ['track',        '/track',                 null,     700],
  ['verify',       '/verify',                null,     700],
];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ baseURL: BASE, locale: 'ckb', viewport: { width: 1340, height: 1000 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  let who = null;

  async function signIn(user) {
    if (who === user) return;
    await ctx.clearCookies();
    await page.goto('/login');
    if (user) {
      await page.fill('#username', user);
      await page.fill('#password', PW);
      await Promise.all([page.waitForURL(u => !/^\/(login)?$/.test(new URL(u).pathname), { timeout: 30000 }), page.click('button[type=submit]')]);
    }
    who = user;
  }

  // A letter with scans, both marks and a trail, chosen once rather than hunted for.
  const docId = process.argv[3] || '1908';
  await signIn('shilan');
  await page.goto('/documents/' + docId);
  const stampHref = await page.locator('a[href$="/stamp"]').first().getAttribute('href').catch(() => null);
  console.log('letter for the pictures:', docId, '| stamp page:', stampHref);

  const paths = {
    document: '/documents/' + docId,
    reply: '/documents/' + docId + '/reply',
    compare: '/documents/' + docId + '/compare',
    case: '/documents/' + docId + '/case',
    margin: '/documents/' + docId + '/margin',
    stamp: stampHref || '/documents/' + docId,
  };

  const made = [];
  for (const [name, path, user, height] of SHOTS) {
    const url = path || paths[name];
    try {
      await signIn(user);
      const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(name === 'map' || name === 'compare' || name === 'margin' || name === 'stamp' ? 4200 : 1100);
      const full = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.screenshot({
        path: `${OUT}/shot-${name}.png`,
        clip: { x: 0, y: 0, width: 1340, height: Math.min(height, full) },
      });
      made.push(`${name} ${res ? res.status() : '?'}`);
    } catch (e) {
      made.push(`${name} FAILED ${e.message.slice(0, 40)}`);
    }
  }
  console.log(made.join('\n'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
