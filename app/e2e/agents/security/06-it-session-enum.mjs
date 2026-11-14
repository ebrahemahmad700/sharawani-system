import { chromium } from '@playwright/test';
import { launch, signIn, registerLetter, get, post, tag, short, BASE, PASSWORD } from './lib.mjs';

const browser = await launch();
const log = (...a) => console.log(a.join(' '));
const marker = tag();

const shilan = await signIn(browser, 'shilan');
const it     = await signIn(browser, 'itadmin');
const ahang  = await signIn(browser, 'ahang');   // room_clerk, front desk (no /log in nav)

// A letter with a distinctive subject, and a distinctive search, both by shilan.
const { id } = await registerLetter(shilan.page, { subject: `LOGLEAK ${marker}`, sender: `SENDER ${marker}` });
await get(shilan, `/documents?q=${encodeURIComponent('CITIZENSEARCH ' + marker)}`);   // logged as search.documents(raw)
log('doc', id, 'marker', marker, '\n');

log('======== 4. IT CONFIDENTIALITY ========');
{
  const logHtml = await (await get(it, '/log')).text();
  const docLinks = (logHtml.match(/href="\/documents\/\d+"/g) || []).length;
  log('  itadmin /log: status ok, #letter-number links =', docLinks);
  log('  itadmin /log contains subject "LOGLEAK '+marker+'"? ', logHtml.includes('LOGLEAK '+marker));
  log('  itadmin /log contains sender  "SENDER '+marker+'"?  ', logHtml.includes('SENDER '+marker));
  log('  itadmin /log contains search  "CITIZENSEARCH '+marker+'"? ', logHtml.includes('CITIZENSEARCH '+marker));

  const nHtml = await (await get(it, '/notifications')).text();
  log('  itadmin /notifications contains any marker? ', nHtml.includes(marker));

  for (const p of ['/dashboard', '/documents?q='+marker, '/inbox', '/assistant']) {
    const r = await get(it, p); log(`  itadmin ${p} => ${r.error?'ERR':r.status()}`);
  }

  // room_clerk with no /log nav item can still open it (only requireAuth). What does RLS show?
  const clerkLog = await get(ahang, '/log');
  const clerkHtml = clerkLog.error ? '' : await clerkLog.text();
  log('  room_clerk ahang /log => ', clerkLog.error?'ERR':clerkLog.status(),
      '  contains other-user search "CITIZENSEARCH"?', clerkHtml.includes('CITIZENSEARCH'));
}

