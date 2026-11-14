import { launch, signIn, get, post, tag, short, inkPdf } from './lib.mjs';

const browser = await launch();
const log = (...a) => console.log(a.join(' '));
const marker = tag();

const shilan = await signIn(browser, 'shilan');   // registry, front desk
const rebwar = await signIn(browser, 'rebwar');   // room_clerk, contracts 14
const sozan  = await signIn(browser, 'sozan');    // room_head, accounts (has archive access)
const bafrin = await signIn(browser, 'bafrin');   // hr (no archive, not company reader)
const it     = await signIn(browser, 'itadmin');  // sysadmin
const karwan = await signIn(browser, 'karwan');   // archive_clerk, room 8
const zhyan  = await signIn(browser, 'zhyan');    // archive_clerk, room 9

const probe = async (label, targets, path) => {
  for (const [who, s, expect] of targets) {
    const r = await get(s, path);
    const st = r.error ? 'ERR' : r.status();
    let leak = '';
    if (!r.error && st === 200) { const b = await r.text(); if (b.includes(marker) || b.includes('%PDF')) leak = ' ***LEAK***'; }
    log(`  [${who}] ${path} => ${st}${leak}  ${expect||''}`);
  }
};

// ---- TRAY (room-scoped) -------------------------------------------------
log('===== TRAY: shilan uploads to front-desk tray; other room reads =====');
{
  const up = await shilan.context.request.post('/tray/upload', {
    maxRedirects: 0,
    multipart: { _csrf: shilan.csrf, scanner_code: 'MANUAL', file: { name: `tray-${marker}.pdf`, mimeType: 'application/pdf', buffer: inkPdf() } },
  }).catch(e => ({ error: String(e) }));
  log('  upload =>', up.error ? up.error : up.status(), up.error ? '' : (up.headers()['location']||''));
  // find tray id from shilan's tray page
  const trayHtml = await (await get(shilan, '/tray')).text();
  const tids = [...new Set([...trayHtml.matchAll(/\/tray\/(\d+)/g)].map(m => Number(m[1])))];
  log('  shilan sees tray ids:', tids.slice(0,6).join(', '));
  const tid = tids[0];
  if (tid) {
    await probe('tray', [['rebwar', rebwar, '(other room, expect 404)'], ['itadmin', it, '(expect 403 role)']], `/tray/${tid}`);
    await probe('tray', [['rebwar', rebwar, '(expect 404)']], `/tray/${tid}/preview`);
  }
}

// ---- ARCHIVE ------------------------------------------------------------
log('\n===== ARCHIVE: karwan (room 8) uploads a map; access by others =====');
{
  const up = await karwan.context.request.post('/archive/new', {
    maxRedirects: 0,
    multipart: {
      _csrf: karwan.csrf, title: `map ${marker}`, plot_no: `9${Math.floor(Math.random()*9000)}/SECZ`,
      shelf: 'A', section: 'B', folder_no: '7',
      file: { name: `map-${marker}.pdf`, mimeType: 'application/pdf', buffer: inkPdf() },
    },
  }).catch(e => ({ error: String(e) }));
  const loc = up.error ? '' : (up.headers()['location']||'');
  log('  upload =>', up.error ? up.error : up.status(), loc);
  const am = /\/archive\/(\d+)/.exec(loc);
  const afid = am ? Number(am[1]) : null;
  log('  archive file id:', afid);
  if (afid) {
    // Roles WITHOUT archive access: registry(shilan), hr(bafrin), sysadmin(it) -> expect 403
    // Role WITH archive access, different room: sozan(room_head), zhyan(room9) -> access? (design)
    await probe('archive-detail', [
      ['shilan', shilan, '(registry, no archive: 403)'],
      ['bafrin', bafrin, '(hr, no archive: 403)'],
      ['itadmin', it, '(no archive: 403)'],
      ['sozan', sozan, '(room_head, has archive)'],
      ['zhyan', zhyan, '(other archive room)'],
    ], `/archive/${afid}`);
    await probe('archive-dl', [
      ['shilan', shilan, '(403)'], ['bafrin', bafrin, '(403)'], ['itadmin', it, '(403)'],
      ['zhyan', zhyan, '(other archive room)'],
    ], `/archive/${afid}/download`);
    await probe('archive-prev', [['bafrin', bafrin, '(403)'], ['zhyan', zhyan, '']], `/archive/${afid}/preview`);
  }
}

