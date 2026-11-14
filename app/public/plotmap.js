// The map of plots. Loaded only by /plots/map, after /vendor/leaflet/leaflet.js.
//
// Draws Rania from /map/rania.json (streets, water, parks, the buildings that are
// mapped, place names), then the plots from /plots/map/data. No tiles and no
// requests anywhere but this server.
//
// Placing: /plots/map?place=247/5 puts the page in placing mode for that plot.
// A click sets the point (drag it to adjust), "کێشانی سنوور" lets further clicks
// trace the outline, and "پاشەکەوتکردن" posts it.
//
// Plain ES2017 and a classic script, because Leaflet is a global.

(function () {
  'use strict';

  var host = document.querySelector('[data-plot-map]');
  if (!host || !window.L) return;

  var KU = function (s) { return String(s).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x0660 + Number(d)); }); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  // The same canonical key the server uses for a plot number, near enough to
  // find a typed number among the ones on the map: digits folded, separators unified.
  var keyOf = function (s) {
    return String(s || '')
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/\s+/g, '').replace(/[\\\-–—.]/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').toLowerCase();
  };

  var placeNo = host.getAttribute('data-place');
  var focusNo = host.getAttribute('data-focus');
  var csrf = host.getAttribute('data-csrf');

  var map = L.map(host, {
    preferCanvas: true,
    zoomControl: true,
    attributionControl: true,
    minZoom: 12,
    maxZoom: 20,
    zoomSnap: 0.5,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('© OpenStreetMap contributors');
  var renderer = L.canvas({ padding: 0.5 });

  var ROAD_STYLE = {
    1: { color: '#d9a441', weight: 5 },
    2: { color: '#e3bc6a', weight: 4 },
    3: { color: '#ffffff', weight: 3.5, casing: true },
    4: { color: '#ffffff', weight: 2.6, casing: true },
    5: { color: '#ffffff', weight: 1.6 },
    6: { color: '#bdb6a4', weight: 1, dashArray: '3 3' },
  };

  function drawBase(data) {
    host.querySelector('.map-loading') && host.querySelector('.map-loading').remove();
    var b = data.bounds;
    map.setMaxBounds(L.latLngBounds([b[0][0] - 0.05, b[0][1] - 0.05], [b[1][0] + 0.05, b[1][1] + 0.05]));
    map.fitBounds(L.latLngBounds(b[0], b[1]).pad(-0.25));

    (data.areas || []).forEach(function (a) {
      L.polygon(a.g, { renderer: renderer, stroke: false, fillColor: a.k === 'cemetery' ? '#dcd8cc' : '#d7e8cf', fillOpacity: 1, interactive: false }).addTo(map);
    });
    (data.water || []).forEach(function (g) {
      L.polygon(g, { renderer: renderer, stroke: false, fillColor: '#b9d3e6', fillOpacity: 1, interactive: false }).addTo(map);
    });
    (data.waterLines || []).forEach(function (g) {
      L.polyline(g, { renderer: renderer, color: '#9cc0dc', weight: 2, interactive: false }).addTo(map);
    });
    (data.buildings || []).forEach(function (g) {
      L.polygon(g, { renderer: renderer, color: '#cfc6b3', weight: 0.6, fillColor: '#e6dfcf', fillOpacity: 1, interactive: false }).addTo(map);
    });
    // Smaller roads first, so the main roads are drawn over them.
    var roads = (data.roads || []).slice().sort(function (x, y) { return y.r - x.r; });
    roads.forEach(function (r) {
      var s = ROAD_STYLE[r.r] || ROAD_STYLE[5];
      if (s.casing) L.polyline(r.g, { renderer: renderer, color: '#d8d2c2', weight: s.weight + 1.6, interactive: false }).addTo(map);
    });
    roads.forEach(function (r) {
      var s = ROAD_STYLE[r.r] || ROAD_STYLE[5];
      L.polyline(r.g, { renderer: renderer, color: s.color, weight: s.weight, dashArray: s.dashArray, interactive: false }).addTo(map);
    });
    (data.places || []).forEach(function (p) {
      L.marker(p.c, {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'map-place ' + (p.k === 'town' || p.k === 'city' ? 'big' : ''), html: '<span>' + esc(p.n) + '</span>', iconSize: null }),
      }).addTo(map);
    });
  }

  function stateOf(p) {
    if (p.late) return 'late';
    if (p.open) return 'open';
    if (p.letters) return 'done';
    if (p.drawings) return 'drawing';
    return 'none';
  }
  var COLOUR = { late: '#9E2B25', open: '#C99A2E', done: '#276E50', drawing: '#2F5D86', none: '#5C6B63' };

  var plots = [];
  var byKey = {};
  var plotLayer = L.layerGroup().addTo(map);

  function popupFor(p) {
    var bits = [];
    if (p.letters) bits.push(KU(p.letters) + ' کتاب');
    if (p.open) bits.push(KU(p.open) + ' کراوە');
    if (p.late) bits.push(KU(p.late) + ' دواکەوتوو');
    if (p.drawings) bits.push(KU(p.drawings) + ' نەخشە');
    return '<div class="map-popup" dir="rtl">' +
      '<strong>پارچەی <bdi dir="ltr">' + esc(p.no) + '</bdi></strong>' +
      (p.hood ? '<div class="muted">' + esc(p.hood) + '</div>' : '') +
      '<div>' + (bits.length ? bits.join(' · ') : 'هیچ کتابێک نییە کە بتوانیت بیبینیت') + '</div>' +
      '<div class="map-popup-actions">' +
        '<a class="btn small" href="/plots?p=' + encodeURIComponent(p.no) + '">فایلی پارچە</a>' +
        (host.getAttribute('data-can-place') ? ' <a class="btn small secondary" href="/plots/map?place=' + encodeURIComponent(p.no) + '">گۆڕینی شوێن</a>' : '') +
      '</div></div>';
  }

  function drawPlots() {
    plotLayer.clearLayers();
    plots.forEach(function (p) {
      var c = COLOUR[stateOf(p)];
      var layer;
      if (p.outline && p.outline.length >= 3) {
        layer = L.polygon(p.outline, { color: c, weight: 2, fillColor: c, fillOpacity: 0.25 });
      } else {
        layer = L.circleMarker([p.lat, p.lng], { radius: 8, color: '#fff', weight: 2, fillColor: c, fillOpacity: 1 });
      }
      layer.bindTooltip(p.no, { direction: 'top', className: 'map-tip' });
      layer.bindPopup(popupFor(p));
      layer.addTo(plotLayer);
      p.layer = layer;
      byKey[keyOf(p.no)] = p;
    });
    renderList();
  }

  function renderList() {
    var box = document.querySelector('[data-placed-list]');
    if (!box) return;
    if (!plots.length) {
      box.innerHTML = '<div class="empty compact">هێشتا هیچ پارچەیەک لەسەر نەخشە دیاری نەکراوە.</div>';
      return;
    }
    var rows = plots.slice(0, 200).map(function (p) {
      return '<tr><td><button type="button" class="linklike mono" data-fly="' + esc(p.no) + '"><bdi dir="ltr">' + esc(p.no) + '</bdi></button></td>' +
        '<td>' + esc(p.hood || '—') + '</td>' +
        '<td><span class="map-dot ' + stateOf(p) + '"></span> ' + (p.late ? KU(p.late) + ' دواکەوتوو' : p.open ? KU(p.open) + ' کراوە' : KU(p.letters) + ' کتاب') + '</td>' +
        '<td><a class="btn small secondary" href="/plots?p=' + encodeURIComponent(p.no) + '">فایل</a></td></tr>';
    }).join('');
    box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>پارچە</th><th>گەڕەک</th><th>دۆخ</th><th class="actions"><span class="sr-only">کردار</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    box.querySelectorAll('[data-fly]').forEach(function (b) {
      b.addEventListener('click', function () { fly(b.getAttribute('data-fly')); host.scrollIntoView({ block: 'center' }); });
    });
  }

  function fly(no) {
    var p = byKey[keyOf(no)];
    if (!p) return false;
    if (p.outline && p.outline.length >= 3) map.fitBounds(L.polygon(p.outline).getBounds(), { maxZoom: 18 });
    else map.setView([p.lat, p.lng], 18);
    p.layer.openPopup();
    return true;
  }

  var search = document.querySelector('[data-map-search]');
  if (search) {
    search.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = search.elements.p.value.trim();
      if (!value) return;
      if (!fly(value)) {
        // Not on the map: the plot file still has everything about it.
        if (window.confirm('ئەم پارچەیە هێشتا لەسەر نەخشە نییە. فایلی پارچەکە بکرێتەوە؟')) {
          window.location.assign('/plots?p=' + encodeURIComponent(value));
        }
      }
    });
  }

  // --- placing ------------------------------------------------------------------

  function startPlacing() {
    var bar = document.querySelector('[data-place-bar]');
    var text = document.querySelector('[data-place-text]');
    var save = document.querySelector('[data-place-save]');
    var outlineBtn = document.querySelector('[data-outline]');
    var outlineUndo = document.querySelector('[data-outline-undo]');
    bar.hidden = false;
    host.classList.add('placing');
    text.textContent = 'پارچەی ' + placeNo + ': کرتە لەسەر شوێنەکەی بکە.';

    var existing = byKey[keyOf(placeNo)];
    var marker = null;
    var ring = existing && existing.outline ? existing.outline.slice() : [];
    var ringLayer = null;
    var tracing = false;

    function drawRing() {
      if (ringLayer) map.removeLayer(ringLayer);
      ringLayer = ring.length >= 2
        ? (ring.length >= 3 ? L.polygon(ring, { color: '#15503A', weight: 2, dashArray: '5 4', fillOpacity: 0.15 }) : L.polyline(ring, { color: '#15503A', weight: 2, dashArray: '5 4' })).addTo(map)
        : null;
      outlineUndo.hidden = !ring.length;
    }

    // Moving the pin moves the outline with it: a plot moved without its outline
    // stayed drawn at the old place (feature test, 13 September).
    function shiftRing(from, to) {
      if (!ring.length || !from) return;
      var dLat = to.lat - from.lat, dLng = to.lng - from.lng;
      ring = ring.map(function (p) { return [p[0] + dLat, p[1] + dLng]; });
      drawRing();
    }

    function setPoint(latlng) {
      latlng = L.latLng(latlng);
      if (marker) {
        shiftRing(marker.getLatLng(), latlng);
        marker.setLatLng(latlng);
      } else {
        marker = L.marker(latlng, {
          draggable: true, autoPan: true,
          icon: L.divIcon({ className: 'map-pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] }),
        }).addTo(map);
        var dragFrom = null;
        marker.on('dragstart', function () { dragFrom = marker.getLatLng(); });
        marker.on('dragend', function () { shiftRing(dragFrom, marker.getLatLng()); dragFrom = null; });
      }
      save.disabled = false;
      text.textContent = 'پارچەی ' + placeNo + ': شوێنەکە دیاری کرا. دەتوانیت بیجوڵێنیت، یان سنوورەکەی بکێشیت.';
    }

    if (existing) {
      setPoint([existing.lat, existing.lng]);
      drawRing();
      map.setView([existing.lat, existing.lng], 18);
    }

    map.on('click', function (e) {
      if (tracing) { ring.push([e.latlng.lat, e.latlng.lng]); drawRing(); return; }
      setPoint(e.latlng);
    });

    outlineBtn.addEventListener('click', function () {
      tracing = !tracing;
      outlineBtn.setAttribute('aria-pressed', tracing ? 'true' : 'false');
      outlineBtn.textContent = tracing ? 'تەواوبوونی سنوور' : 'کێشانی سنوور';
      if (tracing) {
        // Drawing the outline again starts a new one; the corners were added to
        // the old outline and made a sliver (feature test, 13 September).
        ring = [];
        drawRing();
        text.textContent = 'کرتە لەسەر گۆشەکانی پارچەکە بکە، یەک لە دوای یەک.';
      } else if (ring.length >= 3) {
        text.textContent = 'سنوورەکە کێشرا (' + KU(ring.length) + ' گۆشە). پاشەکەوتی بکە.';
      } else if (ring.length) {
        text.textContent = 'سنوور پێویستی بە لانیکەم سێ گۆشەیە.';
      } else {
        text.textContent = 'پارچەی ' + placeNo + ': بێ سنوور، تەنها شوێنەکە.';
      }
    });
    outlineUndo.addEventListener('click', function () { ring.pop(); drawRing(); });

    save.addEventListener('click', function () {
      if (!marker) return;
      if (ring.length && ring.length < 3) { text.textContent = 'سنوور پێویستی بە لانیکەم سێ گۆشەیە، یان بیسڕەوە.'; return; }
      save.disabled = true;
      var ll = marker.getLatLng();
      var body = new URLSearchParams();
      body.append('_csrf', csrf);
      body.append('plot_no', placeNo);
      body.append('lat', String(ll.lat));
      body.append('lng', String(ll.lng));
      if (ring.length >= 3) body.append('outline', JSON.stringify(ring));
      fetch('/plots/map/place', {
        method: 'POST', credentials: 'same-origin', body: body,
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (x.ok && x.j.location) { window.location.assign(x.j.location); return; }
          text.textContent = x.j.error || 'پاشەکەوت نەکرا.';
          save.disabled = false;
        })
        .catch(function () { text.textContent = 'پەیوەندی بە ڕاژەوە نەبوو.'; save.disabled = false; });
    });
  }

  // --- start -----------------------------------------------------------------------

  fetch(host.getAttribute('data-map-src'), { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      drawBase(data);
      return fetch('/plots/map/data', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      plots = d.plots || [];
      drawPlots();
      if (placeNo) startPlacing();
      else if (focusNo && !fly(focusNo)) {
        var note = document.createElement('p');
        note.className = 'notice warn map-notice';
        note.textContent = 'پارچەی ' + focusNo + ' هێشتا لەسەر نەخشە دیاری نەکراوە.';
        host.parentNode.insertBefore(note, host);
      }
    })
    .catch(function (err) {
      console.warn('[map] could not load:', err && err.message);
      var loading = host.querySelector('.map-loading');
      if (loading) loading.textContent = 'نەخشەکە نەکرایەوە. پەڕەکە نوێ بکەرەوە.';
    });
})();
