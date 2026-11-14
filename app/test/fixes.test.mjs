// The ten things reported from the demo on 2026-09-13, over HTTP.
//
//   node test/fixes.test.mjs        (server must be running on BASE)
//
// One file for one report, so the report can be read against it. The browser
// half of the same report (scrolling, removing a chosen file, two people in two
// tabs, the PDF actually drawing) is in e2e/tests/, because only a real browser
// can say whether a mouse wheel moves a page.
//
//    3  a DWG could not be stored in the drawing archive
//    5  plot numbers came out as "2٤0/4"
//    6  rooms could not open the PDFs attached to a letter
//    7  two people could not be signed in at the same time
//    8  the legal and contracts rooms could not start a letter
//    9  a scan from one room appeared in room 9's tray
//   10  rooms 8 and 9 could not attach a DWG to a letter

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i).trim(); const v = p.slice(i + 1); if (v) this.cookies.set(k, v); else this.cookies.delete(k); } } }
  async get(path) { const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' }); this.store(r); const ct = r.headers.get('content-type') ?? ''; const buf = Buffer.from(await r.arrayBuffer()); const body = /text|json|javascript/.test(ct) ? buf.toString('utf8') : ''; const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body, bytes: buf, headers: r.headers }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async upload(path, fields, files) { const f = new FormData(); f.append('_csrf', this.csrf); for (const [k, v] of Object.entries(fields)) f.append(k, v); for (const [k, name, bytes] of files) f.append(k, new Blob([bytes]), name); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header() }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async signIn(u) { await this.get('/login'); const r = await this.post('/login', { username: u, password: PASSWORD }); await this.get('/inbox'); return r; }
}

const mark = Math.random().toString(36).slice(2, 9);
const pdf = () => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${Math.random()}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
const dwg = () => Buffer.concat([Buffer.from('AC1032'), Buffer.from(String(Math.random())), Buffer.alloc(4000, 3)]);
const errorOf = body => /class="notice error"[^>]*>([^<]+)/.exec(body)?.[1] ?? '';

const registry = new Session(); await registry.signIn('shilan');
const mayor    = new Session(); await mayor.signIn('aram');
const legal    = new Session(); await legal.signIn('hemin');       // head of legal
const legalClerk = new Session(); await legalClerk.signIn('sakar');
const contracts  = new Session(); await contracts.signIn('rebwar'); // a clerk in contracts (14)
const room8    = new Session(); await room8.signIn('karwan');
const room9    = new Session(); await room9.signIn('zhyan');
const it       = new Session(); await it.signIn('itadmin');

const { body: formBody } = await registry.get('/registry/new');
const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(formBody)?.[1] ?? '';
const roomIdByName = (html, name) => new RegExp(`<option value="(\\d+)"[^>]*>${name}`).exec(html)?.[1];

// ---------------------------------------------------------------------------
console.log('--- 8: every room can start a letter ---');

for (const [who, s] of [['the head of legal', legal], ['a clerk in contracts', contracts]]) {
  const form = await s.get('/registry/new');
  check(`${who} can open the new letter form`, form.status === 200 && form.body.includes('name="subject"'), `status ${form.status}`);
  const reg = await s.post('/registry/new', {
    subject: `یادداشتی ناوخۆیی بۆ سەرۆکایەتی ${mark} ${who.length}`, doc_type_option_id: typeId,
    sender_kind: 'internal', sender_name: 'ژووری ناوخۆ', priority: 'normal', confirm_similar: '1',
  });
  const id = /\/documents\/(\d+)/.exec(reg.location ?? '')?.[1];
  check(`and ${who} can register it, and it takes a number`, reg.status === 303 && Boolean(id),
    reg.status === 303 ? reg.location : `status ${reg.status} ${errorOf(reg.body)}`);
  if (s === legal) globalThis.legalLetter = id;
}

const legalLetter = globalThis.legalLetter;
const clerkView = await legalClerk.get(`/documents/${legalLetter}`);
check('a clerk in the same room can see the letter their head started', clerkView.status === 200, `status ${clerkView.status}`);
check('and can send it, because it is their room\'s and not yet sent', clerkView.body.includes('action="/documents/' + legalLetter + '/route"'));
const legalInbox = await legalClerk.get('/inbox');
check('the letter waits in the room\'s own list of unsent letters', legalInbox.body.includes(`/documents/${legalLetter}`));

