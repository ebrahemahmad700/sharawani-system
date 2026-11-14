// The QR codes, read back.
//
//   node test/qr.test.mjs
//
// A QR code is the one thing in this system that cannot be checked by looking
// at it. A wrong mask, a transposed matrix, an inverted module or a missing
// quiet zone all produce a square that looks exactly like a working QR code and
// that no phone will read. The failure is discovered by a citizen in a corridor,
// months later, and reported as "it does not work".
//
// So this decodes the SVG that lib/qr.mjs produced, with a decoder written here
// from the specification rather than from the encoder: the modules are read out
// of the path data, the format information is recovered and unmasked, the
// placement is walked, and the payload string is reassembled. If any of the
// things listed above were wrong, the string would not come back.
//
// What this does NOT check is the Reed-Solomon parity, because the decoder here
// reads the data codewords and stops. That part is the library's, is unchanged
// since 2009, and is the reason a library is used at all; see the header of
// lib/qr.mjs. The honest final test is a phone, and it is in the testing guide.

import { qrSvg, trackUrl } from '../src/lib/qr.mjs';

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

// --- reading the SVG back into modules --------------------------------------

/** The matrix inside the quiet zone, as booleans. */
function modulesFromSvg(svg, quiet = 4) {
  const view = /viewBox="0 0 (\d+) \1"/.exec(svg);
  if (!view) throw new Error('no square viewBox');
  const total = Number(view[1]);
  const n = total - quiet * 2;

  const grid = Array.from({ length: n }, () => new Array(n).fill(false));
  const d = /<path d="([^"]*)"/.exec(svg)?.[1] ?? '';
  // Each dark module is "M<x> <y>h1v1h-1z".
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const c = Number(m[1]) - quiet;
    const r = Number(m[2]) - quiet;
    if (r < 0 || c < 0 || r >= n || c >= n) throw new Error(`module outside the code at ${r},${c}`);
    grid[r][c] = true;
  }
  return grid;
}

// --- the specification bits -------------------------------------------------

const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

// Alignment pattern centres by version, from the table in the specification.
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Which modules carry function patterns rather than data. */
function functionMap(n, version) {
  const f = Array.from({ length: n }, () => new Array(n).fill(false));
  const mark = (r0, c0, h, w) => {
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) {
        if (r >= 0 && c >= 0 && r < n && c < n) f[r][c] = true;
      }
    }
  };

  // The three finders, with their separators and the format information beside
  // them. 9x9 at the top-left, 9x8 at the top-right, 8x9 at the bottom-left.
  mark(0, 0, 9, 9);
  mark(0, n - 8, 9, 8);
  mark(n - 8, 0, 8, 9);

  // Timing patterns.
  for (let i = 0; i < n; i++) { f[6][i] = true; f[i][6] = true; }

  // Alignment patterns, at every intersection except the three that would sit on
  // a finder.
  const centres = ALIGN[version] ?? [];
  for (const r of centres) {
    for (const c of centres) {
      const onFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8);
      if (!onFinder) mark(r - 2, c - 2, 5, 5);
    }
  }

  // The dark module, always just above the bottom-left format strip.
  f[n - 8][8] = true;

  // Version information, versions seven and up. Not reached by these codes but
  // left in so the decoder does not quietly misread a longer payload one day.
  if (version >= 7) {
    mark(0, n - 11, 6, 3);
    mark(n - 11, 0, 3, 6);
  }
  return f;
}

/**
 * The five data bits of the format information, recovered from both copies.
 *
 * The positions are written out rather than computed. They are not a formula in
 * the specification either, and the one time this was written as a loop it read
 * every bit in the opposite order, which still gave two copies that agreed with
 * each other and a value that was nonsense.
 */
