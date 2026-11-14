// Reading what is written inside a scan.
//
// Most of what this municipality holds is a photograph of paper. Until now none
// of it was searchable: a letter could be found only by what a clerk had typed
// into the subject field, and if they had typed it differently, or not at all,
// the only way to find it was to open folders one at a time.
//
// This runs tesseract on the municipality's own machine. That is the whole
// design decision and it is not a performance one. Every hosted text-recognition
// service, without exception, requires uploading the image, which for this
// system means posting a scan of a citizen's land dispute to a company in
// another country. The rule is that municipal correspondence does not leave the
// building, so the reader comes to the building instead.
//
// Two things it is honest about.
//
//   Typed Kurdish and Arabic read well. Handwriting does not, and no amount of
//   configuration changes that. A low-confidence reading is stored and marked
//   'low' rather than presented as fact, and the screen says so.
//
//   Where the binaries are not installed — a serverless host, for instance —
//   this reports that it is unavailable and nothing else changes. Scans are
//   labelled as not read. That is the same arrangement as virus scanning, and
//   for the same reason: an honest "not done" beats a quiet "probably fine".

import { spawn } from 'child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// The Arabic SCRIPT model, not the Arabic LANGUAGE model, and the distinction is
// the whole reason this feature is usable in Kurdish.
//
// Tesseract has no Central Kurdish pack. Its Arabic language model has never
// seen ژ, پ, چ, گ, ڕ, ێ or ۆ, so it substitutes the nearest Arabic letter and
// ژمارە comes back as زماره. The script model was trained on the letterforms
// rather than the language and reads all of them. On the same test page the
// language model scored 64% and produced nonsense in the number line; the script
// model produced the line correctly.
//
// English second, for the Latin runs: references, plot numbers, company names.
const LANGS = process.env.OCR_LANGS || 'Arabic+eng';

// A scanned letter is one to four pages. Twelve is generous and stops one
// four-hundred-page drawing archive PDF from occupying the reader for an hour.
const MAX_PAGES = Number(process.env.OCR_MAX_PAGES || 12);

// Per page. A page that takes longer than this is a photograph of a wall.
const PAGE_TIMEOUT_MS = Number(process.env.OCR_PAGE_TIMEOUT_MS || 40_000);

// Below this the reading is kept and searchable but marked as unreliable, and
// the screen says the writing could not be read with confidence. Chosen from
// what tesseract returns on a clean typed page (85-95) against a handwritten
// one (20-50).
const LOW_CONFIDENCE = Number(process.env.OCR_LOW_CONFIDENCE || 62);

const READABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/tiff']);

let available = null;     // null = not yet asked

/** Run a command, capturing stdout. Never throws for a non-zero exit; returns it. */
function run(cmd, args, { timeout = PAGE_TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    let out = '', err = '', done = false;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { if (!done) { child.kill('SIGKILL'); } }, timeout);

    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { done = true; clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', code => { done = true; clearTimeout(timer); resolve({ code, out, err }); });
  });
}

/**
 * Whether this machine can read a scan at all.
 * Asked once and remembered, because it cannot change while the process runs.
 */
export async function isAvailable() {
  if (available !== null) return available;
  const t = await run('tesseract', ['--version'], { timeout: 5000 });
  const p = await run('pdftoppm', ['-v'], { timeout: 5000 });
  // pdftoppm prints its version to stderr and exits non-zero on some builds, so
  // the presence of the word is what counts rather than the exit code.
  available = {
    tesseract: t.code === 0,
    pdf: /pdftoppm/i.test(p.out + p.err),
    version: (t.out.split('\n')[0] || '').trim(),
  };
  available.ok = available.tesseract;
  return available;
}

export const canRead = mime => READABLE.has(String(mime ?? '').toLowerCase());

/**
 * Read one file.
 *
 * @param {Buffer} bytes
 * @param {string} mime
 * @returns {Promise<{status, text, pages, chars, confidence, engine, ms}>}
 */