const otherRoom = await room9.get(`/documents/${legalLetter}`);
check('a room that had nothing to do with it cannot see it', otherRoom.status === 404, `status ${otherRoom.status}`);
const itView = await it.get(`/documents/${legalLetter}`);
check('IT cannot see it', itView.status !== 200, `status ${itView.status}`);
const itForm = await it.get('/registry/new');
check('IT is not offered the form', itForm.status === 303, `status ${itForm.status}`);

const numbers = await registry.get(`/documents/${legalLetter}`);
check('the registry sees the room\'s letter too, in the one register', numbers.status === 200 && /ه\/\d{4}\/\d+/.test(numbers.body));

const mayorRoomId = roomIdByName(clerkView.body, 'ژووری سەرۆکی شارەوانی');
const sentByClerk = await legalClerk.post(`/documents/${legalLetter}/route`, { mode: 'single', to_room_id: mayorRoomId, note: 'بۆ ئاگاداری' });
check('the clerk sends it to the mayor', sentByClerk.status === 303 && /sent=1/.test(sentByClerk.location ?? ''), decodeURIComponent(sentByClerk.location ?? ''));

// ---------------------------------------------------------------------------
console.log('\n--- 5: one kind of digit in identifiers ---');

await registry.get('/registry/new');
const mixed = await registry.post('/registry/new', {
  subject: `داواکاری مۆڵەتی بیناسازی ${mark}`, doc_type_option_id: typeId, sender_kind: 'citizen',
  sender_name: `هاووڵاتی ${mark}`, priority: 'normal', confirm_similar: '1',
  plot_no: `2٤${mark.length}/4`, physical_shelf: 'C-١٢', sender_contact: '٠٧٥٠١٢٣٤٥٦٧',
});
const mixedId = /\/documents\/(\d+)/.exec(mixed.location ?? '')?.[1];
const mixedPage = await registry.get(`/documents/${mixedId}`);
check('a plot typed as "2٤7/4" is shown as 247/4', mixedPage.body.includes(`>24${mark.length}/4<`), 'mixed digits on the page');
check('and nothing mixed remains anywhere on the page', !/\d[٠-٩]|[٠-٩]\d/.test(mixedPage.body.replace(/<script[\s\S]*?<\/script>/g, '')));
check('the plot link still finds the same plot file', mixedPage.body.includes('/plots?p='));

// ---------------------------------------------------------------------------
console.log('\n--- 3: a DWG into the drawing archive ---');

await room9.get('/archive/new');
const noSection = await room9.upload('/archive/new', {
  plot_no: '٣١٠/٢', title: `نەخشەی بنەڕەتی ${mark}`, shelf: '4', section: '', folder_no: '9',
}, [['file', `naxsha-${mark}.dwg`, dwg()]]);
check('leaving out the section says so, rather than the generic error page',
  noSection.status === 400 && errorOf(noSection.body).includes('بەش') && !noSection.body.includes('هەڵەیەک ڕوویدا'),
  `status ${noSection.status}: ${errorOf(noSection.body)}`);
check('the form marks the section as required', /for="section" class="required"/.test(noSection.body));

await room9.get('/archive/new');
const stored = await room9.upload('/archive/new', {
  plot_no: '٣١٠/٢', title: `نەخشەی بنەڕەتی ${mark}`, shelf: '4', section: '٢', folder_no: '9', year: '٢٠١٩',
}, [['file', `naxsha-${mark}.dwg`, dwg()]]);
const archiveId = /\/archive\/(\d+)/.exec(stored.location ?? '')?.[1];
check('room 9 stores a DWG in the archive', stored.status === 303 && Boolean(archiveId), `status ${stored.status}: ${errorOf(stored.body)}`);
const archivePage = await room9.get(`/archive/${archiveId}`);
check('with the plot in one kind of digit', archivePage.body.includes('>310/2<'));
check('and the section on the shelf line', archivePage.body.includes('بەش 2'));
const archDl = await room9.get(`/archive/${archiveId}/download`);
check('the DWG downloads as a file, not as a page', archDl.status === 200 && /attachment/.test(archDl.headers.get('content-disposition') ?? ''));

// ---------------------------------------------------------------------------
console.log('\n--- 10: rooms 8 and 9 attach a DWG to a letter ---');

await mayor.get('/registry/new');
const plotLetter = await mayor.post('/registry/new', {
  subject: `پرسیار دەربارەی نەخشەی پارچە ${mark}`, doc_type_option_id: typeId, sender_kind: 'citizen',
  sender_name: `داواکار ${mark}`, priority: 'normal', confirm_similar: '1',
});
const plotId = /\/documents\/(\d+)/.exec(plotLetter.location ?? '')?.[1];
const plotPage = await mayor.get(`/documents/${plotId}`);
const room8Id = /<option value="(\d+)">نەخشەی بنەڕەتی \(٨\)/.exec(plotPage.body)?.[1];
await mayor.post(`/documents/${plotId}/route`, { mode: 'single', to_room_id: room8Id, note: 'نەخشەکە بلکێنە' });

