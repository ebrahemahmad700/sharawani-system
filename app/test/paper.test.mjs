// The paper half of the system, over HTTP.
//
// Barcodes, signing for a folder, delivery manifests, the applicant's receipt,
// the public tracking page, the company register, the transaction type
// catalogue and notes on a letter.
//
// These all exist for one reason: the record of where a letter is and the
// whereabouts of the paper it is written on used to be the same fact, and they
// are not. A room can complete a step on screen while the folder sits in a tray
// by the photocopier, and until now nothing could say so.
//
//   node test/paper.test.mjs      (server must be running on BASE)
//
// Writes. Needs the fixtures loaded. Exit code 1 on any failure.

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
    const r = await fetch(BASE + path, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: f,
    });
    this.store(r);
    return { status: r.status, location: r.headers.get('location'), body: await r.text() };
  }
  async upload(path, fields, files) {
    const f = new FormData();
    f.append('_csrf', this.csrf);
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    for (const [k, { name, bytes, type }] of Object.entries(files)) f.append(k, new Blob([bytes], { type }), name);
    const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header() }, body: f });
    this.store(r);
    return { status: r.status, location: r.headers.get('location'), body: await r.text() };
  }
  async signIn(u) { await this.get('/login'); return this.post('/login', { username: u, password: PASSWORD }); }
}

// Unique bytes each time, so two uploads never share a hash and a stale row
// cannot be mistaken for a fresh one.
const pdfBytes = () => Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n'),
  Buffer.from(`% ${Math.random()}\n`),
  Buffer.from('trailer<</Root 1 0 R>>\n%%EOF\n'),
]);

const registry = new Session(); await registry.signIn('shilan');
const legal    = new Session(); await legal.signIn('hemin');
const it       = new Session(); await it.signIn('itadmin');
const anon     = new Session();

const unique = () => String(Date.now()).slice(-6) + Math.floor(Math.random() * 90 + 10);

// ---------------------------------------------------------------------------
console.log('--- barcodes ---');

// Register a letter and read its barcode off its own receipt, rather than
// assuming one: the barcode comes from the sequence within the year and the row
// id comes from the table, and the two are only ever equal by coincidence.
await registry.get('/registry/new');
const made = await registry.post('/registry/new', { confirm_similar: '1',
  subject: 'داواکاری تاقیکردنەوەی پەڕگە', doc_type: 'citizen_request',
  sender_kind: 'citizen', sender_name: 'ئاسۆ نموونە', priority: 'normal',
});
const docId = /\/documents\/(\d+)/.exec(made.location ?? '')?.[1];
check('a letter can be registered', Boolean(docId), made.location ?? `status ${made.status}`);

const receipt = await registry.get(`/documents/${docId}/receipt`);
check('the applicant receipt prints', receipt.status === 200 && receipt.body.includes('پسوولەی وەرگرتن'));
check('it carries a drawn barcode', /<svg[^>]*role="img"/.test(receipt.body));

const barcode = /aria-label="(\d{11})"/.exec(receipt.body)?.[1];
const pin = /<b>(\d{6})<\/b>/.exec(receipt.body)?.[1];
check('it carries an eleven-digit barcode', Boolean(barcode), `got ${barcode}`);
check('it carries a six-digit PIN', Boolean(pin), `got ${pin}`);

const found = await registry.get(`/barcode?q=${barcode}`);
check('scanning that barcode finds the letter', found.status === 200 && found.body.includes(`/documents/${docId}`));

// The check digit exists so that a mis-scan fails to resolve rather than
// resolving to somebody else's letter. Break the last digit and confirm the
// screen says the barcode is wrong, not that the letter is missing.
const wrongCheck = barcode.slice(0, 10) + ((Number(barcode[10]) + 1) % 10);
const misScan = await registry.get(`/barcode?q=${wrongCheck}`);
check('a mis-scan is reported as a mis-scan', misScan.body.includes('دروست نییە'));

// Valid arithmetic, no such letter. This must read differently from the above.
const notThere = await registry.get('/barcode?q=20999999996');
check('a barcode with no letter says so instead', notThere.body.includes('نەدۆزرایەوە'));

const typed = await registry.get('/barcode?q=' + encodeURIComponent('ه/2026/1'));
check('a document number typed by hand also works', typed.status === 200 && typed.body.includes('/documents/'));

