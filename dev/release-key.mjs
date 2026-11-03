#!/usr/bin/env node
// Generates the Ed25519 key pair that signs the releases (dist/SHA256SUMS.sig).
//
//   node dev/release-key.mjs
//
// The private key (PEM, mode 600) is written OUTSIDE the repository, to ~/.config/jdr/release-ed25519.pem
// (or to the path of JDR_RELEASE_KEY); an existing key is never overwritten. The raw public key
// (32 bytes, base64) is printed: it goes into app/Domain/Update/ReleaseSignature.php (PUBLIC_KEY).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function defaultKeyPath() {
  return process.env.JDR_RELEASE_KEY || path.join(os.homedir(), '.config', 'jdr', 'release-ed25519.pem');
}

/** Raw 32-byte public key of a KeyObject, base64. */
export function rawPublicKey(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('base64');
}

function main() {
  const target = defaultKeyPath();
  if (fs.existsSync(target)) {
    console.error(`release-key: ${target} already exists, refusing to overwrite it.`);
    return 1;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  fs.chmodSync(target, 0o600);
  console.log(`Private key written to ${target} (keep it secret, back it up outside the repository).`);
  console.log('Public key (base64, for ReleaseSignature::PUBLIC_KEY):');
  console.log(rawPublicKey(publicKey));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
