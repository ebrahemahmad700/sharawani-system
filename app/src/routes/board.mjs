// The wall board.
//
// A television in the corridor outside the mayor's office, running a browser on
// one page. Nobody signs in to it. It shows the day's figures, a tile per room,
// and a line for each thing that happens as it happens.
//
// Two doors into it, and only two:
//
//   the mayor, his deputy or IT, signed in as usual. This is how you set it up
//   and how you show it to somebody.
//
//   a machine holding the board cookie, which is handed out once by opening
//   /board?key=<BOARD_TOKEN> on that machine. No session, no account, no
//   password on a corridor wall.
//
// Everything either door can reach is board_snapshot() in migration 0410, which
// returns counts, room names and letter numbers and has no way to return a
// subject, a sender or anybody's name. That is the whole security model and it
// is deliberately in the database rather than in this file: a corridor screen is
// read by whoever walks past, including the people whose letters are in it.

import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { withActor } from '../lib/db.mjs';
import { waitForChange } from '../lib/realtime.mjs';
import { escapeHtml, num } from '../lib/html.mjs';
import { asset } from '../views/layout.mjs';

const router = Router();

const SERVERLESS = Boolean(process.env.VERCEL || process.env.SERVERLESS);
const HOLD_MS = Number(process.env.EVENTS_HOLD_MS || (SERVERLESS ? 25_000 : 600_000));

const BOARD_COOKIE = 'docsys_board';
const TOKEN = process.env.BOARD_TOKEN || '';

// The cookie is not the token. It is a value derived from the CSRF secret, so a
// cookie copied off the corridor machine is useless anywhere the secret differs,
// and so the token itself is never written to a disk in that corridor.
const boardCookieValue = () =>
  createHmac('sha256', process.env.CSRF_SECRET || 'unset').update('board-v1').digest('base64url');

