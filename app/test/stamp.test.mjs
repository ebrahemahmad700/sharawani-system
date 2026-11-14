// The arrival and dispatch marks on a scan, over HTTP.
//
//   node test/stamp.test.mjs           (server must be running on BASE)
//
// Registers letters, attaches scans and stamps them, so it refuses anything but a
// database on this machine. What it holds the feature to:
//
//   · the mark is drawn onto a copy and the scan underneath is left alone;
//   · the dispatch mark is refused until the letter has an outgoing number;
//   · a stamped copy is what the comparison screen then shows on that side;
//   · IT cannot stamp, and a request without a token is refused;
//   · every mark is on the record (stamp.applied) and says what it printed.

import { PDFDocument } from 'pdf-lib';
import { deflateSync } from 'zlib';

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

if (!/localhost|127\.0\.0\.1|\/\/app[:/]/.test(BASE)) {
  console.error(`refusing to run against ${BASE}: this test registers letters and writes files.`);
  process.exit(2);
}

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i).trim(); const v = p.slice(i + 1); if (v) this.cookies.set(k, v); else this.cookies.delete(k); } } }
  async get(path) { const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) { for (const one of [].concat(v)) f.append(k, one); } if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async upload(path, fields, files, { csrf = true } = {}) { const f = new FormData(); if (csrf) f.append('_csrf', this.csrf); for (const [k, v] of Object.entries(fields)) f.append(k, v); for (const [k, name, bytes] of files) f.append(k, new Blob([bytes]), name); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), accept: 'application/json' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async signIn(u) { await this.get('/login'); const r = await this.post('/login', { username: u, password: PASSWORD }); await this.get('/inbox'); return r; }
}

const json = s => { try { return JSON.parse(s); } catch { return {}; } };
const mark = Math.random().toString(36).slice(2, 8);
const idFrom = loc => /\/documents\/(\d+)/.exec(loc ?? '')?.[1];

