// The service worker.
//
// This file is what makes the system installable and what lets it survive a
// dropped connection, and it is also the single most dangerous file in the
// project, so the rule it follows is stated first and without exception:
//
//   NOTHING ABOUT A LETTER IS EVER STORED HERE.
//
// A service worker cache is a database on the machine, readable by anything
// running as that user and surviving sign-out, the browser closing, and the
// person handing the laptop to a colleague. Caching pages "for offline" would
// mean a copy of the mayor's correspondence sitting on the disk of whichever
// shared workstation last opened it, outside every rule the rest of this system
// enforces. Row-level security cannot reach into a browser cache.
//
// So the cache holds an allowlist of four files and one page, all of them
// public, none of them containing a single word about any letter:
//
//   /app.css  /app.js  /sounds.js  the icons  /offline.html
//
// Every other request — every page, every search, every attachment, every scan
// — is passed straight to the network and never touched. When the network is
// down, a page request gets the offline notice and nothing else, which is the
// honest answer: this system is the record of what the municipality has, and a
// stale copy of that record is worse than no copy.
//
// The push handler follows the same rule from the other direction. The push
// carries no payload (see lib/push.mjs), so the text shown is a count fetched
// from this server over the browser's own authenticated connection, and it says
// how many, never what.

var CACHE = 'docsys-shell-v2';

// Cached by exact path. A list rather than a pattern, so that adding something
// to the cache has to be a decision somebody wrote down.
var SHELL = [
  '/app.css',
  '/app.js',
  '/sounds.js',
  '/offline.html',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      // One icon missing must not leave the worker uninstalled and the whole
      // thing silently not working.
      .catch(function (e) { console.warn('[sw] shell incomplete:', e && e.message); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // The event stream must reach the network untouched. Calling respondWith on it
  // at all breaks the streaming.
  if (url.pathname === '/events') return;

  if (SHELL.indexOf(url.pathname) !== -1) {
    // Cache first, and quietly refresh behind it. The pages ask for these files
    // with a fingerprint of their contents on the URL (asset() in layout.mjs), so
    // a deployed change is a URL this cache has never seen and is fetched at once.
    // Before the fingerprint, a stale stylesheet was served for as long as the
    // browser kept the page, which is how a scrolling fix could be live on the
    // server and absent from every screen. Offline, any stored copy will do.
    event.respondWith(
      caches.match(req).then(function (hit) {
        var live = fetch(req).then(function (res) {
          if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
          return res;
        }).catch(function () {
          return hit || caches.match(req, { ignoreSearch: true });
        });
        return hit || live;
      })
    );
    return;
  }

  // A page. Network only; the offline notice if there is no network. Never
  // cached, whatever it contains.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('/offline.html');
      })
    );
    return;
  }

  // Everything else: not our business. No respondWith, so the browser does
  // exactly what it would have done with no service worker installed.
});

// --- the doorbell -----------------------------------------------------------

self.addEventListener('push', function (event) {
  event.waitUntil(
    fetch('/notifications/count', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var n = data && data.unread ? data.unread : 0;
        var text = n > 1
          ? n + ' ئاگادارکردنەوەی نوێت هەیە'
          : 'ئاگادارکردنەوەیەکی نوێت هەیە';

        return self.registration.showNotification('شارەوانی ڕانیە', {
          // What it is about is deliberately absent. Opening the application is
          // what shows that, behind the password.
          body: text,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          lang: 'ckb',
          dir: 'rtl',
          // One notification, replaced each time, rather than a stack of eleven.
          tag: 'docsys',
          renotify: true,
          data: { url: '/notifications' },
        });
      })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/notifications';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        // Already open somewhere: bring that window forward rather than opening
        // a second copy of the application.
        if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) {
          return list[i].focus().then(function (c) {
            return c.navigate ? c.navigate(target) : c;
          });
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

// A browser may replace a subscription on its own, after an update or when a
// push service rotates its keys. There is no CSRF token inside a service worker
// and inventing an endpoint that does not need one would be a hole for the sake
// of a rare event, so nothing is posted from here. The page handles it instead:
// app.js finds no subscription, sees that permission is still granted, and
// registers a new one silently on the next visit.
self.addEventListener('pushsubscriptionchange', function () {
  console.info('[sw] push subscription replaced; app.js will register the new one');
});
