// The encrypted container a backup is written into.
//
// A backup of this system is a copy of every letter the municipality has ever
// received. It is written to a disk, and then the whole point of it is that it
// LEAVES THE BUILDING: onto a second disk, into a cupboard in another office,
// somewhere a fire or a thief or a failed controller cannot reach. That is also
// precisely the moment the municipality loses physical control of it. So it is
// encrypted here, on the machine that made it, before it is ever written down.
//
// THE FORMAT (docsys-backup-1)
//
//   offset       bytes   what
//   0            16      the ASCII magic "DOCSYS-BACKUP-1\n"
//   16           4       the length of the header, big-endian uint32
//   20           n       the header, UTF-8 JSON, described below
//   20 + n       ...     the ciphertext
//   size - 16    16      the AES-GCM authentication tag
//
// The header is plain text on purpose and carries no secret:
//
//   { "v": 1, "kdf": "scrypt", "N": 32768, "r": 8, "p": 1, "salt": "<hex>",
//     "cipher": "aes-256-gcm", "iv": "<hex>", "content": "pgdump-custom",
//     "created": "2026-09-11T02:00:00.000Z" }
//
// Being able to read what a backup file is without knowing the passphrase is the
// difference between an archive somebody can manage and a pile of blobs nobody
// dares touch. The header is also fed to the cipher as additional authenticated
// data, so editing one character of it makes the file refuse to decrypt rather
// than quietly decrypt into something else.
//
// WHY THIS AND NOT SOMETHING OFF THE SHELF
//
// `openssl enc` cannot do an authenticated cipher at all: it refuses GCM, and
// what it offers instead is CBC with no integrity, which would let somebody
// flip bits in a backup and have the restore succeed. gpg can, but it is a
// second thing to install, keep and get right on a machine whose whole job is
// to still work on the day everything else has stopped. Node's crypto is
// already here and AES-256-GCM is one call.
//
// RECOVERING WITHOUT THIS FILE
//
// The format above is a complete specification. Anybody competent can decrypt a
// backup with twenty lines of Python and no access to this repository, and the
// runbook says so. A backup whose only reader is one file in one git repository
// has a single point of failure, and it is the same failure it was supposed to
// protect against.
//
// WHAT THIS DOES NOT DO
//
// It does not hide how large the backup is, or when it was taken, or how many
// there are. Anyone holding the files learns that much. That is an acceptable
// trade for a header you can read.

import { createCipheriv, createDecipheriv, scrypt, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { open, stat } from 'fs/promises';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';

const scryptAsync = promisify(scrypt);

const MAGIC = Buffer.from('DOCSYS-BACKUP-1\n', 'ascii');   // exactly 16 bytes
const HEADER_LEN_BYTES = 4;
const SALT_LEN = 32;
const IV_LEN = 12;              // 96 bits, the size GCM is defined for
const KEY_LEN = 32;             // AES-256
const TAG_LEN = 16;

// scrypt at N=32768 costs roughly a tenth of a second and 32 MB. That is nothing
// once a night and a great deal to somebody working through a dictionary against
// a stolen disk. maxmem has to be raised above node's default or scrypt refuses
// these parameters outright.
const KDF = { N: 32768, r: 8, p: 1 };
const MAXMEM = 128 * 1024 * 1024;

const MAX_HEADER = 64 * 1024;   // a sane ceiling, so a corrupt length is not a huge allocation

function deriveKey(passphrase, salt, params = KDF) {
  if (!passphrase || String(passphrase).length < 8) {
    throw new Error('the backup passphrase is missing or too short; see RESTORE.md');
  }
  return scryptAsync(String(passphrase), salt, KEY_LEN,
    { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM });
}

/**
 * Encrypt a stream into a backup file.
 *
 * The source is consumed as it arrives and nothing is buffered, so a pg_dump of
 * any size can be piped straight in without ever existing on disk unencrypted.
 * That matters: a temporary plaintext dump sitting in /tmp for four minutes is
 * exactly the copy that gets left behind when the machine is powered off mid-run.
 *
 * Returns the sizes and both hashes: the plaintext hash proves a later restore
 * produced the same bytes, the file hash proves the file itself was copied
 * somewhere else intact, and that second one can be checked by anybody without
 * the passphrase.
 */
export async function encryptTo(destPath, passphrase, content, source) {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(passphrase, salt);

  const header = Buffer.from(JSON.stringify({
    v: 1,
    kdf: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p,
    salt: salt.toString('hex'),
    cipher: 'aes-256-gcm', iv: iv.toString('hex'),
    content,
    created: new Date().toISOString(),
  }), 'utf8');
  const headerLen = Buffer.alloc(HEADER_LEN_BYTES);
  headerLen.writeUInt32BE(header.length, 0);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);

  const out = createWriteStream(destPath, { mode: 0o600 });
  const fileHash = createHash('sha256');
  const plainHash = createHash('sha256');
  let plainBytes = 0, fileBytes = 0;

  // Awaiting the write callback is what gives backpressure here. Without it a
  // fast pg_dump into a slow disk grows the write queue until the process is
  // killed for memory, which is a failure mode that only shows up on the large
  // database, which is to say only in production.
  const failed = new Promise((_, reject) => out.on('error', reject));
  const write = buf => Promise.race([failed, new Promise((resolve, reject) => {
    fileHash.update(buf); fileBytes += buf.length;
    out.write(buf, err => err ? reject(err) : resolve());
  })]);

  try {
    await write(MAGIC);
    await write(headerLen);
    await write(header);

    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      plainHash.update(buf);
      plainBytes += buf.length;
      const enc = cipher.update(buf);
      if (enc.length) await write(enc);
    }

    const last = cipher.final();
    if (last.length) await write(last);
    await write(cipher.getAuthTag());
    await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });
  } catch (err) {
    out.destroy();
    throw err;
  }

  return {
    path: destPath,
    content,
    plain_bytes: plainBytes,
    bytes: fileBytes,
    sha256_plain: plainHash.digest('hex'),
    sha256_file: fileHash.digest('hex'),
  };
}

