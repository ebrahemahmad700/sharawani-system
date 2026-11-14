import { launch, signIn, post, get, tag } from './lib.mjs';
const browser = await launch();
const log = (...a) => console.log(a.join(' '));
const shilan = await signIn(browser, 'shilan');

async function mk(fields, label) {
  const M = tag();
  const r = await post(shilan, '/companies/new', { _csrf: shilan.csrf, name: `co ${M}`, ...fields });
  const st = r.status?.();
  const loc = r.headers?.()['location'] || '';
  log(`  ${label.padEnd(34)} => ${st} ${loc.startsWith('/companies?error')?'(handled error)':loc}`);
}

log('isolating company /new 500:');
await mk({}, 'baseline plain');
await mk({ note: 'plain note' }, 'note plain');
await mk({ address: 'plain address' }, 'address plain');
await mk({ name: `co <b>${tag()}</b>` }, 'name with <b>');
await mk({ name: `co "${tag()}"` }, 'name with quotes');
await mk({ name: `co {{7*7}} ${tag()}` }, 'name with {{}}');
await mk({ email: 'not-an-email' }, 'email invalid');
await mk({ email: 'a@b.co' }, 'email valid');
await mk({ capital: 'abc' }, 'capital non-numeric');
await mk({ capital: '1000' }, 'capital numeric');
await mk({ licence_expires_on: 'not-a-date' }, 'licence bad date');
await mk({ tax_no: 'x'.repeat(400) }, 'tax_no very long');
await mk({ phone: '<img src=x onerror=alert(1)>' }, 'phone with payload');
await mk({ registration_no: '<svg onload=1>' }, 'reg_no with payload');

await browser.close();
log('----DONE----');