// A reader may emit the Code 39 start and stop characters; a phone keyboard may
// emit Arabic-Indic digits. Both are the same barcode.
const withStars = await registry.get(`/barcode?q=${encodeURIComponent('*' + barcode + '*')}`);
check('start and stop characters are tolerated', withStars.body.includes(`/documents/${docId}`));

// ---------------------------------------------------------------------------
console.log('\n--- the public tracking page ---');

check('it opens without an account', (await anon.get('/track')).status === 200);

// 'بەرواری تۆمار' appears only inside the result card. The page's own
// explanatory paragraph contains the words 'دۆخی داواکاری', so asserting on
// those would pass even when nothing was found.
const right = await anon.post('/track', { barcode, pin });
check('barcode and PIN together show the stage', right.status === 200 && right.body.includes('بەرواری تۆمار'), `status ${right.status}`);
check('it does not show the subject', !right.body.includes('داواکاری تاقیکردنەوەی پەڕگە'));
check('it does not show the applicant name', !right.body.includes('ئاسۆ نموونە'));

const wrongPin = await anon.post('/track', { barcode, pin: String((Number(pin) + 1) % 1000000).padStart(6, '0') });
check('a wrong PIN is refused', wrongPin.status === 404, `status ${wrongPin.status}`);
check('and says nothing about the letter', !wrongPin.body.includes('بەرواری تۆمار'));

// A wrong PIN and a barcode that does not exist must be indistinguishable, or
// the page becomes an oracle for which numbers are real.
const noSuchLetter = await anon.post('/track', { barcode: '20999999996', pin });
check('an unknown barcode gives the same answer as a wrong PIN',
      noSuchLetter.status === wrongPin.status);

check('reprinting the receipt does not change the PIN',
      /<b>(\d{6})<\/b>/.exec((await registry.get(`/documents/${docId}/receipt`)).body)?.[1] === pin);

// ---------------------------------------------------------------------------
console.log('\n--- signing for the folder ---');

const docPage = await registry.get(`/documents/${docId}`);
const legalRoomId = [...docPage.body.matchAll(/<option value="(\d+)"[^>]*>([^<]+)</g)]
  .find(m => m[2].includes('یاسا'))?.[1];
check('the legal room can be chosen', Boolean(legalRoomId), `got ${legalRoomId}`);

const sent = await registry.post(`/documents/${docId}/route`, { mode: 'single', to_room_id: legalRoomId, note: '' });
check('the letter is sent to legal', sent.status === 303 && !String(sent.location).includes('error'), sent.location);

// All of it: after enough test runs the room has more than a hundred open letters,
// and the inbox shows the oldest hundred with a link to the rest.
const inbox = await legal.get('/inbox?all=1');
check('legal sees it in the inbox', inbox.body.includes(`/documents/${docId}`));
// «نەگەیشتووە», the one word every screen now uses for a folder not yet here.
check('and sees the folder has not arrived', inbox.body.includes('نەگەیشتووە'));
check('the inbox counts folders still in transit', inbox.body.includes('پەڕگەی نەگەیشتوو'));

// ---------------------------------------------------------------------------
console.log('\n--- the delivery manifest ---');

const waiting = await registry.get('/manifests');
check('the sending room sees the folder waiting to go', waiting.body.includes(`value="${docId}"`), `status ${waiting.status}`);

const fromRoomId = /name="from_room_id" value="(\d+)"/.exec(waiting.body)?.[1];
const created = await registry.post('/manifests/new', {
  from_room_id: fromRoomId, to_room_id: legalRoomId,
  document_id: docId, courier: 'ئاسۆ گەیەنەر',
});
const manifestId = /\/manifests\/(\d+)/.exec(created.location ?? '')?.[1];
check('a manifest is created', Boolean(manifestId), created.location ?? `status ${created.status}`);

const sheet = await registry.get(`/manifests/${manifestId}/print`);
check('it prints', sheet.status === 200 && sheet.body.includes('لیستی گەیاندنی پەڕگە'));
check('the printed sheet names the courier', sheet.body.includes('ئاسۆ گەیەنەر'));
check('and has somewhere to sign', sheet.body.includes('ناو و واژوو'));
check('and lists the letter', sheet.body.includes(barcode));

