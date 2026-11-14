// Where uploaded bytes actually live.
//
// Two backends behind one interface, chosen by FILE_STORAGE:
//
//   disk   the default. Files under files/<area>/<year>/<month>/<uuid>.<ext>.
//          What a municipal server on its own hardware should use.
//
//   pg     the bytes go into a Postgres table as bytea, addressed by the same
//          relative path. For hosts with no durable filesystem, which is every
//          serverless platform: there the disk is wiped between requests, so a
//          scan uploaded on Monday is gone before Tuesday and nothing says so.
//
// The path is a uuid either way, so nothing here is ever derived from a name the
// user supplied. Switching backends does not change a single stored path, which
// means the metadata rows in attachment and archive_file stay valid.
//
// Tradeoff worth knowing: the pg backend holds a whole file in memory while it is
// written and while it is read, because bytea has no streaming interface through
// a pooled connection. MAX_UPLOAD_BYTES caps that at 60 MiB by default. On disk
// the bytes stream and memory stays flat. If drawings get much larger than that,
// the answer is object storage, not a bigger cap.

import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { createWriteStream, createReadStream } from 'fs';
import { mkdir, unlink, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { withActor } from './db.mjs';

export const BACKEND = (process.env.FILE_STORAGE || 'disk').toLowerCase();
const FILES_ROOT = process.env.FILES_DIR || join(process.cwd(), 'files');

class StoragePathError extends Error {
  constructor() { super('ڕێڕەوی فایل دروست نییە.'); this.code = 'bad_path'; this.expected = true; }
}

/** Absolute path for a stored file, refusing anything that escapes the root. */
export function absolutePath(relPath) {
  const abs = join(FILES_ROOT, relPath);
  if (!abs.startsWith(FILES_ROOT)) throw new StoragePathError();
  return abs;
}

// A relative path must look like the uuid paths this module generates. Checked on
// every read as well as every write, so a bad row in the database cannot become a
// path traversal later.
//
// This mirrors the CHECK constraints on attachment.stored_path and
// archive_file.stored_path exactly, the same way the Kurdish normaliser mirrors
// its SQL twin. If the two ever disagree, a file becomes unreadable through one
// door and readable through the other, and nothing reports it. Keep them equal.
const SAFE = /^(files|archive)\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,4}$/;
function assertSafe(relPath) {
  if (!SAFE.test(String(relPath ?? ''))) throw new StoragePathError();
  return relPath;
}

// --- the pg backend's writer ------------------------------------------------
// Collects the chunks, then writes one row. end(cb) calls back only once the row
// is committed, so the caller's "the file is stored" is true when it says so.

class PgWriter extends EventEmitter {
  constructor(relPath, actor = null) { super(); this.relPath = relPath; this.actor = actor; this.chunks = []; this.dead = false; }
  write(chunk) { if (!this.dead) this.chunks.push(chunk); return true; }
  destroy() { this.dead = true; this.chunks = []; }
  // end(cb) and end(chunk, cb), both of which fs.WriteStream accepts. Supporting
  // only the first is how a caller that writes its last chunk in end() works
  // perfectly on disk and throws "cb is not a function" on this backend, with
  // the buffer arriving where the callback was expected.
  end(chunkOrCb, maybeCb) {
    const cb = typeof chunkOrCb === 'function' ? chunkOrCb : maybeCb;
    if (typeof chunkOrCb !== 'function' && chunkOrCb != null) this.write(chunkOrCb);
    if (this.dead) return;
    const bytes = Buffer.concat(this.chunks);
    this.chunks = [];
    // A plain INSERT, deliberately. ON CONFLICT would make Postgres apply the
    // SELECT policy to the new row, and that policy requires a parent attachment
    // or archive_file row which does not exist yet at upload time, so every
    // upload failed with a row-level security violation. Beyond that: the path is
    // a fresh uuid, so a collision means something is badly wrong and should fail
    // loudly rather than quietly store nothing. This matches the disk backend,
    // which opens with 'wx' for the same reason.
    // uploaded_by is what lets the virus scanner read these bytes in the seconds
    // before the attachment row exists, and lets nobody else read them at all.
    withActor(this.actor, q => q(
      `INSERT INTO file_blob (stored_path, bytes, size_bytes, uploaded_by) VALUES ($1, $2, $3, $4)`,
      [this.relPath, bytes, bytes.length, this.actor?.id ?? null]))
      .then(() => cb && cb())
      .catch(err => this.emit('error', err));
  }
}

/** Make ready to receive files for a month directory. Only disk needs this. */
export async function prepare(monthDir) {
  if (BACKEND === 'disk') await mkdir(join(FILES_ROOT, monthDir), { recursive: true });
}

/**
 * Open a writer for a new file. Mirrors the part of the fs.WriteStream contract
 * the upload path uses: write(chunk), end(cb), destroy(), and an 'error' event.
 */
export function openWrite(relPath, actor = null) {
  assertSafe(relPath);
  if (BACKEND === 'pg') return new PgWriter(relPath, actor);
  // 'wx' so a uuid collision fails loudly instead of overwriting a stored file.
  return createWriteStream(absolutePath(relPath), { flags: 'wx' });
}

// Reads take the actor, and they must.
//
// The SELECT policy on file_blob allows a row only when the attachment or
// archive_file pointing at it is visible, and that visibility is decided by
// app.user_id. Read with no actor and the policy hides every blob from everyone,
// including the clerk who just uploaded it. Read as the actor and the policy does
// the work it was written for: IT cannot see the attachment row, so IT cannot
// reach the bytes behind it either, through the very same database role.
//
// The disk backend ignores the actor because a filesystem has no equivalent. That
// is exactly why both download routes check the metadata row first and only then
// ask for bytes.

/** A readable stream of a stored file's bytes, as seen by `actor`. */
export function readStream(relPath, actor = null) {
  assertSafe(relPath);
  if (BACKEND !== 'pg') return createReadStream(absolutePath(relPath));

  const out = new Readable({ read() {} });
  withActor(actor, q => q('SELECT bytes FROM file_blob WHERE stored_path = $1', [relPath]))
    .then(({ rows }) => {
      if (!rows.length) return out.destroy(new Error(`stored file missing or not permitted: ${relPath}`));
      out.push(rows[0].bytes);
      out.push(null);
    })
    .catch(err => out.destroy(err));
  return out;
}

export async function exists(relPath, actor = null) {
  try { assertSafe(relPath); } catch { return false; }
  if (BACKEND === 'pg') {
    const { rows } = await withActor(actor, q => q('SELECT 1 FROM file_blob WHERE stored_path = $1', [relPath]));
    return rows.length > 0;
  }
  try { await stat(absolutePath(relPath)); return true; } catch { return false; }
}

/** Remove a stored file. Used to clean up when one file in an upload is refused. */
export async function remove(relPath) {
  try { assertSafe(relPath); } catch { return; }
  if (BACKEND === 'pg') {
    // No actor: the DELETE policy is unconditional, and this runs while an upload
    // is being rolled back, before any row exists that an actor could be judged by.
    await withActor(null, q => q('DELETE FROM file_blob WHERE stored_path = $1', [relPath])).catch(() => {});
    return;
  }
  await unlink(absolutePath(relPath)).catch(() => {});
}

export { StoragePathError };