function hasBoardCookie(req) {
  const given = req.cookies?.[BOARD_COOKIE];
  if (!given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(boardCookieValue());
  return a.length === b.length && timingSafeEqual(a, b);
}

const MAY_VIEW = ['mayor', 'deputy_mayor', 'sysadmin'];

function allowed(req) {
  if (req.user && MAY_VIEW.includes(req.user.role)) return true;
  return hasBoardCookie(req);
}

/** What each action code says on a wall, in Kurdish. */
const SAYS = {
  'document.registered':  'تۆمارکرا',
  'document.closed':      'داخرا',
  'document.cancelled':   'هەڵوەشێندرایەوە',
  'step.sent':            'نێردرا بۆ',
  'step.received':        'کرایەوە لە',
  'step.completed':       'تەواوکرا لە',
  'step.returned':        'گەڕێندرایەوە لە',
  'step.paper_received':  'پەڕگە گەیشتە',
  'manifest.created':     'لیستی گەیاندن دروستکرا',
  'manifest.received':    'لیستی گەیاندن وەرگیرا',
};

/** The snapshot, shaped for the screen. Nothing is added that the function did not give. */
async function snapshot() {
  const { rows: [row] } = await withActor(null, q => q(`SELECT board_snapshot() AS s`));
  const s = row.s;
  return {
    at: s.at,
    today: s.today,
    rooms: s.rooms,
    recent: (s.recent ?? []).map(e => ({
      at: e.occurred_at,
      says: SAYS[e.action] ?? e.action,
      number: e.incoming_no ?? null,
      room: e.room_name ?? null,
    })),
  };
}

// --- handing the corridor machine its cookie --------------------------------

router.get('/board', (req, res, next) => {
  const key = String(req.query.key ?? '');
  if (key && TOKEN && key.length === TOKEN.length &&
      timingSafeEqual(Buffer.from(key), Buffer.from(TOKEN))) {
    // A year, because the point of this screen is that nobody touches it. It is
    // httpOnly so a page running on that machine cannot read it, and it grants
    // nothing but the board.
    res.cookie(BOARD_COOKIE, boardCookieValue(), {
      httpOnly: true, sameSite: 'lax', path: '/board',
      secure: process.env.SECURE_COOKIES === 'true',
      maxAge: 365 * 24 * 3600 * 1000,
    });
    return res.redirect(303, '/board');
  }
  return next();
});

// --- the page ---------------------------------------------------------------

router.get('/board', async (req, res, next) => {
  if (!allowed(req)) {
    // Says nothing about whether a board token is configured, and offers the
    // sign-in page rather than an error, because the commonest reason to land
    // here is a member of staff opening it on their own machine.
    return res.redirect(303, '/login');
  }
  try {
    const s = await snapshot();
    // A member of staff who opened the board from the menu gets a way back out
    // of it. The corridor machine does not: that screen has no menu to return
    // to, and a link on a wall anybody can touch is a door nobody asked for.
    const staff = Boolean(req.user && MAY_VIEW.includes(req.user.role));
    res.set('Cache-Control', 'no-store').send(pageHtml(s, staff));
  } catch (err) { next(err); }
});

router.get('/board/data', async (req, res, next) => {
  if (!allowed(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    res.set('Cache-Control', 'no-store').json(await snapshot());
  } catch (err) { next(err); }
});

// The stream. The board is told when anything lands rather than asking every few
// seconds forever, which on a screen that runs for years is the difference
// between a quiet database and a million pointless queries a week.
router.get('/board/stream', async (req, res) => {
  if (!allowed(req)) return res.status(403).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  let open = true;
  req.on('close', () => { open = false; });
  const started = Date.now();
  let last = '';

  try {
    while (open && Date.now() - started < HOLD_MS) {
      const s = await snapshot();
      // The timestamp changes every time, so it is left out of the comparison;
      // otherwise the board would redraw itself every three seconds all night.
      const digest = JSON.stringify({ t: s.today, r: s.rooms, e: s.recent });
      if (digest !== last) {
        last = digest;
        res.write(`event: board\ndata: ${JSON.stringify(s)}\n\n`);
      } else {
        res.write(': ping\n\n');
      }
      if (!open) break;
      // waitForChange wakes on a notification, which every event that matters to
      // this board also raises. Failing that it returns on its own timer, so a
      // change nothing notified about still appears within a few seconds.
      await waitForChange('board', Math.min(4000, HOLD_MS - (Date.now() - started)));
    }
  } catch (err) {
    console.error('[board] stream ended:', err.message);
  }
  res.end();
});

// --- the screen -------------------------------------------------------------

// As many tiles as fit a television without the last row falling off the
// bottom. The list arrives busiest first, so what is cut is always the rooms
// with nothing in them.
const MAX_TILES = 20;

const tile = r => {
  const late = Number(r.late) || 0;
  const open = Number(r.open) || 0;
  const paper = Number(r.paper_waiting) || 0;
  const cls = late > 2 ? ' bad' : late > 0 ? ' warn' : open === 0 ? ' quiet' : '';
  const sub = late > 0 ? `${num(late)} دواکەوتوو`
            : paper > 0 ? `${num(paper)} پەڕگە لە ڕێگەدا`
            : open > 0  ? 'لە کاتی خۆیدا' : 'بەتاڵ';
  return `<div class="tile${cls}">
  <div class="tile-name">${escapeHtml(r.name)}${r.room_number ? ` <span class="rn">${escapeHtml(num(r.room_number))}</span>` : ''}</div>
  <div class="tile-n">${escapeHtml(num(open))}</div>
  <div class="tile-sub">${escapeHtml(sub)}</div>
</div>`;
};

// The time is rendered here as well as by board.js. Without it the board shows
// a column of blank times for the first few seconds after it starts, and on a
// machine where scripting fails it shows them for ever.
const hhmm = at => {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return num(`${p(d.getHours())}:${p(d.getMinutes())}`);
};

const line = e => `<li><span class="when">${escapeHtml(hhmm(e.at))}</span><span class="what">${
  escapeHtml(e.says)}${e.room ? ` ${escapeHtml(e.room)}` : ''}</span>${
  e.number ? `<span class="no" dir="ltr">${escapeHtml(e.number)}</span>` : ''}</li>`;

// The way back. This page is a document of its own with no menu in it, so on a
// phone the only way out used to be the browser's own back gesture, which a
// person who reached the board from the menu has no reason to expect.
const exitLink = `<a class="board-exit" href="/">
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
  <span>گەڕانەوە</span>
</a>`;

function pageHtml(s, staff = false) {
  return `<!doctype html>
<html lang="ckb" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0E3A28">
<title>شارەوانی ڕانیە — تابلۆی کار</title>
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@500;600;700&family=Vazirmatn:wght@400;600;700&display=swap">
<link rel="stylesheet" href="${asset('/board.css')}">
</head>
<body data-board>
<header class="board-top">
  ${staff ? exitLink : ''}
  <div class="brand">شارەوانی ڕانیە<small>تابلۆی کاری ئەمڕۆ</small></div>
  <div class="clock" data-clock></div>
</header>

<section class="figures">
  <div class="fig"><div class="n" data-fig="registered">${escapeHtml(num(s.today.registered))}</div><div class="k">تۆمارکراوی ئەمڕۆ</div></div>
  <div class="fig"><div class="n" data-fig="closed">${escapeHtml(num(s.today.closed))}</div><div class="k">داخراوی ئەمڕۆ</div></div>
  <div class="fig"><div class="n" data-fig="in_flow">${escapeHtml(num(s.today.in_flow))}</div><div class="k">لەژێر کاردا</div></div>
  <div class="fig late"><div class="n" data-fig="late">${escapeHtml(num(s.today.late))}</div><div class="k">دواکەوتوو</div></div>
</section>

<main class="board-main">
  <section class="tiles" data-tiles>${s.rooms.slice(0, MAX_TILES).map(tile).join('')}</section>
  <aside class="feed">
    <h2>ئێستا</h2>
    <ul data-feed>${s.recent.map(line).join('')}</ul>
  </aside>
</main>

<footer class="board-foot">
  <span class="dot" data-live></span>
  <span data-status>پەیوەندی...</span>
</footer>
<script src="${asset('/board.js')}"></script>
</body>
</html>`;
}

export default router;
