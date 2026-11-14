// QR codes, for the citizen's own phone.
//
// The barcode in lib/barcode.mjs is for the municipality's scanner: it holds
// eleven digits and it is read by a machine on a desk. This is the other half.
// A citizen standing in the corridor with a receipt has a camera in their
// pocket and no scanner, and what they need to reach is a web address, which is
// far too long for Code 39.
//
// Hand-rolled, like the barcode? No, and the reasoning is the opposite one.
//
// Code 39 is a table of eleven rows and a check digit, and a wrong table is
// visible to anyone who looks at it, so writing it was safer than trusting a
// dependency. QR is Reed-Solomon over GF(256), eight masks scored against four
// penalty rules, format bits with their own BCH code, and a placement spiral.
// Every one of those can be subtly wrong in a way that still draws a
// convincing-looking square of black and white that no phone will read, and
// there is no way to see the fault by eye. The honest test is a real scanner,
// which cannot be run in a test suite.
//
// So: a pinned, zero-dependency library that has been read by phones for
// fifteen years, wrapped here so the rest of the application only ever asks for
// an SVG. Same reasoning as pdf-lib, written down for the same reason.

import qrcode from 'qrcode-generator';

/**
 * A QR code as inline SVG.
 *
 * @param {string} text        what the phone should open
 * @param {object} [o]
 * @param {number} [o.sizeMm]  the printed square, excluding the quiet zone
 * @param {number} [o.quiet]   quiet zone in modules. Four is the specified
 *                             minimum and the reason a QR printed hard against
 *                             a table border often will not scan.
 * @param {'L'|'M'|'Q'|'H'} [o.ec]  error correction. M survives a thumbprint and
 *                             a fold; H would survive a stamp across the corner
 *                             but makes the code denser, and these are printed
 *                             small on a till roll.
 */
export function qrSvg(text, { sizeMm = 26, quiet = 4, ec = 'M' } = {}) {
  const value = String(text ?? '');
  if (!value) return '';

  // Type 0 asks the library for the smallest version the data fits in, so a
  // short address stays a coarse grid that a cheap phone camera reads at arm's
  // length.
  const q = qrcode(0, ec);
  q.addData(value);
  q.make();

  const n = q.getModuleCount();
  const total = n + quiet * 2;

  // One path for every dark module rather than one rect each. A version 3 code
  // is about four hundred rects, and four hundred elements inside a printed
  // receipt is a page that takes a noticeable moment to lay out.
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizeMm}mm" height="${sizeMm}mm" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="QR">` +
    // The quiet zone has to be white, not transparent. Printed on tinted paper
    // or over a shaded table cell, a transparent margin is not a quiet zone.
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${d}" fill="#000"/></svg>`;
}

/**
 * The address printed on a receipt or a letter.
 *
 * The barcode goes in the path and the PIN goes in the fragment, deliberately.
 * A fragment is never sent to the server: it does not reach an access log, a
 * reverse proxy, or the referrer of anything the phone opens next. The page
 * reads it from the address bar and fills the box in. With scripting off the
 * citizen types the six digits, which is what the printed line under the code
 * says anyway.
 */
export function trackUrl(base, barcode, pin) {
  const root = String(base ?? '').replace(/\/+$/, '');
  return `${root}/t/${encodeURIComponent(barcode)}${pin ? `#${encodeURIComponent(pin)}` : ''}`;
}
