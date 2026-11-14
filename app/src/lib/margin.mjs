// Laying a handwritten instruction onto a letter (migration 0550).
//
// The browser does the drawing and the lettering: it renders the scan's page,
// takes the pen, and draws the stamp with the writer's name and the time,
// because the browser is the only thing in this stack that shapes Kurdish text
// (the same reason every print sheet is printed by the browser). What arrives
// here is one PNG the exact shape of the page as it was shown, transparent where
// there is no ink.
//
// This file puts that PNG over the page in the PDF, the whole letter kept and
// only that page written on, so the result reads like the paper: the letter,
// with the mayor's pen on it. The stamp's name and time are what the page was
// given by the server; the authoritative who and when are the margin_note row and
// the activity log, written in the same transaction.

import { PDFDocument, degrees } from 'pdf-lib';

export class MarginError extends Error {
  constructor(message, code) { super(message); this.code = code; this.expected = true; }
}

const A4 = { width: 595.28, height: 841.89 };
export const MAX_INK_PIXELS = 4096;

/** A standalone copy of the bytes; see ownBytes in lib/pdfmerge.mjs for why. */
const own = bytes => Uint8Array.from(bytes);

/**
 * @param {object} o
 * @param {Buffer} o.ink            the PNG from the page, transparent where there is no ink
 * @param {Buffer|null} o.source    the scan, or null for a blank sheet
 * @param {'pdf'|'png'|'jpg'|null} o.sourceType
 * @param {number} o.pageNo         1-based, for a PDF
 * @returns {Promise<{bytes: Buffer, pages: number}>}
 */
export async function inkOntoLetter({ ink, source, sourceType, pageNo = 1 }) {
  let out;
  let image;

  if (sourceType === 'pdf') {
    try {
      out = await PDFDocument.load(own(source), { ignoreEncryption: true });
    } catch {
      throw new MarginError('سکانی کتابەکە نەخوێندرایەوە.', 'bad_source');
    }
    const count = out.getPageCount();
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > count) {
      throw new MarginError('ئەو پەڕەیە لەم سکانەدا نییە.', 'bad_page');
    }
    image = await embedInk(out, ink);
    const page = out.getPage(pageNo - 1);
    // What PDF.js drew: the crop box, turned by the page's rotation. The ink is
    // upright on that; in the page's own coordinates it has to be turned back.
    const box = page.getCropBox();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const { x, y, width: w, height: h } = box;
    const place = {
      0:   { x,        y,        width: w, height: h, rotate: degrees(0) },
      90:  { x: x + w, y,        width: h, height: w, rotate: degrees(90) },
      180: { x: x + w, y: y + h, width: w, height: h, rotate: degrees(180) },
      270: { x,        y: y + h, width: h, height: w, rotate: degrees(270) },
    }[rotation] ?? { x, y, width: w, height: h, rotate: degrees(0) };
    page.drawImage(image, place);
  } else if (sourceType === 'png' || sourceType === 'jpg') {
    out = await PDFDocument.create();
    let scan;
    try {
      scan = sourceType === 'jpg' ? await out.embedJpg(own(source)) : await out.embedPng(own(source));
    } catch {
      throw new MarginError('وێنەی کتابەکە نەخوێندرایەوە.', 'bad_source');
    }
    // A page the shape of the photograph, A4 wide, so ink and picture line up exactly.
    const width = A4.width;
    const height = A4.width * (scan.height / scan.width);
    const page = out.addPage([width, height]);
    page.drawImage(scan, { x: 0, y: 0, width, height });
    image = await embedInk(out, ink);
    page.drawImage(image, { x: 0, y: 0, width, height });
  } else {
    // No scan on the letter: the browser drew the letter's heading on white paper.
    out = await PDFDocument.create();
    image = await embedInk(out, ink);
    const height = A4.width * (image.height / image.width);
    const page = out.addPage([A4.width, height]);
    page.drawImage(image, { x: 0, y: 0, width: A4.width, height });
  }

  out.setProducer('docsys');
  out.setCreator('شارەوانی ڕانیە');
  const bytes = Buffer.from(await out.save());
  return { bytes, pages: out.getPageCount() };
}

async function embedInk(doc, ink) {
  if (!ink || ink[0] !== 0x89 || ink.slice(1, 4).toString('latin1') !== 'PNG') {
    throw new MarginError('نووسینەکە نەگەیشت. دووبارە هەوڵبدەوە.', 'bad_ink');
  }
  let image;
  try {
    image = await doc.embedPng(own(ink));
  } catch {
    throw new MarginError('نووسینەکە نەخوێندرایەوە. دووبارە هەوڵبدەوە.', 'bad_ink');
  }
  if (image.width > MAX_INK_PIXELS || image.height > MAX_INK_PIXELS || image.width < 50 || image.height < 50) {
    throw new MarginError('قەبارەی نووسینەکە دروست نییە.', 'bad_ink');
  }
  return image;
}
