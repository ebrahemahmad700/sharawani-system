// File intake.
//
// Every uploaded file passes through here, and the rules are the same for a
// scanned letter and a plot drawing:
//
//   - the type is decided by looking at the bytes, not by trusting the extension
//     or the browser's content type
//   - there is a hard size cap, enforced while streaming, so a huge upload is
//     cut off rather than filling the disk first
//   - the stored path is a uuid under files/<area>/<year>/<month>/. It is never
//     derived from the name the user supplied, so a name like ../../etc/passwd
//     is just a string in a database column
//   - the SHA-256 is computed as the bytes stream past, so the record can prove
//     later that the file on disk is the one that was uploaded
//
// Virus scanning is done by ClamAV on the server, per the deployment runbook.
// The hook for it is scanFile(); until ClamAV is installed it returns 'skipped'
// and the log records that, so nobody can later believe a file was scanned when
// it was not.

import Busboy from 'busboy';
import { createHash, randomUUID } from 'crypto';
import { prepare, openWrite, readStream, exists, remove, absolutePath, BACKEND } from './storage.mjs';

// The whole whitelist. Anything not here is refused before a byte is written.
// sniff() looks at the first bytes; DXF is a text format so it is checked by
// content rather than by a fixed signature.
const TYPES = {
  pdf: { ext: 'pdf', sniff: b => b.slice(0, 4).toString('latin1') === '%PDF' },
  dwg: { ext: 'dwg', sniff: b => b.slice(0, 4).toString('latin1') === 'AC10' },
  dxf: { ext: 'dxf', sniff: b => /^\s*0\r?\n\s*SECTION/.test(b.slice(0, 64).toString('latin1')) },
  png: { ext: 'png', sniff: b => b[0] === 0x89 && b.slice(1, 4).toString('latin1') === 'PNG' },
  jpg: { ext: 'jpg', sniff: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  tif: { ext: 'tif', sniff: b => ['II*\0', 'MM\0*'].includes(b.slice(0, 4).toString('latin1')) },
};
const EXT_ALIASES = { jpeg: 'jpg', tiff: 'tif' };

// The content type each stored kind is served with. One table, so the letter
// attachments, the tray and the archive cannot disagree about what a DWG is.
export const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', tif: 'image/tiff',
  dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf',
};

// What a browser can show on its own. Everything else is sent as a download,
// because asking a browser to display a DWG in a tab shows a blank page and
// looks like the file is broken.
export const SHOWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg']);

export const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 60 * 1024 * 1024);   // 60 MiB; a DWG can be big

class UploadError extends Error {
  constructor(message, code) { super(message); this.code = code; this.expected = true; }
}

/** What the extension claims. Only used to decide which sniff to run. */
function claimedType(originalName) {
  const ext = String(originalName ?? '').split('.').pop()?.toLowerCase() ?? '';
  return EXT_ALIASES[ext] ?? ext;
}

function detectType(claimed, head) {
  // The bytes decide. If the extension says DWG but the bytes say PDF, it is a
  // PDF that somebody renamed, and it is stored as what it is.
  for (const [key, t] of Object.entries(TYPES)) if (t.sniff(head)) return key;
  return null;
}

/**
 * Parse a multipart request, saving every file field to disk under `area`.
 *
 * Resolves to { fields, files, fileList }. files is keyed by field name and
 * holds the last file seen under each; fileList is every file in arrival order,
 * which is what a multi-file input needs. Each entry is
 * { field, originalName, type, storedPath, sizeBytes, sha256 }. Files that
 * fail the whitelist or the size cap cause the whole request to be rejected and
 * every file already written to be removed, so a partial upload never leaves
 * orphans on disk.
 *
 * @param {import('http').IncomingMessage} req
 * @param {{area: 'archive'|'attachments', allow?: string[], maxFiles?: number}} o
 */
