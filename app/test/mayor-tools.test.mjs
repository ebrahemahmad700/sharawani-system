// The seven things asked for on 13 September, over HTTP.
//
//   node test/mayor-tools.test.mjs      (server must be running on BASE)
//
//   1  the handwritten instruction (هامش) laid onto the letter, which is then sent
//   2  a code and QR that prove a letter came from the municipality
//   3  the escalation ladder: holder, then room head, then the mayor
//   4  the weekly room report
//   5  security alerts from the activity log
//   6  the whole case on one screen
//   7  the map of plots
//
// Part 3 needs a letter that has been late for days, and a letter cannot be made
// late over HTTP without waiting a week. So that part inserts one step dated ten
// days ago, through DATABASE_URL_OWNER, and only against a database on this
// machine or inside compose with ALLOW_DESTRUCTIVE_TESTS; anywhere else it says
// it was skipped. Everything else is what a person could do in a browser.
//
// Never run this against the municipality's server or the demo: it changes alert
// thresholds for a moment, raises alerts, and registers letters.

import { deflateSync } from 'zlib';
import { PDFDocument, degrees } from 'pdf-lib';

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

if (!/localhost|127\.0\.0\.1|\/\/app[:/]/.test(BASE)) {
  console.error(`refusing to run against ${BASE}: this test raises alerts and registers letters.`);
  process.exit(2);
}

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i).trim(); const v = p.slice(i + 1); if (v) this.cookies.set(k, v); else this.cookies.delete(k); } } }
  async get(path, headers = {}) { const r = await fetch(BASE + path, { headers: { cookie: this.header(), ...headers }, redirect: 'manual' }); this.store(r); const ct = r.headers.get('content-type') ?? ''; const buf = Buffer.from(await r.arrayBuffer()); const body = /text|json|javascript/.test(ct) ? buf.toString('utf8') : ''; const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body, bytes: buf, headers: r.headers }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) { for (const one of [].concat(v)) f.append(k, one); } if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async upload(path, fields, files, { csrf = true } = {}) { const f = new FormData(); if (csrf) f.append('_csrf', this.csrf); for (const [k, v] of Object.entries(fields)) f.append(k, v); for (const [k, name, bytes] of files) f.append(k, new Blob([bytes]), name); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), accept: 'application/json' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async signIn(u) { await this.get('/login'); const r = await this.post('/login', { username: u, password: PASSWORD }); await this.get('/inbox'); return r; }
}

const json = s => { try { return JSON.parse(s); } catch { return {}; } };
const latin = s => String(s).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
const mark = Math.random().toString(36).slice(2, 8);
const idFrom = loc => /\/documents\/(\d+)/.exec(loc ?? '')?.[1];
const roomId = (page, name) => new RegExp(`<option value="(\\d+)"[^>]*>${name}`).exec(page)?.[1]
                              ?? new RegExp(`value="(\\d+)" data-room>\\s*<span[^>]*></span>\\s*<span>${name}`).exec(page)?.[1];

// A PNG with a stroke of ink across it, a few random pixels so no two are alike.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function inkPng(w = 400, h = 566) {
  const row = w * 4 + 1;
  const raw = Buffer.alloc(row * h);
  const seed = Math.floor(Math.random() * 1000);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * row + 1 + x * 4;
      const onLine = Math.abs(y - (h * 0.25 + x * 0.3)) < 3 || (x === seed % w && y === seed % h);
      if (onLine) { raw[o] = 31; raw[o + 1] = 63; raw[o + 2] = 156; raw[o + 3] = 255; }
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A two-page scan, the second page turned, as scanners sometimes store them.
async function scanPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawText(`scan ${mark} ${Math.random()}`, { x: 50, y: 780, size: 12 });
  const p2 = doc.addPage([595.28, 841.89]);
  p2.setRotation(degrees(90));
  return Buffer.from(await doc.save());
}

const aram = new Session();    await aram.signIn('aram');      // mayor
const shilan = new Session();  await shilan.signIn('shilan');  // registry
const hemin = new Session();   await hemin.signIn('hemin');    // head of legal
const sakar = new Session();   await sakar.signIn('sakar');    // a clerk in legal
const karwan = new Session();  await karwan.signIn('karwan');  // archive
const it = new Session();      await it.signIn('itadmin');

