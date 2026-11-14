import { launch, signIn, registerLetter, get, short, tag } from './lib.mjs';

const XSS = `<img src=x onerror=alert(1)> "><svg onload=alert(2)> {{7*7}}`;

const browser = await launch();
const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

// Sign in as the creator and three would-be snoopers.
const shilan = await signIn(browser, 'shilan');   // registry clerk, front desk
const sozan  = await signIn(browser, 'sozan');    // room_head, accounts
const rebwar = await signIn(browser, 'rebwar');   // room_clerk, contracts 14
const it     = await signIn(browser, 'itadmin');  // sysadmin

log('landing shilan:', shilan.page.url());
log('landing sozan :', sozan.page.url());
log('landing rebwar:', rebwar.page.url());
log('landing it    :', it.page.url());
log('csrf distinct :', new Set([shilan.csrf, sozan.csrf, rebwar.csrf, it.csrf].filter(Boolean)).size, 'of 4');

const marker = tag();
const subject = `بابەتی ${marker} ${XSS}`;
const sender = `نێردەری ${marker} ${XSS}`;
const { id } = await registerLetter(shilan.page, { subject, sender });
log('\ncreated doc id', id, 'as shilan, marker', marker);

// Does the subject marker leak in a response body?
const leaks = body => body.includes(marker);

const addresses = [
  ['/documents/' + id, 'GET'],
  ['/documents/' + id + '/print', 'GET'],
  ['/documents/' + id + '/receipt', 'GET'],
  ['/documents/' + id + '/reply', 'GET'],
  ['/documents/' + id + '/reply/print', 'GET'],
  ['/scan?document_id=' + id, 'GET'],
];

for (const [who, s] of [['sozan', sozan], ['rebwar', rebwar], ['itadmin', it]]) {
  log(`\n=== as ${who} ===`);
  for (const [path] of addresses) {
    const r = await get(s, path);
    if (r.error) { log(`  ${path} -> ERR ${r.error}`); continue; }
    const status = r.status();
    let body = '';
    try { body = await r.text(); } catch {}
    const leak = leaks(body) ? '  ***MARKER LEAKED***' : '';
    log(`  ${path} -> ${status}${leak}`);
    if (leak) log('     snippet:', short(body.slice(Math.max(0, body.indexOf(marker) - 80), body.indexOf(marker) + 120)));
  }
}

// Also: creator can obviously see it (sanity + confirm XSS payload is escaped, not executed).
const self = await get(shilan, '/documents/' + id);
const selfBody = await self.text();
log('\nshilan self view status', self.status());
log('subject rendered raw <img?  ', selfBody.includes('<img src=x onerror'));
log('subject rendered escaped?    ', selfBody.includes('&lt;img src=x onerror'));
log('svg raw?                     ', selfBody.includes('<svg onload'));
log('svg escaped?                 ', selfBody.includes('&lt;svg onload'));

await browser.close();
console.log('\n----DONE----');
