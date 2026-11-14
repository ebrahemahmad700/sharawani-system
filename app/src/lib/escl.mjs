// Driving a network scanner.
//
// eSCL is the protocol behind Apple AirScan and Mopria scanning, and nearly every
// office scanner and multifunction printer sold since about 2017 speaks it: Canon,
// HP, Epson, Brother, Kyocera, Ricoh, Xerox, Konica. It is plain HTTP on the local
// network, with no driver, no vendor software and no per-computer setup:
//
//   GET  <root>/ScannerCapabilities     what it can do, as XML
//   GET  <root>/ScannerStatus           idle or busy, and whether the feeder has paper
//   POST <root>/ScanJobs                start a job; the answer is a Location header
//   GET  <job>/NextDocument             one page or one document; 404 when finished
//
// The server does the talking, not the browser. A browser cannot reach a scanner
// on another machine's network card, and would need the scanner to allow it; the
// server is on the same LAN as the scanners and needs nothing from them.
//
// WHAT THIS CANNOT DO
//
// A USB scanner plugged into one clerk's computer is not on the network, so the
// server cannot see it. Those keep the two routes they already had: save to the
// watched folder, or upload the file. This is written plainly in the handover so
// nobody buys the wrong machine.
//
// SAFETY
//
// The address is somewhere the server will send requests, so it must not become
// a way to make the server fetch arbitrary URLs. Only IT, the mayor and the deputy
// may set one, and checkScannerUrl() refuses anything that is not on the local
// network: private IPv4 ranges, link-local, .local names and single-label names.

import { mergeToPdf, countPages } from './pdfmerge.mjs';

class ScannerError extends Error {
  constructor(message, code) { super(message); this.code = code; this.expected = true; }
}

// The simulated scanner. Lets the whole path be tried with no hardware: on the
// demo, in the tests, and on a laptop before the real machine arrives. Switched
// on by SCANNER_SIMULATOR=1 and never otherwise.
export const SIMULATOR_URL = 'http://simulator.docsys.invalid/eSCL';
export const simulatorEnabled = () => process.env.SCANNER_SIMULATOR === '1';

const REQUEST_TIMEOUT_MS = Number(process.env.SCANNER_TIMEOUT_MS || 60_000);
const JOB_TIMEOUT_MS = Number(process.env.SCANNER_JOB_TIMEOUT_MS || 180_000);

/**
 * Whether an address is one the server may talk to. Returns the address with no
 * trailing slash, or throws a ScannerError saying why not.
 */
export function checkScannerUrl(raw) {
  const text = String(raw ?? '').trim();
  if (simulatorEnabled() && text === SIMULATOR_URL) return SIMULATOR_URL;

  let u;
  try { u = new URL(text); } catch { throw new ScannerError('ناونیشانەکە دروست نییە. وەک http://192.168.1.40/eSCL.', 'bad_url'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new ScannerError('تەنها http یان https.', 'bad_url');
  if (u.username || u.password || u.search || u.hash) throw new ScannerError('ناونیشان نابێت ناو، وشەی نهێنی یان ? تێدابێت.', 'bad_url');

  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  let local = false;
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    local = a === 10
         || (a === 172 && b >= 16 && b <= 31)
         || (a === 192 && b === 168)
         || (a === 169 && b === 254)
         // Loopback only for the protocol test, which runs a fake scanner in the
         // same process. Otherwise it would be the server asking itself.
         || (a === 127 && process.env.SCANNER_ALLOW_LOOPBACK === '1');
  } else if (host.includes(':')) {
    local = /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  } else {
    local = host.endsWith('.local') || host.endsWith('.lan') || !host.includes('.');
    if (host === 'localhost') local = process.env.SCANNER_ALLOW_LOOPBACK === '1';
  }
  if (!local) {
    throw new ScannerError('سکانەر دەبێت لەسەر تۆڕی ناوخۆی شارەوانی بێت (وەک 192.168.x.x).', 'not_local');
  }
  // Only the ports scanners answer eSCL on. A one-word host name is a normal
  // office printer name, and it is also what the database's container is called:
  // http://db:5432/eSCL was accepted and contacted (records test, 13 September).
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (![80, 443, 631, 8080, 8443, 9095, 9096].includes(port) && !(process.env.SCANNER_ALLOW_LOOPBACK === '1')) {
    throw new ScannerError('ئەم دەروازەیە (port) بۆ سکانەر نییە. سکانەرەکان لەسەر 80، 443، 631 یان 8080 وەڵام دەدەنەوە.', 'bad_port');
  }
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

// --- talking ----------------------------------------------------------------

async function request(url, { method = 'GET', body = null, headers = {}, timeout = REQUEST_TIMEOUT_MS } = {}) {
  if (url.startsWith(SIMULATOR_URL)) return simulator(url, { method, body });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { method, body, headers, signal: ctl.signal, redirect: 'manual' });
    const bytes = Buffer.from(await r.arrayBuffer());
    return { status: r.status, headers: r.headers, bytes, text: () => bytes.toString('utf8') };
  } catch (err) {
    throw new ScannerError(err.name === 'AbortError'
      ? 'سکانەر لە کاتی خۆیدا وەڵامی نەدایەوە.'
      : 'پەیوەندی بە سکانەرەوە نەکرا. دڵنیابە کە هەڵکراوە و لەسەر هەمان تۆڕە.', 'unreachable');
  } finally {
    clearTimeout(timer);
  }
}

