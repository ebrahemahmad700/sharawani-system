import { chromium } from '@playwright/test';
import { BASE } from './lib.mjs';

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ baseURL: BASE });   // anonymous, no cookies
const R = ctx.request;

const HDRS = ['content-security-policy', 'x-content-type-options', 'referrer-policy',
  'cache-control', 'content-type', 'content-disposition', 'set-cookie', 'x-powered-by',
  'x-frame-options', 'strict-transport-security'];

async function probe(method, path, opts = {}) {
  const r = await (method === 'POST' ? R.post(path, { maxRedirects: 0, ...opts })
                                     : R.get(path, { maxRedirects: 0, ...opts })).catch(e => ({ error: String(e) }));
  if (r.error) { console.log(`${method} ${path} -> ERR ${r.error}`); return; }
  const h = r.headers();
  const loc = h['location'] ? `  ->${h['location']}` : '';
  console.log(`\n${method} ${path} => ${r.status()}${loc}`);
  for (const k of HDRS) if (h[k] !== undefined) console.log(`   ${k}: ${h[k]}`);
}

console.log('======== ANON PUBLIC SURFACE ========');
await probe('GET', '/');
await probe('GET', '/login');
await probe('GET', '/inbox');            // should redirect to login
await probe('GET', '/documents/1');      // protected
await probe('GET', '/nonexistent-page'); // 404 while anon
await probe('GET', '/board');            // redirect to login (no cookie/role)
await probe('GET', '/board/data');       // 403 json
await probe('GET', '/board/stream');
await probe('GET', '/track');
await probe('GET', '/healthz');
await probe('GET', '/app.css');
await probe('GET', '/app.js');
await probe('GET', '/sw.js');
await probe('GET', '/manifest.webmanifest');
await probe('GET', '/offline.html');
await probe('GET', '/vendor/pdfjs/pdf.min.js');
await probe('GET', '/vendor/');          // directory listing?
await probe('GET', '/vendor/pdfjs/');
await probe('GET', '/icons/');

console.log('\n======== CRON (no secret) ========');
await probe('GET', '/api/cron/seal-log');
await probe('GET', '/api/cron/does-not-exist');
await probe('GET', '/api/cron/seal-log', { headers: { authorization: 'Bearer wrong' } });

console.log('\n======== board/data body ========');
const bd = await R.get('/board/data', { maxRedirects: 0 }).catch(e => ({ error: String(e) }));
if (!bd.error) console.log('status', bd.status(), 'body:', (await bd.text()).slice(0, 300));

await browser.close();
console.log('\n----DONE----');
