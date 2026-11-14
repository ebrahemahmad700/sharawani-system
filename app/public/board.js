// The wall board, keeping itself up to date.
//
// This page is expected to run for years without anybody touching it, so the
// only thing that really matters here is that it never gets stuck. Every path
// ends in either a redraw or a retry:
//
//   - the stream drops          -> EventSource reconnects on its own
//   - the stream keeps failing  -> it asks every twenty seconds instead
//   - the server goes away      -> the dot turns red and it keeps trying
//   - the browser was suspended -> it redraws the moment the tab is shown
//
// It never reloads the page. A wall board that reloads is a wall board that
// spends a second a minute showing a white flash to the corridor.

(function () {
  'use strict';

  var KU = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  function ku(n) { return String(n == null ? '' : n).replace(/[0-9]/g, function (d) { return KU[+d]; }); }

  function $(s) { return document.querySelector(s); }
  var statusText = $('[data-status]');
  var dot = $('[data-live]');

  function live(on, why) {
    if (dot) dot.className = on ? 'dot live' : 'dot';
    if (statusText) statusText.textContent = why;
  }

  // --- the clock ------------------------------------------------------------

  var DAYS = ['یەکشەممە', 'دووشەممە', 'سێشەممە', 'چوارشەممە', 'پێنجشەممە', 'هەینی', 'شەممە'];

  function tickClock() {
    var el = $('[data-clock]');
    if (!el) return;
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    el.innerHTML = ku(p(d.getHours()) + ':' + p(d.getMinutes())) +
      '<small>' + DAYS[d.getDay()] + ' · ' +
      ku(d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate())) + '</small>';
  }

  // --- drawing --------------------------------------------------------------

  function setFigure(key, value) {
    var el = document.querySelector('[data-fig="' + key + '"]');
    if (!el) return;
    var next = ku(value);
    if (el.textContent === next) return;
    el.textContent = next;
    el.classList.remove('changed');
    // Reading offsetWidth restarts the animation; without it a figure that
    // changes twice in a row only lifts the first time.
    void el.offsetWidth;
    el.classList.add('changed');
    if (key === 'late') {
      var fig = el.parentNode;
      if (fig) fig.classList.toggle('zero', Number(value) === 0);
    }
  }

  function drawTiles(rooms) {
    var wrap = $('[data-tiles]');
    if (!wrap) return;
    // Redrawn wholesale, because a municipality has thirty rooms and the whole
    // list is cheaper to build than to diff. The only thing kept is the bump on
    // a number that actually moved.
    var before = {};
    [].forEach.call(wrap.children, function (t) {
      var name = t.getAttribute('data-room');
      if (name) before[name] = t.querySelector('.tile-n').textContent;
    });

    var html = '';
    // The same twenty as the server renders, and the same order: the list
    // arrives busiest first, so what falls off the end is always a quiet room.
    for (var i = 0; i < rooms.length && i < 20; i++) {
      var r = rooms[i];
      var late = Number(r.late) || 0;
      var open = Number(r.open) || 0;
      var paper = Number(r.paper_waiting) || 0;
      var cls = late > 2 ? ' bad' : late > 0 ? ' warn' : open === 0 ? ' quiet' : '';
      var sub = late > 0 ? ku(late) + ' دواکەوتوو'
              : paper > 0 ? ku(paper) + ' پەڕگە لە ڕێگەدا'
              : open > 0 ? 'لە کاتی خۆیدا' : 'بەتاڵ';
      html += '<div class="tile' + cls + '" data-room="' + esc(r.name) + '">' +
        '<div class="tile-name">' + esc(r.name) +
          (r.room_number ? ' <span class="rn">' + ku(r.room_number) + '</span>' : '') + '</div>' +
        '<div class="tile-n">' + ku(open) + '</div>' +
        '<div class="tile-sub">' + sub + '</div>' +
        '</div>';
    }
    wrap.innerHTML = html;

    [].forEach.call(wrap.children, function (t) {
      var name = t.getAttribute('data-room');
      var n = t.querySelector('.tile-n');
      if (before[name] !== undefined && before[name] !== n.textContent) n.classList.add('changed');
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var seen = {};

  function drawFeed(recent) {
    var ul = $('[data-feed]');
    if (!ul) return;
    var html = '';
    for (var i = 0; i < recent.length; i++) {
      var e = recent[i];
      var id = e.at + '|' + e.says + '|' + (e.number || '') + '|' + (e.room || '');
      var fresh = seen.ready && !seen[id] ? ' class="fresh"' : '';
      seen[id] = true;
      var t = new Date(e.at);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      html += '<li' + fresh + '>' +
        '<span class="when">' + ku(p(t.getHours()) + ':' + p(t.getMinutes())) + '</span>' +
        '<span class="what">' + esc(e.says) + (e.room ? ' ' + esc(e.room) : '') + '</span>' +
        (e.number ? '<span class="no" dir="ltr">' + esc(e.number) + '</span>' : '') +
        '</li>';
    }
    ul.innerHTML = html;
    seen.ready = true;
  }

  function draw(s) {
    if (!s) return;
    setFigure('registered', s.today.registered);
    setFigure('closed', s.today.closed);
    setFigure('in_flow', s.today.in_flow);
    setFigure('late', s.today.late);
    drawTiles(s.rooms || []);
    drawFeed(s.recent || []);
  }

  // --- being told -----------------------------------------------------------

  var stream = null, failures = 0, pollTimer = null;

  function fetchOnce() {
    return fetch('/board/data', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('board ' + r.status); return r.json(); })
      .then(function (s) { draw(s); live(true, 'نوێکرایەوە'); return s; });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      fetchOnce().catch(function () { live(false, 'پەیوەندی نییە'); });
    }, 20000);
  }

  function startStream() {
    if (!window.EventSource) { startPolling(); return; }
    try { stream = new EventSource('/board/stream'); } catch (e) { startPolling(); return; }

    stream.addEventListener('open', function () { failures = 0; live(true, 'ڕاستەوخۆ'); });
    stream.addEventListener('board', function (e) {
      failures = 0;
      live(true, 'ڕاستەوخۆ');
      try { draw(JSON.parse(e.data)); } catch (err) { /* a half-sent frame */ }
    });
    stream.addEventListener('error', function () {
      // The server closes the stream deliberately every few minutes and
      // EventSource reconnects by itself. Only a run of failures means it is
      // not going to work here at all.
      failures++;
      live(false, 'پەیوەندی...');
      if (failures >= 5) {
        stream.close();
        stream = null;
        startPolling();
      }
    });
  }

  // A screen that has been on for a month drifts. This costs one request a day
  // and guarantees the figures are never quietly a week old because something
  // somewhere silently stopped.
  setInterval(function () { fetchOnce().catch(function () {}); }, 3600 * 1000);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) fetchOnce().catch(function () {});
  });

  tickClock();
  setInterval(tickClock, 10000);
  fetchOnce().catch(function () { live(false, 'پەیوەندی نییە'); });
  startStream();
})();
