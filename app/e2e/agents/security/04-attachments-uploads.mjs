import { launch, signIn, registerLetter, get, tag, short, inkPdf, jsPdf, BASE } from './lib.mjs';

const browser = await launch();
const log = (...a) => console.log(a.join(' '));

const shilan = await signIn(browser, 'shilan');
const sozan  = await signIn(browser, 'sozan');
const rebwar = await signIn(browser, 'rebwar');
const it     = await signIn(browser, 'itadmin');

const marker = tag();
const { id } = await registerLetter(shilan.page, { subject: `attach ${marker}`, sender: `snd ${marker}` });
log('doc', id, 'marker', marker);

// Upload helper via multipart, reading _csrf from the field.
async function upload(user, name, buffer, mimeType, kind = 'supporting') {
  const r = await user.context.request.post(`/documents/${id}/attachments`, {
    maxRedirects: 0,
    multipart: {
      _csrf: user.csrf, kind,
      file: { name, mimeType, buffer },
    },
  }).catch(e => ({ error: String(e) }));
  if (r.error) return { status: 'ERR', detail: r.error };
  const loc = r.headers()['location'] || '';
  const err = /error=([^&]+)/.exec(loc);
  return { status: r.status(), loc, err: err ? decodeURIComponent(err[1]) : null };
}

log('\n===== 6. UPLOAD VALIDATION (as shilan, on own doc) =====');
const cases = [
  ['legit.pdf', inkPdf(), 'application/pdf'],
  ['evil.pdf', Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf'],   // HTML mislabelled .pdf
  ['pic.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'), 'image/svg+xml'],
  ['a.pdf.html', Buffer.from('<html>hi</html>'), 'text/html'],
  ['zero.pdf', Buffer.alloc(0), 'application/pdf'],
  ['jsy.pdf', jsPdf(), 'application/pdf'],
];
for (const [name, buf, mt] of cases) {
  const res = await upload(shilan, name, buf, mt);
  log(`  ${name.padEnd(12)} (${buf.length}B) => ${res.status} ${res.err ? 'REJECT: '+short(res.err,80) : (res.loc.includes('attached=1')?'ACCEPTED':res.loc)}`);
}
// 55MB, once. Should be rejected by the 50MiB attach cap.
const big = Buffer.concat([inkPdf(), Buffer.alloc(55 * 1024 * 1024, 0x20)]);
const bigRes = await upload(shilan, 'big.pdf', big, 'application/pdf');
log(`  big.pdf      (55MB) => ${bigRes.status} ${bigRes.err ? 'REJECT: '+short(bigRes.err,80) : bigRes.loc}`);

log('\n===== find attachment ids on the doc =====');
const docHtml = await (await get(shilan, `/documents/${id}`)).text();
const aids = [...new Set([...docHtml.matchAll(/\/attachments\/(\d+)/g)].map(m => Number(m[1])))];
log('  attachment ids:', aids.join(', ') || '(none)');
const aid = aids[0];

if (aid) {
  log('\n===== download headers for a legit attachment (as shilan) =====');
  const dl = await shilan.context.request.get(`/attachments/${aid}?download=1`, { maxRedirects: 0 });
  const inl = await shilan.context.request.get(`/attachments/${aid}`, { maxRedirects: 0 });
  for (const [label, r] of [['inline', inl], ['download', dl]]) {
    const h = r.headers();
    log(`  ${label}: ${r.status()} type=${h['content-type']} disp=${h['content-disposition']} nosniff=${h['x-content-type-options']} cache=${h['cache-control']}`);
  }

  log('\n===== 1. cross-room attachment access (expect 404/refused) =====');
  for (const [who, s] of [['sozan', sozan], ['rebwar', rebwar], ['itadmin', it]]) {
    for (const p of [`/attachments/${aid}`, `/attachments/${aid}/view`, `/attachments/${aid}/text`, `/attachments/${aid}?download=1`]) {
      const r = await get(s, p);
      const st = r.error ? 'ERR' : r.status();
      let leak = '';
      if (!r.error && (st === 200)) { const b = await r.text(); if (b.includes(marker) || b.includes('%PDF')) leak = ' ***LEAK***'; }
      log(`  [${who}] ${p} => ${st}${leak}`);
    }
  }
}

await browser.close();
log('\n----DONE----');
