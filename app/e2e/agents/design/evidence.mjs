// Tight, readable crops for every finding, written to shots/evidence/.
import { launch, ctxFor, settle, shotPath, loadJson, BASE } from './lib.mjs';
import { copyFileSync } from 'fs';

const data = loadJson('data.json');
const D = data.docs;
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const E = n => shotPath('evidence', `${n}.png`);

const JOBS = [
  // name, user, path, size, how ({clip}|{sel}|{full}), scale
  ['01-tray-list-action-column', 'shilan', '/tray', '1366x768', { clip: [24, 170, 1086, 430] }],
  ['02-archive-list-columns-pushed-out', 'aram', '/archive', '1366x768', { clip: [0, 90, 1120, 600] }],
  ['05a-letter-plot-row-monospace', 'shilan', `/documents/${D.registered}`, '1366x768', { sel: '.content table tr:has(th:text-is("پارچە"))' }, 2],
  ['05b-scanner-address-monospace', 'itadmin', '/admin/scanners', '1366x768', { sel: '.content table tbody tr' }, 2],
  ['06a-letter-sender-phone-reversed', 'shilan', `/documents/${D.registered}`, '1366x768', { sel: '.content table tr:has(th:text-is("نێردەر"))' }, 2],
  ['06b-print-sheet-phone-reversed', 'shilan', `/documents/${D.registered}/print`, '1366x768', { sel: 'tr:has(th:text-is("نێردەر"))' }, 2],
  ['06c-company-phone-correct', 'shilan', `/companies/${data.company}`, '1366x768', { sel: '.content table tr:has(th:text-is("تەلەفۆن"))' }, 2],
  ['07-times-in-utc-note', 'shilan', `/documents/${D.eight}`, '1366x768', { sel: '.content ul li >> nth=0' }, 2],
  ['08a-holder-letter-page-fullpage', 'sakar', `/documents/${D.flow}`, '1366x768', { full: true }],
  ['08b-many-notes-letter-fullpage', 'shilan', `/documents/${D.eight}`, '1366x768', { full: true }],
  ['09-very-urgent-letter-no-priority', 'shilan', `/documents/${D.registered}`, '1366x768', { clip: [576, 66, 790, 500] }],
  ['10a-chase-heading-grammar', 'shilan', `/documents/${D.flow}`, '1366x768', { sel: 'h2:has-text("ئەم کتابە لای")' }, 2],
  ['10b-trail-finished-after-now', 'shilan', `/documents/${D.closed}`, '1366x768', { sel: '.trail li >> nth=0' }, 2],
  ['11a-search-table-last-column-clipped', 'shilan', `/documents?q=${data.mark}`, '1366x768', { clip: [24, 90, 1110, 420] }],
  ['11b-dashboard-rooms-status-hidden-1024', 'aram', '/dashboard', '1024x768', { sel: '.card:has(h2:text-is("ژوورەکان"))', maxH: 420 }],
  ['12-topbar-long-title-company', 'shilan', `/companies/${data.company}`, '1366x768', { clip: [0, 0, 1366, 140] }],
  ['14-manifest-print-latin-digits', 'shilan', '/manifests/46/print', '1366x768', { clip: [330, 0, 710, 360] }],
  ['15-template-print-no-line-breaks', 'shilan', '/fills/106/print', '1366x768', { clip: [350, 0, 670, 520] }],
  ['16-reply-print-subject-abbrev', 'shilan', `/documents/${D.closed}/reply/print`, '1366x768', { clip: [330, 0, 710, 230] }],
  ['17-closed-and-cancelled-same-grey', 'shilan', `/documents?q=${data.mark}`, '1366x768', { clip: [24, 190, 1110, 330] }],
  ['18-registration-form-grid-hole-1920', 'shilan', '/registry/new', '1920x1080', { clip: [24, 170, 1640, 520] }],
  ['20a-tray-upload-MANUAL', 'shilan', '/tray', '1366x768', { sel: 'form[action="/tray/upload"]' }],
  ['20b-template-author-english-types', 'aram', '/templates/new', '1366x768', { clip: [290, 390, 820, 220] }],
  ['21a-sidebar-extension-latin-logout-white', 'shilan', '/inbox', '1366x768', { clip: [1134, 630, 232, 138] }, 2],
  ['21b-log-id-latin', 'aram', '/log', '1366x768', { clip: [24, 160, 1086, 250] }],
  ['21c-receipt-steps-latin', 'shilan', `/documents/${D.registered}/receipt`, '1366x768', { sel: 'ol' }, 2],
  ['23-attachment-name-scrambled', 'shilan', `/documents/${D.eight}`, '1366x768', { sel: '.attach-list > li' }, 2],
  ['24a-leave-form-two-bo-labels', 'aram', '/leave', '1366x768', { sel: 'form[action="/leave/new"]' }],
  ['24b-complete-step-placeholder', 'sakar', `/documents/${D.flow}`, '1366x768', { sel: 'form[action$="/complete"]' }, 2],
  ['26-karwan-tray-title-vs-inbox', 'karwan', '/tray', '1366x768', { clip: [600, 0, 520, 66] }, 2],
  ['27-letter-labels-squeezed', 'shilan', `/documents/${D.flow}`, '1366x768', { sel: '.content .card table' }],
  ['29-manifest-heading-and-cancel', 'shilan', '/manifests/46', '1366x768', { clip: [24, 90, 1086, 580] }],
  ['30-myday-button-wrap', 'shilan', '/my-day', '1366x768', { clip: [24, 280, 1086, 300] }],
];

