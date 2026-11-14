// Layout crawl: every main screen at every size. Overflow + small targets + screenshot of first viewport.
import { launch, ctxFor, overflow, smallTargets, shot, DEVICES, HERE } from './lib.mjs';
import { writeFileSync } from 'fs';
import { join } from 'path';

const sizes = (process.env.SIZES || 's360,i390,a412,t768,t1024').split(',');
const onlyUser = process.env.USER_ONLY;

const PLAN = {
  shilan: ['/registry', '/registry/new', '/inbox', '/my-day', '/outgoing', '/documents?q=2026', '/plots', '/tray', '/barcode', '/manifests', '/companies', '/templates', '/leave', '/admin/doc-types', '/notifications', '/registry/photo', '/password', '/scan'],
  hemin: ['/inbox', '/log', '/archive', '/rooms'],
  karwan: ['/archive', '/archive/new'],
  bafrin: ['/leave'],
  aram: ['/dashboard', '/rooms', '/admin/scanners'],
  itadmin: ['/admin/users', '/admin/rooms'],
};

const browser = await launch();
const results = [];
for (const [user, paths] of Object.entries(PLAN)) {
  if (onlyUser && onlyUser !== user) continue;
  for (const size of sizes) {
    const { context, page } = await ctxFor(browser, user, size);
    for (const path of paths) {
      try {
        const resp = await page.goto(path, { waitUntil: 'load', timeout: 30000 }).catch(async e => { await page.waitForLoadState('domcontentloaded'); return null; });
        await page.waitForTimeout(300);
        const ov = await overflow(page);
        const small = await smallTargets(page, 40);
        const name = `crawl-${size}-${user}-${path.replace(/[^a-z0-9]+/gi, '_')}`;
        await shot(page, name);
        const r = { user, size, path, url: page.url(), status: resp?.status(), sw: ov.sw, iw: ov.iw, over: ov.sw > ov.iw, offenders: ov.offenders, smallCount: small.length, small: small.filter(s => !s.inline).slice(0, 40) };
        results.push(r);
        console.log(`${size} ${user} ${path} -> ${r.status} sw=${ov.sw} iw=${ov.iw} offenders=${ov.offenders.length} small=${small.filter(s => !s.inline).length}`);
      } catch (e) {
        console.log(`ERR ${size} ${user} ${path}: ${e.message}`);
      }
    }
    if (page.problems.length) console.log('  problems:', page.problems.slice(0, 5));
    await context.close();
  }
}
writeFileSync(join(HERE, `crawl-${onlyUser || 'all'}-${sizes.join('_')}.json`), JSON.stringify(results, null, 1));
await browser.close();