// The same folder cannot travel on two open manifests at once, because on paper
// it cannot be in two places.
const again = await registry.get('/manifests');
check('the folder is no longer offered for a second manifest', !again.body.includes(`value="${docId}"`));

const incoming = await legal.get('/manifests');
check('the receiving room sees it coming', incoming.body.includes(`/manifests/${manifestId}`));

const signedFor = await legal.post(`/manifests/${manifestId}/receive`, {});
check('one signature covers the whole manifest',
      signedFor.status === 303 && String(signedFor.location).includes('ok'), signedFor.location);

const afterArrival = await legal.get(`/documents/${docId}`);
check('the folder now counts as arrived', afterArrival.body.includes('وەرگیراوە'));

const twice = await legal.post(`/manifests/${manifestId}/receive`, {});
check('signing twice is not an error', twice.status === 303 && !String(twice.location).includes('error'));

const tooLate = await legal.post(`/manifests/${manifestId}/cancel`, {});
check('a manifest already signed for cannot be cancelled',
      String(tooLate.location).includes('error'), tooLate.location);

// ---------------------------------------------------------------------------
console.log('\n--- notes on a letter ---');

const marker = `تێبینی تاقیکردنەوە ${unique()}`;
const noted = await legal.post(`/documents/${docId}/notes`, { body: marker });
check('a note can be added', noted.status === 303, `status ${noted.status}`);
check('and appears on the letter', (await legal.get(`/documents/${docId}`)).body.includes(marker));

const empty = await legal.post(`/documents/${docId}/notes`, { body: '   ' });
check('an empty note is refused', String(empty.location).includes('error'), empty.location);

// ---------------------------------------------------------------------------
console.log('\n--- the company register ---');

const regNo = `TEST-${unique()}`;
const company = await registry.post('/companies/new', {
  name: 'کۆمپانیای تاقیکردنەوە', registration_no: regNo, status: 'active',
  representative: 'نموونەی نوێنەر', licence_expires_on: '2026-10-01',
});
const companyId = /\/companies\/(\d+)/.exec(company.location ?? '')?.[1];
check('a company can be registered', Boolean(companyId), company.location ?? `status ${company.status}`);

const dup = await registry.post('/companies/new', { name: 'دووبارە', registration_no: regNo, status: 'active' });
check('the registration number cannot be reused', dup.status === 400 && dup.body.includes('ئەم ژمارەی تۆمارە پێشتر هەیە'), `status ${dup.status}`);

const linked = await registry.post(`/companies/${companyId}/link`, { reference: barcode });
check('a letter can be linked by barcode', linked.status === 303 && !String(linked.location).includes('error'));

const vault = await registry.get(`/companies/${companyId}`);
check('the letter appears on the company', vault.body.includes(`/documents/${docId}`));
check('an expiring licence is flagged', vault.body.includes('ڕۆژ ماوە') || vault.body.includes('بەسەرچووە'));

const onDoc = await registry.get(`/documents/${docId}`);
check('and the company appears on the letter', onDoc.body.includes(`/companies/${companyId}`));

await registry.post(`/companies/${companyId}/unlink`, { document_id: docId });
check('the link can be undone',
      !(await registry.get(`/companies/${companyId}`)).body.includes(`/documents/${docId}`));

const nonsense = await registry.post(`/companies/${companyId}/link`, { reference: 'ه/1999/99999' });
check('linking a letter that does not exist is refused', String(nonsense.location).includes('error'));

// A file that belongs to the company rather than to any one letter: the licence,
// the tax clearance. Same storage, same virus scan, same type sniffing as an
// attachment, so a renamed executable is refused here too.
await registry.get(`/companies/${companyId}`);
const licence = await registry.upload(`/companies/${companyId}/files`,
  { title: 'مۆڵەتی بازرگانی', category: 'مۆڵەت', valid_until: '2026-12-31' },
  { file: { name: 'مۆڵەت ٢٠٢٦.pdf', bytes: pdfBytes(), type: 'application/pdf' } });
check('a company file can be uploaded', licence.status === 303 && !String(licence.location).includes('error'), licence.location);

