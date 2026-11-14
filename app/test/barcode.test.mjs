// A barcode that renders but does not scan looks exactly like one that does.
//
// So the test does not check that an SVG came back. It reads the bar widths out
// of the SVG that was produced and decodes them, with a table written out again
// from the Code 39 specification rather than imported from the encoder, so that
// a wrong row in the encoder's table cannot agree with itself.
//
//   node test/barcode.test.mjs
//
// No database. Exit code 1 on any failure.

import { code39Svg, normaliseBarcode, barcodeValid } from '../src/lib/barcode.mjs';

let pass = 0, fail = 0;
const failures = [];
const check = (name, got, want) => {
  if (got === want) { pass++; return; }
  fail++;
  failures.push(`${name}\n    expected: ${want}\n    got:      ${got}`);
};

// ---------------------------------------------------------------------------
// The table again, independently. Written as bar/space wide-narrow strings in
// the form the specification prints them: n narrow, w wide, nine elements
// beginning and ending on a bar.
// ---------------------------------------------------------------------------
const SPEC = {
  'nnnwwnwnn': '0',
  'wnnwnnnnw': '1',
  'nnwwnnnnw': '2',
  'wnwwnnnnn': '3',
  'nnnwwnnnw': '4',
  'wnnwwnnnn': '5',
  'nnwwwnnnn': '6',
  'nnnwnnwnw': '7',
  'wnnwnnwnn': '8',
  'nnwwnnwnn': '9',
  'nwnnwnwnn': '*',
};

// ---------------------------------------------------------------------------
// Decode: pull the bars out of the SVG, reconstruct the spaces from the gaps
// between them, and read the result back as characters.
// ---------------------------------------------------------------------------
function decode(svg, moduleMm) {
  const bars = [...svg.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)"/g)]
    .map(m => ({ x: Number(m[1]) / moduleMm, w: Number(m[2]) / moduleMm }));

  if (bars.length === 0) return null;

  // Rebuild the full element run: bar, then the space up to the next bar.
  const els = [];
  bars.forEach((b, i) => {
    els.push(Math.round(b.w));
    const next = bars[i + 1];
    if (next) els.push(Math.round(next.x - (b.x + b.w)));
  });

  // Characters are nine elements, separated by a single narrow space, so a
  // character plus its separator is ten. The last character has no separator.
  const chars = [];
  for (let i = 0; i < els.length; i += 10) {
    const nine = els.slice(i, i + 9);
    if (nine.length < 9) return null;
    const key = nine.map(w => (w === 2 ? 'w' : 'n')).join('');
    const ch = SPEC[key];
    if (!ch) return null;
    chars.push(ch);
    // The separator, when there is one, must be a narrow space.
    if (i + 9 < els.length && els[i + 9] !== 1) return null;
  }
  return chars.join('');
}

// ---------------------------------------------------------------------------

const MODULE = 0.33;

for (const value of ['20260000011', '20260000029', '01234567890', '99999999999', '00000000000']) {
  const svg = code39Svg(value, { moduleMm: MODULE });
  check(`decodes ${value}`, decode(svg, MODULE), `*${value}*`);
}

// Three wide elements per character is the whole invariant of "3 of 9". A row
// with two or four is a typo that would still produce a plausible picture.
for (const [key, ch] of Object.entries(SPEC)) {
  const wides = [...key].filter(c => c === 'w').length;
  check(`${ch} has three wide elements`, wides, 3);
  check(`${ch} has nine elements`, key.length, 9);
}

// Every character must be distinct, or two digits scan as each other.
check('all patterns distinct', new Set(Object.keys(SPEC)).size, 11);

// ---------------------------------------------------------------------------
// Quiet zone. A reader run in from the edge of the paper reads the edge as a
// bar unless there is clear space first.
// ---------------------------------------------------------------------------
{
  const svg = code39Svg('20260000011', { moduleMm: MODULE });
  // Rounded, because the SVG carries millimetres to three places and dividing
  // 3.300 by 0.33 lands just under ten rather than on it.
  const firstBarX = Math.round(Number(/<rect x="([\d.]+)" y="0"/.exec(svg)[1]) / MODULE);
  check('quiet zone is at least ten modules', firstBarX >= 10, true);
}

// ---------------------------------------------------------------------------
// What arrives from a reader or a keyboard
// ---------------------------------------------------------------------------
check('plain digits',        normaliseBarcode('20260000011'), '20260000011');
check('start/stop included', normaliseBarcode('*20260000011*'), '20260000011');
check('grouped by spaces',   normaliseBarcode('2026 000001 1'), '20260000011');
check('Arabic-Indic digits', normaliseBarcode('٢٠٢٦٠٠٠٠٠١١'), '20260000011');
check('Persian digits',      normaliseBarcode('۲۰۲۶۰۰۰۰۰۱۱'), '20260000011');
check('trailing newline',    normaliseBarcode('20260000011\n'), '20260000011');
check('too short',           normaliseBarcode('2026000001'), null);
check('too long',            normaliseBarcode('202600000111'), null);
check('letters',             normaliseBarcode('2026000001A'), null);
check('empty',               normaliseBarcode(''), null);
check('null',                normaliseBarcode(null), null);

// ---------------------------------------------------------------------------
// The check digit, which is the thing standing between a mis-scan and the
// wrong letter being opened.
// ---------------------------------------------------------------------------
check('valid barcode',   barcodeValid('20260000011'), true);
check('wrong check digit', barcodeValid('20260000012'), false);

// Luhn catches every single-digit error. Try them all.
{
  const good = '20260000011';
  let missed = 0;
  for (let i = 0; i < 10; i++) {
    for (let d = 0; d <= 9; d++) {
      if (String(d) === good[i]) continue;
      const bad = good.slice(0, i) + d + good.slice(i + 1);
      if (barcodeValid(bad)) missed++;
    }
  }
  check('no single-digit error survives', missed, 0);
}

// And every adjacent transposition, except the one pair Luhn is known not to
// catch. Stating the exception is the point: it is a property of the algorithm,
// not a defect in this code, and a future reader should not go looking for it.
{
  const good = '20260000011';
  const survivors = [];
  for (let i = 0; i < 9; i++) {
    if (good[i] === good[i + 1]) continue;
    const bad = good.slice(0, i) + good[i + 1] + good[i] + good.slice(i + 2);
    if (barcodeValid(bad)) survivors.push(`${good[i]}${good[i + 1]}`);
  }
  const onlyKnownPair = survivors.every(p => p === '09' || p === '90');
  check('transpositions caught except 09/90', onlyKnownPair, true);
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------
{
  let threw = false;
  try { code39Svg('20260ABC011'); } catch { threw = true; }
  check('letters are refused, not drawn wrong', threw, true);
}

// ---------------------------------------------------------------------------

console.log(`\nbarcode: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
}
process.exit(fail ? 1 : 0);