const FORMAT_A = [           // bits 14 down to 0, around the top-left finder
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
  [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
];
const formatB = n => [       // the same fifteen, split across the other two corners
  [n - 1, 8], [n - 2, 8], [n - 3, 8], [n - 4, 8], [n - 5, 8], [n - 6, 8], [n - 7, 8],
  [8, n - 8], [8, n - 7], [8, n - 6], [8, n - 5], [8, n - 4], [8, n - 3], [8, n - 2], [8, n - 1],
];

function readFormat(grid, n) {
  const readAt = positions => positions.reduce((v, [r, c]) => (v << 1) | (grid[r][c] ? 1 : 0), 0);
  const a = readAt(FORMAT_A);
  const b = readAt(formatB(n));
  // The two copies must agree, or the code is damaged; here that would mean the
  // renderer put something in the wrong place.
  const fmt = (a ^ 0x5412) >>> 0;
  return { fmt, agree: a === b, ec: (fmt >> 13) & 3, mask: (fmt >> 10) & 7 };
}

/** Walk the data area and return the bitstream. */
function readBits(grid, n, version, maskId) {
  const fn = functionMap(n, version);
  const mask = MASKS[maskId];
  const bits = [];
  let upward = true;

  for (let right = n - 1; right >= 1; right -= 2) {
    // Column six is the vertical timing pattern and is skipped entirely, which
    // shifts every column to its left by one.
    if (right === 6) right = 5;
    for (let step = 0; step < n; step++) {
      const r = upward ? n - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (fn[r][c]) continue;
        const dark = grid[r][c];
        // The mask is applied to the data modules only, and unmasking is the
        // same operation as masking.
        bits.push((dark !== mask(r, c)) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  return bits;
}

// How the data codewords are split into blocks, at error correction level M.
// From the block table in the specification: [[how many blocks, data codewords
// in each], ...]. Anything above version four is here only so that a longer
// address one day does not silently stop being checked.
const BLOCKS_M = {
  1: [[1, 16]], 2: [[1, 28]], 3: [[1, 44]], 4: [[2, 32]], 5: [[2, 43]],
  6: [[4, 27]], 7: [[4, 31]], 8: [[2, 38], [2, 39]], 9: [[3, 36], [2, 37]],
  10: [[4, 43], [1, 44]],
};

/**
 * Undo the interleaving.
 *
 * From version four upward the data is split into blocks and the codewords are
 * written round-robin: the first byte of block one, the first byte of block two,
 * the second byte of block one, and so on. Reading the stream straight through
 * gives text that is very nearly right, which is the worst kind of wrong: the
 * first attempt at this test produced "kcxud}du`~s" for "https://docsys" and
 * looked like a masking bug for some time.
 */
function deinterleave(codewords, version) {
  const shape = BLOCKS_M[version];
  if (!shape) throw new Error(`no block table for version ${version}`);

  const sizes = [];
  for (const [count, per] of shape) for (let i = 0; i < count; i++) sizes.push(per);
  const blocks = sizes.map(() => []);

  let at = 0;
  for (let i = 0; i < Math.max(...sizes); i++) {
    for (let b = 0; b < sizes.length; b++) {
      if (i < sizes[b]) blocks[b].push(codewords[at++]);
    }
  }
  return blocks.flat();
}

/** The byte-mode payload, if that is what this code holds. */
function decode(svg, quiet = 4) {
  const grid = modulesFromSvg(svg, quiet);
  const n = grid.length;
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1) throw new Error(`odd module count ${n}`);

  const format = readFormat(grid, n);
  const bits = readBits(grid, n, version, format.mask);

  // Into codewords, then out of their interleaved order.
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  }
  const data = deinterleave(codewords, version);

  // The header sits across the first byte and a half.
  const mode = data[0] >> 4;
  if (mode !== 0b0100) throw new Error(`mode ${mode.toString(2)} is not byte mode`);
  const length = ((data[0] & 0x0f) << 4) | (data[1] >> 4);

  const bytes = [];
  for (let i = 0; i < length; i++) {
    bytes.push((((data[1 + i] & 0x0f) << 4) | (data[2 + i] >> 4)) & 0xff);
  }

  return { version, n, format, text: Buffer.from(bytes).toString('utf8') };
}

// --- the checks -------------------------------------------------------------

console.log('--- a code reads back as what went in ---');

const cases = [
  'https://sharawani01.vercel.app/t/20260000253',
  'https://docsys.rania.gov.krd/documents/4498',
  'https://a.b/t/1',
  'https://sharawani01.vercel.app/manifests/12',
];

for (const text of cases) {
  let got = null, err = null;
  try { got = decode(qrSvg(text)); } catch (e) { err = e; }
  check(`"${text.slice(0, 46)}" survives the round trip`,
    got?.text === text, err ? err.message : `got "${got?.text}"`);
  if (got) {
    check('   both copies of the format information agree', got.format.agree);
    check('   the error correction level is M, as asked for', got.format.ec === 0,
      `bits ${got.format.ec.toString(2)}`);
  }
}

console.log('\n--- the things that make a QR unreadable ---');

const svg = qrSvg('https://sharawani01.vercel.app/t/20260000253');

// Quiet zone. Four modules is the specified minimum and the commonest reason a
// printed code fails: hard against a table border, a phone cannot find it.
const view = Number(/viewBox="0 0 (\d+) /.exec(svg)[1]);
const grid = modulesFromSvg(svg);
check('there is a four module quiet zone on every side', view === grid.length + 8,
  `${view} across for a ${grid.length} code`);
check('the quiet zone is painted white rather than left transparent',
  /<rect width="\d+" height="\d+" fill="#fff"\/>/.test(svg));
check('the modules are black', /fill="#000"/.test(svg));

// The three finder patterns. If these are wrong nothing else matters, because a
// scanner never gets as far as the data.
const finder = (r0, c0) => {
  const want = [
    [1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1],
    [1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1],
    [1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1],
  ];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      if (grid[r0 + r][c0 + c] !== Boolean(want[r][c])) return false;
    }
  }
  return true;
};
const n = grid.length;
check('the top-left finder pattern is correct', finder(0, 0));
check('the top-right finder pattern is correct', finder(0, n - 7));
check('the bottom-left finder pattern is correct', finder(n - 7, 0));

// The timing patterns are what a scanner counts modules with.
let timingOk = true;
for (let i = 8; i < n - 8; i++) {
  if (grid[6][i] !== (i % 2 === 0)) timingOk = false;
  if (grid[i][6] !== (i % 2 === 0)) timingOk = false;
}
check('the timing patterns alternate correctly', timingOk);

check('the dark module is present', grid[n - 8][8] === true);

console.log('\n--- the address on the receipt ---');

const url = trackUrl('https://sharawani01.vercel.app/', '20260000253', '481902');
check('the barcode goes in the path', url.includes('/t/20260000253'));
check('the PIN goes in the fragment, which never reaches a server',
  url.endsWith('#481902') && url.indexOf('481902') > url.indexOf('#'));
check('there is no PIN anywhere in the part the server sees',
  !url.split('#')[0].includes('481902'));
check('a trailing slash on the base does not become a double slash',
  !url.replace('https://', '').includes('//'));
check('the same address round trips through a code', decode(qrSvg(url)).text === url);

const noPin = trackUrl('https://x.test', '20260000253', null);
check('a receipt with no PIN still gets a usable address', noPin === 'https://x.test/t/20260000253');

console.log('\n--- refusals ---');
check('an empty string makes no code at all', qrSvg('') === '');

console.log(failures ? `\n${failures} FAILED` : '\nthe QR codes decode back to what went into them');
process.exit(failures ? 1 : 0);
