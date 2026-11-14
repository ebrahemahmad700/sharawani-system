// The browser audit of 13 September, over HTTP.
//
//   node test/audit.test.mjs        (server must be running on BASE)
//
// The audit itself is in e2e/audit/ and drives a real Chrome. This file holds
// the fixes to the things it found that an HTTP request can see, so they cannot
// come back quietly. IDs match the report: F fix first, B broken, M missing,
// D design, P phones, W words.

import { ACTIONS } from '../src/lib/log.mjs';
import { ACTION_KU } from '../src/routes/dashboard.mjs';

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i).trim(); const v = p.slice(i + 1); if (v) this.cookies.set(k, v); else this.cookies.delete(k); } } }
  async get(path) { const t0 = Date.now(); const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body, headers: r.headers, ms: Date.now() - t0 }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body, headers: r.headers }; }
  async signIn(u) { await this.get('/login'); const r = await this.post('/login', { username: u, password: PASSWORD }); await this.get('/inbox'); return r; }
}

const mark = Math.random().toString(36).slice(2, 9);
const registry = new Session(); await registry.signIn('shilan');
const mayor    = new Session(); await mayor.signIn('aram');
const legal    = new Session(); await legal.signIn('hemin');
const legalClerk = new Session(); await legalClerk.signIn('sakar');
const land     = new Session(); await land.signIn('hersh');
const it       = new Session(); await it.signIn('itadmin');

const { body: formBody } = await registry.get('/registry/new');
const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(formBody)?.[1] ?? '';
const register = async (s, subject) => {
  await s.get('/registry/new');
  const r = await s.post('/registry/new', { subject, doc_type_option_id: typeId, sender_kind: 'citizen', sender_name: `نێردەر ${mark}`, priority: 'normal', confirm_similar: '1' });
  return Number(/\/documents\/(\d+)/.exec(r.location ?? '')?.[1]);
};
const roomId = (html, name) => new RegExp(`<option value="(\\d+)"[^>]*>[^<]*${name}`).exec(html)?.[1];

// ---------------------------------------------------------------------------
console.log('--- F1: nothing a signed-in person sees is kept by the browser ---');
for (const path of ['/registry', '/inbox', '/documents']) {
  const r = await registry.get(path);
  check(`${path} is sent no-store`, /no-store/.test(r.headers.get('cache-control') ?? ''), r.headers.get('cache-control'));
}
const loginPage = await new Session().get('/login');
check('the static stylesheet is still cacheable', !/no-store/.test((await fetch(BASE + '/app.css')).headers.get('cache-control') ?? ''));
check('the sign-in page opens', loginPage.status === 200);

// ---------------------------------------------------------------------------
console.log('\n--- F2: a temporary password never travels in an address ---');
const usersPage = await it.get('/admin/users');
const uname = `audit.${mark}`;
const created = await it.post('/admin/users', { full_name: `کارمەندی پشکنین ${mark}`, username: uname, role: 'room_clerk', room_id: roomId(usersPage.body, 'یاسا') ?? '' });
check('creating an account answers with the page itself, not a redirect', created.status === 200, `status ${created.status} ${created.location ?? ''}`);
check('and the temporary password is on that page', /وشەی نهێنی کاتی: [a-z0-9-]{8,}/.test(created.body));
check('and no address anywhere carries it', !(created.location ?? '').includes('temp=') && !created.body.includes('temp='));
const rows = [...created.body.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => m[0]);
const row = rows.find(r => r.includes(uname)) ?? '';
const resetId = /\/admin\/users\/(\d+)\/reset/.exec(row)?.[1];
if (resetId) {
  const reset = await it.post(`/admin/users/${resetId}/reset`, {});
  check('resetting a password also answers with the page, not ?temp=', reset.status === 200 && !(reset.location ?? '').includes('temp='), `status ${reset.status}`);
  await it.post(`/admin/users/${resetId}/deactivate`, {});
} else {
  check('the new account is listed', false, 'row not found');
}

