import { launch, signIn, registerLetter, get, post, tag } from './lib.mjs';

const browser = await launch();
const log = (...a) => console.log(a.join(' '));
const M = tag();

const shilan = await signIn(browser, 'shilan');  // registry, front desk (from-room)
const hemin  = await signIn(browser, 'hemin');   // room_head, legal (to-room, party)
const rebwar = await signIn(browser, 'rebwar');  // room_clerk, contracts 14 (USER, not party)
const it     = await signIn(browser, 'itadmin'); // sysadmin (not a USER)

const { id } = await registerLetter(shilan.page, { subject: `manifest ${M}`, sender: `s ${M}` });
log('doc', id);

// route to legal
const dh = await (await get(shilan, `/documents/${id}`)).text();
const legalOpt = /<option value="(\d+)">[^<]*یاسا/.exec(dh);
const legalId = legalOpt ? legalOpt[1] : null;
log('legal room id', legalId);
const routed = await post(shilan, `/documents/${id}/route`, { _csrf: shilan.csrf, mode:'single', to_room_id: legalId, note:'m' });
log('route =>', routed.status?.(), routed.headers?.()['location']);

// build manifest from the /manifests form that lists my doc
const mh = await (await get(shilan, '/manifests')).text();
const forms = mh.split('action="/manifests/new"');
const mine = forms.find(f => f.includes(`name="document_id" value="${id}"`));
let mid = null;
if (mine) {
  const from = /name="from_room_id" value="(\d+)"/.exec(mine)?.[1];
  const to = /name="to_room_id" value="(\d+)"/.exec(mine)?.[1];
  log('manifest from', from, 'to', to, 'doc', id);
  const mk = await post(shilan, '/manifests/new', { _csrf: shilan.csrf, from_room_id: from, to_room_id: to, document_id: id, courier: `courier ${M}` });
  const loc = mk.headers?.()['location'] || '';
  mid = /\/manifests\/(\d+)/.exec(loc)?.[1];
  log('manifest create =>', mk.status?.(), loc, 'mid', mid);
} else {
  log('could not find sendable form for my doc; front-desk sendable list:', forms.length - 1, 'forms');
}

if (mid) {
  log('\n===== 1. cross-room manifest access =====');
  for (const [who, s, exp] of [
    ['shilan (from-room)', shilan, '200 party'],
    ['hemin (to-room)', hemin, '200 party'],
    ['rebwar (USER, not party)', rebwar, 'expect 404'],
    ['itadmin (not USER)', it, 'expect 403'],
  ]) {
    for (const p of [`/manifests/${mid}`, `/manifests/${mid}/print`]) {
      const r = await get(s, p);
      const st = r.error ? 'ERR' : r.status();
      let leak = '';
      if (!r.error && st === 200) { const b = await r.text(); if (b.includes('manifest '+M) || b.includes('courier '+M)) leak = ' (shows manifest)'; }
      log(`  [${who}] ${p} => ${st}${leak}  ${exp}`);
    }
  }
}

await browser.close();
log('\n----DONE----');
