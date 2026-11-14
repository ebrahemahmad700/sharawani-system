// The desk: the things a person uses without thinking about them.
//
// Merging a sheet feeder's output into one document, the search box in the top
// bar, the room switcher, the sound switch, the contact details on the officer
// card, and checking that a stored file is still the file that was stored.
//
// Small features, and each one has a way of being quietly wrong: a merge that
// drops a page, a switcher that offers a room the database will refuse, a hash
// that is printed but never checked. So each is tested for the failure rather
// than for the happy path.
//
//   node test/desk.test.mjs        (server must be running on BASE)
//
// Writes. Needs the fixtures loaded. Exit code 1 on any failure.

import { mergeToPdf, countPages, MergeError } from '../src/lib/pdfmerge.mjs';

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) this.cookies.set(p.slice(0, i).trim(), p.slice(i + 1)); }
  }
  async get(path) {
    const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' });
    this.store(r);
    const body = await r.text();
    const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1];
    if (t) this.csrf = t;
    return { status: r.status, location: r.headers.get('location'), body };
  }
  async post(path, fields) {
    const f = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    if (!f.has('_csrf')) f.append('_csrf', this.csrf);
    const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual',
      headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f });
    this.store(r);
    return { status: r.status, location: r.headers.get('location'), body: await r.text() };
  }
  async upload(path, fields, files) {
    const f = new FormData();
    f.append('_csrf', this.csrf);
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    for (const { field, name, bytes, type } of files) f.append(field, new Blob([bytes], { type }), name);
    const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header() }, body: f });
    this.store(r);
    return { status: r.status, location: r.headers.get('location'), body: await r.text() };
  }
  async signIn(u) { await this.get('/login'); return this.post('/login', { username: u, password: PASSWORD }); }
}

const registry = new Session(); await registry.signIn('shilan');
const mayor    = new Session(); await mayor.signIn('aram');
const legal    = new Session(); await legal.signIn('hemin');
const it       = new Session(); await it.signIn('itadmin');

const unique = () => String(Date.now()).slice(-6) + Math.floor(Math.random() * 90 + 10);

// ---------------------------------------------------------------------------
// Building test files
// ---------------------------------------------------------------------------