export async function readScan(bytes, mime) {
  const started = Date.now();
  const have = await isAvailable();

  if (!have.ok) {
    return { status: 'unsupported', text: null, pages: 0, chars: 0, confidence: null,
             engine: null, ms: 0, reason: 'no reader installed on this host' };
  }
  if (!canRead(mime)) {
    return { status: 'unsupported', text: null, pages: 0, chars: 0, confidence: null,
             engine: have.version, ms: Date.now() - started, reason: `cannot read ${mime}` };
  }

  const dir = await mkdtemp(join(tmpdir(), 'docsys-ocr-'));
  try {
    let pageFiles = [];

    if (String(mime).toLowerCase() === 'application/pdf') {
      if (!have.pdf) {
        return { status: 'unsupported', text: null, pages: 0, chars: 0, confidence: null,
                 engine: have.version, ms: Date.now() - started, reason: 'no pdftoppm' };
      }
      const src = join(dir, 'in.pdf');
      await writeFile(src, bytes);
      // 200 dpi greyscale. Tesseract wants around 300 for small print, but a
      // municipal letter is 14 point and 200 halves the time for the same
      // result. -gray rather than colour because the colour of a stamp does not
      // help read the words under it.
      const conv = await run('pdftoppm', ['-r', '200', '-gray', '-png', '-f', '1',
                                          '-l', String(MAX_PAGES), src, join(dir, 'p')],
                             { timeout: PAGE_TIMEOUT_MS * 2 });
      if (conv.code !== 0) {
        return { status: 'failed', text: null, pages: 0, chars: 0, confidence: null,
                 engine: have.version, ms: Date.now() - started,
                 reason: `pdftoppm: ${conv.err.slice(0, 200)}` };
      }
      pageFiles = (await readdir(dir)).filter(f => f.endsWith('.png')).sort().map(f => join(dir, f));
    } else {
      const ext = mime.includes('png') ? 'png' : mime.includes('tiff') ? 'tif' : 'jpg';
      const src = join(dir, `in.${ext}`);
      await writeFile(src, bytes);
      pageFiles = [src];
    }

    const texts = [];
    const confidences = [];

    for (const page of pageFiles.slice(0, MAX_PAGES)) {
      // Two passes over the same page would double the time, so the confidence
      // comes from the TSV output and the text is rebuilt from it. One run, both
      // answers.
      const r = await run('tesseract', [page, 'stdout', '-l', LANGS, '--psm', '6', 'tsv']);
      if (r.code !== 0) continue;

      const lines = r.out.split('\n').slice(1);
      let pageText = '';
      let lastLine = null;
      for (const row of lines) {
        const f = row.split('\t');
        if (f.length < 12) continue;
        const conf = Number(f[10]);
        const word = f[11];
        if (!word || word.trim() === '') continue;
        if (conf >= 0) confidences.push(conf);
        const lineKey = `${f[2]}/${f[3]}/${f[4]}`;
        if (lastLine !== null && lineKey !== lastLine) pageText += '\n';
        else if (pageText) pageText += ' ';
        lastLine = lineKey;
        pageText += word;
      }
      texts.push(pageText.trim());
    }

    const text = texts.join('\n\n').trim();
    const confidence = confidences.length
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
      : null;

    const status = !text ? 'empty' : (confidence !== null && confidence < LOW_CONFIDENCE) ? 'low' : 'done';

    return {
      status,
      // A cap, because a two hundred page PDF of a land register would otherwise
      // put a megabyte of text in a row that exists to be searched, not read.
      text: text ? text.slice(0, 200_000) : null,
      pages: pageFiles.length,
      chars: text.length,
      confidence,
      engine: `${have.version} ${LANGS}`,
      ms: Date.now() - started,
    };
  } catch (err) {
    return { status: 'failed', text: null, pages: 0, chars: 0, confidence: null,
             engine: null, ms: Date.now() - started, reason: err.message };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export { LOW_CONFIDENCE, MAX_PAGES, READABLE };
