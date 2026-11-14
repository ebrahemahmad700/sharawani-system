// What came in beside what went out, over HTTP.
//
//   node test/compare.test.mjs         (server must be running on BASE)
//
// Registers letters, attaches scans to them and opens /documents/:id/compare, so
// it never runs anywhere but this machine or inside compose. The things it holds
// the screen to:
//
//   · the two scans it chooses are the first one in and the last one out;
//   · a file id in the link that belongs to another letter is ignored, so the
//     page cannot be talked into showing a scan from a letter next door;
//   · the side with nothing yet says what is missing instead of looking broken;
//   · somebody who may not read the letter gets the same "not found" as for the
//     letter itself, and the refusal is written down;
//   · opening it is on the record (compare.viewed).

import { PDFDocument } from 'pdf-lib';

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

if (!/localhost|127\.0\.0\.1|\/\/app[:/]/.test(BASE)) {
  console.error(`refusing to run against ${BASE}: this test registers letters and attaches files.`);
  process.exit(2);
}

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i).trim(); const v = p.slice(i + 1); if (v) this.cookies.set(k, v); else this.cookies.delete(k); } } }
  async get(path, headers = {}) { const r = await fetch(BASE + path, { headers: { cookie: this.header(), ...headers }, redirect: 'manual' }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) { for (const one of [].concat(v)) f.append(k, one); } if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async upload(path, fields, files) { const f = new FormData(); f.append('_csrf', this.csrf); for (const [k, v] of Object.entries(fields)) f.append(k, v); for (const [k, name, bytes] of files) f.append(k, new Blob([bytes]), name); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), accept: 'application/json' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async signIn(u) { await this.get('/login'); const r = await this.post('/login', { username: u, password: PASSWORD }); await this.get('/inbox'); return r; }
}

const mark = Math.random().toString(36).slice(2, 8);
const idFrom = loc => /\/documents\/(\d+)/.exec(loc ?? '')?.[1];

async function onePagePdf(label) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawText(`${label} ${mark}`, { x: 50, y: 780, size: 12 });
  return Buffer.from(await doc.save());
}

const aram = new Session();   await aram.signIn('aram');      // mayor
const shilan = new Session(); await shilan.signIn('shilan');  // registry
const it = new Session();     await it.signIn('itadmin');     // may not read letters

const { body: form } = await shilan.get('/registry/new');
const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(form)?.[1] ?? '';

async function register(extra = {}) {
  await shilan.get('/registry/new');
  const r = await shilan.post('/registry/new', {
    subject: `داواکاری تاقیکردنەوەی بەراورد ${mark} ${Math.random().toString(36).slice(2, 6)}`,
    doc_type_option_id: typeId, sender_kind: 'citizen', sender_name: `هاووڵاتی ${mark}`,
    priority: 'normal', confirm_similar: '1', ...extra,
  });
  return idFrom(r.location);
}

const attach = (id, kind, name) => onePagePdf(name)
  .then(bytes => shilan.upload(`/documents/${id}/attachments`, { kind }, [['file', `${name}-${mark}.pdf`, bytes]]));

// ---------------------------------------------------------------------------
console.log('--- a letter with both scans ---');

const full = await register();
check('a letter is registered', Boolean(full));
const up1 = await attach(full, 'original_scan', 'intake');
const up2 = await attach(full, 'outgoing_copy', 'outgoing');
check('the intake scan and the stamped copy are both attached',
  [200, 303].includes(up1.status) && [200, 303].includes(up2.status), `${up1.status} / ${up2.status}`);

const letter = await shilan.get(`/documents/${full}`);
check('the letter page offers the comparison', letter.body.includes(`/documents/${full}/compare`));
const fileIds = [...letter.body.matchAll(/\/attachments\/(\d+)\/view/g)].map(m => Number(m[1]));
const intakeId = Math.min(...fileIds);
const outgoingId = Math.max(...fileIds);

const cmp = await shilan.get(`/documents/${full}/compare`);
check('the comparison opens', cmp.status === 200, `status ${cmp.status}`);
check('both scans are on the screen', cmp.body.includes(`data-pdf-file="/attachments/${intakeId}"`)
  && cmp.body.includes(`data-pdf-file="/attachments/${outgoingId}"`));
