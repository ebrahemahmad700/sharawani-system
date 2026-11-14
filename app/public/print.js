// Auto-print for the sheets that exist to be printed.
//
// This lives in a file rather than inline because the Content-Security-Policy is
// script-src 'self', which blocks inline scripts with no visible error: the page
// renders, the print dialogue never opens, and it looks like the browser is being
// awkward. The delay lets the fonts land first, so the sheet is not printed in a
// fallback face.
window.addEventListener('load', function () {
  setTimeout(function () { window.print(); }, 300);
});
