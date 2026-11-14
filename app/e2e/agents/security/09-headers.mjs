import { launch, signIn, registerLetter, get, post, tag } from './lib.mjs';
const browser = await launch();
const log = (...a) => console.log(a.join(' '));
const shilan = await signIn(browser, 'shilan');
const { id } = await registerLetter(shilan.page, { subject: `hdr ${tag()}`, sender: 'x' });

// upload a pdf to get an attachment
await shilan.context.request.post(`/documents/${id}/attachments`, { maxRedirects:0,
  multipart: { _csrf: shilan.csrf, kind:'supporting', file:{ name:'h.pdf', mimeType:'application/pdf', buffer: (await import('./lib.mjs')).inkPdf() } } });
const dh = await (await get(shilan, `/documents/${id}`)).text();
const aid = /\/attachments\/(\d+)/.exec(dh)?.[1];

async function hdr(label, doGet) {
  const r = await doGet();
  const h = r.headers();
  log(`${label} [${r.status()}]`);
  log(`   CSP:${h['content-security-policy']?'yes':'NO'} nosniff:${h['x-content-type-options']||'NO'} referrer:${h['referrer-policy']||'NO'} cache:${h['cache-control']||'(none)'} frame-anc:${/frame-ancestors 'none'/.test(h['content-security-policy']||'')?'none':'NO'}`);
}

await hdr('signed-in page /documents/:id', () => get(shilan, `/documents/${id}`));
await hdr('print /documents/:id/print', () => get(shilan, `/documents/${id}/print`));
if (aid) await hdr('attachment inline', () => get(shilan, `/attachments/${aid}`));
await hdr('403 refused (assistant as clerk)', () => get(shilan, '/assistant'));
await hdr('404 (missing doc)', () => get(shilan, '/documents/99999999'));
await hdr('500 (company create missing reg_no)', () => post(shilan, '/companies/new', { _csrf: shilan.csrf, name: `x ${tag()}` }));

await browser.close();
log('\n----DONE----');
