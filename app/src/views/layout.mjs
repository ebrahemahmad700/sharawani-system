// The page shell: sidebar, top bar, content area.
//
// Matches the approved screens in design/. The sidebar is the dark green, the
// active item carries the gold, the page is the warm off-white. Do not restyle
// these here; if a screen needs to change, change the design file first.
//
// The whole document is dir="rtl" lang="ckb". Latin runs are wrapped by ltr()
// in lib/html.mjs, never by hand.

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { html, raw, escapeHtml, date, initials, num } from '../lib/html.mjs';

// A fingerprint of the stylesheet and scripts, put on their URLs.
//
// Without it a fix to app.css reached nobody for an hour: the file is sent with a
// one-hour cache, and the service worker then served its own stored copy first.
// The scrolling fix would have been deployed and every open browser in the
// building would have gone on not scrolling. A new fingerprint is a new URL, so a
// changed file is fetched the first time a page asks for it.
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const ASSET_VERSION = (() => {
  const h = createHash('sha256');
  // Every script and stylesheet a page names, not only the application's own:
  // the viewer, the board, the print sheets and the tracking page were loaded
  // without a fingerprint and could stay stale for an hour after an update
  // (browser audit, 13 September).
  for (const f of ['app.css', 'app.js', 'sounds.js', 'viewer.js', 'board.css', 'board.js', 'print.js', 'track.js']) {
    try { h.update(readFileSync(join(PUBLIC, f))); } catch { h.update(f); }
  }
  return h.digest('hex').slice(0, 10);
})();
export const asset = path => `${path}?v=${ASSET_VERSION}`;

const ROLE_NAMES = {
  mayor:            'سەرۆکی شارەوانی',
  deputy_mayor:     'جێگری سەرۆک',
  directorate_head: 'بەڕێوەبەر',
  room_head:        'بەرپرسی ژوور',
  room_clerk:       'کارمەندی ژوور',
  registry_clerk:   'کارمەندی هات و دەرچوو',
  archive_clerk:    'کارمەندی ئەرشیف',
  hr:               'کارگێڕی',
  sysadmin:         'بەڕێوەبەری سیستەم',
};

// Stroke icons, matching the design files. 20px, currentColor.
const icon = d => raw(
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);

