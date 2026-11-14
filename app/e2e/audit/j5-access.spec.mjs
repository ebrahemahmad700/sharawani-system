// Journey 5: who can open what.
//
// Every person, every screen, by typing its address. Written to access.json and
// compared with the menu: a screen that opens but is not in the menu is a hidden
// page; a menu item that refuses is a dead end; and a handful of screens are
// checked for what they must never show.

import { test } from '@playwright/test';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { as, ok } from './lib.mjs';

const USERS = ['aram', 'nabaz', 'shilan', 'ahang', 'hemin', 'sakar', 'dler', 'rebwar', 'bafrin', 'shne', 'karwan', 'zhyan', 'hersh', 'sozan', 'itadmin'];
const PAGES = ['/dashboard', '/directorate', '/registry', '/registry/new', '/registry/photo', '/inbox', '/my-day', '/outgoing',
  '/documents', '/plots', '/archive', '/archive/new', '/tray', '/scan?to=tray', '/barcode', '/manifests', '/companies',
  '/companies/new', '/templates', '/templates/new', '/leave', '/rooms', '/admin/doc-types', '/admin/users', '/admin/rooms',
  '/admin/scanners', '/board', '/notifications', '/log', '/assistant', '/password', '/find?q=1'];
const OUT = join(process.cwd(), 'audit-output', 'access.json');

test('every person, every screen', async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const table = {};
  for (const u of USERS) {
    const { context, page } = await as(browser, u);
    const nav = await page.$$eval('.sidebar nav a', as => as.map(a => a.getAttribute('href')));
    table[u] = { nav, pages: {} };
    for (const path of PAGES) {
      const r = await page.request.get(path, { maxRedirects: 0 });
      const body = r.status() === 200 ? await r.text() : '';
      table[u].pages[path] = {
        status: r.status(), location: r.headers().location ?? null, inNav: nav.includes(path.split('?')[0]),
        title: /<title>([^<]*)<\/title>/.exec(body)?.[1]?.replace(' — شارەوانی ڕانیە', '') ?? null,
        cacheControl: r.headers()['cache-control'] ?? null,
      };
    }
    await context.close();
  }
  writeFileSync(OUT, JSON.stringify(table, null, 1));

  for (const [u, { pages }] of Object.entries(table)) {
    for (const [path, p] of Object.entries(pages)) {
      if (p.inNav && p.status !== 200 && !(p.status === 303 && path === '/directorate')) {
        await ok(false, `a menu item refuses: ${u} → ${path}`, { detail: p });
      }
    }
  }
  // HTML pages with letters on them should not be kept by the browser after sign-out.
  const reg = table.shilan.pages['/registry'];
  await ok(/no-store/.test(reg.cacheControl ?? ''), 'pages with letters on them are sent without Cache-Control: no-store (Back after sign-out shows them)', { severity: 'security', detail: reg.cacheControl });
});