const room8Page = await room8.get(`/documents/${plotId}`);
check('room 8 is offered DWG in the file box', /accept="[^"]*\.dwg/.test(room8Page.body));
const dwgUp = await room8.upload(`/documents/${plotId}/attachments`, { kind: 'drawing' }, [['file', `plot-${mark}.dwg`, dwg()]]);
check('room 8 attaches a DWG to the letter', dwgUp.status === 303 && /attached=1/.test(dwgUp.location ?? ''), decodeURIComponent(dwgUp.location ?? ''));

const registryPage = await registry.get(`/documents/${plotId}`);
check('the registry is not offered DWG', !/accept="[^"]*\.dwg/.test(registryPage.body));
const regDwg = await registry.upload(`/documents/${plotId}/attachments`, { kind: 'drawing' }, [['file', 'x.dwg', dwg()]]);
check('and a DWG from the registry is refused with a reason', /error=/.test(regDwg.location ?? ''), decodeURIComponent(regDwg.location ?? ''));

// ---------------------------------------------------------------------------
console.log('\n--- 6: every room that holds a letter can open what is attached ---');

await mayor.get(`/documents/${plotId}`);
const mayorPdf = await mayor.upload(`/documents/${plotId}/attachments`, { kind: 'original_scan' }, [['file', `scan-${mark}.pdf`, pdf()]]);
check('the mayor attaches a scan', /attached=1/.test(mayorPdf.location ?? ''), decodeURIComponent(mayorPdf.location ?? ''));

const legalRoomId = roomIdByName(plotPage.body, 'ژووری یاسا');
await room8.get(`/documents/${plotId}`);
await room8.post(`/documents/${plotId}/complete`, { action: 'opinion', reply_note: 'نەخشەکە لکێندرا' });
const toLegal = await mayor.post(`/documents/${plotId}/route`, { mode: 'single', to_room_id: legalRoomId, note: 'بۆ ڕای یاسایی' });
check('the letter moves on to legal', /sent=1/.test(toLegal.location ?? ''), decodeURIComponent(toLegal.location ?? ''));

const legalDoc = await legalClerk.get(`/documents/${plotId}`);
const listed = [...legalDoc.body.matchAll(/\/attachments\/(\d+)\/view/g)].map(m => m[1]);
check('legal sees both files: the mayor\'s scan and room 8\'s drawing', new Set(listed).size >= 2, `${new Set(listed).size} listed`);
check('each is offered with a view button, not only a file name', (legalDoc.body.match(/>بینین</g) ?? []).length >= 2);
const scanRow = legalDoc.body.split('<li>').find(li => li.includes(`scan-${mark}.pdf`)) ?? '';
const scanId = /\/attachments\/(\d+)\/view/.exec(scanRow)?.[1];
const opened = await legalClerk.get(`/attachments/${scanId}`);
check('legal opens the mayor\'s PDF', opened.status === 200 && opened.bytes.slice(0, 4).toString() === '%PDF', `status ${opened.status}`);
check('inline, so the browser shows it', /^inline/.test(opened.headers.get('content-disposition') ?? ''));
const viewer = await legalClerk.get(`/attachments/${scanId}/view`);
check('the viewer page opens for legal', viewer.status === 200, `status ${viewer.status}`);
check('and draws it in the page rather than handing it to the browser', viewer.body.includes(`data-pdf-src="/attachments/${scanId}"`) && viewer.body.includes('/viewer.js'));
check('beside the list of every file on the letter', viewer.body.includes(`plot-${mark}.dwg`) && viewer.body.includes(`scan-${mark}.pdf`));
const pdfjs = await legalClerk.get('/vendor/pdfjs/pdf.min.js');
check('PDF.js is served from this server, as JavaScript', pdfjs.status === 200 && /javascript/.test(pdfjs.headers.get('content-type') ?? ''));
const worker = await legalClerk.get('/vendor/pdfjs/pdf.worker.min.js');
check('and so is its worker', worker.status === 200 && /javascript/.test(worker.headers.get('content-type') ?? ''));

