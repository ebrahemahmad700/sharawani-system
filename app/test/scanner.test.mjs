// Scanners.
//
//   node test/scanner.test.mjs      (server must be running on BASE; run inside
//                                     the app container, which has src/ beside it)
//
// Three layers, because a scanner can go wrong at each of them:
//
//   the protocol    a fake eSCL scanner on a real HTTP socket, answering the way
//                   real ones do: a job URL given as a full address, "busy" once
//                   before the first page, JPEG pages from the feeder rather than
//                   a PDF, and 404 when the feeder is empty
//   the safety      addresses off the local network are refused
//   the screens     the simulated scanner end to end: onto a letter, into a
//                   room's tray, onto a registration, and nobody else's tray
//
// The screens part needs SCANNER_SIMULATOR=1 on the server and says so when it is
// not, rather than failing.

import http from 'http';

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

process.env.SCANNER_ALLOW_LOOPBACK = '1';
const { checkScannerUrl, capabilities, scan, ScannerError } = await import('../src/lib/escl.mjs');
const { referencesIn } = await import('../src/lib/detect.mjs');
const { countPages } = await import('../src/lib/pdfmerge.mjs');

// ---------------------------------------------------------------------------
console.log('--- the protocol, against a scanner on a socket ---');

// A 1x1 greyscale baseline JPEG, the smallest page a scanner could send.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/' +
  'wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

const seen = [];
let busyOnce = true;
let pagesLeft = 0;
const fake = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`);
  const port = fake.address().port;
  if (req.method === 'GET' && req.url === '/eSCL/ScannerCapabilities') {
    res.writeHead(200, { 'content-type': 'text/xml' });
    return res.end(`<?xml version="1.0"?><scan:ScannerCapabilities xmlns:scan="s" xmlns:pwg="p">
      <pwg:MakeAndModel>Fake Feeder 3000</pwg:MakeAndModel>
      <scan:Adf><scan:AdfSimplexInputCaps><scan:MaxWidth>2550</scan:MaxWidth><scan:MaxHeight>4200</scan:MaxHeight>
        <scan:SettingProfiles><scan:SettingProfile>
          <scan:ColorModes><scan:ColorMode>Grayscale8</scan:ColorMode></scan:ColorModes>
          <scan:DocumentFormats><pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat></scan:DocumentFormats>
          <scan:DiscreteResolution><scan:XResolution>150</scan:XResolution></scan:DiscreteResolution>
          <scan:DiscreteResolution><scan:XResolution>300</scan:XResolution></scan:DiscreteResolution>
        </scan:SettingProfile></scan:SettingProfiles>
      </scan:AdfSimplexInputCaps></scan:Adf></scan:ScannerCapabilities>`);
  }
  if (req.method === 'POST' && req.url === '/eSCL/ScanJobs') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push(body);
      pagesLeft = 2;
      busyOnce = true;
      // A full URL, the way several makers answer.
      res.writeHead(201, { location: `http://127.0.0.1:${port}/eSCL/ScanJobs/abc123` });
      res.end();
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/eSCL/ScanJobs/abc123/NextDocument') {
    if (busyOnce) { busyOnce = false; res.writeHead(503); return res.end(); }
    if (pagesLeft <= 0) { res.writeHead(404); return res.end(); }
    pagesLeft--;
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    return res.end(JPEG);
  }
  if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
  res.writeHead(404); res.end();
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const root = `http://127.0.0.1:${fake.address().port}/eSCL`;

const caps = await capabilities(checkScannerUrl(root));
check('the capabilities are read', caps.makeModel === 'Fake Feeder 3000' && caps.feeder && !caps.platen, JSON.stringify(caps));

const result = await scan(checkScannerUrl(root), { source: 'Platen', color: 'gray', resolution: 300 });
check('a scanner with only a feeder is used through its feeder', seen.some(s => s.includes('<pwg:InputSource>Feeder</pwg:InputSource>')));
check('the resolution asked for is one the scanner offers', seen.some(s => s.includes('<scan:XResolution>300</scan:XResolution>')));
check('JPEG is asked for when the scanner cannot make a PDF', seen.some(s => s.includes('<pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>')));
check('"busy" is waited out rather than treated as failure', seen.filter(s => s.endsWith('/NextDocument')).length === 4, seen.filter(s => s.endsWith('/NextDocument')).length + ' requests');
check('both feeder pages come back as one PDF', result.pdf.slice(0, 4).toString() === '%PDF' && result.pages === 2 && (await countPages(result.pdf)) === 2, `${result.pages} pages`);
check('the job is tidied away on the scanner afterwards', seen.some(s => s.startsWith('DELETE /eSCL/ScanJobs/abc123')));