// ---------------------------------------------------------------------------
console.log('\n--- F3: letter lists are fast for every room ---');
for (const [who, s] of [['land', land], ['legal', legal]]) {
  for (const path of ['/outgoing', '/documents', '/documents?q=' + encodeURIComponent('تاقیکردنەوە')]) {
    await s.get(path);                       // warm
    const r = await s.get(path);
    check(`${who} ${path} answers in under a second`, r.status === 200 && r.ms < 1000, `${r.ms} ms`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n--- B1: each action says what it did ---');
const doc = await register(registry, `پشکنینی پەیامەکان ${mark}`);
await registry.get(`/documents/${doc}`);
const note = await registry.post(`/documents/${doc}/notes`, { body: `تێبینی ${mark}` });
check('adding a note does not say "sent"', /done=note/.test(note.location ?? ''), note.location);
const notePage = await registry.get(note.location);
check('and the page says the note was added', notePage.body.includes('تێبینییەکە زیادکرا'));
const sent = await registry.post(`/documents/${doc}/route`, { mode: 'single', to_room_id: roomId(notePage.body, 'یاسا'), note: '' });
check('sending still says sent', /sent=1/.test(sent.location ?? ''), sent.location);
const recalled = await registry.post(`/documents/${doc}/recall`, {});
check('recalling says recalled', /done=recalled/.test(recalled.location ?? ''), recalled.location);

// ---------------------------------------------------------------------------
console.log('\n--- M1: cancelling a letter, and who may ---');
const clerkDoc = await register(legalClerk, `کتابی دووبارەی یاسا ${mark}`);
const clerkCancel = await legalClerk.post(`/documents/${clerkDoc}/cancel`, { reason: 'دووبارە' });
check('a room clerk cannot cancel, even by a hand-made request', /error=/.test(clerkCancel.location ?? ''), clerkCancel.location);
const clerkView = await legalClerk.get(`/documents/${clerkDoc}`);
check('and is not offered the button', !clerkView.body.includes(`/documents/${clerkDoc}/cancel`));
const headView = await legal.get(`/documents/${clerkDoc}`);
check('the head of the room that started it is offered it', headView.body.includes(`/documents/${clerkDoc}/cancel`));
const headCancel = await legal.post(`/documents/${clerkDoc}/cancel`, { reason: 'دووجار تۆمارکرا' });
check('and can cancel it', /done=cancelled/.test(headCancel.location ?? ''), headCancel.location);
const afterCancel = await legal.get(`/documents/${clerkDoc}`);
check('which then shows as cancelled with its reason', afterCancel.body.includes('هەڵوەشێنراوە') && afterCancel.body.includes('دووجار تۆمارکرا'));
const deskView = await registry.get(`/documents/${doc}`);
check('the front desk is offered cancel on an open letter', deskView.body.includes(`/documents/${doc}/cancel`));
check('B11: the close form has the anchor the sent list links to', deskView.body.includes('id="close"'));

// ---------------------------------------------------------------------------
console.log('\n--- B3: the rooms table has as many cells as headings ---');
const roomsPage = await it.get('/admin/rooms');
const head = /<thead><tr>([\s\S]*?)<\/tr><\/thead>/.exec(roomsPage.body)?.[1] ?? '';
const firstRow = /<tbody>\s*(<tr[\s\S]*?<\/tr>)/.exec(roomsPage.body)?.[1] ?? '';
const cols = h => [...h.matchAll(/<t[hd](?:\s[^>]*)?>/g)].reduce((n, m) => n + Number(/colspan="(\d+)"/.exec(m[0])?.[1] ?? 1), 0);
check('headings and cells line up', cols(head) > 0 && cols(head) === cols(firstRow.replace(/<form[\s\S]*?<\/form>/g, '')), `${cols(head)} headings, ${cols(firstRow.replace(/<form[\s\S]*?<\/form>/g, ''))} cells`);
check('M3: the rooms screen is in IT\'s menu', roomsPage.body.includes('href="/admin/rooms"'));

// ---------------------------------------------------------------------------
console.log('\n--- B4: the room switcher shows the room being looked at ---');
const mayorInbox = await mayor.get('/inbox');
const deskRoom = roomId(/<select name="room"[\s\S]*?<\/select>/.exec(mayorInbox.body)?.[0] ?? '', 'هات و دەرچوو');
const deskInbox = await mayor.get(`/inbox?room=${deskRoom}`);
const selected = /<select name="room"[\s\S]*?<option value="(\d+)" selected>/.exec(deskInbox.body)?.[1];
check('the front desk is the selected room', Boolean(deskRoom) && selected === deskRoom, `selected ${selected}, desk ${deskRoom}`);

// ---------------------------------------------------------------------------
console.log('\n--- B5: no link to a screen that refuses ---');
const hr = new Session(); await hr.signIn('bafrin');
const hrForm = await hr.get('/registry/new');
check('HR is not offered the transaction types editor', !hrForm.body.includes('href="/admin/doc-types"'));
check('HR is not offered the photo screen', !hrForm.body.includes('href="/registry/photo"'));
const archiveClerk = new Session(); await archiveClerk.signIn('karwan');
const photo = await archiveClerk.get('/registry/photo');
check('an archive room may use the photo screen it is offered', photo.status === 200, `status ${photo.status}`);

// ---------------------------------------------------------------------------
console.log('\n--- B6: format checks a browser accepts ---');
for (const [s, path] of [[it, '/admin/users'], [registry, '/admin/doc-types'], [mayor, '/admin/scanners']]) {
  const { body } = await s.get(path);
  const bad = [...body.matchAll(/pattern="([^"]*)"/g)].map(m => m[1]).filter(p => /[^\\]-\]/.test(p));
  check(`${path}: no unescaped hyphen at the end of a character class`, bad.length === 0, bad.join(' '));
}

// ---------------------------------------------------------------------------
console.log('\n--- B7: an extension typed in Kurdish digits ---');
const roomRow = /<form method="post" action="\/admin\/rooms\/(\d+)"/.exec(roomsPage.body)?.[1];
const roomForm = /<form method="post" action="\/admin\/rooms\/\d+"[\s\S]*?<\/form>/.exec(roomsPage.body)?.[0] ?? '';
const current = Object.fromEntries([...roomForm.matchAll(/name="(department|floor_label)"[^>]*value="([^"]*)"/g)].map(m => [m[1], m[2]]));
const headSel = /name="head_user_id"[\s\S]*?<option value="(\d+)" selected/.exec(roomForm)?.[1] ?? '';
const depSel = /name="deputy_user_id"[\s\S]*?<option value="(\d+)" selected/.exec(roomForm)?.[1] ?? '';
const ext = await it.post(`/admin/rooms/${roomRow}`, { head_user_id: headSel, deputy_user_id: depSel, phone_extension: '٢١٤', department: current.department ?? '', floor_label: current.floor_label ?? '' });
check('٢١٤ is accepted', /ok=1/.test(ext.location ?? ''), decodeURIComponent(ext.location ?? ''));

// ---------------------------------------------------------------------------
console.log('\n--- B8: the log speaks Kurdish ---');
const unnamed = [...ACTIONS].filter(a => !ACTION_KU[a]);
check('every logged action has a Kurdish name', unnamed.length === 0, unnamed.join(', '));
const log = await mayor.get('/log');
const visibleCodes = (log.body.replace(/<[^>]+>/g, ' ').match(/\b[a-z_]+\.[a-z_]+\b/g) ?? []).filter(c => ACTIONS.has(c));
check('no action code is shown as text', visibleCodes.length === 0, [...new Set(visibleCodes)].slice(0, 5).join(' '));
check('no raw JSON is shown as text', !/\{&quot;|\{"[a-z_]+":/.test(log.body.replace(/title="[^"]*"/g, '')));

// ---------------------------------------------------------------------------
console.log('\n--- B9: a busy room sees what just arrived ---');
const legalInbox0 = await legal.get('/inbox');
const openTile = /<div class="stat"><div class="n">([^<]+)<\/div><div class="k">کراوە/.exec(legalInbox0.body)?.[1];
const arrived = await register(registry, `کتابی تازە بۆ یاسا ${mark}`);
const arrivedPage = await registry.get(`/documents/${arrived}`);
await registry.post(`/documents/${arrived}/route`, { mode: 'single', to_room_id: roomId(arrivedPage.body, 'یاسا'), note: '' });
const legalInbox = await legal.get('/inbox');
check('the letter just sent is on legal\'s inbox without "show all"', legalInbox.body.includes(`/documents/${arrived}"`));
const badge = /href="\/inbox"[^>]*>[\s\S]*?<span class="count">([^<]+)<\/span>/.exec(legalInbox.body)?.[1];
const tile = /<div class="stat"><div class="n">([^<]+)<\/div><div class="k">کراوە/.exec(legalInbox.body)?.[1];
check('the menu badge is the room\'s open count, the same as the tile', badge && badge === tile, `badge ${badge}, tile ${tile} (before ${openTile})`);

const mayorLetter = await register(mayor, `کتابی سەرۆک بۆ یاسا ${mark}`);
const mayorLetterPage = await mayor.get(`/documents/${mayorLetter}`);
await mayor.post(`/documents/${mayorLetter}/route`, { mode: 'single', to_room_id: roomId(mayorLetterPage.body, 'یاسا'), note: '' });
const myDay = await mayor.get('/my-day');
check('my day lists a letter the mayor sent a moment ago, however many are out', myDay.body.includes(`/documents/${mayorLetter}"`));

// ---------------------------------------------------------------------------
console.log('\n--- B10: templates find a letter by its number ---');
const templates = await mayor.get('/templates');
const tplId = /href="\/templates\/(\d+)"/.exec(templates.body)?.[1];
const tplForm = await mayor.get(`/templates/${tplId}`);
check('the form asks for a letter number, not an internal id', tplForm.body.includes('name="reference"') && !tplForm.body.includes('name="document_id"'));
const fieldNames = [...(/<form[^>]*action="\/templates\/\d+"[\s\S]*?<\/form>/.exec(tplForm.body)?.[0] ?? '').matchAll(/name="([a-z_]+)"/g)].map(m => m[1]).filter(n => !['_csrf', 'reference'].includes(n));
const values = Object.fromEntries(fieldNames.map(n => [n, n.includes('date') ? '2026-09-20' : n.includes('days') ? '2' : 'x']));
const noLetter = await mayor.post(`/templates/${tplId}`, { ...values, reference: 'ه/1999/99999' });
check('a number that is not there comes back as the form with a message', noLetter.status === 400 && noLetter.body.includes('class="sidebar"') && noLetter.body.includes('نەدۆزرایەوە'), `status ${noLetter.status}`);
const incomingNo = /ژمارەی هاتوو<\/th><td class="mono">(?:<span[^>]*>)?([^<]+)</.exec(arrivedPage.body)?.[1]?.replace(/[⁦-⁩]/g, '');
const linked = await mayor.post(`/templates/${tplId}`, { ...values, reference: incomingNo });
check('the real number links it and prints', linked.status === 303 && /\/fills\/\d+\/print/.test(linked.location ?? ''), `${incomingNo} → ${linked.status} ${linked.location ?? ''}`);
if (linked.location) {
  const printed = await mayor.get(linked.location);
  check('and the print names the letter by its number', printed.body.includes(incomingNo ?? '---'));
}

// ---------------------------------------------------------------------------
console.log('\n--- B12: the reply draft dates the letter in Kurdish digits ---');
const replyPage = await registry.get(`/documents/${arrived}/reply`);
const draft = /<textarea id="body"[^>]*>([\s\S]*?)<\/textarea>/.exec(replyPage.body)?.[1] ?? '';
check('no ISO date in the draft', !/\d{4}-\d{2}-\d{2}/.test(draft), draft.slice(0, 120));

// ---------------------------------------------------------------------------
console.log('\n--- D5: one "not found" page, with the menu ---');
const missing = await registry.get('/no-such-page');
check('an unknown address keeps the menu for a signed-in person', missing.status === 404 && missing.body.includes('class="sidebar"'));
const missingFile = await registry.get('/attachments/999999999');
check('a missing file is a page, not the words "not found"', missingFile.status === 404 && missingFile.body.includes('class="sidebar"'));
const refusedPage = await registry.get('/admin/users');
check('a refusal keeps the menu too', refusedPage.status === 403 && refusedPage.body.includes('class="sidebar"'));

// ---------------------------------------------------------------------------
console.log('\n--- D6: every script and stylesheet carries the fingerprint ---');
const bare = [];
for (const [s, path] of [[registry, `/documents/${doc}/print`], [registry, `/documents/${doc}/receipt`], [mayor, '/board']]) {
  const { body } = await s.get(path);
  for (const m of body.matchAll(/(?:src|href)="(\/(?:[a-z]+\.(?:js|css)))"/g)) bare.push(`${path} ${m[1]}`);
}
check('none is loaded without ?v=', bare.length === 0, bare.join(', '));

// ---------------------------------------------------------------------------
console.log('\n--- M2, M4: the menu ---');
check('everyone has a way to change their own password', legalClerk && (await legalClerk.get('/inbox')).body.includes('href="/password"'));
const clerkInbox = await legalClerk.get('/inbox');
check('a room clerk finds templates and leave in the menu', clerkInbox.body.includes('href="/templates"') && clerkInbox.body.includes('href="/leave"'));
const clerkRegistry = await legalClerk.get('/registry?q=abc');
check('the front desk register sends others to search', clerkRegistry.status === 303 && /\/documents\?q=abc/.test(clerkRegistry.location ?? ''), clerkRegistry.location);
const dana = new Session(); await dana.signIn('dana');
const danaHome = await dana.get('/rooms');
check('a directorate head exists in the test staff and can open their screen', danaHome.status === 200, `status ${danaHome.status}`);
check('and their menu has no duplicate "directorate" item', !danaHome.body.includes('href="/directorate"'));
const voluntary = await legalClerk.get('/password');
check('the password screen, reached by choice, does not say "you must"', voluntary.status === 200 && !voluntary.body.includes('پێویستە وشەی نهێنیت بگۆڕیت'));

// ---------------------------------------------------------------------------
console.log('\n--- W: words ---');
const words = [await registry.get('/registry/new'), await registry.get(`/barcode`), await legal.get('/inbox')].map(r => r.body).join('');
check('priority is پەلە everywhere, never گرنگ', !/>گرنگ<|>زۆر گرنگ</.test(words));
const trayPage = await registry.get('/tray');
check('no Arabic ك in sizes', !/ك\.ب/.test(trayPage.body));
check('scanner codes are named, not MANUAL/CAMERA shown as text', !/>MANUAL<|>CAMERA</.test(trayPage.body.replace(/<span dir="ltr">/g, '>')));

// ---------------------------------------------------------------------------
console.log('\n--- the security test\'s four findings ---');
await registry.get('/companies/new');
const noReg = await registry.post('/companies/new', { name: `کۆمپانیای بێ ژمارە ${mark}` });
check('a company without a registration number comes back as the form with a message, not the error page',
      noReg.status === 400 && noReg.body.includes('ژمارەی تۆمار پێویستن') && noReg.body.includes(`کۆمپانیای بێ ژمارە ${mark}`), `status ${noReg.status}`);

const sozan = new Session(); await sozan.signIn('sozan');
await sozan.get('/inbox');
const foreignNote = await sozan.post(`/documents/${doc}/notes`, { body: `نابێت بنووسرێت ${mark}` });
check('a note on a letter the room cannot see is refused cleanly', foreignNote.status === 303 && /error=/.test(foreignNote.location ?? ''), `status ${foreignNote.status}`);
const deskAfter = await registry.get(`/documents/${doc}`);
check('and is not written', !deskAfter.body.includes(`نابێت بنووسرێت ${mark}`));

const hrAuthor = new Session(); await hrAuthor.signIn('bafrin');
await hrAuthor.get('/templates/new');
const evil = await hrAuthor.post('/templates/new', {
  name: `تێمپلەیتی پشکنین ${mark}`, category: 'پشکنین', description: '',
  fields: 'who | ناو | text', body: '<p onclick="x()">بەڕێز <b>{{who}}</b></p><script>alert(1)</script><img src=x onerror=alert(1)>',
});
const evilId = /\/templates\/(\d+)/.exec(evil.location ?? '')?.[1];
if (evilId) {
  await hrAuthor.get(`/templates/${evilId}`);
  const filledEvil = await hrAuthor.post(`/templates/${evilId}`, { who: 'x' });
  const printedEvil = await hrAuthor.get(filledEvil.location ?? '/');
  const sheet = /<div class="body">([\s\S]*?)<\/div>/.exec(printedEvil.body)?.[1] ?? '';
  check('a template body keeps its layout', sheet.includes('<b>x</b>') && sheet.includes('<p>'), sheet.slice(0, 80));
  check('and loses scripts, handlers and images', !/<script|onerror|onclick|<img/i.test(sheet), sheet.slice(0, 120));
} else {
  check('the test template was saved', false, `status ${evil.status}`);
}

await registry.get(`/documents?q=${encodeURIComponent(`ناوی هاووڵاتی ${mark}`)}`);
const itLog = await it.get('/log?action=search.');
check('IT\'s log does not show what staff searched for', !itLog.body.includes(`ناوی هاووڵاتی ${mark}`));
const mayorLog = await mayor.get('/log?action=search.');
check('the mayor\'s log still does', mayorLog.body.includes(`ناوی هاووڵاتی ${mark}`));

// ---------------------------------------------------------------------------
console.log('\n--- the letters test: who may move a letter ---');
const accounts = sozan;
const landHead = land;
const stepIdOn = body => /name="step_id" value="(\d*)"/.exec(body)?.[1];
const seqDoc = await register(registry, `ڕیزبەندی بۆ پشکنین ${mark}`);
const seqPage = await registry.get(`/documents/${seqDoc}`);
// URLSearchParams in the helper sends one value per key; send the sequence the way a form does.
const seqForm = new URLSearchParams();
for (const [k, v] of [['_csrf', registry.csrf], ['mode', 'sequence'], ['seq_room', roomId(seqPage.body, 'ژمێریاری')], ['seq_room', roomId(seqPage.body, 'زەوی')], ['return_to_assigner', '1']]) seqForm.append(k, v);
const seqSent = await fetch(BASE + `/documents/${seqDoc}/route`, { method: 'POST', redirect: 'manual', headers: { cookie: registry.header(), 'content-type': 'application/x-www-form-urlencoded' }, body: seqForm });
check('a letter goes out in sequence: accounts, then land', /sent=1/.test(seqSent.headers.get('location') ?? ''), seqSent.headers.get('location'));

const landBefore = await landHead.get(`/documents/${seqDoc}`);
check('land, waiting its turn, cannot open the letter yet', landBefore.status === 404, `status ${landBefore.status}`);
const landTakes = await landHead.post(`/documents/${seqDoc}/route`, { mode: 'single', to_room_id: roomId(seqPage.body, 'یاسا'), note: '' });
check('and cannot take it and send it elsewhere', !/sent=1/.test(landTakes.location ?? '') , landTakes.location);

const accPage = await accounts.get(`/documents/${seqDoc}`);
const accStep = stepIdOn(accPage.body);
const accDone = await accounts.post(`/documents/${seqDoc}/complete`, { action: 'opinion', reply_note: 'یەکەم', step_id: accStep });
check('accounts finishes its step', /done=complete/.test(accDone.location ?? ''), accDone.location);
const stale = await accounts.post(`/documents/${seqDoc}/complete`, { action: 'rejected', reply_note: 'پەڕەی کۆن', step_id: accStep });
check('the same old page pressed again is refused, not applied to land\'s step', /error=/.test(stale.location ?? ''), decodeURIComponent(stale.location ?? ''));
const noStepField = await accounts.post(`/documents/${seqDoc}/complete`, { action: 'rejected', reply_note: 'بێ ژمارەی هەنگاو' });
check('and without the page\'s step id, accounts still cannot finish land\'s step', /error=/.test(noStepField.location ?? ''), decodeURIComponent(noStepField.location ?? ''));
const landNow = await landHead.get(`/documents/${seqDoc}`);
check('land\'s step is untouched and now land\'s to act on', landNow.status === 200 && landNow.body.includes('ئەم کتابە لای ژووری تۆیە') && !landNow.body.includes('پەڕەی کۆن'));

console.log('\n--- the letters test: recall, return, own room, delivery lists ---');
const fwd = await register(registry, `ناردنەوە و گەڕاندنەوە ${mark}`);
const fwdPage = await registry.get(`/documents/${fwd}`);
await registry.post(`/documents/${fwd}/route`, { mode: 'single', to_room_id: roomId(fwdPage.body, 'ژمێریاری'), note: '' });
const accFwdPage = await accounts.get(`/documents/${fwd}`);
await accounts.post(`/documents/${fwd}/route`, { mode: 'single', to_room_id: roomId(accFwdPage.body, 'زەوی'), note: '', step_id: stepIdOn(accFwdPage.body) });
const recallAfter = await accounts.post(`/documents/${fwd}/recall`, {});
check('recalling after it passed through a room works (it was an error page)', recallAfter.status === 303 && /done=recalled/.test(recallAfter.location ?? ''), `status ${recallAfter.status} ${decodeURIComponent(recallAfter.location ?? '')}`);
const backOnDesk = await accounts.get(`/documents/${fwd}`);
check('and the letter is back on accounts\' desk to send again', backOnDesk.body.includes('ئەم کتابە لای ژووری تۆیە'));
const shortReason = await accounts.post(`/documents/${fwd}/return`, { reason: 'نا', step_id: stepIdOn(backOnDesk.body) });
check('a two-letter return reason is a message, not an error page', shortReason.status === 303 && /error=/.test(shortReason.location ?? ''), `status ${shortReason.status}`);

const ownRoom = await register(registry, `بۆ هەمان ژوور ${mark}`);
const ownPage = await registry.get(`/documents/${ownRoom}`);
const toSelf = await registry.post(`/documents/${ownRoom}/route`, { mode: 'single', to_room_id: roomId(formBody, 'هات و دەرچوو') ?? roomId(deskInbox.body, 'هات و دەرچوو'), note: '' });
check('sending a new letter to your own room is a message, not an error page', toSelf.status === 303 && /error=/.test(toSelf.location ?? ''), `status ${toSelf.status}`);
const ownRoomOptions = ownPage.body.split('id="to_room"')[1]?.split('</select>')[0] ?? '';
check('and your own room is not offered', ownRoomOptions.length > 0 && !ownRoomOptions.includes('ژووری هات و دەرچوو'));

const mfA = await register(registry, `لیستی گەیاندن ${mark}`);
const mfPage = await registry.get(`/documents/${mfA}`);
await registry.post(`/documents/${mfA}/route`, { mode: 'single', to_room_id: roomId(mfPage.body, 'ژمێریاری'), note: '' });
await registry.get('/manifests');
const mfMade = await registry.post('/manifests/new', { from_room_id: roomId(deskInbox.body, 'هات و دەرچوو'), to_room_id: roomId(mfPage.body, 'ژمێریاری'), document_id: String(mfA), courier: 'گەیەنەر' });
const mfId = /\/manifests\/(\d+)/.exec(mfMade.location ?? '')?.[1];
if (mfId) {
  const senderView = await registry.get(`/manifests/${mfId}`);
  check('the sender is not offered to sign for their own delivery list', !senderView.body.includes(`/manifests/${mfId}/receive`));
  const senderSigns = await registry.post(`/manifests/${mfId}/receive`, {});
  check('and cannot, by a hand-made request', /error=/.test(senderSigns.location ?? ''), decodeURIComponent(senderSigns.location ?? ''));
  const receiverCancels = await accounts.post(`/manifests/${mfId}/cancel`, {});
  check('the receiving room cannot cancel it', /error=/.test(receiverCancels.location ?? ''), decodeURIComponent(receiverCancels.location ?? ''));
  const receiverSigns = await accounts.post(`/manifests/${mfId}/receive`, {});
  check('the receiving room signs for it', /ok=/.test(receiverSigns.location ?? ''), decodeURIComponent(receiverSigns.location ?? ''));
} else {
  check('the delivery list was made', false, `status ${mfMade.status} ${decodeURIComponent(mfMade.location ?? '')}`);
}

console.log('\n--- the letters test: closing, finding, chasing ---');
const draftDoc = await register(registry, `ڕەشنووس پارێزراو ${mark}`);
await registry.get(`/documents/${draftDoc}/reply`);
await registry.post(`/documents/${draftDoc}/reply`, { recipient: 'وەرگر', body: `دەقی وەڵامی پاشەکەوتکراو ${mark}` });
await registry.get(`/documents/${draftDoc}`);
await registry.post(`/documents/${draftDoc}/close`, { recipient: 'وەرگر', summary: '', channel: 'hand' });
const closedPrint = await registry.get(`/documents/${draftDoc}/reply/print`);
check('closing from the letter page keeps the reply that was saved', closedPrint.body.includes(`دەقی وەڵامی پاشەکەوتکراو ${mark}`));

const found = await registry.get(`/barcode?q=${encodeURIComponent(incomingNo ?? '')}`);
check('the barcode screen finds a letter by its full number', found.status === 200 && found.body.includes(`/documents/${arrived}"`) && !found.body.includes('دوو کتاب بەم ژمارەیە'), incomingNo);
const withE = (incomingNo ?? '').replace('ه', 'ە');
const foundE = await registry.get(`/documents?q=${encodeURIComponent(withE)}`);
check('a number typed with ە for ه is found', foundE.body.includes(`/documents/${arrived}"`), withE);

const chaseDoc = await register(registry, `بەدواداچوون دوای تێبینی ${mark}`);
await registry.get(`/documents/${chaseDoc}`);
await registry.post(`/documents/${chaseDoc}/notes`, { body: 'تێبینییەکی ئاسایی' });
const chasePage = await registry.get(`/documents/${chaseDoc}`);
await registry.post(`/documents/${chaseDoc}/route`, { mode: 'single', to_room_id: roomId(chasePage.body, 'یاسا'), note: '' });
const chased = await registry.post(`/documents/${chaseDoc}/chase`, { note: '' });
check('a note written earlier today does not block chasing', /chased=1/.test(chased.location ?? ''), decodeURIComponent(chased.location ?? ''));
const chasedPage = await registry.get(chased.location ?? '/');
check('and the letter page says the chase was sent', chasedPage.body.includes('داواکاری بەدواداچوونەکەت نووسرا'));

console.log('\n--- the design test: times ---');
const timeNote = `کاتی ئێستا ${mark}`;
await registry.post(`/documents/${chaseDoc}/notes`, { body: timeNote });
const timePage = await registry.get(`/documents/${chaseDoc}`);
const shown = new RegExp(`${timeNote}[\\s\\S]*?([٠-٩]{2}:[٠-٩]{2})`).exec(timePage.body)?.[1] ?? '';
const baghdad = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const shownLatin = shown.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
check('a note\'s time is Rania\'s time, not UTC', shown && Math.abs(minutes(shownLatin) - minutes(baghdad)) <= 2, `shown ${shownLatin}, Baghdad ${baghdad}`);

console.log(`\n${failures === 0 ? 'every audit fix holds' : `${failures} FAILED`}`);
process.exit(failures ? 1 : 0);