// A transparent PNG with one opaque corner, standing in for the drawn mark.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function markPng(w = 400, h = 566) {
  const row = w * 4 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 20; y < 70; y++) {
    for (let x = 20; x < 160; x++) {
      const o = y * row + 1 + x * 4;
      raw[o] = 31; raw[o + 1] = 63; raw[o + 2] = 156; raw[o + 3] = 255;
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function scanPdf(label) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawText(`${label} ${mark}`, { x: 50, y: 780, size: 12 });
  doc.addPage([595.28, 841.89]);
  return Buffer.from(await doc.save());
}

const shilan = new Session(); await shilan.signIn('shilan');
const it = new Session();     await it.signIn('itadmin');

const { body: form } = await shilan.get('/registry/new');
const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(form)?.[1] ?? '';

async function register() {
  await shilan.get('/registry/new');
  const r = await shilan.post('/registry/new', {
    subject: `داواکاری تاقیکردنەوەی مۆر ${mark} ${Math.random().toString(36).slice(2, 6)}`,
    doc_type_option_id: typeId, sender_kind: 'citizen', sender_name: `هاووڵاتی ${mark}`,
    priority: 'normal', confirm_similar: '1',
  });
  return idFrom(r.location);
}

// ---------------------------------------------------------------------------
console.log('--- the arrival mark ---');

const docId = await register();
const up = await shilan.upload(`/documents/${docId}/attachments`, { kind: 'original_scan' },
  [['file', `scan-${mark}.pdf`, await scanPdf('intake')]]);
check('a letter with a two-page scan exists', Boolean(docId) && [200, 303].includes(up.status), `status ${up.status}`);

const letter = await shilan.get(`/documents/${docId}`);
const scanId = Number(/\/attachments\/(\d+)\/view/.exec(letter.body)?.[1]);
check('the letter page offers to stamp the scan', letter.body.includes(`/attachments/${scanId}/stamp`));

const stampPage = await shilan.get(`/attachments/${scanId}/stamp`);
check('the stamping page opens with the scan and the mark on it',
  stampPage.status === 200 && stampPage.body.includes('data-stamp')
  && stampPage.body.includes(`data-file="/attachments/${scanId}"`)
  && stampPage.body.includes('stamp.js'), `status ${stampPage.status}`);
check('it offers the arrival mark and refuses the dispatch one for now',
  stampPage.body.includes('مۆری هاتوو') && stampPage.body.includes('هێشتا ژمارەی دەرچووی نییە'));

const early = await shilan.upload(`/attachments/${scanId}/stamp`, { kind: 'outgoing', page_no: '1' },
  [['ink', 'stamp.png', markPng()]]);
check('a dispatch mark is refused before the letter has an outgoing number',
  early.status === 400 && /ژمارەی دەرچووی نییە/.test(json(early.body).error ?? ''), `status ${early.status}`);

const noToken = await shilan.upload(`/attachments/${scanId}/stamp`, { kind: 'incoming', page_no: '1' },
  [['ink', 'stamp.png', markPng()]], { csrf: false });
check('a request without a token is refused', noToken.status === 403, `status ${noToken.status}`);

const refusedForIt = await it.upload(`/attachments/${scanId}/stamp`, { kind: 'incoming', page_no: '1' },
  [['ink', 'stamp.png', markPng()]]);
check('IT may not stamp anything', [403, 404].includes(refusedForIt.status), `status ${refusedForIt.status}`);

const applied = await shilan.upload(`/attachments/${scanId}/stamp`, { kind: 'incoming', page_no: '2' },
  [['ink', 'stamp.png', markPng()]]);
const appliedBody = json(applied.body);
check('the arrival mark is applied', applied.status === 200 && /done=stamp_incoming/.test(appliedBody.location ?? ''),
  `status ${applied.status} ${applied.body.slice(0, 120)}`);

const stampedId = Number(appliedBody.attachment_id);
const after = await shilan.get(`/documents/${docId}`);
check('a new stamped copy is on the letter, the scan under it untouched',
  Number.isFinite(stampedId) && stampedId !== scanId
  && after.body.includes(`/attachments/${stampedId}/view`) && after.body.includes(`/attachments/${scanId}/view`));
check('the list says which copy carries the arrival mark', after.body.includes('مۆری هاتوو'));
check('the stamped copy is a PDF of the whole scan',
  /هاتوو-[^"]*\.pdf/.test(after.body) && /٢ پەڕە|2 پەڕە/.test(after.body));

const cmpIn = await shilan.get(`/documents/${docId}/compare`);
check('the comparison screen shows the stamped copy as what came in',
  cmpIn.body.includes(`data-pdf-file="/attachments/${stampedId}"`));

// ---------------------------------------------------------------------------
console.log('--- the dispatch mark ---');

const closed = await shilan.post(`/documents/${docId}/close`, {
  recipient: `وەرگری تاقیکردنەوە ${mark}`, channel: 'hand', summary: `وەڵامی تاقیکردنەوە ${mark}`,
});
check('the letter is answered and closed', closed.status === 303 && /closed=1/.test(closed.location ?? ''), closed.location);

const up2 = await shilan.upload(`/documents/${docId}/attachments`, { kind: 'original_scan' },
  [['file', `signed-${mark}.pdf`, await scanPdf('signed')]]);
check('the signed paper is scanned back in', [200, 303].includes(up2.status), `status ${up2.status}`);
const page2 = await shilan.get(`/documents/${docId}`);
const signedId = Math.max(...[...page2.body.matchAll(/\/attachments\/(\d+)\/view/g)].map(m => Number(m[1])));

const out = await shilan.upload(`/attachments/${signedId}/stamp`, { kind: 'outgoing', page_no: '1' },
  [['ink', 'stamp.png', markPng()]]);
const outBody = json(out.body);
check('the dispatch mark is applied once there is an outgoing number',
  out.status === 200 && /done=stamp_outgoing/.test(outBody.location ?? ''), `status ${out.status} ${out.body.slice(0, 120)}`);

const cmpOut = await shilan.get(`/documents/${docId}/compare`);
check('the comparison screen shows the dispatch copy as what went out',
  cmpOut.body.includes(`data-pdf-file="/attachments/${outBody.attachment_id}"`));
check('and still shows the stamped arrival copy beside it',
  cmpOut.body.includes(`data-pdf-file="/attachments/${stampedId}"`));

// ---------------------------------------------------------------------------
console.log('--- on the record ---');

const aram = new Session(); await aram.signIn('aram');
const log = await aram.get('/log?action=stamp.applied');
check('every mark is on the record', log.body.includes('مۆری هاتوو/دەرچووی لە سکانێک دا'));

// ---------------------------------------------------------------------------
console.log(failures ? `\n${failures} check(s) failed` : '\nthe marks hold');
process.exit(failures ? 1 : 0);