let wrongPlace;
try { await scan(checkScannerUrl(`http://127.0.0.1:${fake.address().port}/nothing-here`)); } catch (err) { wrongPlace = err; }
check('an address that is not a scanner says so', wrongPlace instanceof ScannerError, wrongPlace?.message);

fake.close();
let gone;
try { await capabilities(checkScannerUrl(root)); } catch (err) { gone = err; }
check('a scanner that is switched off says so in words', gone instanceof ScannerError && gone.code === 'unreachable', gone?.code);

// ---------------------------------------------------------------------------
console.log('\n--- only the local network ---');

delete process.env.SCANNER_ALLOW_LOOPBACK;
const refused = raw => { try { checkScannerUrl(raw); return false; } catch (err) { return err instanceof ScannerError; } };
check('a printer on the office network is accepted', !refused('http://192.168.1.40/eSCL') && !refused('https://10.0.0.7:443/eSCL') && !refused('http://canon-mf.local/eSCL'));
check('an address on the internet is refused', refused('http://8.8.8.8/eSCL') && refused('https://scanner.example.com/eSCL'));
check('the server asking itself is refused', refused('http://127.0.0.1:3000/eSCL') && refused('http://localhost/eSCL'));
check('names and passwords in the address are refused', refused('http://admin:secret@192.168.1.40/eSCL'));
check('anything but http is refused', refused('file:///etc/passwd') && refused('ftp://192.168.1.40/'));

// ---------------------------------------------------------------------------
console.log('\n--- which letter a page names ---');

// 20260004153 is a valid barcode; changing its last digit makes it invalid.
const refs = referencesIn('ژمارە: ه/2026/415   بەروار ٢٠٢٦/٠٩/١٣   بارکۆد 2026 0004153   415/2026/د');
check('a letter number is read', refs.numbers.some(n => n.kind === 'ه' && n.year === 2026 && n.seq === 415));
check('and the same number read right to left, as the reader often returns it', refs.numbers.some(n => n.kind === 'د' && n.seq === 415));
check('a date is not mistaken for a letter number', refs.numbers.length === 2, JSON.stringify(refs.numbers));
check('a barcode with a space in it is read', refs.barcodes.includes('20260004153'), JSON.stringify(refs.barcodes));
check('a barcode whose check digit is wrong is not', referencesIn('20260004154').barcodes.length === 0);
check('Arabic-Indic digits are read the same', referencesIn('ه/٢٠٢٦/٤١٥').numbers.length === 1);

// ---------------------------------------------------------------------------
console.log('\n--- the screens, with the simulated scanner ---');

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? []; for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) this.cookies.set(p.slice(0, i).trim(), p.slice(i + 1)); } }
  async get(path) { const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async signIn(u) { await this.get('/login'); await this.post('/login', { username: u, password: PASSWORD }); await this.get('/inbox'); }
}

const mayor = new Session(); await mayor.signIn('aram');
const registry = new Session(); await registry.signIn('shilan');
const room9 = new Session(); await room9.signIn('zhyan');
const it = new Session(); await it.signIn('itadmin');

const admin = await mayor.get('/admin/scanners');
check('the mayor can open the scanners screen', admin.status === 200, `status ${admin.status}`);
check('a registry clerk cannot', (await registry.get('/admin/scanners')).status === 403);

const internet = await mayor.post('/admin/scanners', { name: 'نامۆ', code: 'OUTSIDE', base_url: 'http://8.8.8.8/eSCL', room_id: '' });
check('adding a scanner on the internet is refused on the screen', internet.status === 400 && internet.body.includes('تۆڕی ناوخۆ'), `status ${internet.status}`);

