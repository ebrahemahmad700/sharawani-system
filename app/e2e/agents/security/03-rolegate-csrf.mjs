import { launch, signIn, registerLetter, post, get, tag, short } from './lib.mjs';

const browser = await launch();
const log = (...a) => console.log(a.join(' '));

// A spread of roles.
const U = {};
for (const name of ['aram', 'shilan', 'rebwar', 'bafrin', 'karwan', 'itadmin', 'sozan', 'hemin']) {
  U[name] = await signIn(browser, name);
}
const role = { aram:'mayor', shilan:'registry_clerk', rebwar:'room_clerk(contracts14)',
  bafrin:'hr', karwan:'archive_clerk', itadmin:'sysadmin', sozan:'room_head(accounts)', hemin:'room_head(legal)' };

// A fresh letter owned by shilan (front desk), not routed anywhere.
const marker = tag();
const { id } = await registerLetter(U.shilan.page, { subject: `rolegate ${marker}`, sender: `snd ${marker}` });
log('doc', id, 'owned by shilan\n');

// POST with the acting user's own valid CSRF token.
async function tryPost(user, path, form = {}, note = '') {
  const u = U[user];
  const r = await post(u, path, { _csrf: u.csrf, ...form });
  const status = r.error ? 'ERR' : r.status();
  let loc = '';
  if (!r.error) { const h = r.headers(); loc = h['location'] ? ` ->${h['location']}` : ''; }
  log(`  [${role[user]}] POST ${path} ${JSON.stringify(form).slice(0,60)} => ${status}${loc} ${note}`);
  return r;
}

log('===== A. requireRole POST gates: acting role should be REFUSED (expect 403) =====');
// admin (sysadmin only) tried by the mayor
await tryPost('aram', '/admin/users', { username: 'x'+marker, full_name:'x', role:'room_clerk' });
await tryPost('aram', '/admin/rooms', { name: 'x'+marker });
await tryPost('aram', `/admin/users/1/contact`, { });
// assistant (mayor/deputy) tried by a clerk
await tryPost('shilan', '/assistant/ask', { q: 'hi' });
await tryPost('itadmin', '/assistant/ask', { q: 'hi' });
// templates authoring (hr/mayor/deputy) by registry clerk and room clerk
await tryPost('shilan', '/templates/new', { name:'t'+marker, category:'c', fields:'a | A | text', body:'{{a}}' });
await tryPost('rebwar', '/templates/new', { name:'t'+marker, category:'c', fields:'a | A | text', body:'{{a}}' });
// leave decide (hr/mayor/deputy/dir head) by room clerk
await tryPost('rebwar', '/leave/1/decide', { decision:'approved' });
// manifests (not hr, not archive_clerk) by hr and archive_clerk
await tryPost('bafrin', '/manifests/new', { });
await tryPost('karwan', '/manifests/new', { });
// company writers (not archive_clerk, not hr) by archive_clerk & hr
await tryPost('karwan', '/companies/new', { name:'co'+marker });
await tryPost('bafrin', '/companies/new', { name:'co'+marker });
// doc-types editors (registry/mayor/deputy/sysadmin) by room clerk & hr
await tryPost('rebwar', '/admin/doc-types', { name:'dt'+marker, base_kind:'other' });
await tryPost('bafrin', '/admin/doc-types', { name:'dt'+marker, base_kind:'other' });
// archive edit (archive_clerk/mayor/deputy) by room clerk & hr
await tryPost('rebwar', '/archive/new', { });
await tryPost('bafrin', '/archive/new', { });
// scanners admin (sysadmin/mayor/deputy) by registry clerk
await tryPost('shilan', '/admin/scanners', { });
// scan (USERS: not hr, not sysadmin) by hr and itadmin
await tryPost('bafrin', '/scan', { document_id: id });
await tryPost('itadmin', '/scan', { document_id: id });
// tray (USERS: not hr, not sysadmin) by hr, itadmin
await tryPost('bafrin', '/tray/upload', { });
await tryPost('itadmin', '/tray/1/claim', { });
// photo (USERS) by hr
await tryPost('bafrin', '/registry/photo', { });
// barcode paper-received (USERS) by hr
await tryPost('bafrin', '/barcode/1/paper-received', { });

log('\n===== B. letter actions on shilan\'s doc by wrong actor (expect refusal, NO half-success) =====');
// IT can never touch a letter
await tryPost('itadmin', `/documents/${id}/notes`, { body:'itnote '+marker });
await tryPost('itadmin', `/documents/${id}/route`, { mode:'single', to_room_id:'2' });
await tryPost('itadmin', `/documents/${id}/cancel`, { reason:'x' });
await tryPost('itadmin', `/documents/${id}/close`, { recipient:'x' });
// A different room acting on a letter it does not hold / cannot see
await tryPost('sozan', `/documents/${id}/notes`, { body:'sozannote '+marker });
await tryPost('sozan', `/documents/${id}/complete`, { action:'opinion' });
await tryPost('rebwar', `/documents/${id}/cancel`, { reason:'x' });   // clerk cancel
await tryPost('sozan', `/documents/${id}/cancel`, { reason:'x' });    // other-room head cancel
await tryPost('bafrin', `/documents/${id}/close`, { recipient:'x' }); // hr close
// itadmin registering a letter
await tryPost('itadmin', '/registry/new', { subject:'itreg '+marker, sender_name:'x' });

log('\n===== verify: did any B write land? (read shilan notes) =====');
const selfDoc = await (await get(U.shilan, `/documents/${id}`)).text();
for (const m of ['itnote', 'sozannote']) {
  log(`  note "${m} ${marker}" present on doc:`, selfDoc.includes(`${m} ${marker}`));
}

log('\n===== C. CSRF variants on a GENUINELY-allowed action (shilan adds note to own doc) =====');
// C1: no token
let r = await post(U.shilan, `/documents/${id}/notes`, { body:'c1 '+marker });
log('  no _csrf =>', r.error ? 'ERR' : r.status());
// C2: another session's token (sozan's)
r = await post(U.shilan, `/documents/${id}/notes`, { _csrf: U.sozan.csrf, body:'c2 '+marker });
log('  foreign token =>', r.error ? 'ERR' : r.status());
// C3: token only in x-csrf-token header
r = await post(U.shilan, `/documents/${id}/notes`, { body:'c3 '+marker }, { 'x-csrf-token': U.shilan.csrf });
log('  header token =>', r.error ? 'ERR' : r.status(), (!r.error ? (r.headers()['location']||'') : ''));
// C4: correct body token (should work)
r = await post(U.shilan, `/documents/${id}/notes`, { _csrf: U.shilan.csrf, body:'c4 '+marker });
log('  correct token =>', r.error ? 'ERR' : r.status(), (!r.error ? (r.headers()['location']||'') : ''));

const after = await (await get(U.shilan, `/documents/${id}`)).text();
for (const c of ['c1','c2','c3','c4']) log(`  note ${c} landed:`, after.includes(`${c} ${marker}`));

await browser.close();
log('\n----DONE----');
