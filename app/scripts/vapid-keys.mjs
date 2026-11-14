// Print a fresh VAPID key pair for web push.
//
//   node scripts/vapid-keys.mjs
//
// Run once per deployment. Put the two lines it prints into the environment and
// restart. The public key is not a secret — the browser is given it — but the
// private key is, and changing it invalidates every browser already registered,
// which means everyone has to press the bell button again. So generate it once
// and keep it with the rest of the deployment secrets.

import { generateKeys } from '../src/lib/push.mjs';

const { publicKey, privateKey } = generateKeys();

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=mailto:it@rania.gov.krd`);
