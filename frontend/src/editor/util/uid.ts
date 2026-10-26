/** Identifiers of new objects and placed tokens (nanoid-like: 21 chars of [A-Za-z0-9_-]). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export function newObjectUid(size = 21): string {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i]! & 63];
  return out;
}