/** Read the header of a backup file without decrypting anything. */
export async function readHeader(srcPath) {
  const { size } = await stat(srcPath);
  if (size < MAGIC.length + HEADER_LEN_BYTES + TAG_LEN) {
    throw new Error(`${srcPath} is too short to be a backup file`);
  }
  const fh = await open(srcPath, 'r');
  try {
    const front = Buffer.alloc(MAGIC.length + HEADER_LEN_BYTES);
    await fh.read(front, 0, front.length, 0);
    if (!front.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error(`${srcPath} is not a docsys backup file`);
    }
    const headerLen = front.readUInt32BE(MAGIC.length);
    if (headerLen < 2 || headerLen > MAX_HEADER || size < front.length + headerLen + TAG_LEN) {
      throw new Error(`${srcPath} has a damaged header`);
    }
    const raw = Buffer.alloc(headerLen);
    await fh.read(raw, 0, headerLen, front.length);

    const tag = Buffer.alloc(TAG_LEN);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);

    return {
      header: JSON.parse(raw.toString('utf8')),
      raw, tag, size,
      bodyStart: front.length + headerLen,
      bodyEnd: size - TAG_LEN - 1,
    };
  } finally {
    await fh.close();
  }
}

/**
 * Decrypt a backup file into a stream.
 *
 * If the passphrase is wrong, or one byte of the file was altered, or the file
 * was truncated by a copy that ran out of disk, this throws. It cannot say WHICH
 * of those happened, and the message says so rather than guessing: an
 * authenticated cipher answers one question, "are these the bytes that were
 * written, under this key", and the honest answer to a failure is no.
 *
 * The caller gets the plaintext sha256 back so it can be compared with the one
 * recorded when the backup was taken.
 */
export async function decryptFrom(srcPath, passphrase, destination) {
  const { header, raw, tag, bodyStart, bodyEnd } = await readHeader(srcPath);

  if (header.v !== 1 || header.cipher !== 'aes-256-gcm' || header.kdf !== 'scrypt') {
    throw new Error(`${srcPath} is a backup format this version does not know: ${JSON.stringify(header)}`);
  }

  const key = await deriveKey(passphrase, Buffer.from(header.salt, 'hex'),
    { N: header.N, r: header.r, p: header.p });
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'hex'));
  decipher.setAAD(raw);
  decipher.setAuthTag(tag);

  const plainHash = createHash('sha256');
  let plainBytes = 0;
  const measure = async function* (chunks) {
    for await (const c of chunks) { plainHash.update(c); plainBytes += c.length; yield c; }
  };

  // An empty payload is a legitimate thing to encrypt and createReadStream
  // refuses a range that ends before it starts, so it gets its own path.
  const body = bodyEnd < bodyStart
    ? (async function* () {})()
    : createReadStream(srcPath, { start: bodyStart, end: bodyEnd });

  try {
    await pipeline(body, decipher, measure, destination);
  } catch (err) {
    if (/auth|unable to authenticate|bad decrypt/i.test(err.message)) {
      throw new Error(
        `${srcPath} would not decrypt. Either the passphrase is wrong or the file has been ` +
        `altered or truncated since it was written. There is no way to tell which from here.`);
    }
    throw err;
  }

  return { header, plain_bytes: plainBytes, sha256_plain: plainHash.digest('hex') };
}

/** Whether two hex digests match, without leaking where they differ by timing. */
export function digestsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export { MAGIC, KDF, TAG_LEN };