const { body: form } = await shilan.get('/registry/new');
const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(form)?.[1] ?? '';
const plotNo = `7${Math.floor(Math.random() * 900) + 100}/${Math.floor(Math.random() * 90) + 10}`;

async function register(s, extra = {}) {
  await s.get('/registry/new');
  const r = await s.post('/registry/new', {
    subject: `داواکاری تاقیکردنەوەی ئامرازەکانی سەرۆک ${mark} ${Math.random().toString(36).slice(2, 6)}`,
    doc_type_option_id: typeId, sender_kind: 'citizen', sender_name: `هاووڵاتی ${mark}`,
    priority: 'normal', confirm_similar: '1', ...extra,
  });
  return idFrom(r.location);
}

// ---------------------------------------------------------------------------
console.log('--- 1: the handwritten instruction ---');

const l1 = await register(shilan, { plot_no: plotNo });
check('a letter to write on is registered', Boolean(l1));
const scanUp = await shilan.upload(`/documents/${l1}/attachments`, { kind: 'original_scan' }, [['file', `scan-${mark}.pdf`, await scanPdf()]]);
check('its two-page scan is attached', [200, 303].includes(scanUp.status), `status ${scanUp.status}`);
const l1Page = await aram.get(`/documents/${l1}`);
const scanId = /\/attachments\/(\d+)\/view/.exec(l1Page.body)?.[1];
check('the mayor is offered «نووسینی هامش» on the letter', l1Page.body.includes(`/documents/${l1}/margin`));
const marginPage = await aram.get(`/documents/${l1}/margin`);
check('the pen page opens, with the scan to write on and the rooms to send to',
  marginPage.status === 200 && marginPage.body.includes('data-ink-canvas') && marginPage.body.includes(`value="${scanId}"`)
  && marginPage.body.includes('margin.js'), `status ${marginPage.status}`);
check('the stamp is told who is writing', marginPage.body.includes('data-stamp-title="هامشی سەرۆکی شارەوانی"'));
const legalId = roomId(marginPage.body, 'ژووری یاسا') ?? /<input type="checkbox" value="(\d+)" data-room>[\s\S]{0,120}ژووری یاسا/.exec(marginPage.body)?.[1];
const contractsId = /<input type="checkbox" value="(\d+)" data-room>[\s\S]{0,120}گرێبەستە گشتییەکان/.exec(marginPage.body)?.[1];
check('the rooms are listed to choose from', Boolean(legalId) && Boolean(contractsId), `${legalId} ${contractsId}`);

const clerkMargin = await sakar.get(`/documents/${l1}/margin`);
check('a room clerk is not offered the pen', clerkMargin.status === 403, `status ${clerkMargin.status}`);

const noRooms = await aram.upload(`/documents/${l1}/margin`, { rooms: '', page_no: '2', source_attachment_id: scanId }, [['ink', 'ink.png', inkPng()]]);
check('sending with no room is refused with the reason', noRooms.status === 400 && /ژوور/.test(json(noRooms.body).error ?? ''), noRooms.body.slice(0, 120));
const notPng = await aram.upload(`/documents/${l1}/margin`, { rooms: legalId, page_no: '1', source_attachment_id: scanId }, [['ink', 'ink.png', await scanPdf()]]);
check('ink that is not a picture is refused', notPng.status === 400, `status ${notPng.status}`);
const noToken = await aram.upload(`/documents/${l1}/margin`, { rooms: legalId, page_no: '1', source_attachment_id: scanId }, [['ink', 'ink.png', inkPng()]], { csrf: false });
check('and so is a post without the form token', noToken.status === 403, `status ${noToken.status}`);

const written = await aram.upload(`/documents/${l1}/margin`,
  { rooms: legalId, page_no: '2', source_attachment_id: scanId, instruction: `بە پەلە ${mark}` },
  [['ink', 'ink.png', inkPng()]]);
const writtenAnswer = json(written.body);
check('the mayor writes on page two (the turned one) and sends it to legal', written.status === 200 && writtenAnswer.location === `/documents/${l1}?done=margin`, written.body.slice(0, 160));