const ICONS = {
  dashboard: icon('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
  registry:  icon('<path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M15 4v5h5"/><path d="M8 13h8M8 17h5"/>'),
  inbox:     icon('<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 5h14l2 7v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z"/>'),
  outgoing:  icon('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'),
  archive:   icon('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>'),
  tray: icon('<path d="M4 15h4l1.5 2h5L16 15h4"/><path d="M4 15V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  templates: icon('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>'),
  leave:     icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>'),
  people:    icon('<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 11a3 3 0 1 0 0-6"/><path d="M18 20a5.5 5.5 0 0 0-3-4.9"/>'),
  log:       icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  search:    icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'),
  rooms:     icon('<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>'),
  logout:    icon('<path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
  barcode:   icon('<path d="M4 6v12M7 6v12M10 6v8M13 6v12M16 6v8M20 6v12"/>'),
  manifest:  icon('<path d="M3 17V8a1 1 0 0 1 1-1h9v10"/><path d="M13 10h4l3 3v4h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>'),
  sound:     icon('<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  soundOff:  icon('<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 6M21 9l-5 6"/>'),
  company:   icon('<path d="M3 21h18"/><path d="M5 21V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15"/><path d="M13 21V11h5a1 1 0 0 1 1 1v9"/><path d="M8 9h2M8 13h2M8 17h2"/>'),
  bell:      icon('<path d="M18 16V11a6 6 0 1 0-12 0v5l-2 3h16l-2-3Z"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
  menu:      icon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  report:    icon('<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="11" width="3" height="6" rx=".5"/><rect x="12" y="7" width="3" height="10" rx=".5"/><rect x="17" y="13" width="3" height="4" rx=".5"/>'),
  shield:    icon('<path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6Z"/><path d="M12 8v4"/><path d="M12 15.5v.5"/>'),
  pen:       icon('<path d="m15 5 4 4"/><path d="M4 20l1.2-4.6L16.5 4.1a1.8 1.8 0 0 1 2.6 0l.8.8a1.8 1.8 0 0 1 0 2.6L8.6 18.8Z"/>'),
  map:       icon('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Z"/><path d="M9 4v14M15 6v14"/>'),
  board:     icon('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 12v2M11 9v5M15 11v3"/>'),
  // A surveyed parcel with a corner peg: the plot file.
  plot:      icon('<path d="M4 18 9 5l11 3-2 11Z"/><path d="M9 5 7 18"/><path d="m18 8-9 2"/><circle cx="4" cy="18" r="1.4"/>'),
  // A flatbed scanner with its light bar.
  scanner:   icon('<rect x="3" y="11" width="18" height="8" rx="2"/><path d="M5 11 17 4"/><path d="M7 15h10"/>'),
  // A sheet with a plus: a new letter.
  newdoc:    icon('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/>'),
  // A sun over the horizon: the day ahead.
  day:       icon('<circle cx="12" cy="13" r="4"/><path d="M12 4v2M4.5 13H3M21 13h-1.5M6.3 7.3 5.2 6.2M17.7 7.3l1.1-1.1"/><path d="M3 20h18"/>'),
};

// The head of every page: the same on the login screen and inside the
// application, because a phone offers to install whatever is on screen at the
// time and the offer should not depend on which page somebody happened to open.
//
// theme-color paints the phone's status bar the sidebar green, so an installed
// copy looks like one application rather than a web page in a frame.
const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0E3A28">
<meta name="color-scheme" content="light">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="شارەوانی ڕانیە">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@500;600;700&family=Vazirmatn:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="${asset('/app.css')}">`;

/**
 * The card above the sign-out row: who is at this desk and how to reach them.
 *
 * Every field is optional and most start empty, because the real extension list
 * has not been read off the wall by the switchboard yet. A blank line is left
 * out rather than printed as a dash, so the card grows as the list is filled in
 * rather than looking broken until it is.
 */
function officerCard(user) {
  const lines = [
    user.roomName && `${user.roomName}${user.roomNumber ? ` (${num(user.roomNumber)})` : ''}`,
    user.roomDepartment,
    user.roomFloor,
  ].filter(Boolean);

  const ext = user.extension || user.roomExtension;
  if (lines.length === 0 && !ext) return '';

  return `<div class="officer">
    ${lines.map(l => `<div>${escapeHtml(l)}</div>`).join('')}
    ${ext ? `<div class="ext">ناوخۆ ${escapeHtml(num(ext))}</div>` : ''}
  </div>`;
}

// Who gets a search box. The same list as the search screen itself, because a
// box that leads to a refusal is worse than no box.
const CAN_SEARCH = ['mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                    'room_clerk', 'registry_clerk', 'archive_clerk', 'hr'];

/**
 * One box for both kinds of lookup.
 *
 * Eleven digits is a barcode and goes to the scanner screen; anything else is a
 * search. Deciding that here rather than making the user choose is the whole
 * point: somebody holding a folder should not have to know which screen they
 * want before they can type.
 */
function headerSearch(user) {
  if (!CAN_SEARCH.includes(user.role)) return '';
  return `<form method="get" action="/find" class="topbar-search" role="search">
    <input type="search" name="q" placeholder="بارکۆد، ژمارەی کتاب، ناو یان پارچە"
           aria-label="گەڕان" autocomplete="off">
    <button class="btn secondary" type="submit" title="گەڕان" aria-label="گەڕان">${ICONS.search}</button>
  </form>`;
}

/**
 * The rooms this person may look into.
 *
 * Not a way to become another room. The list comes from app_visible_rooms(),
 * which is the function row-level security itself uses, so for almost everyone
 * it holds exactly one room and the switcher does not appear at all. It appears
 * for the mayor, the deputy, a directorate head, and anyone currently covering
 * another room as a delegate, which is the same set the database already lets
 * through.
 */
function roomSwitcher(user, rooms, current, viewing) {
  if (!rooms || rooms.length < 2) return '';
  // The room on the screen. It used to mark the person's own room, so the mayor
  // looking at the front desk's inbox saw his own room in the box, and choosing
  // it did nothing because it was already "chosen" (browser audit, 13 September).
  const selected = Number(viewing ?? user.roomId);
  const target = ['/inbox', '/manifests', '/tray'].includes(current) ? current : '/inbox';
  // data-auto-submit, not onchange. script-src is 'self', so an inline handler
  // is refused by the browser without a word in the page, which is precisely
  // what had been happening here: with scripting on, the noscript button is
  // hidden and the blocked handler never fired, so choosing a room did nothing
  // at all. app.js submits it now.
  return `<form method="get" action="${escapeHtml(target)}" class="topbar-rooms">
    <select name="room" data-auto-submit aria-label="ژوور">
      ${rooms.map(r => `<option value="${r.id}"${Number(r.id) === selected ? ' selected' : ''}>${
        escapeHtml(r.name)}${r.room_number ? ` (${escapeHtml(num(r.room_number))})` : ''}</option>`).join('')}
    </select>
    <noscript><button class="btn secondary" type="submit">پیشاندان</button></noscript>
  </form>`;
}

/**
 * The sound switch.
 *
 * Rendered here and wired up by /sounds.js, because the content security policy
 * is script-src 'self' and an inline onclick would be blocked silently, which is
 * exactly how the auto-print script went unnoticed for months.
 */
function soundToggle() {
  return `<button type="button" class="btn secondary sound-toggle" data-sound-toggle
          aria-pressed="false" title="دەنگی سکانەر" aria-label="دەنگی سکانەر">${ICONS.sound}</button>`;
}

/**
 * The bell.
 *
 * The count is not rendered by the server. Filling it would mean one more query
 * on every page in the application, including every download and every print
 * sheet, to draw a number that the live stream sends within a moment of the page
 * opening anyway. With scripting off the bell is still a link, and the screen
 * behind it still lists everything.
 */
function bell() {
  return `<a class="btn secondary bell" href="/notifications" data-bell
          aria-label="ئاگادارکردنەوەکان" title="ئاگادارکردنەوەکان">${ICONS.bell}<span
          class="bell-count" data-bell-count hidden>0</span></a>`;
}

/**
 * Which navigation items a role sees.
 * This is convenience, not security. Every one of these routes checks its own
 * permission, and the database enforces the real rules regardless.
 */
function navFor(user, counts = {}) {
  const R = user.role;
  const items = [];
  const add = (href, label, ic, roles, count) => {
    if (roles.includes(R)) items.push({ href, label, icon: ic, count });
  };

  add('/dashboard', 'داشبۆردی گشتی', ICONS.dashboard, ['mayor', 'deputy_mayor']);
  // The directorate head's "directorate" item only redirected to /rooms, which is
  // also in the menu below, so it was one page reached twice and never marked
  // as the current item. The rooms item is the one kept.
  add('/registry', 'ژووری هات و دەرچوو', ICONS.registry,
      ['registry_clerk', 'mayor', 'deputy_mayor']);
  // Every room can start a letter (migration 0450). The front desk reaches the
  // same form from its own register screen, so it is not listed twice for them.
  add('/registry/new', 'کتابی نوێ', ICONS.newdoc,
      ['directorate_head', 'room_head', 'room_clerk', 'archive_clerk', 'hr']);
  add('/inbox', 'کتابە هاتووەکان', ICONS.inbox,
      ['mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'room_clerk', 'registry_clerk', 'archive_clerk', 'hr'],
      counts.inbox);
  // Directly under the inbox, because the two answer the two halves of the same
  // morning question: what is on my desk, and what am I waiting for.
  add('/my-day', 'ڕۆژی من', ICONS.day,
      ['mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'room_clerk', 'registry_clerk', 'archive_clerk', 'hr']);
  add('/outgoing', 'ناردراوەکان', ICONS.outgoing,
      ['mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'room_clerk', 'registry_clerk', 'hr']);
  add('/documents', 'گەڕان بەدوای کتاب', ICONS.search,
      ['mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'room_clerk', 'registry_clerk', 'archive_clerk', 'hr']);
  add('/plots', 'فایلی پارچە', ICONS.plot,
      ['mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'room_clerk', 'registry_clerk', 'archive_clerk', 'hr']);
  add('/plots/map', 'نەخشەی پارچەکان', ICONS.map,
      ['mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'room_clerk', 'registry_clerk', 'archive_clerk', 'hr']);
  add('/archive', 'ئەرشیفی نەخشە', ICONS.archive,
      ['mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'room_clerk', 'archive_clerk']);
  add('/tray', 'سینیی سکان', ICONS.tray,
      ['registry_clerk', 'room_clerk', 'room_head', 'archive_clerk', 'mayor', 'deputy_mayor', 'directorate_head']);
  // Everyone who touches a paper folder. The barcode screen is how the folder in
  // your hand becomes the letter on the screen, so it is deliberately the widest
  // list in this file, IT excepted as always.
  add('/barcode', 'خوێندنەوەی بارکۆد', ICONS.barcode,
      ['registry_clerk', 'room_clerk', 'room_head', 'archive_clerk', 'mayor', 'deputy_mayor', 'directorate_head']);
  add('/manifests', 'لیستی گەیاندن', ICONS.manifest,
      ['registry_clerk', 'room_clerk', 'room_head', 'mayor', 'deputy_mayor', 'directorate_head'],
      counts.manifests);
  add('/companies', 'کۆمپانیاکان', ICONS.company,
      ['registry_clerk', 'room_clerk', 'room_head', 'archive_clerk', 'mayor', 'deputy_mayor', 'directorate_head']);
  // Everyone the templates screen lets in (routes/templates.mjs USERS); the
  // registry and room clerks could open it by address but had no way to find it.
  add('/templates', 'تێمپلەیتەکان', ICONS.templates,
      ['hr', 'mayor', 'deputy_mayor', 'room_head', 'directorate_head', 'registry_clerk', 'room_clerk']);
  // Everyone may ask for leave and follow their own request; the database shows
  // each person only what they may see (leave_select).
  add('/leave', 'مۆڵەتەکان', ICONS.leave,
      ['hr', 'mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'room_clerk', 'registry_clerk', 'archive_clerk'], counts.leave);
  add('/rooms', 'هەموو ژوورەکان', ICONS.rooms, ['mayor', 'deputy_mayor', 'directorate_head']);
  add('/reports/weekly', 'ڕاپۆرتی هەفتانە', ICONS.report, ['mayor', 'deputy_mayor', 'directorate_head', 'room_head']);
  add('/alerts', 'ئاگادارییە ئەمنییەکان', ICONS.shield, ['mayor', 'deputy_mayor'], counts.alerts);
  add('/admin/doc-types', 'جۆرەکانی مامەڵە', ICONS.templates,
      ['registry_clerk', 'mayor', 'deputy_mayor', 'sysadmin']);
  add('/admin/users', 'کارمەندان', ICONS.people, ['sysadmin']);
  add('/admin/rooms', 'ژوورەکان', ICONS.rooms, ['sysadmin']);
  add('/admin/scanners', 'سکانەرەکان', ICONS.scanner, ['sysadmin', 'mayor', 'deputy_mayor']);
  add('/board', 'تابلۆی کار', ICONS.board, ['mayor', 'deputy_mayor', 'sysadmin']);
  add('/notifications', 'ئاگادارکردنەوەکان', ICONS.bell,
      ['mayor', 'deputy_mayor', 'directorate_head', 'room_head', 'room_clerk',
       'registry_clerk', 'archive_clerk', 'hr', 'sysadmin'], counts.notifications);
  add('/log', 'تۆماری چالاکی', ICONS.log, ['mayor', 'deputy_mayor', 'sysadmin', 'room_head', 'directorate_head']);

  return items;
}

/**
 * @param {object} o
 * @param {object} o.user     the signed-in user
 * @param {string} o.title    page title, shown in the top bar and the tab
 * @param {string} o.current  pathname of the active nav item
 * @param {object} o.body     safe html from the html`` tag
 * @param {object} [o.counts] badge counts for the sidebar
 * @param {object} [o.notice] { kind: 'ok'|'error'|'warn'|'info', text }
 * @param {object} [o.actions] safe html for the top-right of the top bar
 * @param {object[]} [o.rooms] rooms this user may look into, for the switcher.
 *        Comes from roomContext() in lib/auth.mjs, which asks the same function
 *        row-level security asks, so it can never offer a room the database
 *        would refuse.
 */
export function page({ user, title, current, body, counts = {}, notice = null, actions = null, rooms = [], viewingRoomId = null }) {
  const nav = navFor(user, counts);

  // The request's CSRF token, put on req.user by the middleware in server.mjs.
  // It is here because the sign-out form is rendered by this file rather than by
  // a route, and a form posted without a token is refused: sign-out had been
  // returning "request refused" on every page in the application for exactly
  // that reason. app.js reads the same value from the body attribute for the
  // two things it posts.
  const csrf = user?.csrf ?? '';

  return `<!doctype html>
<html lang="ckb" dir="rtl">
<head>
${HEAD}
<title>${escapeHtml(title)} — شارەوانی ڕانیە</title>
</head>
<body data-csrf="${escapeHtml(csrf ?? '')}" data-user-id="${escapeHtml(String(user?.id ?? ''))}" data-user-name="${escapeHtml(user?.fullName ?? '')}">
<!-- The drawer switch. A checkbox rather than a button, so the menu opens on a
     phone with no JavaScript at all; see the comment in app.css. -->
<!-- Past the menu in one key press. Without it a keyboard went through every
     sidebar link before reaching the page (design test, 13 September). -->
<a class="skip-link" href="#main">بازدان بۆ ناوەڕۆک</a>
<input type="checkbox" id="nav-toggle" class="nav-toggle-input" aria-label="پێڕست">
<div class="shell">
  <label for="nav-toggle" class="nav-backdrop" aria-hidden="true"></label>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-seal" aria-hidden="true"></span>
      شارەوانی ڕانیە
      <small>سیستەمی دۆکیومێنت</small>
    </div>
    <nav class="nav">
      ${raw(nav.map(i => `
        <a href="${escapeHtml(i.href)}"${current === i.href ? ' aria-current="page"' : ''}>
          ${i.icon}
          <span>${escapeHtml(i.label)}</span>
          ${i.count ? `<span class="count">${escapeHtml(num(i.count))}</span>` : ''}
        </a>`).join(''))}
    </nav>
    ${officerCard(user)}
    <div class="whoami">
      <span class="avatar sm">${escapeHtml(initials(user.fullName))}</span>
      <span>
        <span class="name">${escapeHtml(user.fullName)}</span><br>
        <span class="role">${escapeHtml(user.jobTitle || ROLE_NAMES[user.role] || user.role)}</span><br>
        <a class="whoami-link" href="/password">گۆڕینی وشەی نهێنی</a>
      </span>
      <form method="post" action="/logout" class="spacer">
        ${csrf ? `<input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">` : ''}
        <button class="btn secondary logout-btn" type="submit" title="دەرچوون" aria-label="دەرچوون">${ICONS.logout}</button>
      </form>
    </div>
  </aside>

  <div class="main">
    <header class="topbar">
      <label for="nav-toggle" class="nav-toggle" aria-hidden="true">${ICONS.menu}</label>
      <h1 title="${escapeHtml(title)}">${escapeHtml(title)}</h1>
      <div class="spacer topbar-tools">
        ${headerSearch(user)}
        ${roomSwitcher(user, rooms, current, viewingRoomId)}
        ${bell()}
        ${soundToggle()}
        ${actions ? String(actions) : ''}
      </div>
      <div class="today">${escapeHtml(date(new Date()))}</div>
    </header>
    <main class="content" id="main" tabindex="-1">
      ${notice ? `<div class="notice ${escapeHtml(notice.kind)}">${escapeHtml(notice.text)}</div>` : ''}
      ${String(body)}
    </main>
  </div>
</div>
<!-- Where a letter arriving is announced. Filled by app.js, empty otherwise. -->
<div class="toasts" data-toasts aria-live="polite" aria-atomic="false"></div>
<script src="${asset('/sounds.js')}"></script>
<script src="${asset('/app.js')}"></script>
</body>
</html>`;
}

/** The login page and other pages with no signed-in user. */
export function bare({ title, body }) {
  return `<!doctype html>
<html lang="ckb" dir="rtl">
<head>
${HEAD}
<title>${escapeHtml(title)} — شارەوانی ڕانیە</title>
</head>
<body>
${String(body)}
</body>
</html>`;
}

const AUTH_SEAL = raw(`<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9.5 21v-5.5h5V21"/></svg>`);

/**
 * Every page seen without the menu: signing in, the citizen's tracking page, and
 * the refusals and errors a signed-out person can land on. design/Login.dc.html:
 * the municipality's panel on one side, the form on the other. On a phone the
 * panel becomes a band above the form. These pages were a small card on a green
 * page, a different look from the approved design (design test, 13 September).
 *
 * The panel names what the system does, not its rooms: this page is public.
 */
export function authPage({ title, body, wide = false }) {
  return bare({
    title,
    body: html`<div class="auth">
      <aside class="auth-brand" aria-label="شارەوانی ڕانیە">
        <div class="auth-brand-top">
          <div class="auth-seal">${AUTH_SEAL}</div>
          <div class="auth-name">شارەوانی ڕانیە</div>
          <p class="auth-tagline">سیستەمی بەڕێوەبردنی دۆکیومێنت و بەدواداچوونی ڕێڕەوی کتاب لە نێوان ژوورەکاندا</p>
        </div>
        <div class="auth-brand-mid">
          <div class="auth-eyebrow">لەم سیستەمەدا</div>
          <div class="auth-chips">
            <span>تۆمارکردنی کتاب</span><span>ناردن بۆ ژوورەکان</span><span>ئەرشیفی نەخشە</span>
            <span>کۆمپانیاکان</span><span>مۆڵەت</span><span>بەدواداچوونی داواکاری</span>
          </div>
        </div>
        <div class="auth-foot">بەڕێوەبەرایەتی تەکنەلۆژیای زانیاری — شارەوانی ڕانیە<br>هەموو مافەکان پارێزراون © ${num(new Date().getFullYear())}</div>
      </aside>
      <main class="auth-main">
        <div class="auth-panel${wide ? ' wide' : ''}">${body}</div>
      </main>
    </div>`,
  });
}

export { ROLE_NAMES, ICONS };
