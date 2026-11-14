// Installable, and usable on a phone.
//
//   node test/pwa.test.mjs        (server must be running on BASE)
//
// A stylesheet cannot be tested by asking a browser to render it, so this tests
// the things that are actually checkable and that actually break:
//
//   - the manifest is served, is valid, and its icons exist at the sizes it
//     claims (a wrong size is the commonest reason a phone refuses to install)
//   - every page carries the viewport tag, without which a phone renders the
//     desktop layout shrunk to illegibility and nothing else matters
//   - every table sits inside something that can scroll sideways, because a
//     seven-column register on a 360 pixel screen has no other honest answer
//   - the service worker caches static files and nothing else
//
// That last one is a confidentiality check wearing a performance hat. A service
// worker that caches a page puts municipal correspondence on the disk of a
// shared workstation, where row-level security cannot reach it.

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) this.cookies.set(p.slice(0, i).trim(), p.slice(i + 1)); } }
  async get(path) { const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, body }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location') }; }
  async signIn(u) { await this.get('/login'); return this.post('/login', { username: u, password: PASSWORD }); }
}

console.log('--- the manifest ---');

const manifestRes = await fetch(`${BASE}/manifest.webmanifest`);
check('the manifest is served', manifestRes.status === 200);
check('as a manifest, not as plain text',
  (manifestRes.headers.get('content-type') ?? '').includes('manifest+json'),
  manifestRes.headers.get('content-type'));

let manifest = null;
try { manifest = JSON.parse(await manifestRes.text()); } catch { /* reported below */ }
check('and is valid JSON', Boolean(manifest));

if (manifest) {
  for (const field of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color']) {
    check(`it declares ${field}`, manifest[field] !== undefined);
  }
  check('it opens as an application rather than a browser tab', manifest.display === 'standalone', manifest.display);
  check('it is marked right-to-left Kurdish', manifest.dir === 'rtl' && manifest.lang === 'ckb');
  check('it offers a maskable icon, so Android does not letterbox it',
    manifest.icons.some(i => String(i.purpose ?? '').includes('maskable')));

  // An icon whose real size does not match the declared size is the commonest
  // reason a phone quietly refuses to offer installation.
  for (const icon of manifest.icons) {
    const res = await fetch(BASE + icon.src);
    const bytes = Buffer.from(await res.arrayBuffer());
    const isPng = bytes.length > 24 && bytes.subarray(1, 4).toString('latin1') === 'PNG';
    // Width and height live in the IHDR chunk, at a fixed offset.
    const w = isPng ? bytes.readUInt32BE(16) : 0;
    const h = isPng ? bytes.readUInt32BE(20) : 0;
    check(`${icon.src} is a real PNG of ${icon.sizes}`,
      isPng && `${w}x${h}` === icon.sizes, `${w}x${h}`);
  }
}

console.log('\n--- the service worker ---');

const swRes = await fetch(`${BASE}/sw.js`);
const sw = await swRes.text();
check('the service worker is served', swRes.status === 200);

