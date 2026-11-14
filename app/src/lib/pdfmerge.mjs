// Turning a pile of scanned pages into one document.
//
// A document scanner with a sheet feeder produces one file per page, or one PDF
// per pass, and a five-page application arrives as five files. Attaching them
// one at a time is how five pages become five attachments with no stated order,
// and then somebody prints page three on its own and does not know it is page
// three.
//
// So: several files in, one PDF out, in the order the pages were fed.
//
// This is the one place in the project that uses a third-party library for
// something the standard library could nearly do. Writing a PDF from images by
// hand is a few hundred lines and I would trust it. Merging existing PDFs by
// hand means parsing cross-reference tables, object streams and page trees
// written by a decade of different scanner firmware, and the failure mode is
// not a crash: it is a merged file that opens fine and has a page missing,
// discovered when somebody looks for it in 2031. That is worth a dependency.
//
// pdf-lib is pinned, pure JavaScript, and runs unchanged on the office server
// and on serverless hosting.

import { PDFDocument } from 'pdf-lib';

class MergeError extends Error {
  constructor(message, code) { super(message); this.code = code; this.expected = true; }
}

// A4 at 72 points to the inch. Pages larger than this are scaled down to fit, so
// a phone photograph does not produce a page half a metre across; pages smaller
// are left alone, because scaling a small scan up only makes it blurry.
const A4 = { width: 595.28, height: 841.89 };

// Enough for any municipal file, and low enough that a mistaken selection of
// four hundred photographs is refused rather than tying up the server.
const MAX_PAGES = 200;

/**
 * A standalone copy of the bytes, owning its own ArrayBuffer.
 *
 * Node allocates small Buffers out of a shared pool, so a Buffer's .buffer is
 * usually a large block with this file at some offset inside it. Code that
 * reaches for .buffer without also honouring .byteOffset reads from the start of
 * the pool instead, which is somebody else's data.
 *
 * That is not theoretical. Passing one pooled Buffer to two embed calls threw
 * "SOI not found in JPEG" on Node 18 and worked on Node 20, purely because the
 * pool happened to be laid out differently. Copying once here costs a few
 * hundred bytes per page and makes the result the same everywhere.
 */
function ownBytes(bytes) {
  if (!bytes || typeof bytes.length !== 'number') {
    throw new MergeError('پەڕگەیەکی بەتاڵ نێردرا.', 'empty');
  }
  return Uint8Array.from(bytes);
}

/** How many pages a single part contributes, without building anything. */
async function pageCountOf(part) {
  if (part.type !== 'pdf') return 1;
  const doc = await PDFDocument.load(ownBytes(part.bytes), { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Merge scanned pages into one PDF.
 *
 * @param {{bytes: Buffer, type: 'pdf'|'jpg'|'png', name?: string}[]} parts
 *        in page order. tif is not accepted: PDF has no way to carry it and
 *        converting it means decoding it, which is a different job.
 * @returns {Promise<Buffer>}
 */
export async function mergeToPdf(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new MergeError('هیچ پەڕەیەک نەنێردرا.', 'empty');
  }

  for (const p of parts) {
    if (!['pdf', 'jpg', 'png'].includes(p.type)) {
      throw new MergeError(`ئەم جۆرە پەڕگەیە ناتوانرێت تێکەڵ بکرێت (${p.type}). تەنها PDF، JPG، PNG.`, 'bad_type');
    }
  }

  // Counted before anything is built, so an oversized job is refused up front
  // rather than after ninety seconds of work.
  let total = 0;
  for (const p of parts) total += await pageCountOf(p);
  if (total > MAX_PAGES) {
    throw new MergeError(`زۆر پەڕەیە (${total}). زۆرترین ${MAX_PAGES} پەڕەیە.`, 'too_many_pages');
  }

  const out = await PDFDocument.create();

  for (const part of parts) {
    if (part.type === 'pdf') {
      // ignoreEncryption, because scanners routinely set an empty owner password
      // that protects nothing and would otherwise refuse the whole file.
      const src = await PDFDocument.load(ownBytes(part.bytes), { ignoreEncryption: true });
      const copied = await out.copyPages(src, src.getPageIndices());
      for (const page of copied) out.addPage(page);
      continue;
    }

    const image = part.type === 'jpg'
      ? await out.embedJpg(ownBytes(part.bytes))
      : await out.embedPng(ownBytes(part.bytes));

    // Fit inside A4 without cropping and without enlarging.
    const scale = Math.min(A4.width / image.width, A4.height / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;

    const page = out.addPage([A4.width, A4.height]);
    page.drawImage(image, {
      x: (A4.width - w) / 2,
      y: (A4.height - h) / 2,
      width: w,
      height: h,
    });
  }

  out.setProducer('docsys');
  out.setCreator('شارەوانی ڕانیە');
  // No creation date, deliberately. A merged scan is evidence about a letter and
  // the times that matter are the ones in the activity log, which cannot be
  // edited. A timestamp inside the file is another number to disagree with them.

  return Buffer.from(await out.save({ useObjectStreams: false }));
}

/** How many pages a merged result would have. Used to fill attachment.page_count. */
export async function countPages(bytes) {
  try {
    const doc = await PDFDocument.load(ownBytes(bytes), { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

export { MergeError, MAX_PAGES };