const afterMargin = await aram.get(`/documents/${l1}?done=margin`);
check('the letter says so', afterMargin.body.includes('هامشەکە مۆرکرا و کتابەکە نێردرا.'));
check('the stamped page is on the letter as «هامشی دەستنووس»', afterMargin.body.includes('هامشی دەستنووس'));
check('and the letter went to legal with the typed words', afterMargin.body.includes(`هامش: بە پەلە ${mark}`) && afterMargin.body.includes('ژووری یاسا'));
const marginFileId = [...afterMargin.body.matchAll(/\/attachments\/(\d+)\/view/g)].map(m => m[1]).find(id => id !== scanId);
const marginFile = await aram.get(`/attachments/${marginFileId}`);
let pageCount = 0;
try { pageCount = (await PDFDocument.load(marginFile.bytes)).getPageCount(); } catch { /* not a PDF */ }
check('the stamped file is the whole letter as a PDF, both pages kept', marginFile.bytes.slice(0, 4).toString('latin1') === '%PDF' && pageCount === 2, `pages ${pageCount}`);

const heminMargin = await hemin.get(`/documents/${l1}/margin`);
check('the head of legal, now holding it, may write the next instruction', heminMargin.status === 200, `status ${heminMargin.status}`);
const aramAgain = await aram.get(`/documents/${l1}/margin`);
check('the pen page still opens for the mayor, who may send any letter', aramAgain.status === 200);

// ---------------------------------------------------------------------------
console.log('\n--- 6: the whole case ---');

const l2 = await register(shilan, { related_document_id: l1 });
check('a follow-up letter is registered against the first', Boolean(l2));
const l1Numbers = /ه\/\d{4}\/\d+/.exec(afterMargin.body)?.[0];
const case2 = await aram.get(`/documents/${l2}/case`);
check('the follow-up\'s case shows both letters', case2.status === 200 && case2.body.includes(l1Numbers) && (case2.body.match(/class="case-mark m\d"/g) ?? []).length >= 2, `status ${case2.status}`);
check('with the handwritten instruction on the line of time', case2.body.includes('هامشی نووسی'));
const case1 = await aram.get(`/documents/${l1}/case`);
check('and the first letter\'s case is the same case', case1.status === 200 && case1.body.includes(`/documents/${l2}`));
const l1Now = await aram.get(`/documents/${l1}`);
check('a letter with a follow-up offers «هەموو دۆسیەکە»', l1Now.body.includes('هەموو دۆسیەکە'));
const itCase = await it.get(`/documents/${l1}/case`);
check('IT gets no case', itCase.status === 404, `status ${itCase.status}`);

// ---------------------------------------------------------------------------
console.log('\n--- 2: proving a letter is genuine ---');

const l3 = await register(shilan);
await shilan.get(`/documents/${l3}`);
const recipient = `وەرگری تاقیکردنەوە ${mark}`;
const closed = await shilan.post(`/documents/${l3}/close`, { recipient, channel: 'hand', summary: `دەقی وەڵامی نهێنی ${mark}` });
check('a letter is answered and closed', closed.status === 303 && /closed=1/.test(closed.location ?? ''), closed.location);
const l3Page = await shilan.get(`/documents/${l3}`);
const grouped = /([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{2})/.exec(l3Page.body)?.[1];
const code = grouped?.replaceAll('-', '');
check('closing gave it a verification code, shown on the letter', Boolean(code) && l3Page.body.includes('کۆدی پشتڕاستکردنەوە'), grouped);
const printed = await shilan.get(`/documents/${l3}/reply/print`);
check('the printed reply carries the QR and the code', printed.status === 200 && printed.body.includes(grouped) && printed.body.includes('پشتڕاستکردنەوەی ئەم کتابە'));
const outgoingNo = /د\/\d{4}\/\d+/.exec(l3Page.body)?.[0];

const stranger = new Session();
const checked = await stranger.get(`/v/${code}`);
check('anyone, signed in or not, can check the code', checked.status === 200 && checked.body.includes('لە شارەوانی ڕانیەوە دەرچووە'), `status ${checked.status}`);
check('and sees the outgoing number and who it was sent to', checked.body.includes(outgoingNo) && checked.body.includes(recipient));
check('but nothing of what the letter says', !checked.body.includes(`دەقی وەڵامی نهێنی ${mark}`) && !checked.body.includes(`ئامرازەکانی سەرۆک ${mark}`));
const typedLower = await stranger.get(`/verify?code=${encodeURIComponent(grouped.toLowerCase())}`);
check('the code typed in small letters with the dashes works too', typedLower.status === 200 && typedLower.body.includes(outgoingNo));
const kurdishDigits = grouped.replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d))).replaceAll('-', '—');
const typedKurdish = await stranger.get(`/verify?code=${encodeURIComponent(kurdishDigits)}`);
check('and in Kurdish digits with long dashes, as a phone types it', typedKurdish.status === 200 && typedKurdish.body.includes(outgoingNo), kurdishDigits);
const forged = await stranger.get('/v/ABCDEFGHJK');
check('a made-up code says the letter is not in the register', forged.status === 404 && forged.body.includes('ساختەیە'));
const draftPrint = await aram.get(`/documents/${l2}/reply/print`);
check('a draft reply carries no verification code', draftPrint.status === 200 && !draftPrint.body.includes('/v/'));

