// The tracking page, when the citizen arrived by photographing a QR code.
//
// The address they opened looks like
//
//   https://.../t/20260000253#481902
//
// and the six digits after the hash are the PIN from their own receipt. A
// fragment is never sent to a server, so this is the one part of the address
// that reached the phone and not the access log. This file reads it, fills the
// box in, removes it from the address bar so it does not sit in the browser
// history, and submits.
//
// Nothing here is required. With this file blocked, the barcode is already
// filled in by the server and the citizen types six digits off the paper in
// their hand, which is what the line under the QR code tells them to do.

(function () {
  'use strict';

  var form = document.querySelector('form[action="/track"]');
  var pin = document.getElementById('pin');
  if (!form || !pin) return;

  var hash = (window.location.hash || '').replace(/^#/, '');
  var digits = decodeURIComponent(hash).replace(/[^0-9]/g, '');

  if (digits.length !== 6) {
    // No PIN in the address. Put the cursor where the person has to type.
    if (!pin.value) { try { pin.focus(); } catch (e) {} }
    return;
  }

  pin.value = digits;

  // Out of the address bar before anything else happens. replaceState leaves no
  // extra history entry, so the back button still goes where the person expects,
  // and a phone handed to somebody else does not show the PIN in the address.
  try {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch (e) { /* an old browser; the fragment stays visible and nothing breaks */ }

  var note = document.querySelector('[data-scanned]');
  if (note) note.textContent = 'پسوولەکەت خوێندرایەوە. چاوەڕێ بکە...';

  // Submitted rather than shown filled in, because the person pointed a camera
  // at a piece of paper and expects an answer, not a form.
  form.submit();
})();
