/** Random seed of a generation (outside procgen/: generators never read entropy, D1). */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 8 base-36 characters (lowercase), from crypto.getRandomValues. */
export function randomSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  // 256 % 36 != 0: reject the biased tail (>= 252) so every character is uniform.
  for (let i = 0; i < bytes.length; i++) {
    let b = bytes[i]!;
    while (b >= 252) {
      const one = new Uint8Array(1);
      crypto.getRandomValues(one);
      b = one[0]!;
    }
    out += ALPHABET[b % 36];
  }
  return out;
}