const outsider = await room9.get(`/attachments/${scanId}/view`);
check('a room the letter never reached still cannot open it', outsider.status === 404, `status ${outsider.status}`);
const outsiderRaw = await room9.get(`/attachments/${scanId}`);
check('not even by the file address', outsiderRaw.status === 404, `status ${outsiderRaw.status}`);
const itRaw = await it.get(`/attachments/${scanId}`);
check('and IT cannot', itRaw.status !== 200, `status ${itRaw.status}`);

// ---------------------------------------------------------------------------
console.log('\n--- 9: a room\'s scan tray is its own ---');

await registry.get('/tray');
const trayUp = await registry.upload('/tray/upload', { scanner_code: 'FRONT' }, [['file', `private-${mark}.pdf`, pdf()]]);
check('the registry adds a scan to its tray', trayUp.status === 303 && !/error/.test(trayUp.location ?? ''), trayUp.location);
const regTray = await registry.get('/tray');
const trayRow = regTray.body.split('<tr>').find(r => r.includes(`private-${mark}.pdf`)) ?? '';
const trayId = /href="\/tray\/(\d+)"/.exec(trayRow)?.[1];
check('it is in the registry\'s tray', Boolean(trayId));

const room9Tray = await room9.get('/tray');
check('room 9 does not see it in its tray', room9Tray.status === 200 && !room9Tray.body.includes(`private-${mark}.pdf`));
const room9Preview = await room9.get(`/tray/${trayId}/preview`);
check('and cannot open it by its address', room9Preview.status === 404, `status ${room9Preview.status}`);
const room9Claim = await room9.get(`/tray/${trayId}`);
check('or reach its claim page', room9Claim.status === 404, `status ${room9Claim.status}`);
const legalTray = await legal.get('/tray');
check('neither does legal', !legalTray.body.includes(`private-${mark}.pdf`));

const registryRoomId = /<option value="(\d+)"[^>]*>ژووری هات و دەرچوو/.exec((await mayor.get('/inbox')).body)?.[1];
const mayorLooks = await mayor.get(`/tray?room=${registryRoomId}`);
check('the mayor can look into the registry\'s tray on purpose', mayorLooks.body.includes(`private-${mark}.pdf`));

const claim = await registry.post(`/tray/${trayId}/claim`, { document_id: plotId, kind: 'supporting' });
check('the registry files it onto a letter', claim.status === 303 && String(claim.location).includes(`/documents/${plotId}`), claim.location);
const staleAddress = await registry.get(`/tray/${trayId}/preview`);
check('once filed, the old tray address no longer opens it, even for the registry', staleAddress.status === 404, `status ${staleAddress.status}`);
const stillOnLetter = await legalClerk.get(`/documents/${plotId}`);
check('it is opened through the letter now, under the letter\'s rules', stillOnLetter.body.includes(`private-${mark}.pdf`));

// Legal finishes its step, so repeated runs do not pile open letters into the
// legal room's inbox until other tests cannot find theirs in the first hundred.
await legalClerk.post(`/documents/${plotId}/complete`, { action: 'opinion', reply_note: 'تاقیکردنەوە' });
await mayor.get(`/documents/${legalLetter}`);
await mayor.post(`/documents/${legalLetter}/complete`, { action: 'no_action', reply_note: '' });

// ---------------------------------------------------------------------------
console.log('\n--- 7: two people at once ---');

const shilan = new Session(); await shilan.signIn('shilan');
const aram = new Session(); await aram.signIn('aram');
const both = await Promise.all([shilan.get('/registry'), aram.get('/dashboard'), shilan.get('/tray'), aram.get('/inbox')]);
check('Shilan and Aram, signed in separately, both work at the same moment', both.every(r => r.status === 200), both.map(r => r.status).join(','));
check('and each is still themselves', both[0].body.includes('شیلان') && both[1].body.includes('ئارام'));

const sameBrowser = await shilan.get('/login');
check('opening the sign-in page while signed in explains, instead of bouncing away',
  sameBrowser.status === 200 && sameBrowser.body.includes('/login/switch') && sameBrowser.body.includes('Ctrl+Shift+N'));
const switched = await shilan.post('/login/switch', {});
check('switching signs the first person out', switched.status === 303 && /switched=1/.test(switched.location ?? ''));
const after = await shilan.get('/registry');
check('and that session is really over, not just forgotten by the browser', after.status === 303 && /login/.test(after.location ?? ''), `status ${after.status}`);
const aramStill = await aram.get('/inbox');
check('while the other person carries on untouched', aramStill.status === 200);

console.log(failures ? `\n${failures} FAILED` : '\nall ten reports hold');
process.exit(failures ? 1 : 0);