// ---- COMPANY FILE -------------------------------------------------------
log('\n===== COMPANY FILE: shilan creates company + file; access by others =====');
{
  const nc = await post(shilan, '/companies/new', { _csrf: shilan.csrf, name: `co ${marker}`, registration_no: `R${Date.now()%100000}` });
  const cloc = nc.error ? '' : (nc.headers()['location']||'');
  const cm = /\/companies\/(\d+)/.exec(cloc);
  const cid = cm ? Number(cm[1]) : null;
  log('  company create =>', nc.error?nc.error:nc.status(), cloc, 'cid', cid);
  if (cid) {
    const uf = await shilan.context.request.post(`/companies/${cid}/files`, {
      maxRedirects: 0,
      multipart: { _csrf: shilan.csrf, title: `cfile ${marker}`, file: { name:`cf-${marker}.pdf`, mimeType:'application/pdf', buffer: inkPdf() } },
    }).catch(e => ({ error: String(e) }));
    log('  file upload =>', uf.error?uf.error:uf.status(), uf.error?'':(uf.headers()['location']||''));
    const cpage = await (await get(shilan, `/companies/${cid}`)).text();
    const fids = [...new Set([...cpage.matchAll(/\/companies\/files\/(\d+)/g)].map(m=>Number(m[1]))) ];
    log('  company file ids:', fids.join(', '));
    const fid = fids[0];
    if (fid) {
      await probe('cfile', [
        ['rebwar', rebwar, '(reader, other room - shared register?)'],
        ['bafrin', bafrin, '(hr, not READER: 403)'],
        ['itadmin', it, '(not READER: 403)'],
      ], `/companies/files/${fid}`);
    }
  }
}

// ---- FILL ---------------------------------------------------------------
log('\n===== FILL: shilan fills a template; others try /fills/:id/print =====');
{
  const tlist = await (await get(shilan, '/templates')).text();
  const tm = /\/templates\/(\d+)/.exec(tlist);
  if (!tm) { log('  no template available to fill; skipping'); }
  else {
    const tid = Number(tm[1]);
    const fp = await (await get(shilan, `/templates/${tid}`)).text();
    const names = [...new Set([...fp.matchAll(/name="([a-zA-Z0-9_]+)"/g)].map(m=>m[1]))].filter(n=>!['_csrf','reference'].includes(n));
    const form = { _csrf: shilan.csrf };
    for (const n of names) form[n] = `x ${marker}`;
    const fr = await post(shilan, `/templates/${tid}`, form);
    const floc = fr.error?'':(fr.headers()['location']||'');
    const fm = /\/fills\/(\d+)/.exec(floc);
    const fid = fm ? Number(fm[1]) : null;
    log(`  filled template ${tid} => ${fr.error?fr.error:fr.status()} ${floc} fill ${fid}`);
    if (fid) {
      await probe('fill', [
        ['rebwar', rebwar, '(not owner, expect 404)'],
        ['itadmin', it, '(not templates USER: 403)'],
      ], `/fills/${fid}/print`);
    }
  }
}

// ---- notifications/:id/go for someone else ------------------------------
log('\n===== NOTIFICATIONS /go for another/absent notification =====');
for (const nid of [1, 2, 999999]) {
  const r = await get(sozan, `/notifications/${nid}/go`);
  const st = r.error?'ERR':r.status();
  const loc = r.error?'':(r.headers()['location']||'');
  log(`  [sozan] /notifications/${nid}/go => ${st} ${loc}`);
}

await browser.close();
log('\n----DONE----');
