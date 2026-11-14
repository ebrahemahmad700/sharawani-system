// Drawing a barcode that a real scanner will read.
//
// Code 39, not Code 128, and the reason is not technical elegance. Code 128 is
// denser and would make a narrower bar block. It also needs a 107-entry pattern
// table and a weighted checksum, and a single wrong digit anywhere in either
// produces a barcode that looks perfectly convincing on screen, prints, goes out
// on five hundred receipts and reads as nothing at all. Code 39 is nine elements
// per character, each character independent of its neighbours, no checksum, and
// the whole table fits on a screen where it can be checked by eye.
//
// The check digit we do have is in the number itself (migration 0290), which is
// the right place for it: it survives the barcode being read aloud, typed by
// hand, or photographed and retyped from a phone.
//
// The output is an inline SVG. Not an image file, because a file means a
// request, a route, a cache header and a way for the barcode on a printed page
// to be a broken-image icon. Inline SVG prints at the printer's resolution
// rather than the screen's, which is what makes it scannable off paper at all.

// Nine elements per character, alternating bar, space, bar, ... starting and
// ending on a bar. 1 is a narrow element, 2 a wide one; every character has
// exactly three wide elements, which is where "3 of 9" comes from.
const PATTERNS = {
  '0': [1, 1, 1, 2, 2, 1, 2, 1, 1],
  '1': [2, 1, 1, 2, 1, 1, 1, 1, 2],
  '2': [1, 1, 2, 2, 1, 1, 1, 1, 2],
  '3': [2, 1, 2, 2, 1, 1, 1, 1, 1],
  '4': [1, 1, 1, 2, 2, 1, 1, 1, 2],
  '5': [2, 1, 1, 2, 2, 1, 1, 1, 1],
  '6': [1, 1, 2, 2, 2, 1, 1, 1, 1],
  '7': [1, 1, 1, 2, 1, 1, 2, 1, 2],
  '8': [2, 1, 1, 2, 1, 1, 2, 1, 1],
  '9': [1, 1, 2, 2, 1, 1, 2, 1, 1],
  '*': [1, 2, 1, 1, 2, 1, 2, 1, 1],   // start and stop, never part of the data
};

/**
 * The bar and space widths for a whole symbol, start and stop included.
 * Returns an array of {width, isBar} in printing order.
 */
function elements(text) {
  const chars = ['*', ...text.split(''), '*'];
  const out = [];

  chars.forEach((ch, i) => {
    const pattern = PATTERNS[ch];
    if (!pattern) throw new Error(`Code 39 cannot encode ${JSON.stringify(ch)}`);
    pattern.forEach((w, j) => out.push({ width: w, isBar: j % 2 === 0 }));
    // Characters are separated by one narrow space. Not after the last one.
    if (i < chars.length - 1) out.push({ width: 1, isBar: false });
  });

  return out;
}

/**
 * An SVG barcode for a string of digits.
 *
 * @param {string} text            digits only; anything else throws
 * @param {object} [opts]
 * @param {number} [opts.moduleMm] width of one narrow element, in millimetres.
 *                                 0.33 is about the narrowest a domestic laser
 *                                 printer reproduces reliably.
 * @param {number} [opts.heightMm] bar height. Under about 10mm a hand-held
 *                                 reader has to be aimed rather than waved.
 * @param {boolean} [opts.showText] print the digits under the bars, so the
 *                                 number is still usable when the print is poor
 *                                 or the scanner is flat.
 * @returns {string} an <svg> element, already escaped, safe to embed
 */
export function code39Svg(text, { moduleMm = 0.33, heightMm = 12, showText = true } = {}) {
  const value = String(text ?? '').trim();
  if (!/^\d+$/.test(value)) throw new Error('code39Svg expects digits only');

  const els = elements(value);
  const modules = els.reduce((n, e) => n + e.width, 0);

  // A quiet zone either side. Without it a reader run in from the edge of the
  // paper sees the paper edge as a bar and refuses the whole symbol.
  const quiet = 10;
  const totalModules = modules + quiet * 2;

  const textMm = showText ? 3.6 : 0;
  const widthMm = totalModules * moduleMm;
  const totalHeightMm = heightMm + textMm;

  const rects = [];
  let x = quiet;
  for (const e of els) {
    if (e.isBar) {
      rects.push(`<rect x="${(x * moduleMm).toFixed(3)}" y="0" `
        + `width="${(e.width * moduleMm).toFixed(3)}" height="${heightMm}" />`);
    }
    x += e.width;
  }

  // shape-rendering: crispEdges stops the renderer antialiasing bar edges into
  // grey, which is the difference between a scan and three scans.
  const label = showText
    ? `<text x="${(widthMm / 2).toFixed(2)}" y="${(heightMm + 3).toFixed(2)}" `
      + `text-anchor="middle" font-family="monospace" font-size="3.1" `
      + `letter-spacing="0.5" fill="#000">${value}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" `
    + `width="${widthMm.toFixed(2)}mm" height="${totalHeightMm.toFixed(2)}mm" `
    + `viewBox="0 0 ${widthMm.toFixed(2)} ${totalHeightMm.toFixed(2)}" `
    + `shape-rendering="crispEdges" role="img" aria-label="${value}">`
    + `<rect width="100%" height="100%" fill="#fff"/>`
    + `<g fill="#000">${rects.join('')}</g>${label}</svg>`;
}

/**
 * The barcode a person typed or a reader emitted, reduced to what the database
 * stores, or null if it cannot be one.
 *
 * Readers are configured differently from one another and people type what they
 * see, so what arrives may carry the Code 39 start and stop characters, spaces
 * grouping the digits, or Arabic-Indic digits from a phone keyboard. All three
 * are the same barcode.
 */
export function normaliseBarcode(input) {
  if (input === null || input === undefined) return null;

  const ascii = String(input)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))   // ٠-٩
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))   // ۰-۹ (Persian forms)
    .replace(/[\s*\-/]/g, '');

  return /^\d{11}$/.test(ascii) ? ascii : null;
}

/**
 * The Luhn check the database applies, repeated here so a mistyped barcode is
 * refused by the screen before it costs a query.
 */
export function barcodeValid(barcode) {
  if (!/^\d{11}$/.test(barcode)) return false;
  const payload = barcode.slice(0, 10);
  let total = 0;
  let double = true;                       // rightmost payload digit doubles
  for (let i = payload.length - 1; i >= 0; i--) {
    let d = Number(payload[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    total += d;
    double = !double;
  }
  return (10 - (total % 10)) % 10 === Number(barcode[10]);
}