export async function receiveUpload(req, { area, allow = Object.keys(TYPES), maxFiles = 2, actor = null }) {
  const now = new Date();
  const monthDir = `${area}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Done once, up front, so nothing inside the stream handlers has to wait.
  // A no-op unless the backend needs a directory to exist.
  await prepare(monthDir);

  return new Promise((resolve, reject) => {
    const fields = {};
    const files = {};
    // files is keyed by field name, which loses everything but the last file when
    // several arrive under one name, as a <input multiple> sends them. fileList
    // keeps all of them, in the order the browser sent them, which for a scanner
    // feeder is page order and therefore not something to sort away.
    const fileList = [];
    const written = [];
    let pending = 0;
    let finished = false;
    let failed = null;

    const fail = err => {
      if (failed) return;
      failed = err;
      // What was typed before the refusal, so a form can come back filled in
      // rather than empty (records test, 13 September).
      if (err && typeof err === 'object') err.fields = fields;
      // One refused file rolls back every file already stored in this request, so
      // a partial upload never leaves orphans behind.
      Promise.all(written.map(p => remove(p))).then(() => reject(err));
    };
    // Files finish writing in whatever order their bytes happen to settle, so a
    // later page could finish first. Each is numbered as it starts arriving and
    // the list is put back in that order: "merge into one PDF" was shuffling
    // pages 4 runs in 6 (records test, 13 September).
    let arrived = 0;
    const maybeDone = () => {
      if (finished && pending === 0 && !failed) {
        fileList.sort((a, b) => a.order - b.order);
        resolve({ fields, files, fileList });
      }
    };

    let bb;
    try {
      // defParamCharset: the parser's default decodes the filename as Latin-1,
      // which turns every Kurdish letter in a name into mojibake. Browsers send
      // UTF-8, so that is what it must be read as.
      bb = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { fileSize: MAX_BYTES, files: maxFiles, fields: 60, fieldSize: 64 * 1024 } });
    } catch {
      return reject(new UploadError('داواکارییەکە فۆڕمی فایلی تێدا نییە.', 'not_multipart'));
    }

    bb.on('field', (name, value) => { fields[name] = value; });

    bb.on('file', (field, stream, info) => {
      const originalName = String(info.filename ?? '').slice(0, 255);
      if (!originalName) { stream.resume(); return; }            // empty file input: ignore
      pending++;
      const order = arrived++;

      const claimed = claimedType(originalName);
      const hash = createHash('sha256');
      let size = 0;
      let buffered = [];        // chunks seen before the type is known
      let type = null;
      let out = null;
      let relPath = null;

      const abort = err => { stream.resume(); if (out) out.destroy(); pending--; fail(err); };
      stream.on('limit', () => abort(new UploadError(`فایل لە ${Math.floor(MAX_BYTES / 1048576)} مێگابایت گەورەترە.`, 'too_large')));
      stream.on('error', abort);

      stream.on('data', chunk => {
        if (failed) return;
        size += chunk.length;
        hash.update(chunk);
        if (type) { out.write(chunk); return; }

        buffered.push(chunk);
        const head = Buffer.concat(buffered);
        if (head.length < 8) return;                               // not enough to sniff yet

        type = detectType(claimed, head.slice(0, 64));
        if (!type || !allow.includes(type)) {
          // A name that says DWG on a file that is not one: "DWG is not accepted,
          // only PDF, DWG…" contradicted itself (records test).
          if (claimed && allow.includes(claimed)) {
            return abort(new UploadError(`«${originalName}» ناوی فایلی ${claimed.toUpperCase()}ی هەیە، بەڵام ناوەڕۆکەکەی ${claimed.toUpperCase()} نییە. لەوانەیە فایلێکی تر بێت کە ناوەکەی گۆڕدرابێت.`, 'bad_type'));
          }
          return abort(new UploadError(`ئەم جۆرە فایلە قبوڵ ناکرێت (${claimed || 'نەناسراو'}). تەنها: ${allow.map(a => a.toUpperCase()).join('، ')}.`, 'bad_type'));
        }
        relPath = `${monthDir}/${randomUUID()}.${TYPES[type].ext}`;
        out = openWrite(relPath, actor);
        out.on('error', abort);
        written.push(relPath);
        out.write(head);
        buffered = [];
      });

      stream.on('end', () => {
        if (failed) return;
        if (!type) return abort(new UploadError('فایلەکە بەتاڵە یان زۆر بچووکە.', 'empty'));
        out.end(() => {
          const stored = { field, originalName, type, storedPath: relPath, sizeBytes: size, sha256: hash.digest('hex'), order };
          files[field] = stored;
          fileList.push(stored);
          pending--;
          maybeDone();
        });
      });
    });

    bb.on('filesLimit', () => fail(new UploadError(`زۆر فایل نێردراوە. زۆرترین ${maxFiles} فایل لە یەک جاردا.`, 'too_many')));
    bb.on('error', fail);
    bb.on('finish', () => { finished = true; maybeDone(); });
    req.pipe(bb);
  });
}

/** True if the stored bytes still match the hash recorded at upload. */
export async function verifyStored(storedPath, expectedSha256, actor = null) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    readStream(storedPath, actor)
      .on('data', c => h.update(c))
      .on('end', () => resolve(h.digest('hex') === expectedSha256))
      .on('error', reject);
  });
}

// The old name, kept so nothing that already calls it breaks. It no longer means
// "on disk" when the pg backend is in use, which is why the new name exists.
export const verifyOnDisk = verifyStored;

/**
 * Virus scan. Returns 'clean', 'infected', 'skipped' or 'error'.
 *
 * Talks clamd's INSTREAM protocol directly over TCP, which is a length-prefixed
 * stream and a one-line reply, so it needs no library. Set CLAMD_HOST to switch
 * it on; leave it unset and every file comes back 'skipped' and the screen says
 * so, which is the honest state on a host that cannot run a scanner daemon.
 *
 * Never returns 'clean' for a scan that did not happen. A scanner that is down
 * gives 'error', not 'clean', because "we could not check" and "we checked and
 * it is fine" must never look the same to the caller.
 *
 * What happens on 'error' is a policy choice. The default is to accept the file
 * and label it unscanned, because a registry that stops accepting scans of
 * letters when a daemon crashes costs the municipality more than the marginal
 * risk of a whitelisted PDF. Set CLAM_FAIL_CLOSED=true to refuse instead.
 */
export async function scanFile(storedPath, actor = null) {
  const host = process.env.CLAMD_HOST;
  if (!host) return 'skipped';
  const port = Number(process.env.CLAMD_PORT || 3310);
  const timeoutMs = Number(process.env.CLAMD_TIMEOUT_MS || 30_000);

  const { createConnection } = await import('net');

  return new Promise(resolve => {
    let settled = false;
    const done = result => { if (!settled) { settled = true; socket.destroy(); resolve(result); } };

    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);

    let reply = '';
    socket.on('data', chunk => { reply += chunk.toString('latin1'); });
    socket.on('timeout', () => { console.error('[scan] clamd timed out'); done('error'); });
    socket.on('error', err => { console.error('[scan] clamd unreachable:', err.message); done('error'); });

    socket.on('close', () => {
      if (settled) return;
      // "stream: OK" or "stream: Eicar-Test-Signature FOUND"
      if (/\bOK\b/.test(reply) && !/FOUND/.test(reply)) return done('clean');
      if (/FOUND/.test(reply)) return done('infected');
      console.error('[scan] clamd said something unexpected:', reply.trim().slice(0, 200));
      done('error');
    });

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      // As the uploader: the bytes have no attachment row pointing at them yet,
      // and the in-flight policy is scoped to whoever stored them.
      const source = readStream(storedPath, actor);
      source.on('data', chunk => {
        // Each chunk is a four-byte big-endian length then the bytes themselves.
        const len = Buffer.allocUnsafe(4);
        len.writeUInt32BE(chunk.length, 0);
        socket.write(len);
        socket.write(chunk);
      });
      source.on('end', () => socket.write(Buffer.from([0, 0, 0, 0])));   // zero length ends the stream
      source.on('error', err => { console.error('[scan] could not read the stored file:', err.message); done('error'); });
    });
  });
}

/** True when an 'error' result should refuse the upload rather than accept it unscanned. */
export const scanFailClosed = () => process.env.CLAM_FAIL_CLOSED === 'true';

// The actor matters on the pg backend, where row-level security decides whether
// this person may see the bytes at all. Passing it is not optional in a route.
export async function fileExists(storedPath, actor = null) {
  return exists(storedPath, actor);
}

/**
 * Store bytes the application produced rather than bytes a browser sent.
 *
 * There is exactly one caller for now, the page merger, and it needs the same
 * three facts every upload has: where it went, how big it is, and its hash. It
 * goes through the same storage layer and lands under the same month directory,
 * so nothing downstream can tell a merged file from an uploaded one, which is
 * the point: the virus scan, the download route and the nightly hash check all
 * work on it unchanged.
 *
 * @param {Buffer} bytes
 * @param {'pdf'|'jpg'|'png'|'tif'} type
 * @param {{id:number}|null} actor
 * @param {'files'|'archive'} [area]
 */
export async function storeBuffer(bytes, type, actor = null, area = 'files') {
  if (!TYPES[type]) throw new UploadError('جۆری فایلی نەناسراو.', 'bad_type');
  if (!bytes?.length) throw new UploadError('فایلەکە بەتاڵە.', 'empty');
  if (bytes.length > MAX_BYTES) {
    throw new UploadError(`فایل لە ${Math.floor(MAX_BYTES / 1048576)} مێگابایت گەورەترە.`, 'too_large');
  }

  const now = new Date();
  const monthDir = `${area}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  await prepare(monthDir);

  const relPath = `${monthDir}/${randomUUID()}.${TYPES[type].ext}`;
  await new Promise((resolve, reject) => {
    const out = openWrite(relPath, actor);
    out.on('error', reject);
    out.end(bytes, () => resolve());
  });

  return {
    storedPath: relPath,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    type,
  };
}

/** Read a stored file back into memory. Only for files small enough to merge. */
export async function readStored(relPath, actor = null) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readStream(relPath, actor)
      .on('data', c => chunks.push(c))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}

// Re-exported so the download routes have one place to import from, and so they
// never touch the filesystem directly. absolutePath is meaningful only on the
// disk backend and is kept for the deployment runbook's own tooling.
export { readStream, absolutePath, BACKEND };
// So a caller that refuses a file can also stop storing it.
export { remove as removeStored } from './storage.mjs';
export { UploadError, TYPES };
