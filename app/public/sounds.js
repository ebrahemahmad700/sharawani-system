// Scanner feedback, synthesised.
//
// A barcode reader beeps. Staff who use one all day work by that beep and not by
// the screen: they scan, hear it, and reach for the next folder without looking
// up. Without the sound they have to stop and read, and a rhythm of one folder
// every four seconds becomes one every ten.
//
// Synthesised with Web Audio rather than played from files, because a file means
// a request, a cache header, and a beep that arrives after the next scan. A
// square wave costs nothing and is always instant.
//
// An external file, not an inline script, because the content security policy is
// script-src 'self'. An inline script here would be blocked with no error in the
// page, which is exactly how the auto-print script silently failed for months.

(function () {
  'use strict';

  var KEY = 'docsys.sound';
  var ctx = null;

  function enabled() {
    try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; }
  }

  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* private window */ }
  }

  // Created on the first real click, never before. Browsers refuse an audio
  // context that was not started by a gesture, and one created too early stays
  // suspended for the life of the page.
  function context() {
    if (!enabled()) return null;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!ctx) { try { ctx = new C(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    return ctx;
  }

  /** One tone. Gain is ramped rather than switched, because a square wave cut
      dead at full amplitude clicks, and the click is louder than the beep. */
  function tone(at, freq, ms, peak) {
    var c = ctx;
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.005);
    gain.gain.setValueAtTime(peak, at + ms / 1000 - 0.01);
    gain.gain.linearRampToValueAtTime(0, at + ms / 1000);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(at);
    osc.stop(at + ms / 1000 + 0.01);
  }

  var SOUNDS = {
    // The supermarket beep: one short, high, unmistakable.
    scan:     function (t) { tone(t, 2400, 70, 0.08); },
    // Two rising notes: the folder is accounted for.
    received: function (t) { tone(t, 1200, 60, 0.07); tone(t + 0.07, 1800, 90, 0.07); },
    // Three rising: a batch is done. Deliberately longer, because it happens
    // rarely and should be worth looking up for.
    batch:    function (t) { tone(t, 900, 60, 0.06); tone(t + 0.07, 1300, 60, 0.06); tone(t + 0.14, 1800, 120, 0.07); },
    // Two low notes, falling. Nothing sounds like an error as clearly as this.
    error:    function (t) { tone(t, 380, 110, 0.09); tone(t + 0.13, 260, 180, 0.09); },
    // A dry click for printing, so a print that started is distinguishable from
    // a button that did nothing.
    click:    function (t) { tone(t, 1500, 22, 0.05); },
  };

  function play(name) {
    var c = context();
    if (!c) return;
    var fn = SOUNDS[name] || SOUNDS.scan;
    try { fn(c.currentTime + 0.01); } catch (e) { /* audio is never worth an error */ }
  }

  // --- the switch ----------------------------------------------------------

  function paint(btn) {
    var on = enabled();
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('off', !on);
    btn.title = on ? 'دەنگ کراوەتەوە' : 'دەنگ کوژاوەتەوە';
  }

  function wireToggle() {
    var btns = document.querySelectorAll('[data-sound-toggle]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        paint(btn);
        btn.addEventListener('click', function () {
          setEnabled(!enabled());
          paint(btn);
          if (enabled()) play('scan');     // so the switch proves itself
        });
      })(btns[i]);
    }
  }

  // --- what makes a sound ---------------------------------------------------
  //
  // The page says what happened by carrying a data-sound attribute, and this
  // reads it once on load. Nothing in the page needs to know how a beep is made
  // and nothing here needs to know what the page is about.

  function announce() {
    var el = document.querySelector('[data-sound]');
    if (el) play(el.getAttribute('data-sound'));
  }

  // Buttons that should click as they are pressed, before the page navigates.
  function wireClicks() {
    var els = document.querySelectorAll('[data-sound-on-click]');
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        el.addEventListener('click', function () {
          play(el.getAttribute('data-sound-on-click'));
        });
      })(els[i]);
    }
  }

  // The barcode box is the reason this file exists: the cursor belongs in it and
  // a scanner's Enter should submit without anyone touching the page.
  function focusScanBox() {
    var box = document.querySelector('[data-scan-input]');
    if (box && !box.value) { try { box.focus(); } catch (e) {} }
  }

  function start() {
    wireToggle();
    wireClicks();
    focusScanBox();
    announce();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Exposed so a page can beep at a moment this file cannot know about.
  window.docsysSound = play;
})();
