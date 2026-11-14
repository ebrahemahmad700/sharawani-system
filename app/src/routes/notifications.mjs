// The bell: what has been drawn to your attention, live.
//
// Four doors, and it is worth being clear which is which.
//
//   GET  /events              an open stream. The page holds this and is told
//                             the moment something lands.
//   GET  /notifications/poll  the same answer as one request. Used when the
//                             stream cannot be held open, and by the service
//                             worker when it is woken by a push.
//   GET  /notifications       the screen.
//   POST /notifications/...   mark read, and register or drop this browser for
//                             pushes.
//
// The stream and the poll return the same shape, so the client has one piece of
// code that handles a batch of notifications and two ways of receiving it.
//
// Nothing here returns a letter's subject unless row-level security already
// grants this reader that letter. The subject is joined at read time; see
// lib/notify.mjs.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, roomContext } from '../lib/auth.mjs';
import { logEvent } from '../lib/log.mjs';
import { waitForChange, currentMode } from '../lib/realtime.mjs';
import * as notify from '../lib/notify.mjs';
import * as push from '../lib/push.mjs';
import { page, ICONS } from '../views/layout.mjs';
import { html, raw, escapeHtml, date, time, ltr } from '../lib/html.mjs';

const router = Router();

const SERVERLESS = Boolean(process.env.VERCEL || process.env.SERVERLESS);

// How long one stream is held before the browser is asked to reconnect.
//
// A serverless function is billed for every second it runs and killed at sixty,
// so there the stream is a short slice and EventSource's own reconnect stitches
// the slices together. On the municipality's own server nothing is billed and
// the connection can simply stay up.
const HOLD_MS = Number(process.env.EVENTS_HOLD_MS || (SERVERLESS ? 25_000 : 600_000));

/** The wire shape. Ids, a kind, and whatever of the letter this reader may see. */
function wire(n) {
  const k = notify.KINDS[n.kind] ?? { text: n.kind, sound: 'click' };
  return {
    id: n.id,
    kind: n.kind,
    text: notify.textFor(n),
    sound: k.sound,
    href: notify.linkFor(n),
    // Present only when the join under row-level security returned it.
    number: n.incoming_no ?? null,
    subject: n.subject ?? null,
    room: n.room_name ?? null,
    actor: n.actor_name ?? null,
    at: n.created_at,
    read: Boolean(n.read_at),
  };
}

// --- the live stream --------------------------------------------------------

router.get('/events', requireAuth, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx buffers a response by default, which for a stream means the browser
    // receives nothing until the connection closes: live updates that arrive
    // all at once, twenty-five seconds late, looking like a bug in this file.
    'X-Accel-Buffering': 'no',
  });

  // Retry sooner than the browser's three second default in poll mode, where
  // each slice is short and a gap between slices is a gap in the notifications.
  res.write(`retry: 2000\n\n`);

  let after = Number(req.query.after) || 0;
  let open = true;
  req.on('close', () => { open = false; });

  const started = Date.now();
  try {
    while (open && Date.now() - started < HOLD_MS) {
      const batch = await withActor(req.user, async q => ({
        items: await notify.since(q, req.user.id, after),
        summary: await notify.summary(q, req.user.id),
      }));

      if (batch.items.length) {
        after = Math.max(after, ...batch.items.map(i => i.id));
        res.write(`event: notify\ndata: ${JSON.stringify({
          items: batch.items.map(wire).reverse(),      // oldest first, as they happened
          unread: batch.summary.unread,
        })}\n\n`);
      } else {
        // A comment line. Keeps proxies and phone radios from deciding the
        // connection is dead, and carries the unread count so a badge cleared in
        // another tab catches up here too.
        res.write(`: ping ${batch.summary.unread}\n\n`);
      }

      if (!open) break;
      await waitForChange(req.user.id, HOLD_MS - (Date.now() - started));
    }
  } catch (err) {
    console.error('[events] stream ended:', err.message);
  }
  res.end();
});

// --- the same answer, as one request ---------------------------------------

router.get('/notifications/poll', requireAuth, async (req, res, next) => {
  try {
    const after = Number(req.query.after) || 0;
    const out = await withActor(req.user, async q => ({
      items: (await notify.since(q, req.user.id, after)).map(wire).reverse(),
      ...(await notify.summary(q, req.user.id)),
    }));
    res.set('Cache-Control', 'no-store').json({ ...out, mode: currentMode() });
  } catch (err) { next(err); }
});

/**
 * How many, and nothing else.
 *
 * The service worker asks for this when a push wakes it. It is separate from the
 * poll so that a letter's subject never enters the service worker at all: the
 * worker shows a number, and the number is all it is ever given.
 */
router.get('/notifications/count', requireAuth, async (req, res, next) => {
  try {
    const { unread } = await withActor(req.user, q => notify.summary(q, req.user.id));
    res.set('Cache-Control', 'no-store').json({ unread });
  } catch (err) { next(err); }
});

// --- the screen -------------------------------------------------------------