// The XML is small and fixed in shape, so it is read with patterns rather than a
// parser. Namespace prefixes vary between makers (pwg:, scan:, or none), so every
// pattern allows any prefix.
const tag = (xml, name) => new RegExp(`<(?:\\w+:)?${name}[^>]*>([^<]*)</(?:\\w+:)?${name}>`, 'i').exec(xml)?.[1]?.trim() ?? null;
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}[^>]*>([^<]*)</(?:\\w+:)?${name}>`, 'gi'))].map(m => m[1].trim());
const has = (xml, name) => new RegExp(`<(?:\\w+:)?${name}[\\s>]`, 'i').test(xml);

/** What the scanner says it can do. */
export async function capabilities(base) {
  const r = await request(`${base}/ScannerCapabilities`);
  if (r.status !== 200) throw new ScannerError(`سکانەر وەڵامی هەڵەی دایەوە (${r.status}). ناونیشانی eSCL دروستە؟`, 'bad_status');
  const xml = r.text();
  if (!/ScannerCapabilities/i.test(xml)) throw new ScannerError('ئەم ناونیشانە سکانەری eSCL نییە.', 'not_escl');
  const formats = [...new Set([...tags(xml, 'DocumentFormat'), ...tags(xml, 'DocumentFormatExt')])];
  const resolutions = [...new Set(tags(xml, 'XResolution').map(Number).filter(Boolean))].sort((a, b) => a - b);
  return {
    makeModel: tag(xml, 'MakeAndModel') ?? tag(xml, 'ModelName') ?? null,
    platen: has(xml, 'Platen'),
    feeder: has(xml, 'Adf'),
    duplex: has(xml, 'AdfDuplexInputCaps'),
    formats,
    colorModes: [...new Set(tags(xml, 'ColorMode'))],
    resolutions,
    maxWidth: Number(tag(xml, 'MaxWidth')) || null,
    maxHeight: Number(tag(xml, 'MaxHeight')) || null,
  };
}

/** Idle, busy, or stopped, and whether there is paper in the feeder. */
export async function status(base) {
  const r = await request(`${base}/ScannerStatus`, { timeout: 5000 });
  if (r.status !== 200) throw new ScannerError(`سکانەر وەڵامی هەڵەی دایەوە (${r.status}).`, 'bad_status');
  const xml = r.text();
  return { state: tag(xml, 'State') ?? 'Unknown', adf: tag(xml, 'AdfState') };
}

const pick = (list, wanted, fallback) => (list.includes(wanted) ? wanted : (list[0] ?? fallback));
const nearest = (list, wanted) => (list.length
  ? list.reduce((best, r) => (Math.abs(r - wanted) < Math.abs(best - wanted) ? r : best), list[0])
  : wanted);

/**
 * Scan, and return one PDF.
 *
 * @param {string} base      the eSCL root, already through checkScannerUrl
 * @param {object} o
 * @param {'Platen'|'Feeder'} o.source   the glass, or the sheet feeder
 * @param {'color'|'gray'} o.color
 * @param {number} o.resolution          dots per inch; the nearest the scanner offers is used
 * @returns {Promise<{pdf: Buffer, pages: number, makeModel: string|null}>}
 */
export async function scan(base, { source = 'Platen', color = 'gray', resolution = 300 } = {}) {
  const caps = await capabilities(base);
  if (source === 'Feeder' && !caps.feeder) throw new ScannerError('ئەم سکانەرە فیدەری نییە. شووشەکە بەکاربهێنە.', 'no_feeder');
  if (source === 'Platen' && !caps.platen && caps.feeder) source = 'Feeder';

  // PDF when the scanner can make one, because one request then brings back a
  // whole feeder pass. JPEG otherwise, one page per request, merged here.
  const format = caps.formats.includes('application/pdf') ? 'application/pdf'
               : caps.formats.includes('image/jpeg') ? 'image/jpeg'
               : caps.formats[0] ?? 'image/jpeg';
  const colorMode = color === 'color'
    ? pick(caps.colorModes, 'RGB24', 'RGB24')
    : pick(caps.colorModes, 'Grayscale8', 'Grayscale8');
  const dpi = nearest(caps.resolutions, resolution);
  // A4, in the three-hundredths of an inch the protocol measures in, clipped to
  // what the glass can take.
  const width = Math.min(2480, caps.maxWidth ?? 2480);
  const height = Math.min(3508, caps.maxHeight ?? 3508);

  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.63</pwg:Version>
  <pwg:ScanRegions pwg:MustHonor="false">
    <pwg:ScanRegion>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>${width}</pwg:Width>
      <pwg:Height>${height}</pwg:Height>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>${source}</pwg:InputSource>
  <scan:ColorMode>${colorMode}</scan:ColorMode>
  <scan:XResolution>${dpi}</scan:XResolution>
  <scan:YResolution>${dpi}</scan:YResolution>
  <pwg:DocumentFormat>${format}</pwg:DocumentFormat>
  <scan:DocumentFormatExt>${format}</scan:DocumentFormatExt>
</scan:ScanSettings>`;

  const started = await request(`${base}/ScanJobs`, {
    method: 'POST', body: settings, headers: { 'content-type': 'text/xml' },
  });
  if (started.status === 503) throw new ScannerError('سکانەر ئێستا سەرقاڵە. کەمێک چاوەڕێ بکە و دووبارە هەوڵبدەوە.', 'busy');
  if (started.status === 409) throw new ScannerError('هیچ کاغەزێک لە فیدەرەکەدا نییە.', 'no_paper');
  if (started.status !== 201) throw new ScannerError(`سکانەر کارەکەی دەست پێنەکرد (${started.status}).`, 'not_started');

  const location = started.headers.get('location');
  if (!location) throw new ScannerError('سکانەر ناونیشانی کارەکەی نەنارد.', 'no_location');
  // Some makers answer with a full URL, some with a path. Both resolve against the
  // scanner's own address, never against anything else, so a scanner cannot send
  // the server somewhere new.
  const origin = new URL(base.startsWith(SIMULATOR_URL) ? SIMULATOR_URL : base).origin;
  const jobUrl = new URL(location, origin + '/');
  if (jobUrl.origin !== origin) throw new ScannerError('سکانەر ناونیشانێکی نامۆی نارد.', 'bad_location');
  const job = jobUrl.href.replace(/\/+$/, '');

  const parts = [];
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new ScannerError('سکانکردن زۆری خایاند.', 'timeout');
    const r = await request(`${job}/NextDocument`);
    if (r.status === 404 || r.status === 410) break;              // no more pages
    if (r.status === 503) { await new Promise(t => setTimeout(t, 1000)); continue; }  // still scanning
    if (r.status !== 200) throw new ScannerError(`سکانەر پەڕەکەی نەنارد (${r.status}).`, 'page_failed');
    if (!r.bytes.length) break;
    const type = r.bytes.slice(0, 4).toString('latin1') === '%PDF' ? 'pdf'
               : (r.bytes[0] === 0xff && r.bytes[1] === 0xd8) ? 'jpg'
               : (r.bytes[0] === 0x89 && r.bytes.slice(1, 4).toString('latin1') === 'PNG') ? 'png' : null;
    if (!type) throw new ScannerError('سکانەر جۆرە فایلێکی نەناسراوی نارد.', 'bad_page');
    parts.push({ bytes: r.bytes, type });
    // The glass holds one page. Asking it for a second starts some models again.
    if (source === 'Platen') break;
  }
  // Tidy up on the scanner, and wait for it: some models refuse the next job
  // while the last one is still listed. Failure here is the scanner's business.
  await request(job, { method: 'DELETE', timeout: 5000 }).catch(() => {});

  if (!parts.length) throw new ScannerError(source === 'Feeder' ? 'هیچ کاغەزێک لە فیدەرەکەدا نەبوو.' : 'سکانەر هیچ پەڕەیەکی نەنارد.', 'empty');

  const pdf = parts.length === 1 && parts[0].type === 'pdf' ? parts[0].bytes : await mergeToPdf(parts);
  return { pdf, pages: await countPages(pdf), makeModel: caps.makeModel };
}