// ---------------------------------------------------------------------------
console.log('\n--- 5: security alerts ---');

const baghdadHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const settings = (o = {}) => aram.post('/alerts/settings', {
  alert_bulk_opens: 50, alert_night_from: 22, alert_night_to: 6, alert_refusals: 10, ...o,
});
await aram.get('/alerts');

// IT asking for a letter.
const itLetter = await it.get(`/documents/${l1}`);
check('IT asking for a letter is refused', itLetter.status === 404);
await it.get(`/attachments/${scanId}`);
let alerts = await aram.get('/alerts');
check('and the mayor is told at once, naming the IT account', alerts.status === 200 && alerts.body.includes('هەژماری IT هەوڵی کردنەوەی کتابێکی دا'));
check('naming the latest thing IT asked for, by the letter number', alerts.body.includes('هاوپێچێکی کتابی') && alerts.body.includes(l1Numbers));
check('a link cannot write its own words on the alerts page', !(await aram.get(`/alerts?error=${encodeURIComponent('سیستەم هاککرا')}`)).body.includes('سیستەم هاککرا'));
const bell = await aram.get('/notifications');
check('through the bell as well', bell.body.includes('ئاگاداری ئەمنی'));
const dash = await aram.get('/dashboard');
check('and on the dashboard', dash.body.includes('ئاگاداری ئەمنی نەبینراو'));

// Someone trying numbers.
check('the thresholds can be lowered for the test', (await settings({ alert_refusals: 3, alert_bulk_opens: 5 })).status === 303);
for (let i = 0; i < 3; i++) await karwan.get(`/documents/${900000000 + i}`);
alerts = await aram.get('/alerts');
check('three refused letters in a row raise «هەوڵی دووبارە»', alerts.body.includes('هەوڵی دووبارەی کردنەوەی کتابی ڕێگەپێنەدراو'));