check('the first scan is the intake side and the stamped copy the outgoing side',
  cmp.body.indexOf(`data-cmp-pane="intake"`) < cmp.body.indexOf(`data-cmp-pane="outgoing"`)
  && /data-cmp-pane="intake"[\s\S]{0,200}data-pdf-file="\/attachments\/(\d+)"/.exec(cmp.body)?.[1] === String(intakeId));
check('each side has a band saying what the register holds',
  cmp.body.includes('وەرگیرا') && cmp.body.includes('نێردرا') && cmp.body.includes('لە تۆماردا:'));
check('the band does not claim the mark is printed on the paper', !cmp.body.includes('لەسەر کاغەز مۆرکراوە'));
check('both scans can be downloaded',
  cmp.body.includes(`/attachments/${intakeId}?download=1`) && cmp.body.includes(`/attachments/${outgoingId}?download=1`));
check('the line of time starts at registration', cmp.body.includes('کتاب تۆمارکرا و سکان کرا')
  && cmp.body.includes('class="cmp-stops"'));
check('the screen draws itself with compare.js', /compare\.js/.test(cmp.body));

// ---------------------------------------------------------------------------
console.log('--- choosing another file, and asking for one that is not ours ---');

const other = await register();
await attach(other, 'original_scan', 'someone-elses');
const otherPage = await shilan.get(`/documents/${other}`);
const otherFileId = Number(/\/attachments\/(\d+)\/view/.exec(otherPage.body)?.[1]);
check('a second letter with its own scan exists', Number.isFinite(otherFileId) && otherFileId !== intakeId);

const stolen = await shilan.get(`/documents/${full}/compare?in=${otherFileId}`);
check('a file id from another letter is ignored, not shown',
  stolen.status === 200 && !stolen.body.includes(`data-pdf-file="/attachments/${otherFileId}"`)
  && stolen.body.includes(`data-pdf-file="/attachments/${intakeId}"`), `status ${stolen.status}`);

const third = await attach(full, 'supporting', 'more-paper');
check('a third file is attached to the first letter', [200, 303].includes(third.status));
const again = await shilan.get(`/documents/${full}`);
const thirdId = Math.max(...[...again.body.matchAll(/\/attachments\/(\d+)\/view/g)].map(m => Number(m[1])));
const chosen = await shilan.get(`/documents/${full}/compare?in=${thirdId}`);
check('a file of this letter can be chosen for a side',
  chosen.body.includes(`data-pdf-file="/attachments/${thirdId}"`) && chosen.body.includes('فایلێکی تر'));
check('the other side keeps the file it had', chosen.body.includes(`data-pdf-file="/attachments/${outgoingId}"`));

// ---------------------------------------------------------------------------
console.log('--- the side that is still empty ---');

const half = await register();
await attach(half, 'original_scan', 'intake-only');
const halfCmp = await shilan.get(`/documents/${half}/compare`);
check('the outgoing side says the answer has not been sent yet',
  halfCmp.status === 200 && halfCmp.body.includes('هێشتا وەڵامی ئەم کتابە نەنێردراوە'), `status ${halfCmp.status}`);
check('and it offers to write the reply, not a broken viewer',
  halfCmp.body.includes(`/documents/${half}/reply`) && (halfCmp.body.match(/data-pdf-file/g) ?? []).length === 1);

const bare = await register();
const bareCmp = await shilan.get(`/documents/${bare}/compare`);
check('a letter with no scan at all opens and says so',
  bareCmp.status === 200 && bareCmp.body.includes('هێشتا سکانی کاغەزی هاتوو نییە'), `status ${bareCmp.status}`);
const bareLetter = await shilan.get(`/documents/${bare}`);
check('and its letter page does not offer a comparison', !bareLetter.body.includes(`/documents/${bare}/compare`));

// ---------------------------------------------------------------------------
console.log('--- who may open it ---');

const refused = await it.get(`/documents/${full}/compare`);
check('the IT account gets the same answer as for the letter itself',
  refused.status === 404 && !refused.body.includes(`data-pdf-file`), `status ${refused.status}`);

const log = await aram.get('/log?action=compare.viewed');
check('opening the comparison is on the record', log.body.includes('هاتوو و دەرچووی کتابێکی بەراورد کرد'));
const refusals = await aram.get('/log?action=access.refused');
check('the refusal is on the record too', refusals.body.includes('داوای کتابێکی کرد کە ڕێگەی پێنەدرا'));

// ---------------------------------------------------------------------------
console.log(failures ? `\n${failures} check(s) failed` : '\nthe two scans hold');
process.exit(failures ? 1 : 0);