// --- which scanners a person is offered -----------------------------------

/**
 * The active scanners this person may use: their own room's first, then the
 * shared ones. IT is offered none, because what comes out of a scanner here is a
 * letter.
 */
// The same people who handle paper everywhere else. Not IT, not HR.
export const SCAN_ROLES = ['registry_clerk', 'room_clerk', 'room_head', 'archive_clerk', 'mayor', 'deputy_mayor', 'directorate_head'];

export async function scannersFor(q, user) {
  if (!user || !SCAN_ROLES.includes(user.role)) return [];
  const { rows } = await q(
    `SELECT s.id, s.code, s.name, s.base_url, s.room_id, s.make_model, s.last_seen_at, s.last_error,
            r.name AS room_name
       FROM scanner s LEFT JOIN room r ON r.id = s.room_id
      WHERE s.is_active AND (s.room_id IS NULL OR s.room_id = $1)
      ORDER BY (s.room_id IS NULL), s.name`, [user.roomId ?? 0]);
  return rows.filter(s => s.base_url !== SIMULATOR_URL || simulatorEnabled());
}

// --- the simulated scanner --------------------------------------------------
//
// Answers the same four requests a real one does, with the same status codes, so
// the code above runs exactly as it would against a Canon in room 8. The page it
// "scans" is drawn with pdf-lib: a plain sheet that says it is a test, with the
// time on it, so nobody mistakes it for a letter.

