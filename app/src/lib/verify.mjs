// The code that proves a letter is genuine (migration 0540).
//
// Ten characters from an alphabet with no 0, O, 1 or I, so a code read aloud over
// the phone or copied off a photocopy cannot be misread: 32 letters, fifty bits,
// from the operating system's cryptographic generator. Printed in groups of four
// (ABCD-EFGH-JK) and accepted with or without the dashes, in either case.

import { randomInt } from 'crypto';
import { logEvent } from './log.mjs';
import { foldDigits } from './ku.mjs';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode() {
  let s = '';
  for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** What somebody typed, as the stored form, or null when it cannot be a code. */
export function normaliseCode(typed) {
  // Kurdish digits typed off a Kurdish keyboard, and whatever dash a phone put in
  // (‐ ‑ – —): a genuine letter was called forged for ٤ instead of 4 (feature test).
  const s = foldDigits(String(typed ?? '')).toUpperCase().replace(/[\s\-_.\u2010-\u2015\u2212]/g, '');
  return /^[A-HJ-NP-Z2-9]{10}$/.test(s) ? s : null;
}

/** ABCD-EFGH-JK */
export const groupCode = code => (code ? `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}` : '');

/**
 * The letter's code, issuing one if it has an outgoing number and none yet.
 * Null for a letter with no outgoing number, or one the person cannot see.
 */
export async function ensureVerifyCode(q, documentId, req) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = newCode();
    // A savepoint, because a unique violation would otherwise end the whole
    // transaction the print or the close is running in.
    await q('SAVEPOINT verify_code');
    let code;
    try {
      const { rows: [r] } = await q(`SELECT issue_verify_code($1, $2) AS code`, [documentId, candidate]);
      code = r?.code ?? null;
      await q('RELEASE SAVEPOINT verify_code');
    } catch (err) {
      await q('ROLLBACK TO SAVEPOINT verify_code');
      // Another letter already has this code: at fifty bits, practically never,
      // and trying again is the whole answer.
      if (err.code === '23505') continue;
      throw err;
    }
    if (code && code === candidate && req?.user) {
      await logEvent(q, {
        action: 'verify.issued', req, userId: req.user.id, roomId: req.user.roomId,
        documentId, detail: {},
      });
    }
    return code;
  }
  return null;
}
