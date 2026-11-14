// The application icon, drawn in code.
//
//   node scripts/make-icons.mjs
//
// An installed application needs PNG icons, and PNGs are the one kind of file
// that cannot be reviewed in a diff: a binary lands in the repository and from
// then on nobody can tell what changed in it or whether it matches the palette
// the rest of the system uses. So the icon is drawn here from the same three
// colours app.css declares, and the PNGs are output.
//
// The encoder is fifty lines because a PNG with no interlacing and no palette is
// a header, one zlib stream of rows each prefixed with a zero byte, and a CRC on
// each chunk. zlib is in the standard library. Bringing in an image library to
// draw a circle would be the tail wagging the dog.
//
// Anti-aliasing is by supersampling: each pixel is sixteen samples of an
// analytic shape. At 192 pixels the difference between that and a hard edge is
// the difference between an icon that looks made and one that looks generated.

import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'icons');

// The palette, from :root in app.css. Keep them equal.
const GREEN = [0x0e, 0x3a, 0x28];
const GOLD  = [0xc9, 0x9a, 0x2e];
const DARK  = [0x0b, 0x2c, 0x1e];

// --- a canvas ---------------------------------------------------------------

function canvas(size) {
  const px = new Uint8Array(size * size * 4);      // RGBA, transparent
  const S = 4;                                      // samples per axis

  /** Paint `color` wherever `inside(x, y)` is true, with soft edges. */
  function paint(color, inside, alpha = 1) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let hits = 0;
        for (let sy = 0; sy < S; sy++) {
          for (let sx = 0; sx < S; sx++) {
            if (inside(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) hits++;
          }
        }
        if (!hits) continue;
        const a = (hits / (S * S)) * alpha;
        const i = (y * size + x) * 4;
        // Straight "over" compositing onto whatever is already there.
        const dstA = px[i + 3] / 255;
        const outA = a + dstA * (1 - a);
        for (let c = 0; c < 3; c++) {
          px[i + c] = Math.round((color[c] * a + px[i + c] * dstA * (1 - a)) / (outA || 1));
        }
        px[i + 3] = Math.round(outA * 255);
      }
    }
  }

  return { px, size, paint };
}

const roundRect = (x, y, w, h, r) => (px, py) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
};

const disc = (cx, cy, r) => (px, py) => {
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
};

/**
 * The mark: a gold seal with a letter on it.
 *
 * @param {number} size
 * @param {boolean} bleed  true for a maskable icon, where the platform crops a
 *                         circle out of the middle and any rounded corner of
 *                         ours would be cropped into a strange shape.
 */
function drawIcon(size, bleed) {
  const c = canvas(size);
  const u = size / 100;                              // one percent, for readability

  c.paint(GREEN, bleed ? () => true : roundRect(0, 0, size, size, 22 * u));

  // The seal. Smaller on a maskable icon, so that the whole mark survives the
  // circular crop every launcher applies differently.
  const r = (bleed ? 30 : 34) * u;
  c.paint(GOLD, disc(50 * u, 50 * u, r));

  // The letter on the seal: a page with two lines of writing.
  const w = r * 0.86, h = r * 1.06;
  const x = 50 * u - w / 2, y = 50 * u - h / 2;
  c.paint(DARK, roundRect(x, y, w, h, 3 * u));

  const lineH = Math.max(1.6 * u, 2);
  const inset = w * 0.2;
  for (const t of [0.3, 0.52]) {
    c.paint(GOLD, roundRect(x + inset, y + h * t, w - inset * 2, lineH, lineH / 2));
  }
  // A short third line, so the block reads as text rather than as a barcode.
  c.paint(GOLD, roundRect(x + inset, y + h * 0.74, (w - inset * 2) * 0.55, lineH, lineH / 2));

  return c;
}

// --- PNG --------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png({ px, size }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // colour type: RGBA
  // 10, 11, 12 stay zero: deflate, adaptive filtering, no interlace.

  // Every row is prefixed with its filter type. Zero — "none" — throughout:
  // these are flat colours, so filtering would buy a few hundred bytes and cost
  // the ability to read this function.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- the same mark as SVG ---------------------------------------------------
// For the browser tab, where a vector stays sharp at whatever size the browser
// decides it wants this week.

function svg() {
  const g = `#${GREEN.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  const o = `#${GOLD.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  const d = `#${DARK.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="شارەوانی ڕانیە">
  <rect width="100" height="100" rx="22" fill="${g}"/>
  <circle cx="50" cy="50" r="34" fill="${o}"/>
  <rect x="35.4" y="31.9" width="29.2" height="36.1" rx="3" fill="${d}"/>
  <g fill="${o}">
    <rect x="41.3" y="42.7" width="17.4" height="1.8" rx=".9"/>
    <rect x="41.3" y="50.7" width="17.4" height="1.8" rx=".9"/>
    <rect x="41.3" y="58.6" width="9.6" height="1.8" rx=".9"/>
  </g>
</svg>
`;
}

// --- write ------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const files = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  // Apple applies its own rounding and does not understand transparency here,
  // so this one bleeds to the edges.
  ['icon-180.png', 180, true],
];

for (const [name, size, bleed] of files) {
  const bytes = png(drawIcon(size, bleed));
  writeFileSync(join(OUT, name), bytes);
  console.log(`${name}  ${size}x${size}  ${bytes.length} bytes`);
}

writeFileSync(join(OUT, 'icon.svg'), svg(), 'utf8');
console.log('icon.svg');