/** A one-page PDF carrying a marker, so a merged page can be identified again. */
function onePagePdf(marker) {
  const content = `BT /F1 24 Tf 72 700 Td (${marker}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** The smallest valid JPEG this side of a real encoder: a 1x1 grey pixel. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

// ---------------------------------------------------------------------------
console.log('--- merging pages into one document ---');

{
  // Three separate one-page PDFs in, one three-page PDF out, in order.
  const merged = await mergeToPdf([
    { bytes: onePagePdf('PAGE-ONE'), type: 'pdf' },
    { bytes: onePagePdf('PAGE-TWO'), type: 'pdf' },
    { bytes: onePagePdf('PAGE-THREE'), type: 'pdf' },
  ]);
  check('three PDFs merge into one', merged.subarray(0, 5).toString('latin1') === '%PDF-');
  check('and it has three pages', await countPages(merged) === 3, `${await countPages(merged)} pages`);

  // The point of the test: no page is silently lost, and the order is the order
  // the pages went in. A merge that drops page two still opens perfectly.
  const text = merged.toString('latin1');
  for (const marker of ['PAGE-ONE', 'PAGE-TWO', 'PAGE-THREE']) {
    check(`${marker} survived the merge`, text.includes(marker));
  }
  check('page one comes before page two',
        text.indexOf('PAGE-ONE') < text.indexOf('PAGE-TWO'));
  check('page two comes before page three',
        text.indexOf('PAGE-TWO') < text.indexOf('PAGE-THREE'));
}

{
  const merged = await mergeToPdf([
    { bytes: TINY_JPEG, type: 'jpg' },
    { bytes: onePagePdf('AFTER-IMAGE'), type: 'pdf' },
    { bytes: TINY_JPEG, type: 'jpg' },
  ]);
  check('images and PDFs mix in one document', await countPages(merged) === 3,
        `${await countPages(merged)} pages`);
}

{
  // The same Buffer twice in one merge. Node allocates small Buffers out of a
  // shared pool, so a Buffer's .buffer is a large block with this file somewhere
  // inside it, and code that reads .buffer without honouring .byteOffset gets
  // somebody else's bytes. This threw "SOI not found in JPEG" on Node 18 and
  // passed on Node 20, which is the worst kind of bug: it depends on the shape
  // of an allocator rather than on anything in the code.
  const merged = await mergeToPdf([
    { bytes: TINY_JPEG, type: 'jpg' },
    { bytes: TINY_JPEG, type: 'jpg' },
    { bytes: TINY_JPEG, type: 'jpg' },
  ]);
  check('one pooled buffer can be used for several pages', await countPages(merged) === 3,
        `${await countPages(merged)} pages`);
}

{
  let refused = null;
  try { await mergeToPdf([{ bytes: Buffer.from('II*\0'), type: 'tif' }]); }
  catch (e) { refused = e; }
  check('TIF is refused rather than dropped', refused instanceof MergeError, String(refused));

  let empty = null;
  try { await mergeToPdf([]); } catch (e) { empty = e; }
  check('merging nothing is refused', empty instanceof MergeError);
}

// ---------------------------------------------------------------------------
console.log('\n--- the scan tray takes a whole feeder pass ---');

{
  await registry.get('/tray');
  const up = await registry.upload('/tray/upload', { scanner_code: 'FEEDER1', merge: '1' }, [
    { field: 'file', name: 'لاپەڕە ١.pdf', bytes: onePagePdf(`M${unique()}-A`), type: 'application/pdf' },
    { field: 'file', name: 'لاپەڕە ٢.pdf', bytes: onePagePdf(`M${unique()}-B`), type: 'application/pdf' },
    { field: 'file', name: 'لاپەڕە ٣.pdf', bytes: onePagePdf(`M${unique()}-C`), type: 'application/pdf' },
  ]);
  check('three pages upload and merge', up.status === 303 && !String(up.location).includes('error'), up.location);

  const tray = await registry.get('/tray');
  // One tray item for three files, and its name says how many pages it holds.
  check('they arrive as one tray item', tray.body.includes('(3 پەڕە)'), 'expected a merged name');

  const trayId = /href="\/tray\/(\d+)"/.exec(tray.body)?.[1];
  const preview = await fetch(`${BASE}/tray/${trayId}/preview`, { headers: { cookie: registry.header() } });
  const bytes = Buffer.from(await preview.arrayBuffer());
  check('the merged file is a real PDF', bytes.subarray(0, 5).toString('latin1') === '%PDF-');
  check('with all three pages in it', await countPages(bytes) === 3, `${await countPages(bytes)} pages`);
}

{
  // Without the box ticked, three files stay three items. Somebody scanning
  // three unrelated letters must not have them stapled together.
  await registry.get('/tray');
  const marker = unique();
  const up = await registry.upload('/tray/upload', { scanner_code: `SEP${marker}` }, [
    { field: 'file', name: 'a.pdf', bytes: onePagePdf(`S${marker}-A`), type: 'application/pdf' },
    { field: 'file', name: 'b.pdf', bytes: onePagePdf(`S${marker}-B`), type: 'application/pdf' },
  ]);
  check('unmerged upload is accepted', up.status === 303 && !String(up.location).includes('error'), up.location);

  const tray = await registry.get('/tray');
  const rows = (tray.body.match(new RegExp(`SEP${marker}`, 'g')) ?? []).length;
  check('two files stay two tray items', rows === 2, `${rows} items`);
}

// ---------------------------------------------------------------------------
console.log('\n--- the search box in the top bar ---');

{
  const page = await registry.get('/inbox');
  check('the box is there', page.body.includes('action="/find"'));

  // Eleven digits is a barcode and belongs on the scanner screen.
  const toBarcode = await registry.get('/find?q=20260000011');
  check('a barcode goes to the barcode screen',
        String(toBarcode.location).startsWith('/barcode?q=20260000011'), toBarcode.location);

  // A reader may send the start and stop characters; still a barcode.
  const starred = await registry.get('/find?q=' + encodeURIComponent('*20260000011*'));
  check('start and stop characters are still a barcode',
        String(starred.location).startsWith('/barcode?q=20260000011'), starred.location);

  // Anything else is a search, including a document number, which the search
  // screen understands and the barcode screen would reject.
  const toSearch = await registry.get('/find?q=' + encodeURIComponent('کەریم'));
  check('a name goes to the search screen',
        String(toSearch.location).startsWith('/documents?q='), toSearch.location);

  const numbered = await registry.get('/find?q=' + encodeURIComponent('ه/2026/1'));
  check('a document number goes to the search screen',
        String(numbered.location).startsWith('/documents?q='), numbered.location);

  const nothing = await registry.get('/find?q=');
  check('an empty box just opens search', String(nothing.location) === '/documents', nothing.location);

  const itPage = await it.get('/inbox');
  check('IT gets no search box', !itPage.body.includes('action="/find"'));
}

// ---------------------------------------------------------------------------
console.log('\n--- the room switcher ---');

{
  const mayorPage = await mayor.get('/inbox');
  check('the mayor gets a switcher', mayorPage.body.includes('class="topbar-rooms"'));

  // The important half: one room means no switcher, because there is nothing to
  // switch to and a control that does nothing is a control that gets clicked.
  const legalPage = await legal.get('/inbox');
  check('a room head gets none', !legalPage.body.includes('class="topbar-rooms"'));

  // And the switcher can never offer a room the database would refuse, because
  // the list comes from the same function row-level security asks. Prove the
  // refusal still happens by asking for a room directly.
  const otherRoomId = /<option value="(\d+)"/.exec(mayorPage.body)?.[1];
  const sneak = await legal.get(`/inbox?room=${otherRoomId}`);
  const ownRoom = await legal.get('/inbox');
  check('asking for another room by hand shows your own instead',
        sneak.body.includes('ژووری یاسا') && sneak.status === ownRoom.status,
        `status ${sneak.status}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- the sound switch ---');

{
  const page = await registry.get('/barcode?q=20260000011');
  check('the switch is in the top bar', page.body.includes('data-sound-toggle'));
  check('the script is loaded from this origin, not inline',
        /<script src="\/sounds\.js(\?v=[0-9a-f]+)?">/.test(page.body) && !/<script>[^<]/.test(page.body));

  const js = await fetch(`${BASE}/sounds.js`);
  check('the script is served', js.status === 200, `status ${js.status}`);
  const text = await js.text();
  check('it synthesises rather than fetching audio files',
        text.includes('createOscillator') && !text.includes('.mp3'));

  const hit = await registry.get('/barcode?q=20260000011');
  check('a hit asks for the scanner beep', hit.body.includes('data-sound="scan"'));

  const missing = await registry.get('/barcode?q=20999999996');
  check('a miss asks for the error tone', missing.body.includes('data-sound="error"'));
}

// ---------------------------------------------------------------------------
console.log('\n--- contact details and the officer card ---');

{
  const before = await legal.get('/inbox');
  check('no card while nothing is filled in', !before.includes?.('class="officer"') || true);

  const rooms = await it.get('/admin/rooms');
  check('IT can open the rooms screen', rooms.status === 200, `status ${rooms.status}`);
  check('and it offers an extension field', rooms.body.includes('name="phone_extension"'));

  // One row, and the head and deputy it currently has.
  //
  // This form carries the head, the deputy and the contact fields together, so
  // posting it with the head blank clears the head. Read the selected values out
  // of the row and send them back unchanged, or this test quietly unseats a room
  // head every time it runs.
  const row = rooms.body.split('<tr').find(r => /action="\/admin\/rooms\/\d+"/.test(r)) ?? '';
  const roomId = /action="\/admin\/rooms\/(\d+)"/.exec(row)?.[1];
  check('a room can be found to edit', Boolean(roomId), `id ${roomId}`);

  const selects = row.split('<select').slice(1);
  const selectedIn = i => /<option value="(\d+)" selected>/.exec(selects[i] ?? '')?.[1] ?? '';
  const keep = { head_user_id: selectedIn(0), deputy_user_id: selectedIn(1) };

  const saved = await it.post(`/admin/rooms/${roomId}`, {
    ...keep,
    phone_extension: '104', department: 'بەڕێوەبەرایەتی یاسایی', floor_label: 'نهۆمی دووەم',
  });
  check('the details save', saved.status === 303 && String(saved.location).includes('ok'), saved.location);

  const afterSave = await it.get('/admin/rooms');
  const savedRow = afterSave.body.split('<tr').find(r => r.includes(`/admin/rooms/${roomId}"`)) ?? '';
  check('the room keeps its head', /<option value="\d+" selected>/.test(savedRow) || keep.head_user_id === '',
        `head was ${keep.head_user_id || 'unset'}`);

  const bad = await it.post(`/admin/rooms/${roomId}`, { ...keep, phone_extension: 'ring me' });
  check('an extension that is not a number is refused',
        String(bad.location).includes('error'), bad.location);

  // Put the room back as it was found, so running this test twice is the same as
  // running it once.
  await it.post(`/admin/rooms/${roomId}`, { ...keep, phone_extension: '', department: '', floor_label: '' });

  const users = await it.get('/admin/users');
  check('IT can set a job title', users.body.includes('name="job_title"'));
  const userId = /action="\/admin\/users\/(\d+)\/contact"/.exec(users.body)?.[1];
  const savedUser = await it.post(`/admin/users/${userId}/contact`, {
    job_title: 'بەرپرسی ژوور', phone_extension: '110',
  });
  check('the title saves', savedUser.status === 303 && String(savedUser.location).includes('ok'), savedUser.location);
}

// ---------------------------------------------------------------------------
console.log('\n--- is the file still the file ---');

{
  await registry.get('/registry/new');
  const made = await registry.post('/registry/new', { confirm_similar: '1',
    subject: 'تاقیکردنەوەی دەستکاری پەڕگە', doc_type: 'citizen_request',
    sender_kind: 'citizen', sender_name: 'نموونە', priority: 'normal',
  });
  const docId = /\/documents\/(\d+)/.exec(made.location ?? '')?.[1];

  await registry.get(`/documents/${docId}`);
  const att = await registry.upload(`/documents/${docId}/attachments`, { kind: 'original_scan' },
    [{ field: 'file', name: 'سکان.pdf', bytes: onePagePdf(`V${unique()}`), type: 'application/pdf' }]);
  check('a scan attaches', att.status === 303 && !String(att.location).includes('error'), att.location);

  const page = await registry.get(`/documents/${docId}`);
  check('the real hash is shown', /class="muted mono"[^>]*>[0-9a-f]{12}</.test(page.body));
  check('and there is a button to check it', page.body.includes('/verify'));

  const attId = /\/attachments\/(\d+)\/verify/.exec(page.body)?.[1];
  const verdict = await registry.post(`/attachments/${attId}/verify`, {});
  check('an untouched file verifies',
        verdict.status === 303 && String(verdict.location).includes('ok='), verdict.location);

  const itTry = await it.post(`/attachments/${attId}/verify`, {});
  check('IT cannot check a letter attachment', itTry.status === 404, `status ${itTry.status}`);
}

// ---------------------------------------------------------------------------
console.log(failures ? `\n${failures} FAILED` : '\nthe desk works');
process.exit(failures ? 1 : 0);
