// The parts of the screen that move.
//
// There is no framework here and there is not going to be one. The pages are
// rendered by the server and arrive complete; this file adds four things that a
// server-rendered page cannot do on its own:
//
//   1. keeps the menu drawer usable from a keyboard
//   2. holds a connection open and says when something arrives
//   3. asks the browser to register for pushes, if the person wants that
//   4. says when the network has gone
//
// Everything it does is an addition. With this file blocked, the menu still
// opens, the notifications screen still lists everything, and the application
// works exactly as it did before any of this existed. That is deliberate: a
// municipal office has machines with old browsers and locked-down extensions,
// and none of them should be shut out of the correspondence system because a
// bell would not load.
//
// Written in plain ES5-shaped JavaScript, for the same reason.

(function () {
  'use strict';

  var body = document.body;
  var csrf = (body && body.getAttribute('data-csrf')) || '';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // --- the service worker ---------------------------------------------------
  //
  // Registered on every page so that an installed copy keeps working when the
  // machine is between wifi points. What it does and, more importantly, what it
  // refuses to keep is in sw.js.

  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(function (e) {
      console.warn('[app] service worker not registered:', e && e.message);
    });
  }

  // --- the drawer -----------------------------------------------------------
  //
  // Opening and closing is done by a checkbox and CSS, so that it works with
  // scripting off. What is missing without script is the keyboard, because a
  // <label> is not a button and does not respond to Enter. That is what this
  // adds, plus Escape to close and closing itself when a link is followed.

  // A page drawn as the answer to a form puts a plain address in the bar, so that
  // reloading it does not send the form again: pressing F5 on the page showing a
  // new temporary password issued a second one (records test, 13 September).
  (function () {
    var r = document.querySelector('[data-replace-url]');
    if (r && window.history && history.replaceState) {
      try { history.replaceState(null, '', r.getAttribute('data-replace-url')); } catch (e) { /* ignore */ }
    }
  })();

  function wireDrawer() {
    var box = $('#nav-toggle');
    if (!box) return;
    var sidebar = $('.sidebar');

    // The checkbox is the control (Space toggles it). Opening moves focus into the
    // drawer, Tab stays inside it while it is open, the page behind does not
    // scroll, and Escape closes it and puts focus back on the menu button
    // (accessibility test, 13 September).
    function opened() {
      document.documentElement.classList.toggle('drawer-open', box.checked);
      document.documentElement.style.overflow = box.checked ? 'hidden' : '';
      if (box.checked) {
        setTimeout(function () { var first = $('.sidebar .nav a'); if (first) first.focus(); }, 30);
      }
    }
    box.addEventListener('change', opened);

    document.addEventListener('keydown', function (e) {
      if (!box.checked) return;
      if (e.key === 'Escape') { box.checked = false; opened(); box.focus(); return; }
      if (e.key === 'Tab' && sidebar) {
        var stops = $$('.sidebar a[href], .sidebar button').filter(function (el) { return el.offsetParent !== null; });
        if (!stops.length) return;
        var first = stops[0], last = stops[stops.length - 1];
        if (!sidebar.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    $$('.nav-backdrop').forEach(function (b) { b.addEventListener('click', function () { setTimeout(opened, 0); }); });

    // The top bar's real height, for anchors and focused fields to clear it.
    var bar = $('.topbar');
    function measure() { if (bar) document.documentElement.style.setProperty('--topbar-actual', bar.offsetHeight + 'px'); }
    measure();
    window.addEventListener('resize', measure);

    // Following a link closes it. Without this the drawer is still open behind
    // the next page on browsers that keep the page alive, which reads as the
    // menu having failed to do anything.
    $$('.sidebar .nav a').forEach(function (a) {
      a.addEventListener('click', function () { box.checked = false; opened(); });
    });
  }

  // --- selects that submit themselves ---------------------------------------
  // The room switcher. An inline onchange is refused by the content security
  // policy, silently, which is why this is here rather than in the markup.

  function wireAutoSubmit() {
    $$('[data-auto-submit]').forEach(function (el) {
      el.addEventListener('change', function () { if (el.form) el.form.submit(); });
    });
  }

  // --- "this looks familiar", while the clerk is still typing ---------------
  //
  // The same check runs on the server when the form is submitted, and that one
  // is the one that counts. This only moves the warning earlier, to while the
  // clerk is still at the counter with the citizen in front of them, which is
  // the moment it is worth something. With this file blocked, nothing is lost
  // except the head start.
  //
  // It asks for a fragment of rendered HTML rather than JSON, so there is one
  // renderer for the panel and no way for the live version to say something
  // different from the submitted one.

  function wireSimilar() {
    var form = $('[data-similar-form]');
    var slot = $('[data-similar-live]');
    if (!form || !slot || !window.fetch) return;

    var subject = form.querySelector('[name="subject"]');
    var sender = form.querySelector('[name="sender_name"]');
    var plot = form.querySelector('[name="plot_no"]');
    var timer = null;
    var last = '';

    function look() {
      var q = 'subject=' + encodeURIComponent(subject ? subject.value : '')
            + '&sender=' + encodeURIComponent(sender ? sender.value : '')
            + '&plot=' + encodeURIComponent(plot ? plot.value : '');

      // Nothing worth asking about yet, and nothing worth asking twice.
      var enough = (subject && subject.value.trim().length >= 6)
                || (plot && plot.value.trim().length >= 3);
      if (!enough) { slot.innerHTML = ''; last = ''; return; }
      if (q === last) return;
      last = q;

      fetch('/registry/similar?' + q, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (h) { slot.innerHTML = h || ''; })
        .catch(function () { /* the server check still runs on submit */ });
    }

    // Half a second after the typing stops. Sooner and it fires on every letter
    // of a Kurdish subject line; later and the clerk has already pressed save.
    [subject, sender, plot].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(look, 500);
      });
    });
  }

  // --- choosing files, and changing your mind -------------------------------
  //
  // Reported from the demo: a chosen file could not be un-chosen. A browser's
  // file box has no remove button; the only way out was to reload the page and
  // lose the rest of the form. So every file box gets a list of what is chosen
  // underneath it, with a remove button on each.
  //
  // It also checks size and type the moment a file is chosen, rather than after
  // the whole file has been sent. A sixty megabyte drawing refused by the server
  // is a minute of waiting to be told something the page already knew.

  var KU_DIGITS = function (s) {
    return String(s).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x0660 + Number(d)); });
  };

  function humanSize(bytes) {
    if (bytes >= 1048576) return KU_DIGITS((bytes / 1048576).toFixed(1)) + ' مێگابایت';
    return KU_DIGITS(Math.max(1, Math.round(bytes / 1024))) + ' کیلۆبایت';
  }

  function acceptsName(input, name) {
    var accept = (input.getAttribute('accept') || '').toLowerCase();
    if (!accept) return true;
    var lower = String(name).toLowerCase();
    return accept.split(',').some(function (a) {
      a = a.trim();
      if (!a) return false;
      if (a.charAt(0) === '.') return lower.slice(-a.length) === a;
      if (a.slice(-2) === '/*') return true;      // image/* from a camera: the server checks the bytes
      return false;
    });
  }

  function wireFilePickers() {
    $$('input[type="file"]').forEach(function (input) {
      if (input.getAttribute('data-picker-wired')) return;
      input.setAttribute('data-picker-wired', '1');

      var list = document.createElement('ul');
      list.className = 'file-picked';
      list.setAttribute('aria-live', 'polite');
      var error = document.createElement('div');
      error.className = 'file-error';
      error.setAttribute('role', 'alert');
      error.hidden = true;

      // A button and a line in Kurdish in place of the browser's own English
      // "Choose File / No file chosen". The input stays in the page, focusable
      // and required, and the label opens it (browser audit, 13 September).
      if (!input.id) input.id = 'file-' + Math.random().toString(36).slice(2, 9);
      var choose = document.createElement('label');
      choose.className = 'btn secondary file-choose';
      choose.setAttribute('for', input.id);
      var none = document.createElement('span');
      none.className = 'file-none muted';
      none.textContent = input.multiple ? 'هیچ فایلێک هەڵنەبژێردراوە' : 'هیچ فایلێک هەڵنەبژێردراوە';
      input.classList.add('file-native');

      var after = input.nextSibling;
      input.parentNode.insertBefore(choose, after);
      input.parentNode.insertBefore(none, after);
      input.parentNode.insertBefore(list, after);
      input.parentNode.insertBefore(error, after);

      var max = Number(input.getAttribute('data-max-bytes')) || 0;

      function setFiles(files) {
        // DataTransfer is how a script gives a file box a new list. Where it is
        // missing (very old browsers) the only possible edit is emptying the box.
        try {
          var dt = new DataTransfer();
          files.forEach(function (f) { dt.items.add(f); });
          input.files = dt.files;
          return true;
        } catch (e) {
          if (!files.length) input.value = '';
          return !files.length;
        }
      }

      function paint() {
        list.textContent = '';
        var files = Array.prototype.slice.call(input.files || []);
        none.hidden = files.length > 0;
        choose.textContent = files.length
          ? (input.multiple ? 'گۆڕینی فایلەکان' : 'گۆڕینی فایل')
          : (input.multiple ? 'هەڵبژاردنی فایلەکان' : 'هەڵبژاردنی فایل');
        files.forEach(function (f, i) {
          var li = document.createElement('li');
          var name = document.createElement('span');
          name.className = 'name';
          name.textContent = f.name;
          name.setAttribute('dir', 'auto');
          name.title = f.name;
          var size = document.createElement('span');
          size.className = 'size';
          size.textContent = humanSize(f.size);
          var remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'remove';
          remove.textContent = 'لابردن ✕';
          remove.setAttribute('aria-label', 'لابردنی ' + f.name);
          remove.addEventListener('click', function () {
            var rest = files.filter(function (_, j) { return j !== i; });
            if (!setFiles(rest)) input.value = '';
            error.hidden = true;
            paint();
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.focus();
          });
          li.appendChild(name);
          li.appendChild(size);
          li.appendChild(remove);
          list.appendChild(li);
        });
      }

      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []);
        var problems = [];
        var keep = files.filter(function (f) {
          if (max && f.size > max) { problems.push(f.name + ': لە ' + humanSize(max) + ' گەورەترە.'); return false; }
          if (!acceptsName(input, f.name)) { problems.push(f.name + ': ئەم جۆرە فایلە لێرە قبوڵ ناکرێت.'); return false; }
          return true;
        });
        if (keep.length !== files.length) setFiles(keep) || (input.value = '');
        error.textContent = problems.join(' ');
        error.hidden = problems.length === 0;
        paint();
      });

      paint();
    });
  }

  // --- digits in identifiers -------------------------------------------------
  //
  // A plot number typed partly on a Kurdish keyboard's number row and partly on
  // the keypad came out as "2٤0/4". Fields that hold identifiers are marked
  // data-digits and are put into one kind of digit as they are typed, the same
  // kind the server stores. Every digit is one character in both forms, so the
  // cursor does not jump.

  function wireDigits() {
    $$('[data-digits]').forEach(function (el) {
      function fold() {
        var v = el.value;
        var out = v.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
                   .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
        // The same rule as unifyDigits() on the server: a value with Kurdish
        // letters in it ("ب٣") keeps Arabic-Indic digits; anything else, Western.
        if (/[ء-يٮ-ۓەۮۯۺ-ۿ]/.test(out)) out = KU_DIGITS(out);
        if (out === v) return;
        var start = el.selectionStart, end = el.selectionEnd;
        el.value = out;
        try { el.setSelectionRange(start, end); } catch (e) { /* not a text field */ }
      }
      el.addEventListener('input', fold);
      fold();
    });
  }

  // --- date fields ------------------------------------------------------------
  //
  // A browser's own date box writes the day in the order of the machine's
  // language: «mm/dd/yyyy» on one desk and «dd/mm/yyyy» on the next, while every
  // screen in the system shows ٢٠٢٦/٠٩/١٣ (design test, 13 September). The fields
  // are plain text in that order (dateInput in src/lib/html.mjs). This adds the
  // calendar, reads a typed date in either kind of digit, and writes it back the
  // system's way. The server reads the same way (readDay), so a date typed with
  // this file blocked still arrives.

  var MONTHS = ['کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران',
                'تەممووز', 'ئاب', 'ئەیلوول', 'تشرینی یەکەم', 'تشرینی دووەم', 'کانوونی یەکەم'];
  // Saturday first, as on the calendars on the office walls.
  var WEEKDAYS = ['شەممە', 'یەکشەممە', 'دووشەممە', 'سێشەممە', 'چوارشەممە', 'پێنجشەممە', 'هەینی'];
  var DAY_FORMAT = 'بەروار بەم شێوەیە بنووسە: ساڵ/مانگ/ڕۆژ، بۆ نموونە ٢٠٢٦/٠٩/١٣.';
  var ICON_CALENDAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
  // Right-to-left: the earlier month is on the right and points right.
  var ICON_EARLIER = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  var ICON_LATER = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(day) { return day.y * 10000 + day.m * 100 + day.d; }
  function dayText(day) { return KU_DIGITS(day.y + '/' + pad2(day.m) + '/' + pad2(day.d)); }
  function dayOf(dt) { return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() }; }
  function dayPlus(day, days, months) {
    // Noon, so a clock change can never move the answer to another day.
    var dt = new Date(day.y, day.m - 1 + (months || 0), 1, 12);
    var last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    dt.setDate(Math.min(day.d, last) + (days || 0));
    return dayOf(dt);
  }

  // The same reading as readDay() on the server: '' for empty, null for not a day.
  function readDay(s) {
    var v = String(s || '').replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
                           .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
                           .replace(/^\s+|\s+$/g, '');
    if (!v) return '';
    var m = /^(\d{1,4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,4})$/.exec(v) || /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (!m) return null;
    var day;
    if (m[1].length === 4) day = { y: +m[1], m: +m[2], d: +m[3] };
    else if (m[3].length === 4) day = { y: +m[3], m: +m[2], d: +m[1] };
    else return null;
    if (day.y < 1900 || day.y > 2200 || day.m < 1 || day.m > 12 || day.d < 1) return null;
    if (day.d > new Date(day.y, day.m, 0).getDate()) return null;
    return day;
  }

  function wireDates() {
    $$('input[data-date]').forEach(function (input) {
      var wrap = document.createElement('span');
      wrap.className = 'date-field';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'date-btn';
      btn.setAttribute('aria-label', 'هەڵبژاردن لە ڕۆژژمێر');
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = ICON_CALENDAR;
      wrap.appendChild(btn);

      var afterId = input.getAttribute('data-after');
      var after = afterId ? document.getElementById(afterId) : null;
      var afterLabel = after && document.querySelector('label[for="' + afterId + '"]');
      var panel = null, title = null, grid = null, todayBtn = null, earlierBtn = null;
      var month = null, focusDay = null;

      function earliest() { return (after && readDay(after.value)) || null; }

      // What is wrong with the field, if anything, as the browser's own message.
      function check() {
        var day = readDay(input.value), min = earliest(), msg = '';
        if (day === null) msg = DAY_FORMAT;
        else if (day && min && dayKey(day) < dayKey(min)) {
          msg = 'ئەم بەروارە دەبێت هەمان ڕۆژ یان دوای «' + (afterLabel ? afterLabel.textContent.replace(/\s+/g, ' ').trim() : '') + '» بێت.';
        }
        input.setCustomValidity(msg);
        return day;
      }
      function tidy() {
        var day = check();
        if (day && input.value !== dayText(day)) input.value = dayText(day);
      }

      input.addEventListener('input', function () { input.setCustomValidity(''); });
      input.addEventListener('change', tidy);
      input.addEventListener('blur', tidy);
      input.addEventListener('keydown', function (e) {
        if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); open(); }
        if (e.key === 'Escape' && panel) { e.preventDefault(); close(false); }
      });
      if (after) after.addEventListener('change', function () { if (input.value) check(); });
      if (input.form) {
        input.form.addEventListener('submit', function (e) {
          tidy();
          if (!input.checkValidity()) { e.preventDefault(); input.reportValidity(); }
        });
      }
      if (input.value) tidy();

      function drawDays() {
        var picked = readDay(input.value), now = dayOf(new Date()), min = earliest();
        var first = new Date(month.y, month.m - 1, 1, 12);
        var count = new Date(month.y, month.m, 0).getDate();
        var lead = (first.getDay() + 1) % 7;          // Saturday is the first column
        var h = '', i;
        for (i = 0; i < lead; i++) h += '<span></span>';
        for (i = 1; i <= count; i++) {
          var day = { y: month.y, m: month.m, d: i };
          var k = dayKey(day);
          h += '<button type="button" class="dp-day' + (k === dayKey(now) ? ' today' : '') + '"'
             + ' data-d="' + i + '"'
             + ' aria-label="' + WEEKDAYS[(lead + i - 1) % 7] + ' ' + KU_DIGITS(i) + 'ی ' + MONTHS[month.m - 1] + ' ' + KU_DIGITS(month.y) + '"'
             + ' aria-pressed="' + (picked && k === dayKey(picked) ? 'true' : 'false') + '"'
             + (k === dayKey(now) ? ' aria-current="date"' : '')
             + (min && k < dayKey(min) ? ' disabled' : '')
             + ' tabindex="' + (k === dayKey(focusDay) ? '0' : '-1') + '">' + KU_DIGITS(i) + '</button>';
        }
        grid.innerHTML = h;
        title.textContent = MONTHS[month.m - 1] + ' ' + KU_DIGITS(month.y);
        todayBtn.disabled = Boolean(min && dayKey(now) < dayKey(min));
        // Nothing to go back to before «لە»'s month.
        var stuck = Boolean(min && month.y * 12 + month.m <= min.y * 12 + min.m);
        if (stuck && document.activeElement === earlierBtn) panel.focus();
        earlierBtn.disabled = stuck;
      }

      function focusCurrent() {
        var b = $('.dp-day[tabindex="0"]:not([disabled])', grid) || $('.dp-day:not([disabled])', grid);
        if (b) b.focus(); else if (panel) panel.focus();
      }

      function show(day, moveFocus) {
        var min = earliest();
        if (min && dayKey(day) < dayKey(min)) day = min;
        focusDay = day;
        month = { y: day.y, m: day.m };
        drawDays();
        if (moveFocus) focusCurrent();
      }

      function place() {
        panel.classList.remove('up', 'left');
        var r = panel.getBoundingClientRect();
        if (r.left < 8) panel.classList.add('left');
        if (r.bottom > window.innerHeight - 8 && wrap.getBoundingClientRect().top > r.height + 16) panel.classList.add('up');
      }

      function open() {
        if (panel) return;
        panel = document.createElement('div');
        panel.className = 'datepicker';
        panel.tabIndex = -1;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'ڕۆژژمێر');
        panel.innerHTML =
            '<div class="dp-head">'
          + '<button type="button" class="dp-nav" data-months="-1" aria-label="مانگی پێشوو">' + ICON_EARLIER + '</button>'
          + '<div class="dp-title" aria-live="polite"></div>'
          + '<button type="button" class="dp-nav" data-months="1" aria-label="مانگی داهاتوو">' + ICON_LATER + '</button>'
          + '</div>'
          + '<div class="dp-week" aria-hidden="true">'
          + WEEKDAYS.map(function (w) { return '<span title="' + w + '">' + w.charAt(0) + '</span>'; }).join('')
          + '</div>'
          + '<div class="dp-days"></div>'
          + '<div class="dp-foot">'
          + '<button type="button" class="btn small secondary" data-today>ئەمڕۆ</button>'
          + '<button type="button" class="btn small secondary" data-clear>سڕینەوە</button>'
          + '</div>';
        title = $('.dp-title', panel);
        grid = $('.dp-days', panel);
        todayBtn = $('[data-today]', panel);
        earlierBtn = $('[data-months="-1"]', panel);
        wrap.appendChild(panel);
        btn.setAttribute('aria-expanded', 'true');
        show(readDay(input.value) || earliest() || dayOf(new Date()), false);
        place();
        // No room above or below on a small screen: bring the whole calendar into view.
        var r = panel.getBoundingClientRect();
        if (r.bottom > window.innerHeight || r.top < 0) panel.scrollIntoView({ block: 'nearest' });
        focusCurrent();
        panel.addEventListener('click', onClick);
        panel.addEventListener('keydown', onKey);
      }

      function close(refocus) {
        if (!panel) return;
        wrap.removeChild(panel);
        panel = null;
        btn.setAttribute('aria-expanded', 'false');
        if (refocus) btn.focus();
      }

      function pick(day) {
        input.value = day ? dayText(day) : '';
        check();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // Back to the button, not the field: focusing the field opens a phone's keyboard.
        close(true);
      }

      function onClick(e) {
        var t = e.target.closest ? e.target.closest('button') : null;
        if (!t || t.disabled) return;
        if (t.hasAttribute('data-months')) show(dayPlus(focusDay, 0, Number(t.getAttribute('data-months'))), false);
        else if (t.hasAttribute('data-d')) pick({ y: month.y, m: month.m, d: Number(t.getAttribute('data-d')) });
        else if (t.hasAttribute('data-today')) pick(dayOf(new Date()));
        else if (t.hasAttribute('data-clear')) pick(null);
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
        // On a day, or on the calendar itself after a click on a day that cannot be chosen.
        if (e.target !== panel && !e.target.classList.contains('dp-day')) return;
        // Right-to-left: the left arrow is the next day.
        var step = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowDown: [7, 0], ArrowUp: [-7, 0],
                     PageDown: [0, 1], PageUp: [0, -1] }[e.key];
        var col = (focusDay ? (new Date(focusDay.y, focusDay.m - 1, focusDay.d, 12).getDay() + 1) % 7 : 0);
        if (e.key === 'Home') step = [-col, 0];
        if (e.key === 'End') step = [6 - col, 0];
        if (!step) return;
        e.preventDefault();
        var next = dayPlus(focusDay, step[0], step[1]);
        var min = earliest();
        if (min && dayKey(next) < dayKey(min)) return;
        show(next, true);
      }

      btn.addEventListener('click', function () { if (panel) close(true); else open(); });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && panel) { e.preventDefault(); close(true); }
      });
      // Clicking anywhere else, or tabbing out of the field and its calendar, closes it.
      document.addEventListener('mousedown', function (e) { if (panel && !wrap.contains(e.target)) close(false); });
      document.addEventListener('touchstart', function (e) { if (panel && !wrap.contains(e.target)) close(false); }, { passive: true });
      wrap.addEventListener('focusout', function (e) {
        if (panel && e.relatedTarget && !wrap.contains(e.relatedTarget)) close(false);
      });
      window.addEventListener('resize', function () { if (panel) place(); });
    });
  }

  // --- a form that takes a while --------------------------------------------
  //
  // Scanning takes as long as the scanner takes. A button that looks untouched
  // for twenty seconds gets pressed again, and the second press is a second scan.

  function wireBusyForms() {
    $$('form[data-busy-form]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        if (form.getAttribute('data-busy')) { e.preventDefault(); return; }
        form.setAttribute('data-busy', '1');
        $$('button[type="submit"]', form).forEach(function (b) {
          var text = b.getAttribute('data-busy-text');
          if (text) b.textContent = text;
          b.classList.add('busy');
          // Disabled after the submit has been dispatched, or the button's own
          // name and value would be left out of what is sent.
          setTimeout(function () { b.disabled = true; }, 0);
        });
      });
    });
  }

  // --- whether each scanner is awake ----------------------------------------

  function wireScannerStatus() {
    $$('[data-scanner-status]').forEach(function (pill) {
      var id = pill.getAttribute('data-scanner-status');
      fetch('/scan/scanners/' + encodeURIComponent(id) + '/status', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : { ok: false }; })
        .then(function (s) {
          if (s.ok && /idle/i.test(s.state || '')) { pill.className = 'pill ok'; pill.textContent = 'ئامادەیە'; }
          else if (s.ok) { pill.className = 'pill warn'; pill.textContent = 'سەرقاڵە'; }
          else { pill.className = 'pill danger'; pill.textContent = 'پەیوەندی نییە'; pill.title = s.message || ''; }
        })
        .catch(function () { pill.className = 'pill muted'; pill.textContent = '؟'; });
    });
  }

  // --- somebody else signed in, in another tab ------------------------------
  //
  // Every tab of a browser shares one sign-in. If Shilan is working in one tab and
  // Aram signs in in another, Shilan's tab now acts as Aram, and whatever she
  // presses next is recorded against his name, while her screen still shows her
  // own. That is the worst version of "two people cannot use it at once", so the
  // tab says so and stops, instead of quietly carrying on.

  function wireSessionWatch() {
    var me = body && body.getAttribute('data-user-id');
    if (!me || !window.localStorage) return;
    var KEY = 'docsys:user';
    var shown = false;

    function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }

    function warn(other) {
      if (shown) return;
      shown = true;
      var wrap = document.createElement('div');
      wrap.className = 'session-changed';
      wrap.setAttribute('role', 'alertdialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', 'هەژمارەکە گۆڕدرا');
      // Nothing behind it can be reached until the page is reloaded.
      document.addEventListener('keydown', function (e) { if (e.key === 'Tab') { e.preventDefault(); btn.focus(); } });
      var box = document.createElement('div');
      box.className = 'box';
      var p = document.createElement('p');
      p.textContent = other && other.id
        ? 'ئەم پەنجەرەیە بۆ «' + (body.getAttribute('data-user-name') || '') + '» بوو، بەڵام لە تابێکی تری ئەم وێبگەڕەدا «'
          + (other.name || '') + '» چووە ژوورەوە. هەموو تابەکان ئێستا ئەو هەژمارە بەکاردەهێنن.'
        : 'لە تابێکی تری ئەم وێبگەڕەدا لە سیستەم چوویتە دەرەوە.';
      var p2 = document.createElement('p');
      p2.className = 'muted';
      p2.textContent = 'بۆ کارکردنی دوو کەس لەسەر یەک کۆمپیوتەر، پەنجەرەیەکی تایبەت (Ctrl+Shift+N) یان وێبگەڕێکی تر بەکاربهێنە.';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = 'نوێکردنەوەی پەڕە';
      btn.addEventListener('click', function () { location.reload(); });
      box.appendChild(p); box.appendChild(p2); box.appendChild(btn);
      wrap.appendChild(box);
      document.body.appendChild(wrap);
      btn.focus();
    }

    try { localStorage.setItem(KEY, JSON.stringify({ id: me, name: body.getAttribute('data-user-name') || '', at: Date.now() })); } catch (e) { return; }

    window.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      var other = read();
      if (!other || String(other.id) !== String(me)) warn(other);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      var other = read();
      if (other && String(other.id) !== String(me)) warn(other);
    });
    // Signing out from this tab tells the others.
    $$('form[action="/logout"]').forEach(function (f) {
      f.addEventListener('submit', function () { try { localStorage.setItem(KEY, JSON.stringify({ id: '', at: Date.now() })); } catch (e) {} });
    });
  }

  // --- the bell -------------------------------------------------------------

  var bellCount = $('[data-bell-count]');

  function paintBadge(n) {
    if (!bellCount) return;
    if (!n) { bellCount.hidden = true; return; }
    bellCount.hidden = false;
    // Arabic-Indic digits, the same as everywhere else in the application.
    bellCount.textContent = String(n > 99 ? '99+' : n).replace(/[0-9]/g, function (d) {
      return String.fromCharCode(0x0660 + Number(d));
    });
    // The tab title too, so a minimised window still says there is something.
    var base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = n ? '(' + n + ') ' + base : base;
  }

  // --- what just happened ---------------------------------------------------

  var toasts = $('[data-toasts]');

  function toast(item) {
    if (!toasts) return;
    var a = document.createElement('a');
    a.className = 'toast';
    a.href = item.href || '/notifications';

    var strong = document.createElement('strong');
    strong.textContent = item.text || '';
    a.appendChild(strong);

    // The subject is shown only when the server sent one, and the server sends
    // one only when this reader is allowed to see that letter. Nothing here
    // decides what may be displayed; see lib/notify.mjs.
    var line = [item.number, item.subject, item.room].filter(Boolean).join(' — ');
    if (line) {
      var span = document.createElement('span');
      span.textContent = line;
      a.appendChild(span);
    }

    var wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'داخستنی ئاگادارکردنەوە');
    close.textContent = '✕';
    wrap.appendChild(a);
    wrap.appendChild(close);
    toasts.appendChild(wrap);

    // Long enough to read a line of Kurdish, short enough not to sit over the
    // page while somebody is working. It waits while it is being pointed at or
    // has focus, and it can be closed (accessibility test, 13 September).
    var held = false, due = false;
    function leave() {
      if (held) { due = true; return; }
      wrap.classList.add('leaving'); a.classList.add('leaving');
      setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 300);
    }
    ['mouseenter', 'focusin'].forEach(function (ev) { wrap.addEventListener(ev, function () { held = true; }); });
    ['mouseleave', 'focusout'].forEach(function (ev) { wrap.addEventListener(ev, function () { held = false; if (due) leave(); }); });
    close.addEventListener('click', function () { held = false; leave(); });
    setTimeout(leave, 7000);
  }

  function announce(batch) {
    if (!batch) return;
    if (typeof batch.unread === 'number') paintBadge(batch.unread);
    var items = batch.items || [];
    for (var i = 0; i < items.length; i++) toast(items[i]);
    // One sound for a batch of five, not five sounds. The loudest thing in the
    // batch wins: an overdue letter is worth a different noise from an arrival.
    if (items.length && window.docsysSound) {
      var worst = items[0].sound;
      for (var j = 0; j < items.length; j++) if (items[j].sound === 'error') worst = 'error';
      // Browsers refuse to make a sound before the page has been clicked on, so
      // the first notification after a fresh load may be silent. Nothing can be
      // done about that from here and it is not worth pretending otherwise.
      try { window.docsysSound(worst); } catch (e) { /* audio is never worth an error */ }
    }
  }

  // --- being told -----------------------------------------------------------
  //
  // Two ways in, one handler. The stream is preferred; polling takes over when
  // the browser has no EventSource or when the stream keeps failing, which on a
  // municipal network usually means a proxy that will not pass a long response.

  var after = 0;
  var stream = null;
  var streamFailures = 0;
  var pollTimer = null;
  var POLL_MS = 20000;

  function apply(data) {
    if (!data) return;
    if (typeof data.latest === 'number' && data.latest > after) after = data.latest;
    var items = data.items || [];
    if (items.length) after = Math.max(after, items[items.length - 1].id);
    announce(data);
  }

  function poll(silent) {
    return fetch('/notifications/poll?after=' + encodeURIComponent(after), {
      credentials: 'same-origin', headers: { accept: 'application/json' },
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('signed out');
      if (!r.ok) throw new Error('poll ' + r.status);
      return r.json();
    }).then(function (data) {
      // The first call only establishes where we are. Without this, opening any
      // page would announce the last twenty things that ever happened.
      if (silent) {
        after = data.latest || 0;
        paintBadge(data.unread || 0);
        return data;
      }
      apply(data);
      return data;
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (document.hidden) return;          // a background tab asks for nothing
      poll(false).catch(function () {});
    }, POLL_MS);
  }

  function startStream() {
    if (!window.EventSource) { startPolling(); return; }

    try {
      stream = new EventSource('/events?after=' + encodeURIComponent(after));
    } catch (e) { startPolling(); return; }

    stream.addEventListener('notify', function (e) {
      streamFailures = 0;
      try { apply(JSON.parse(e.data)); } catch (err) { /* a half-sent frame */ }
    });

    stream.addEventListener('open', function () { streamFailures = 0; });

    stream.addEventListener('error', function () {
      // EventSource reconnects by itself, and on the serverless deployment it is
      // meant to: the server closes the stream every twenty-five seconds. Only a
      // run of failures means the stream is not going to work here.
      streamFailures++;
      if (streamFailures >= 4) {
        stream.close();
        stream = null;
        console.warn('[app] the event stream keeps failing; asking periodically instead');
        startPolling();
      }
    });
  }

  function wireNotifications() {
    if (!bellCount) return;              // signed out, or a page with no shell

    poll(true).then(function () {
      startStream();
    }).catch(function () {
      // Signed out, or the server is unreachable. Either way, say nothing and
      // let the next page load sort it out.
    });

    // Coming back to a tab that a phone suspended. The stream may have been cut
    // without an error ever firing, so ask once, immediately.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll(false).catch(function () {});
    });
  }

  // --- pushes ---------------------------------------------------------------
  //
  // Only ever started by a press. A page that asks for notification permission
  // on load gets refused by the person and then blocked by the browser for good,
  // and there is no second chance after that.

  function urlBase64ToUint8Array(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function form(fields) {
    var b = new URLSearchParams();
    b.append('_csrf', csrf);
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) b.append(k, fields[k]);
    return b;
  }

  function wirePush() {
    var btn = $('[data-push-toggle]');
    if (!btn) return;

    var supported = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
    if (!supported) {
      btn.disabled = true;
      btn.textContent = 'ئەم وێبگەڕە پشتگیری ئاگادارکردنەوە ناکات';
      return;
    }

    function paint(on) {
      btn.textContent = on ? 'ئاگادارکردنەوە کراوەتەوە لەسەر ئەم ئامێرە'
                           : 'ئاگادارکردنەوە لەسەر ئەم ئامێرە';
      btn.classList.toggle('gold', on);
    }

    function tellServer(endpoint) {
      return fetch('/notifications/push/subscribe', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ endpoint: endpoint }),
      });
    }

    // On every visit: make sure the server has whatever endpoint this browser
    // holds now. A browser may replace a subscription on its own, and the
    // service worker has no CSRF token to report it with, so this is where a
    // rotated endpoint is picked up. Re-registering the same one changes
    // nothing; push_register is an upsert.
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub) return tellServer(sub.endpoint).then(function () { paint(true); });

        // Permission already granted but no subscription: it was replaced or
        // cleared. Take it back silently, because the person already said yes
        // and asking again is how people say no.
        if (window.Notification && Notification.permission === 'granted') {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(btn.getAttribute('data-vapid') || ''),
          }).then(function (fresh) {
            return tellServer(fresh.endpoint);
          }).then(function () { paint(true); });
        }
        paint(false);
      });
    }).catch(function () {});

    btn.addEventListener('click', function () {
      btn.disabled = true;
      navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          if (existing) {
            // Pressing it again turns it off on this device only.
            var endpoint = existing.endpoint;
            return existing.unsubscribe().then(function () {
              return fetch('/notifications/push/unsubscribe', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: form({ endpoint: endpoint }),
              });
            }).then(function () { paint(false); });
          }

          return Notification.requestPermission().then(function (permission) {
            if (permission !== 'granted') { paint(false); return; }
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(btn.getAttribute('data-vapid') || ''),
            }).then(function (sub) {
              return tellServer(sub.endpoint);
            }).then(function () { paint(true); });
          });
        });
      }).catch(function (e) {
        console.warn('[app] push could not be set up:', e && e.message);
      }).then(function () { btn.disabled = false; });
    });
  }

  // --- the network ----------------------------------------------------------

  var offlineBar = null;

  function showOffline(on) {
    if (on && !offlineBar) {
      offlineBar = document.createElement('div');
      offlineBar.className = 'offline-bar';
      offlineBar.setAttribute('role', 'status');
      offlineBar.textContent = 'پەیوەندی بە ڕاژەوە نییە. ئەوەی لەبەردەمتە دوایین دۆخی زانراوە.';
      document.body.appendChild(offlineBar);
    } else if (!on && offlineBar) {
      offlineBar.parentNode.removeChild(offlineBar);
      offlineBar = null;
      poll(false).catch(function () {});
    }
  }

  window.addEventListener('online', function () { showOffline(false); });
  window.addEventListener('offline', function () { showOffline(true); });

  // --- start ----------------------------------------------------------------

  function start() {
    registerWorker();
    wireDrawer();
    wireAutoSubmit();
    wireSimilar();
    wireFilePickers();
    wireDigits();
    wireDates();
    wireBusyForms();
    wireScannerStatus();
    wireSessionWatch();
    wireNotifications();
    wirePush();
    if (navigator.onLine === false) showOffline(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