const browser = await launch();
const ctxs = {};
for (const [name, user, path, size, how, scale = 1] of JOBS) {
  if (only && !only.test(name)) continue;
  const [W, H] = size.split('x').map(Number);
  const key = `${user}|${size}|${scale}`;
  if (!ctxs[key]) ctxs[key] = await ctxFor(browser, user, { width: W, height: H, scale });
  const page = await ctxs[key].newPage();
  try {
    await page.goto(path); await settle(page); await page.waitForTimeout(500);
    if (how.clip) {
      const [x, y, width, height] = how.clip;
      await page.screenshot({ path: E(name), clip: { x, y, width, height } });
    } else if (how.full) {
      await page.screenshot({ path: E(name), fullPage: true });
    } else {
      const loc = page.locator(how.sel).first();
      await loc.scrollIntoViewIfNeeded();
      if (how.maxH) {
        const b = await loc.boundingBox();
        await page.screenshot({ path: E(name), clip: { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, how.maxH) } });
      } else await loc.screenshot({ path: E(name) });
    }
    console.log('ok', name);
  } catch (e) { console.log('FAIL', name, String(e).split('\n')[0]); }
  await page.close();
}
await browser.close();

// Whole-viewport captures taken without Playwright's beyond-viewport capture, which
// draws right-to-left pages with sideways overflow shifted.
const copies = [
  ['batch/tray-item-cdp.png', '04-tray-item-filename-overflow'],
  ['batch/archive-entry-1366-cdp.png', '03-archive-entry-table-under-card-1366'],
  ['batch/archive-entry-1024-cdp.png', '03b-archive-entry-table-under-card-1024'],
  ['zoom/150/registry.png', '12b-topbar-150pct-1366-laptop'],
  ['zoom/150/doc-flow-holder.png', '13a-letter-overflow-150pct'],
  ['batch/1024x768/doc-flow.png', '13b-letter-overflow-1024'],
  ['view/1366x768/shilan/inbox-row-zoom.png', '10c-inbox-now-ago'],
  ['mockups/Main.png', '25a-mockup-main'],
  ['batch/1366x768/dashboard.png', '25b-app-dashboard'],
  ['mockups/Login.png', '25c-mockup-login'],
  ['batch/1366x768/login.png', '25d-app-login'],
];
for (const [from, to] of copies) {
  if (only && !only.test(to)) continue;
  try { copyFileSync(shotPath(...from.split('/')), E(to)); console.log('copied', to); } catch (e) { console.log('FAIL copy', to, e.message); }
}