const simulatorOffered = admin.body.includes('SIMULATOR') || admin.body.includes('simulator');
if (!simulatorOffered) {
  console.log('skip  SCANNER_SIMULATOR is not set on this server, so the scan screens are not exercised');
} else {
  if (admin.body.includes('value="SIMULATOR"')) {
    const added = await mayor.post('/admin/scanners', { name: 'سکانەری تاقیکردنەوە', code: 'SIMULATOR', base_url: 'http://simulator.docsys.invalid/eSCL', room_id: '' });
    check('the simulated scanner is added and answers', added.status === 303 && /ok=/.test(added.location ?? ''), decodeURIComponent(added.location ?? ''));
  }
  const scannerId = /name="scanner_id" value="(\d+)"/.exec((await registry.get('/scan?to=tray')).body)?.[1];
  check('the registry is offered it', Boolean(scannerId));
  check('IT is not offered scanning at all', (await it.get('/scan?to=tray')).status === 403);

  // Onto a letter.
  const { body: newForm } = await registry.get('/registry/new');
  const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(newForm)?.[1] ?? '';
  const mark = Math.random().toString(36).slice(2, 8);
  const reg = await registry.post('/registry/new', { subject: `کتابی سکانکراو ${mark}`, doc_type_option_id: typeId, sender_kind: 'citizen', sender_name: `کەس ${mark}`, priority: 'normal', confirm_similar: '1' });
  const docId = /\/documents\/(\d+)/.exec(reg.location ?? '')?.[1];
  await registry.get(`/scan?document_id=${docId}`);
  const onto = await registry.post('/scan', { scanner_id: scannerId, document_id: docId, source: 'Feeder', color: 'gray', resolution: '300', kind: 'original_scan' });
  check('scanning from a letter attaches the pages to that letter', onto.status === 303 && String(onto.location).includes(`/documents/${docId}?attached=1`), onto.location ?? `status ${onto.status}`);
  const docPage = await registry.get(`/documents/${docId}`);
  check('as a PDF named after the scanner', /SIMULATOR-\d{12}\.pdf/.test(docPage.body));
  check('with its page count', docPage.body.includes('٢ پەڕە'));
  check('a room that cannot see the letter cannot scan onto it', (await room9.get(`/scan?document_id=${docId}`)).status === 404);
  const forced = await room9.post('/scan', { scanner_id: scannerId, document_id: docId, source: 'Platen', color: 'gray', resolution: '300' });
  check('not even by posting at it', forced.status === 404, `status ${forced.status}`);

  // Into the registry's tray, and not room 9's.
  await registry.get('/scan?to=tray');
  const toTray = await registry.post('/scan', { scanner_id: scannerId, to: 'tray', source: 'Platen', color: 'gray', resolution: '200' });
  const trayId = /\/tray\/(\d+)/.exec(toTray.location ?? '')?.[1];
  check('scanning from the tray puts the page in the tray', toTray.status === 303 && Boolean(trayId), toTray.location ?? `status ${toTray.status}`);
  const claimPage = await registry.get(`/tray/${trayId}`);
  check('where it can be looked at in the page', claimPage.status === 200 && claimPage.body.includes(`data-pdf-src="/tray/${trayId}/preview"`));
  check('room 9 cannot open it', (await room9.get(`/tray/${trayId}`)).status === 404);

  // Onto a registration.
  await registry.get('/scan?to=registry');
  const toReg = await registry.post('/scan', { scanner_id: scannerId, to: 'registry', source: 'Platen', color: 'gray', resolution: '300' });
  const regTray = /tray_id=(\d+)/.exec(toReg.location ?? '')?.[1];
  check('scanning from the registration form comes back to the form', toReg.status === 303 && Boolean(regTray), toReg.location ?? '');
  const formWithScan = await registry.get(`/registry/new?tray_id=${regTray}`);
  check('which says the scan is waiting', formWithScan.body.includes(`name="tray_id" value="${regTray}"`));
  const registered = await registry.post('/registry/new', { tray_id: regTray, subject: `کتابی نوێ لە سکانەر ${mark}`, doc_type_option_id: typeId, sender_kind: 'citizen', sender_name: `کەسێکی تر ${mark}`, priority: 'normal', confirm_similar: '1' });
  const regDoc = /\/documents\/(\d+)/.exec(registered.location ?? '')?.[1];
  const regPage = await registry.get(`/documents/${regDoc}`);
  check('and registering files the scan onto the new letter', /SIMULATOR-\d{12}\.pdf/.test(regPage.body));
  const otherForm = await room9.get(`/registry/new?tray_id=${regTray}`);
  check('another room cannot pick up that scan by putting its number in the address', !otherForm.body.includes(`value="${regTray}"`));
}

console.log(failures ? `\n${failures} FAILED` : '\nscanners work, and only for the people and places they should');
process.exit(failures ? 1 : 0);