const withFile = await registry.get(`/companies/${companyId}`);
check('it is listed on the company', withFile.body.includes('مۆڵەتی بازرگانی'));
check('the Kurdish filename survives', withFile.body.includes('مۆڵەت') );

const fileId = /\/companies\/files\/(\d+)/.exec(withFile.body)?.[1];
check('the file can be opened', Boolean(fileId), `id ${fileId}`);

if (fileId) {
  const dl = await fetch(`${BASE}/companies/files/${fileId}`, { headers: { cookie: registry.header() } });
  const bytes = Buffer.from(await dl.arrayBuffer());
  check('it comes back as a PDF', dl.status === 200 && dl.headers.get('content-type') === 'application/pdf');
  check('and the bytes are the bytes', bytes.subarray(0, 8).toString('latin1') === '%PDF-1.4');

  const itTry = await fetch(`${BASE}/companies/files/${fileId}`, { headers: { cookie: it.header() }, redirect: 'manual' });
  check('IT cannot open a company file', itTry.status === 403 || itTry.status === 404, `status ${itTry.status}`);
}

// The type is decided by looking at the bytes, not at the name on the end.
const disguised = await registry.upload(`/companies/${companyId}/files`,
  { title: 'خراپ', category: 'تر' },
  { file: { name: 'evil.pdf', bytes: Buffer.from('MZ\x90\x00this is a windows executable'), type: 'application/pdf' } });
check('an executable renamed to .pdf is refused', String(disguised.location).includes('error'), disguised.location);

// ---------------------------------------------------------------------------
console.log('\n--- the transaction type catalogue ---');

const list = await registry.get('/admin/doc-types');
check('the catalogue opens', list.status === 200, `status ${list.status}`);
check('the nine seeded types are there', list.body.includes('داواکاری هاووڵاتی'));

const code = `T${unique()}`;
const added = await registry.post('/admin/doc-types', {
  name: 'مۆڵەتی بیناسازی', code, base_kind: 'citizen_request',
  category: 'زەوی و زار', default_due_days: '5',
});
check('a new type can be added', added.status === 303 && String(added.location).includes('ok'), added.location);

const badCode = await registry.post('/admin/doc-types', {
  name: 'خراپ', code: 'has space', base_kind: 'citizen_request',
});
check('a code with a space is refused', String(badCode.location).includes('error'));

const offered = await registry.get('/registry/new');
check('the new type is offered on the registration form', offered.body.includes('مۆڵەتی بیناسازی'));

// A catalogue row names one of the fixed nine, and that is what the letter is
// filed as. Otherwise an editable list could invent classes the rules do not
// know about.
const optionId = /<option value="(\d+)"[^>]*>مۆڵەتی بیناسازی/.exec(offered.body)?.[1];
const viaCatalogue = await registry.post('/registry/new', { confirm_similar: '1',
  subject: 'داواکاری بە جۆری نوێ', doc_type_option_id: optionId,
  sender_kind: 'citizen', sender_name: 'نموونە', priority: 'normal',
});
const catDocId = /\/documents\/(\d+)/.exec(viaCatalogue.location ?? '')?.[1];
check('a letter can be registered with the new type', Boolean(catDocId), viaCatalogue.location);
check('and is filed under the base kind the row names',
      (await registry.get(`/documents/${catDocId}`)).body.includes('داواکاری هاووڵاتی'));

// ---------------------------------------------------------------------------
console.log('\n--- the doors that stay shut ---');

for (const path of ['/barcode', '/manifests', '/companies', `/companies/${companyId}`]) {
  const r = await it.get(path);
  check(`IT is refused ${path}`, r.status === 403 || r.status === 404, `status ${r.status}`);
}
check('IT cannot open the letter', (await it.get(`/documents/${docId}`)).status === 404);
check('IT cannot print the receipt', (await it.get(`/documents/${docId}/receipt`)).status === 404);

// An archive clerk handles drawings, not deliveries.
const archive = new Session(); await archive.signIn('karwan');
check('an archive clerk has no delivery manifests', (await archive.get('/manifests')).status === 403);
check('but may look a barcode up', (await archive.get('/barcode')).status === 200);

// ---------------------------------------------------------------------------
console.log(failures ? `\n${failures} FAILED` : '\nthe paper trail works');
process.exit(failures ? 1 : 0);
