// Which letter is this scan?
//
// Asked for from the demo as "scanner devices to detect the document". A scanner
// hands over a picture of paper and nothing else; somebody still has to say which
// letter it belongs to. Most of the paper that goes back through a scanner in this
// building already carries the answer, printed on it by this system: the barcode
// under the bars on the folder cover and the receipt, and the letter number in the
// corner of every printed reply.
//
// So the reader reads the page, and anything that looks like one of those two is
// looked up. What comes back is a suggestion with the letter's number and subject
// beside it, never an automatic attachment. A number misread by one digit is a
// different letter, and filing a scan onto the wrong letter is exactly the
// mistake this building cannot afford.
//
// The lookup runs as the person asking, so a scan can only ever suggest a letter
// they were allowed to see anyway.

import { readScan, isAvailable, canRead } from './ocr.mjs';
import { foldDigits } from './ku.mjs';
import { barcodeValid } from './barcode.mjs';
import { withActor } from './db.mjs';

/**
 * The barcodes and letter numbers written in a piece of text.
 * Exported for the tests, which feed it what the reader actually produces.
 */
export function referencesIn(text) {
  const t = foldDigits(String(text ?? '')).replace(/ھ/g, 'ه');

  // Eleven digits with a valid check digit. The reader sometimes puts a space in
  // a long run of digits, so short gaps are closed first.
  const barcodes = new Set();
  for (const m of t.matchAll(/(?<!\d)(\d(?:[ ]?\d){10})(?!\d)/g)) {
    const d = m[1].replace(/ /g, '');
    if (barcodeValid(d)) barcodes.add(d);
  }

  // ه/2026/415 or د/2026/187, and the same thing read right to left, which is how
  // a reader working through a Kurdish line often returns it: 415/2026/ه. The
  // letter is required, because without it every date on the page is a number.
  const numbers = new Map();
  const add = (kind, year, seq) => {
    const y = Number(year), s = Number(seq);
    if (y >= 2000 && y <= 2100 && s >= 1) numbers.set(`${kind}/${y}/${s}`, { kind, year: y, seq: s });
  };
  for (const m of t.matchAll(/([هد])\s*\/\s*(\d{4})\s*\/\s*(\d{1,6})(?!\d)/g)) add(m[1], m[2], m[3]);
  for (const m of t.matchAll(/(?<!\d)(\d{1,6})\s*\/\s*(\d{4})\s*\/\s*([هد])/g)) add(m[3], m[2], m[1]);

  return { barcodes: [...barcodes], numbers: [...numbers.values()] };
}

/** Letters visible to this person that carry any of these references. */
export async function lettersFor(q, { barcodes = [], numbers = [] }) {
  if (!barcodes.length && !numbers.length) return [];
  const inc = numbers.filter(n => n.kind === 'ه');
  const out = numbers.filter(n => n.kind === 'د');
  const { rows } = await q(`
    SELECT d.id, d.incoming_no, d.outgoing_no, d.subject, d.status, d.barcode
      FROM document d
     WHERE d.barcode = ANY ($1::text[])
        OR EXISTS (SELECT 1 FROM unnest($2::int[], $3::int[]) AS x(y, s)
                    WHERE d.incoming_year = x.y AND d.incoming_seq = x.s)
        OR EXISTS (SELECT 1 FROM unnest($4::int[], $5::int[]) AS x(y, s)
                    WHERE d.outgoing_year = x.y AND d.outgoing_seq = x.s)
     ORDER BY d.id DESC
     LIMIT 5`,
    [barcodes, inc.map(n => n.year), inc.map(n => n.seq), out.map(n => n.year), out.map(n => n.seq)]);
  return rows;
}

/**
 * Read a scan and suggest the letters it belongs to.
 *
 * The reading happens outside any database transaction, because it takes seconds
 * and a transaction held open that long is a connection nobody else can use.
 *
 * @returns {Promise<{available: boolean, matches: object[], status?: string}>}
 */
export async function detectLetters(user, bytes, mime) {
  const have = await isAvailable();
  if (!have.ok || !canRead(mime)) return { available: false, matches: [] };
  const result = await readScan(bytes, mime);
  const refs = referencesIn(result.text);
  const matches = await withActor(user, q => lettersFor(q, refs));
  return { available: true, status: result.status, matches };
}