router.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const { rooms } = await roomContext(req.user);
    const rows = await withActor(req.user, q => notify.list(q, req.user.id, { limit: 100 }));

    const body = html`
      <div class="card">
        <!-- No heading: the top bar already says ئاگادارکردنەوەکان. The buttons
             keep the heading row's place, so the list starts at the same height
             as on every other screen. -->
        <div class="card-head">
          <div class="end">
            ${raw(push.isEnabled() ? `
              <button type="button" class="btn secondary" data-push-toggle
                      data-vapid="${escapeHtml(push.publicKey())}">
                ئاگادارکردنەوە لەسەر ئەم ئامێرە
              </button>` : '')}
            <form method="post" action="/notifications/read">
              <input type="hidden" name="_csrf" value="${res.locals.csrf}">
              <button class="btn secondary" type="submit">هەمووی وەک خوێندراوە دابنێ</button>
            </form>
          </div>
        </div>
        <p class="card-sub">
          ئەم لیستە تەنها بۆ تۆیە. کەس نایبینێت، نە بەڕێوەبەری سیستەم و نە سەرۆکی شارەوانی.
          ${raw(push.isEnabled() ? '' : '<br>ئاگادارکردنەوەی دەرەوەی وێبگەڕ لەسەر ئەم ڕاژەیە چالاک نەکراوە.')}
        </p>

        ${rows.length === 0
          ? html`<div class="empty">هیچ ئاگادارکردنەوەیەک نییە.</div>`
          : html`<ul class="notif-list">
              ${rows.map(n => {
                const k = notify.KINDS[n.kind] ?? { text: n.kind, icon: 'log' };
                return html`<li class="${n.read_at ? '' : 'unread'}">
                  <span class="notif-icon">${ICONS[k.icon] ?? ICONS.log}</span>
                  <a class="notif-main" href="/notifications/${n.id}/go">
                    <span class="notif-text">${notify.textFor(n)}</span>
                    <span class="notif-sub">
                      ${n.incoming_no ? ltr(n.incoming_no) : ''}
                      ${n.subject ? html`— ${n.subject}` : ''}
                      ${n.room_name ? html`· ${n.room_name}` : ''}
                      ${n.actor_name ? html`· ${n.actor_name}` : ''}
                    </span>
                  </a>
                  <span class="notif-when muted">${date(n.created_at)} ${time(n.created_at)}</span>
                </li>`;
              })}
            </ul>`}
      </div>`;

    res.send(page({
      user: req.user, title: 'ئاگادارکردنەوەکان', current: '/notifications',
      rooms, body,
      notice: req.query.ok ? { kind: 'ok', text: 'هەمووی وەک خوێندراوە دانرا.' } : null,
    }));
  } catch (err) { next(err); }
});

/** Open what a notification is about, and mark it read on the way. */
router.get('/notifications/:id(\\d+)/go', requireAuth, async (req, res, next) => {
  try {
    const target = await withActor(req.user, async q => {
      const { rows: [n] } = await q(
        `SELECT id, kind, document_id, detail FROM notification WHERE id = $1 AND user_id = $2`,
        [Number(req.params.id), req.user.id]);
      if (!n) return null;
      await notify.markRead(q, req.user.id, n.id);
      return notify.linkFor(n);
    });
    res.redirect(303, target ?? '/notifications');
  } catch (err) { next(err); }
});

router.post('/notifications/read', requireAuth, async (req, res, next) => {
  try {
    const n = await withActor(req.user, async q => {
      const changed = await notify.markAllRead(q, req.user.id);
      // Logged once for the deliberate act, not once per row. Clearing the list
      // is a thing a person chose to do; each individual row turning grey is not.
      if (changed) await logEvent(q, { action: 'notify.read_all', req, userId: req.user.id, detail: { count: changed } });
      return changed;
    });
    // A tab in the background asks for this with fetch and wants no redirect.
    if ((req.get('accept') ?? '').includes('application/json')) return res.json({ ok: true, cleared: n });
    res.redirect(303, '/notifications?ok=1');
  } catch (err) { next(err); }
});

// --- pushes to this browser -------------------------------------------------

router.post('/notifications/push/subscribe', requireAuth, async (req, res, next) => {
  try {
    const endpoint = String(req.body?.endpoint ?? '');
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) {
      return res.status(400).json({ ok: false });
    }
    await withActor(req.user, async q => {
      await q(`SELECT push_register($1, $2)`, [endpoint, req.get('user-agent')?.slice(0, 500) ?? null]);
      await logEvent(q, { action: 'push.subscribed', req, userId: req.user.id, detail: { host: new URL(endpoint).host } });
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/notifications/push/unsubscribe', requireAuth, async (req, res, next) => {
  try {
    const endpoint = String(req.body?.endpoint ?? '');
    await withActor(req.user, async q => {
      // The policy limits this to your own rows, so an endpoint belonging to
      // somebody else simply matches nothing.
      const { rowCount } = await q(`DELETE FROM push_subscription WHERE endpoint = $1`, [endpoint]);
      if (rowCount) await logEvent(q, { action: 'push.removed', req, userId: req.user.id, detail: {} });
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