log('\n======== 7. SESSIONS & COOKIE FLAGS ========');
{
  // Cookie flags from a fresh anonymous login.
  const anon = await browser.newContext({ baseURL: BASE });
  const lp = await anon.request.get('/login');
  const csrf = /data-csrf="([^"]*)"|name="_csrf" value="([^"]*)"/.exec(await lp.text());
  const tok = csrf ? (csrf[1] || csrf[2]) : '';
  const loginResp = await anon.request.post('/login', { form: { _csrf: tok, username: 'shilan', password: PASSWORD }, maxRedirects: 0 });
  const setCookie = loginResp.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie').map(h => h.value);
  log('  Set-Cookie on login:', short(setCookie.join(' || '), 260));
  await anon.close();

  // Sign-out then reuse: capture cookie, logout, reuse.
  const s = await signIn(browser, 'sozan');
  const before = await get(s, '/inbox'); log('  sozan /inbox before logout =>', before.status());
  const cookies = await s.context.cookies();
  const sess = cookies.find(c => c.name === 'docsys_session');
  await post(s, '/logout', { _csrf: s.csrf });
  const after = await get(s, '/inbox');
  log('  same context /inbox after logout =>', after.status(), after.headers?.()['location'] || '');
  // Reuse the captured cookie value in a brand-new context.
  const replay = await browser.newContext({ baseURL: BASE });
  await replay.addCookies([{ name: 'docsys_session', value: sess.value, url: BASE }]);
  const rr = await replay.request.get('/inbox', { maxRedirects: 0 });
  log('  replay old cookie in fresh context /inbox =>', rr.status(), rr.headers()['location'] || '');
  await replay.close();

  // Deactivated account's live session.
  const uname = ('sectst' + marker).replace(/[^a-z0-9._-]/gi, '').toLowerCase().slice(0, 30);
  const create = await post(it, '/admin/users', { _csrf: it.csrf, username: uname, full_name: 'SEC Test ' + marker, role: 'sysadmin' });
  const createBody = create.error ? '' : await create.text();
  const tempM = /وشەی نهێنی کاتی:\s*(\S+)/.exec(createBody);
  const temp = tempM ? tempM[1] : null;
  log('  created user', uname, 'temp pw:', temp);
  if (temp) {
    const victim = await browser.newContext({ baseURL: BASE });
    const vlp = await victim.request.get('/login');
    const vtokM = /data-csrf="([^"]*)"|name="_csrf" value="([^"]*)"/.exec(await vlp.text());
    const vtok = vtokM ? (vtokM[1] || vtokM[2]) : '';
    await victim.request.post('/login', { form: { _csrf: vtok, username: uname, password: temp }, maxRedirects: 0 });
    const live = await victim.request.get('/password', { maxRedirects: 0 });
    log('  new-account session /password (live) =>', live.status());
    // find the user's id from the admin users page
    const usersHtml = await (await get(it, '/admin/users')).text();
    const idM = new RegExp(`/admin/users/(\\d+)/(?:deactivate|reset|contact)`).exec(usersHtml.slice(Math.max(0, usersHtml.indexOf(uname) - 4000), usersHtml.indexOf(uname) + 4000));
    // simpler: post deactivate by scanning for the row's id near the username
    const near = usersHtml.slice(usersHtml.indexOf(uname), usersHtml.indexOf(uname) + 4000);
    const idM2 = /\/admin\/users\/(\d+)\/deactivate/.exec(near);
    const uid = idM2 ? Number(idM2[1]) : (idM ? Number(idM[1]) : null);
    log('  deactivating uid', uid);
    if (uid) {
      const de = await post(it, `/admin/users/${uid}/deactivate`, { _csrf: it.csrf });
      log('  deactivate =>', de.error?'ERR':de.status());
      const dead = await victim.request.get('/password', { maxRedirects: 0 });
      log('  deactivated-account session /password (retry) =>', dead.status(), dead.headers()['location'] || '');
      const dead2 = await victim.request.get('/admin/users', { maxRedirects: 0 });
      log('  deactivated-account session /admin/users (retry) =>', dead2.status(), dead2.headers()['location'] || '');
    }
    await victim.close();
  }
}

log('\n======== 9. ENUMERATION / THROTTLING ========');
{
  // Sign-in message: two NON-EXISTENT usernames, wrong password (budget: 2 wrong attempts).
  const anon = await browser.newContext({ baseURL: BASE });
  async function tryLogin(u, p) {
    const lp = await anon.request.get('/login');
    const m = /data-csrf="([^"]*)"|name="_csrf" value="([^"]*)"/.exec(await lp.text());
    const tok = m ? (m[1] || m[2]) : '';
    const r = await anon.request.post('/login', { form: { _csrf: tok, username: u, password: p }, maxRedirects: 0 });
    const body = await r.text();
    const em = /notice error">([^<]+)</.exec(body);
    return { status: r.status(), msg: em ? em[1].trim() : '(no error box)' };
  }
  const a1 = await tryLogin('nouser' + marker, 'wrongpass1');
  const a2 = await tryLogin('ghost' + marker, 'wrongpass2');
  log('  nonexistent#1 =>', a1.status, short(a1.msg, 120));
  log('  nonexistent#2 =>', a2.status, short(a2.msg, 120));
  log('  identical message? ', a1.msg === a2.msg);
  await anon.close();

  // Track: real barcode (my own doc) + wrong PIN vs fake barcode + wrong PIN. Budget: 2-3 requests.
  const docHtml = await (await get(shilan, `/documents/${id}`)).text();
  const bcM = /بارکۆد<\/th><td class="mono"><span dir="ltr">(\d+)<\/span>/.exec(docHtml) || /(\d{11})/.exec(docHtml);
  const realBarcode = bcM ? bcM[1] : null;
  log('  my doc barcode:', realBarcode);
  const track = await browser.newContext({ baseURL: BASE });
  async function tryTrack(barcode, pin) {
    const tp = await track.request.get('/track');
    const m = /name="_csrf" value="([^"]*)"/.exec(await tp.text());
    const tok = m ? m[1] : '';
    const r = await track.request.post('/track', { form: { _csrf: tok, barcode, pin }, maxRedirects: 0 });
    const body = await r.text();
    const nm = /notice (error|info)">\s*([^<]+)</.exec(body);
    return { status: r.status(), msg: nm ? nm[2].trim() : '(none)' };
  }
  if (realBarcode) {
    const t1 = await tryTrack(realBarcode, '000000');       // real barcode, wrong pin
    const t2 = await tryTrack('20260000001', '000000');      // likely-fake barcode, wrong pin
    log('  real barcode + wrong pin =>', t1.status, short(t1.msg, 120));
    log('  fake barcode + wrong pin =>', t2.status, short(t2.msg, 120));
    log('  identical (no existence oracle)? ', t1.msg === t2.msg && t1.status === t2.status);
  }
  await track.close();
}

await browser.close();
log('\n----DONE----');