// The allowlist it precaches, read out of the file itself.
const shellBlock = /var SHELL = \[([\s\S]*?)\];/.exec(sw)?.[1] ?? '';
const shell = [...shellBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
check('it precaches a list of files', shell.length > 0, shell.join(' '));

const ALLOWED = ['/app.css', '/app.js', '/sounds.js', '/offline.html', '/print.js'];
const strays = shell.filter(p => !ALLOWED.includes(p) && !p.startsWith('/icons/'));
check('and every one of them is a static asset, never a page', strays.length === 0, strays.join(' '));

for (const path of shell) {
  const r = await fetch(BASE + path);
  check(`${path} exists to be cached`, r.status === 200, String(r.status));
}

check('the event stream is left alone by the worker', sw.includes("url.pathname === '/events'"));
check('pages are fetched from the network, never served from the cache',
  /req\.mode === 'navigate'/.test(sw) && /caches\.match\('\/offline\.html'\)/.test(sw));
check('and nothing else is intercepted at all', /No respondWith/.test(sw));

console.log('\n--- every screen ---');

const staff = new Session(); await staff.signIn('aram');
const PAGES = ['/dashboard', '/registry', '/inbox', '/my-day', '/documents', '/plots',
               '/archive', '/tray', '/templates', '/leave', '/rooms', '/barcode',
               '/manifests', '/companies', '/notifications', '/log'];

let missingViewport = [], missingManifest = [], missingDrawer = [], missingBell = [], wide = [];
let unscrollable = [];

for (const path of PAGES) {
  const { status, body } = await staff.get(path);
  if (status !== 200) { check(`${path} opens`, false, String(status)); continue; }

  if (!/<meta name="viewport" content="width=device-width/.test(body)) missingViewport.push(path);
  if (!/<link rel="manifest"/.test(body)) missingManifest.push(path);
  if (!/class="nav-toggle-input"/.test(body)) missingDrawer.push(path);
  if (!/data-bell-count/.test(body)) missingBell.push(path);

  // An inline width in pixels wider than a phone. These are the things that
  // force a sideways scroll of the whole page rather than of one table.
  for (const m of body.matchAll(/style="[^"]*width:\s*(\d{3,})px/g)) {
    if (Number(m[1]) > 420) wide.push(`${path} (${m[1]}px)`);
  }

  // Each table must sit inside an element that scrolls: .table-wrap, or the card
  // itself, which app.css makes scrollable on a narrow screen. Crude but it has
  // to be: there is no DOM parser here and adding one for this would be worse.
  // It looks back at the nearest opening div and asks what class it had.
  let at = -1;
  while ((at = body.indexOf('<table', at + 1)) !== -1) {
    const before = body.slice(Math.max(0, at - 600), at);
    const lastDiv = before.lastIndexOf('<div');
    const cls = lastDiv === -1 ? '' : before.slice(lastDiv, lastDiv + 120);
    if (!/table-wrap|card/.test(cls)) unscrollable.push(`${path}: ${cls.slice(0, 60).replace(/\s+/g, ' ')}`);
  }
}

check('every screen tells the phone its real width', missingViewport.length === 0, missingViewport.join(' '));
check('every screen can be installed from', missingManifest.length === 0, missingManifest.join(' '));
check('every screen has the menu drawer', missingDrawer.length === 0, missingDrawer.join(' '));
check('every screen has the bell', missingBell.length === 0, missingBell.join(' '));
check('no screen is pinned wider than a phone', wide.length === 0, wide.slice(0, 4).join('; '));
check('every table can be scrolled sideways', unscrollable.length === 0, unscrollable.slice(0, 4).join('; '));

console.log('\n--- the stylesheet ---');

const css = await (await fetch(`${BASE}/app.css`)).text();
check('it has a phone arrangement', /@media \(max-width: 900px\)/.test(css));
check('the sidebar becomes a drawer there', /\.nav-toggle-input:checked ~ \.shell \.sidebar/.test(css));
check('fields are 16px on a phone, so iOS does not zoom and stay zoomed',
  /input\[type=text\][\s\S]{0,300}font-size: 16px/.test(css));
check('it uses dvh rather than vh, so the last row is not under the address bar',
  /100dvh/.test(css) && !/min-height: 100vh/.test(css));
check('it respects a request for less motion', /prefers-reduced-motion/.test(css));

console.log('\n--- signed out ---');

const anon = await fetch(`${BASE}/login`);
const loginBody = await anon.text();
check('the login screen is installable too', /<link rel="manifest"/.test(loginBody));
check('and sized for a phone', /width=device-width/.test(loginBody));
check('the offline notice exists and mentions no letter',
  (await (await fetch(`${BASE}/offline.html`)).text()).includes('پەیوەندی بە ڕاژەوە نییە'));

console.log(failures ? `\n${failures} FAILED` : '\nit installs and it fits on a phone');
process.exit(failures ? 1 : 0);