// Somebody opening letters by the handful.
const register_ = await shilan.get('/registry');
const someLetters = [...new Set([...register_.body.matchAll(/\/documents\/(\d+)"/g)].map(m => m[1]))].slice(0, 6);
for (const d of someLetters) await shilan.get(`/documents/${d}`);
alerts = await aram.get('/alerts');
check('opening more letters in an hour than the threshold raises «کتابێکی زۆری کردەوە»', alerts.body.includes('کەسێک لە کاتژمێرێکدا کتابێکی زۆری کردەوە'), `${someLetters.length} opened`);

// Signing in at night: this hour is made "night" for the test.
check('this hour can be made night', (await settings({ alert_night_from: baghdadHour, alert_night_to: (baghdadHour + 1) % 24 })).status === 303);
const late = new Session(); await late.signIn('dler');
alerts = await aram.get('/alerts');
check('signing in at "night" raises «چوونەژوورەوە لە کاتی شەودا»', alerts.body.includes('چوونەژوورەوە لە کاتی شەودا'));

// A room taking a copy of a letter that has left it.
const heminPage = await hemin.get(`/documents/${l1}`);
const heminStep = /name="step_id" value="(\d+)"/.exec(heminPage.body)?.[1];
const forwarded = await hemin.post(`/documents/${l1}/route`, { mode: 'single', to_room_id: contractsId, step_id: heminStep, note: 'بۆ گرێبەستەکان' });
check('legal passes the letter on to contracts', forwarded.status === 303 && !/error=/.test(forwarded.location ?? ''), decodeURIComponent(forwarded.location ?? ''));
const copy = await hemin.get(`/attachments/${scanId}?download=1`);
check('the head of legal can still download its scan', copy.status === 200);
alerts = await aram.get('/alerts');
check('which raises «داگرتنی هاوپێچی کتابێک کە لە ژوورێکی ترە»', alerts.body.includes('داگرتنی هاوپێچی کتابێک کە لە ژوورێکی ترە'));

check('the thresholds go back', (await settings()).status === 303);
const back = await aram.get('/alerts');
check('and read as they were', back.body.includes('name="alert_bulk_opens" type="number" min="5" max="1000" required value="50"') && back.body.includes('name="alert_night_from" type="number" min="0" max="23" required value="22"'));

const firstAlert = /action="\/alerts\/(\d+)\/seen"/.exec(back.body)?.[1];
const seen = await aram.post(`/alerts/${firstAlert}/seen`, {});
check('an alert can be marked seen', seen.status === 303 && /done=seen/.test(seen.location ?? ''));
const allSeen = await aram.post('/alerts/seen-all', {});
const afterAll = await aram.get('/alerts');
check('and all of them at once', allSeen.status === 303 && afterAll.body.includes('هیچ ئاگادارییەکی نەبینراو نییە.'));
const history = await aram.get('/alerts?show=all');
check('seen alerts stay, with who saw them', history.body.includes('بینرا لەلایەن'));
check('IT cannot open the alerts', (await it.get('/alerts')).status === 403);
check('nor can a room head', (await hemin.get('/alerts')).status === 403);

// ---------------------------------------------------------------------------
console.log('\n--- 4: the weekly room report ---');

const report = await aram.get('/reports/weekly');
check('the mayor opens last week\'s report, every room', report.status === 200 && report.body.includes('ژووری یاسا') && report.body.includes('گرێبەستە گشتییەکان'));
const today = new Date().toISOString().slice(0, 10);
const thisWeek = await aram.get(`/reports/weekly?week=${today}`);
check('this week is marked as not yet over', thisWeek.status === 200 && thisWeek.body.includes('هێشتا تەواو نەبووە'));
// A week still running counts as late only what is late by now.
const kuNumberAfter = (body, label) => Number(latin(new RegExp('<div class="n[^"]*">([٠-٩]+)</div>\\s*<div class="k">' + label).exec(body)?.[1] ?? 'NaN'));
const lateThisWeek = kuNumberAfter(thisWeek.body, 'دواکەوتوو لە کۆتایی هەفتە');
const lateNow = kuNumberAfter((await aram.get('/dashboard')).body, 'دواکەوتوو لە ژوورەکان');
check('the late count of a running week is no more than what is late right now', Number.isFinite(lateThisWeek) && lateThisWeek <= lateNow, `${lateThisWeek} in the report, ${lateNow} on the dashboard`);
const sheet = await aram.get(`/reports/weekly/print?week=${today}`);
check('the printed report has a sheet per room with activity, and legal has one', sheet.status === 200 && sheet.body.includes('class="sheet"') && sheet.body.includes('ژووری یاسا'));
const heminReport = await hemin.get(`/reports/weekly?week=${today}`);
check('a room head sees their own room and no other', heminReport.status === 200 && heminReport.body.includes('ژووری یاسا') && !heminReport.body.includes('گرێبەستە گشتییەکان'));
check('a clerk has no report', (await sakar.get('/reports/weekly')).status === 403);
check('a week in the future is not counted', (await aram.get('/reports/weekly?week=2099-01-01')).body.includes('هێشتا تەواو نەبووە'));

// ---------------------------------------------------------------------------
console.log('\n--- 7: the map of plots ---');

const mapPage = await aram.get('/plots/map');
check('the map opens, drawn from this server only', mapPage.status === 200 && mapPage.body.includes('data-plot-map') && mapPage.body.includes('/vendor/leaflet/leaflet.js') && !/https?:\/\/(?!fonts\.)[a-z]/i.test(mapPage.body.replace(/<link[^>]+fonts\.googleapis[^>]+>/g, '').replace(/href="https:\/\/fonts[^"]+"/g, '')));
const mapFile = await aram.get('/map/rania.json');
const mapData = json(mapFile.body);
check('Rania\'s streets are a file on the server', mapFile.status === 200 && (mapData.roads?.length ?? 0) > 1000 && /OpenStreetMap/.test(mapData.attribution ?? ''));
check('the plot with letters and no place is listed to be placed', mapPage.body.includes(`place=${encodeURIComponent(plotNo)}`) || mapPage.body.includes('پارچەی بێ شوێن'));
await karwan.get('/plots/map');
const placed = await karwan.post('/plots/map/place', { plot_no: plotNo, lat: '36.2571', lng: '44.8834' });
check('the archive puts the plot on the map', placed.status === 200 && json(placed.body).ok === true, placed.body.slice(0, 120));
const moved = await karwan.post('/plots/map/place', { plot_no: plotNo, lat: '36.2572', lng: '44.8835', outline: JSON.stringify([[36.2571, 44.8833], [36.2573, 44.8833], [36.2573, 44.8837], [36.2571, 44.8837]]) });
check('and moves it, with its outline', moved.status === 200 && json(moved.body).result === 'moved');
const data = json((await aram.get('/plots/map/data')).body);
const ours = (data.plots ?? []).find(p => p.no === plotNo);
check('the map\'s data has it with its letters counted', Boolean(ours) && ours.letters >= 1 && Array.isArray(ours.outline), JSON.stringify(ours ?? {}).slice(0, 120));
const plotFile = await aram.get(`/plots?p=${encodeURIComponent(plotNo)}`);
check('its plot file says it is on the map', plotFile.body.includes('لەسەر نەخشە دیاریکراوە'));
check('a place outside the region is refused', (await karwan.post('/plots/map/place', { plot_no: plotNo, lat: '51.5', lng: '0.1' })).status === 400);
check('a broken outline is refused', (await karwan.post('/plots/map/place', { plot_no: plotNo, lat: '36.25', lng: '44.88', outline: '[[1,2]]' })).status === 400);
check('a room clerk cannot place plots', (await sakar.post('/plots/map/place', { plot_no: plotNo, lat: '36.25', lng: '44.88' })).status === 403);
check('IT does not get the map', (await it.get('/plots/map')).status === 403);

// ---------------------------------------------------------------------------
console.log('\n--- 3: the escalation ladder ---');

const types = await shilan.get('/admin/doc-types');
check('the registry sees each type\'s escalation, but not the municipality-wide ladder', types.status === 200 && types.body.includes('بەرزکردنەوە') && !types.body.includes('action="/admin/doc-types/ladder"'));
check('and may not change the ladder', (await shilan.post('/admin/doc-types/ladder', { reminder: 1, head: 3, mayor: 5 })).status === 403);
const aramTypes = await aram.get('/admin/doc-types');
check('the mayor may', aramTypes.body.includes('action="/admin/doc-types/ladder"'));
const wrongOrder = await aram.post('/admin/doc-types/ladder', { reminder: 1, head: 6, mayor: 5 });
check('a ladder where the mayor hears before the head is refused', wrongOrder.status === 303 && /error=/.test(wrongOrder.location ?? ''));
const ladder = await aram.post('/admin/doc-types/ladder', { reminder: 1, head: 3, mayor: 5 });
check('and the ordinary one saved', ladder.status === 303 && /done=ladder/.test(ladder.location ?? ''));
const typeTiming = await shilan.post(`/admin/doc-types/${typeId}/timing`, { default_due_days: '', escalate_head_days: '4', escalate_mayor_days: '4' });
check('a type whose head and mayor numbers are equal is refused', /error=/.test(typeTiming.location ?? ''));
const outOfRange = await shilan.post(`/admin/doc-types/${typeId}/timing`, { default_due_days: '0', escalate_head_days: '99', escalate_mayor_days: '500' });
check('numbers out of range are refused, not quietly reset to the default', /error=range/.test(outOfRange.location ?? ''), outOfRange.location);
check('and a made-up message cannot be put on the types page', !(await shilan.get(`/admin/doc-types?error=${encodeURIComponent('سیستەم هاککرا')}`)).body.includes('سیستەم هاککرا'));
const typeReset = await shilan.post(`/admin/doc-types/${typeId}/timing`, { default_due_days: '', escalate_head_days: '', escalate_mayor_days: '' });
check('a type can go back to the ladder for everything', /done=timing/.test(typeReset.location ?? ''));

const ownerUrl = process.env.DATABASE_URL_OWNER;
if (!ownerUrl || !(/localhost|127\.0\.0\.1/.test(ownerUrl) || process.env.ALLOW_DESTRUCTIVE_TESTS)) {
  console.log('skip  a letter ten days late climbing the ladder — needs DATABASE_URL_OWNER on a disposable database');
} else {
  const pg = (await import('pg')).default;
  const { runJob } = await import('../src/lib/jobs-core.mjs');
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 2 });
  const l4 = await register(shilan);
  const { rows: [who] } = await pool.query(`SELECT r.id AS room, r.head_user_id AS head, (SELECT id FROM app_user WHERE username = 'shilan') AS by FROM room r WHERE r.name = 'ژووری یاسا'`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [s] } = await client.query(`
      INSERT INTO routing_step (document_id, seq_no, kind, to_room_id, assigned_by, assigned_to, status, due_days, sent_at, due_at)
      VALUES ($1, 1, 'single', $2, $3, $4, 'active', 2, now() - interval '12 days', now() - interval '10 days') RETURNING id`,
      [l4, who.room, who.by, who.head]);
    await client.query(`UPDATE document SET status = 'in_flow', current_room_id = $2, current_step_id = $3 WHERE id = $1`, [l4, who.room, s.id]);
    await client.query('COMMIT');
    globalThis.lateStep = s.id;
  } catch (e) {
    await client.query('ROLLBACK');
    console.log('FAIL  could not make a late letter:', e.message); failures++;
  } finally { client.release(); }

  const run = await runJob((sql, p) => pool.query(sql, p), 'deadlines');
  check('the morning job runs', run.ok, run.lines.filter(l => /ladder|FAILED/.test(l)).join(' | '));
  const kinds = async () => (await pool.query(
    `SELECT kind, count(*)::int AS n FROM notification WHERE detail ->> 'step_id' = $1 GROUP BY kind`, [String(globalThis.lateStep)])).rows;
  const told = Object.fromEntries((await kinds()).map(r => [r.kind, r.n]));
  check('ten days late, the holder is reminded', told['step.late_reminder'] >= 1, JSON.stringify(told));
  check('the head of the room is told', told['step.escalated_head'] >= 1);
  const { rows: [bosses] } = await pool.query(`SELECT count(*)::int AS n FROM app_user WHERE is_active AND role IN ('mayor', 'deputy_mayor')`);
  check('and the mayor and the deputy are told', told['step.escalated_mayor'] === bosses.n, `${told['step.escalated_mayor']} of ${bosses.n}`);
  await runJob((sql, p) => pool.query(sql, p), 'deadlines');
  const again = Object.fromEntries((await kinds()).map(r => [r.kind, r.n]));
  check('running the job again tells nobody twice', JSON.stringify(again) === JSON.stringify(told), JSON.stringify(again));
  const dashNow = await aram.get('/dashboard');
  const l4No = /ه\/\d{4}\/\d+/.exec((await aram.get(`/documents/${l4}`)).body)?.[0];
  const row = new RegExp(`<tr class="escalated">[\\s\\S]*?${l4No.replace(/\//g, '\\/')}[\\s\\S]*?</tr>`).exec(dashNow.body)?.[0] ?? '';
  check('the dashboard lists it as reached the mayor, with who has it', row.includes('گەیشتووەتە لای سەرۆک') && row.includes('<strong>'), l4No);
  const mayorBell = await aram.get('/notifications');
  check('and the mayor\'s bell says it', mayorBell.body.includes('گەیشتە لای سەرۆک'));
  await pool.end();
}

console.log(failures ? `\n${failures} FAILED` : '\nall seven hold');
process.exit(failures ? 1 : 0);
