// Web push: ringing a browser that is not open.
//
// The one design decision in this file, and the reason it is short:
//
//   THE PUSH CARRIES NO PAYLOAD. EVER.
//
// A normal web push carries an encrypted message that the browser shows without
// asking the server anything. To do that you encrypt the text for the browser's
// key and hand it to Google, Mozilla or Apple to deliver. The ciphertext is
// opaque to them, but its length, its timing and its very existence are not, and
// the arrangement means Rania correspondence metadata is being routed through a
// third party in another country. That is exactly what the confidentiality rule
// forbids.
//
// So this sends a doorbell: a POST with no body at all, which the push services
// accept and deliver as an empty push. The service worker wakes, asks THIS
// server over the browser's own authenticated connection what it was about, and
// shows a count. Nothing about a letter leaves the building.
//
// The happy side effect is that there is no encryption to write. A payload-less
// push needs only a signed VAPID token, which is one ES256 JWT. No dependency,
// about eighty lines, and nothing to get subtly wrong in a way that leaks.
//
// Setup: run  node scripts/vapid-keys.mjs  once and put the two values in the
// environment as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, with VAPID_SUBJECT set
// to a mailto: or https: address for whoever runs the server. With none of them
// set, push is simply off: everything in the app still works and the screen says
// notifications outside the browser are unavailable.

import { createPrivateKey, sign, generateKeyPairSync } from 'crypto';
import { withActor } from './db.mjs';

const PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:it@rania.gov.krd';

const b64url = buf => Buffer.from(buf).toString('base64url');

export const isEnabled = () => Boolean(PUBLIC && PRIVATE);
export const publicKey = () => PUBLIC;

/**
 * A fresh VAPID key pair, as the two base64url strings the environment wants.
 * Used by scripts/vapid-keys.mjs; kept here so the encoding lives next to the
 * code that decodes it again.
 */
export function generateKeys() {
  const { publicKey: pub, privateKey: priv } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = priv.export({ format: 'jwk' });
  // The browser's applicationServerKey is the uncompressed point: 0x04 || x || y.
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  void pub;
  return { publicKey: b64url(point), privateKey: jwk.d };
}

/** Rebuild the signing key from the two environment strings. */
function privateKeyObject() {
  const point = Buffer.from(PUBLIC, 'base64url');
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error('VAPID_PUBLIC_KEY must be the 65-byte uncompressed P-256 point, base64url. Re-run scripts/vapid-keys.mjs.');
  }
  return createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64url(point.subarray(1, 33)),
      y: b64url(point.subarray(33, 65)),
      d: PRIVATE,
    },
  });
}

/**
 * The Authorization header for one push service.
 *
 * One token per origin, valid twelve hours, cached: signing is cheap but a
 * building-wide send is thirty pushes to three origins, and three signatures
 * beat thirty.
 */
const tokens = new Map();   // origin -> { header, expires }

function authorization(origin) {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokens.get(origin);
  if (cached && cached.expires > now + 300) return cached.header;

  const exp = now + 12 * 3600;
  const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64url(JSON.stringify({ aud: origin, exp, sub: SUBJECT }));
  // ieee-p1363 is the raw r||s form JWS requires. The default DER encoding is
  // accepted by nothing and fails with a bare 401 that says why nowhere.
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), {
    key: privateKeyObject(), dsaEncoding: 'ieee-p1363',
  });
  const header = `vapid t=${head}.${body}.${b64url(sig)}, k=${PUBLIC}`;
  tokens.set(origin, { header, expires: exp });
  return header;
}

/**
 * Ring a list of browsers.
 *
 * Returns how many were reached. Never throws: a push service being down, or
 * unreachable because the building's internet is out, must not turn sending a
 * letter into an error. The office system works on the LAN with no internet at
 * all, and in that state this quietly does nothing.
 */
export async function deliver(endpoints, hooks = {}) {
  if (!isEnabled() || !endpoints?.length) return 0;

  // The bookkeeping runs on whatever connection the caller has. A web request
  // has the application pool; the nightly jobs process has only its own
  // connection and would otherwise write nothing at all, so an endpoint that
  // stopped working would be rung forever with nobody counting.
  const book = {
    touch: hooks.touch ?? ((e, ok) => withActor(null, q => q(`SELECT push_touch($1, $2)`, [e, ok]))),
    forget: hooks.forget ?? (e => withActor(null, q => q(`SELECT push_forget($1)`, [e]))),
  };

  const results = await Promise.allSettled(endpoints.map(e => one(e, book)));
  return results.filter(r => r.status === 'fulfilled' && r.value).length;
}

async function one(endpoint, book) {
  let origin;
  try { origin = new URL(endpoint).origin; } catch { return false; }

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 5000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization(origin),
        TTL: '86400',                 // keep it a day if the phone is off
        'Content-Length': '0',
        Urgency: 'normal',
      },
      signal: control.signal,
    });

    // 404 and 410 mean the browser is gone for good: reinstalled, cleared, or
    // the person pressed "remove". Keeping the row would mean retrying forever.
    if (res.status === 404 || res.status === 410) {
      await book.forget(endpoint).catch(() => {});
      return false;
    }
    if (!res.ok) {
      console.error(`[push] ${res.status} from ${origin}`);
      await book.touch(endpoint, false).catch(() => {});
      return false;
    }
    await book.touch(endpoint, true).catch(() => {});
    return true;
  } catch (err) {
    // Offline, DNS down, timed out. Normal on a municipal LAN with no route out.
    console.error(`[push] could not reach ${origin}: ${err.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}