const simJobs = new Map();

async function simulatedPage() {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 40, y: 760, width: 515, height: 50, borderColor: rgb(0.08, 0.31, 0.23), borderWidth: 1.5 });
  page.drawText('DOCSYS TEST SCANNER', { x: 60, y: 778, size: 20, font: bold, color: rgb(0.08, 0.31, 0.23) });
  page.drawText('This page was produced by the simulated scanner. It is not a letter.', { x: 60, y: 730, size: 11, font });
  page.drawText(`Scanned at ${new Date().toISOString()}`, { x: 60, y: 712, size: 11, font });
  for (let i = 0; i < 18; i++) {
    page.drawLine({ start: { x: 60, y: 660 - i * 28 }, end: { x: 60 + 300 + ((i * 97) % 175), y: 660 - i * 28 }, thickness: 1, color: rgb(0.75, 0.75, 0.72) });
  }
  page.drawText(`ref ${Math.random().toString(36).slice(2, 10)}`, { x: 60, y: 80, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
  return Buffer.from(await doc.save());
}

async function simulator(url, { method }) {
  const path = url.slice(SIMULATOR_URL.length);
  const respond = (status, bytes = Buffer.alloc(0), headers = {}) => ({
    status, headers: new Headers(headers), bytes, text: () => bytes.toString('utf8'),
  });
  if (method === 'GET' && path === '/ScannerCapabilities') {
    return respond(200, Buffer.from(`<?xml version="1.0"?>
<scan:ScannerCapabilities xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:MakeAndModel>docsys simulated scanner</pwg:MakeAndModel>
  <scan:Platen><scan:PlatenInputCaps><scan:MaxWidth>2550</scan:MaxWidth><scan:MaxHeight>3508</scan:MaxHeight>
    <scan:SettingProfiles><scan:SettingProfile>
      <scan:ColorModes><scan:ColorMode>Grayscale8</scan:ColorMode><scan:ColorMode>RGB24</scan:ColorMode></scan:ColorModes>
      <scan:DocumentFormats><pwg:DocumentFormat>application/pdf</pwg:DocumentFormat><pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat></scan:DocumentFormats>
      <scan:SupportedResolutions><scan:DiscreteResolutions>
        <scan:DiscreteResolution><scan:XResolution>200</scan:XResolution><scan:YResolution>200</scan:YResolution></scan:DiscreteResolution>
        <scan:DiscreteResolution><scan:XResolution>300</scan:XResolution><scan:YResolution>300</scan:YResolution></scan:DiscreteResolution>
      </scan:DiscreteResolutions></scan:SupportedResolutions>
    </scan:SettingProfile></scan:SettingProfiles></scan:PlatenInputCaps></scan:Platen>
  <scan:Adf><scan:AdfSimplexInputCaps><scan:MaxWidth>2550</scan:MaxWidth><scan:MaxHeight>4200</scan:MaxHeight></scan:AdfSimplexInputCaps></scan:Adf>
</scan:ScannerCapabilities>`));
  }
  if (method === 'GET' && path === '/ScannerStatus') {
    return respond(200, Buffer.from('<scan:ScannerStatus xmlns:scan="x" xmlns:pwg="y"><pwg:State>Idle</pwg:State><scan:AdfState>ScannerAdfLoaded</scan:AdfState></scan:ScannerStatus>'));
  }
  if (method === 'POST' && path === '/ScanJobs') {
    const id = Math.random().toString(16).slice(2);
    simJobs.set(id, 2);                         // two pages from the feeder, one from the glass
    return respond(201, Buffer.alloc(0), { location: `/eSCL/ScanJobs/${id}` });
  }
  const m = /^\/ScanJobs\/([0-9a-f]+)(\/NextDocument)?$/.exec(path);
  if (m && method === 'DELETE') { simJobs.delete(m[1]); return respond(200); }
  if (m && m[2] && method === 'GET') {
    const left = simJobs.get(m[1]);
    if (!left) return respond(404);
    simJobs.set(m[1], left - 1);
    return respond(200, await simulatedPage(), { 'content-type': 'application/pdf' });
  }
  return respond(404);
}

export { ScannerError };
