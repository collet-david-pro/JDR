/**
 * Pure JavaScript raw DEFLATE (RFC 1951), used when CompressionStream('deflate-raw') is missing
 * (projet.md 22: "CompressionStream → deflate JS").
 *
 * - inflateRawSync reads any valid raw deflate stream (stored, fixed and dynamic Huffman blocks),
 *   e.g. PHP gzdeflate() output, with a hard bound on the decompressed size (anti-bomb).
 * - deflateRawSync writes fixed-Huffman blocks with a small LZ77 matcher (falls back to stored
 *   blocks when that would be larger). Good enough for 4 KB tile chunks.
 */

export class InflateError extends Error {
  override readonly name = 'InflateError';
  constructor(
    readonly code: 'truncated' | 'invalid' | 'output_limit',
    message: string,
  ) {
    super(message);
  }
}

const MAX_BITS = 15;
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huffman {
  readonly count: Uint16Array;
  readonly symbol: Uint16Array;
}

/** Canonical Huffman table (puff style). Returns the number of unused codes (<0 = over-subscribed). */
function buildHuffman(lengths: ArrayLike<number>, n: number): { h: Huffman; left: number } {
  const count = new Uint16Array(MAX_BITS + 1);
  const symbol = new Uint16Array(n);
  for (let s = 0; s < n; s++) count[lengths[s] ?? 0]!++;
  if (count[0] === n) return { h: { count, symbol }, left: 0 };
  let left = 1;
  for (let len = 1; len <= MAX_BITS; len++) {
    left <<= 1;
    left -= count[len]!;
    if (left < 0) return { h: { count, symbol }, left };
  }
  const offs = new Uint16Array(MAX_BITS + 1);
  for (let len = 1; len < MAX_BITS; len++) offs[len + 1] = offs[len]! + count[len]!;
  for (let s = 0; s < n; s++) {
    const len = lengths[s] ?? 0;
    if (len !== 0) symbol[offs[len]!++] = s;
  }
  return { h: { count, symbol }, left };
}

let fixedTables: { lit: Huffman; dist: Huffman } | null = null;
function fixed(): { lit: Huffman; dist: Huffman } {
  if (fixedTables === null) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144);
    l.fill(9, 144, 256);
    l.fill(7, 256, 280);
    l.fill(8, 280, 288);
    const d = new Uint8Array(30).fill(5);
    fixedTables = { lit: buildHuffman(l, 288).h, dist: buildHuffman(d, 30).h };
  }
  return fixedTables;
}

/** Decompresses a raw deflate stream. Throws InflateError (never returns more than maxOutput bytes). */
export function inflateRawSync(input: Uint8Array, maxOutput: number): Uint8Array {
  let out = new Uint8Array(Math.max(16, Math.min(maxOutput, input.length * 4 + 64)));
  let outLen = 0;
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;

  const need = (n: number): void => {
    const target = outLen + n;
    if (target > maxOutput) throw new InflateError('output_limit', 'Decompressed data too large');
    if (target > out.length) {
      const grown = new Uint8Array(Math.min(maxOutput, Math.max(target, out.length * 2)));
      grown.set(out.subarray(0, outLen));
      out = grown;
    }
  };
  const bits = (n: number): number => {
    while (bitCnt < n) {
      if (pos >= input.length) throw new InflateError('truncated', 'Unexpected end of data');
      bitBuf |= input[pos++]! << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= bits(1);
      const count = h.count[len]!;
      if (code - count < first) return h.symbol[index + (code - first)]!;
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new InflateError('invalid', 'Invalid Huffman code');
  };
  const codes = (lit: Huffman, dist: Huffman): void => {
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        need(1);
        out[outLen++] = sym;
      } else if (sym === 256) {
        return;
      } else {
        const li = sym - 257;
        if (li >= 29) throw new InflateError('invalid', 'Invalid length symbol');
        const len = LENGTH_BASE[li]! + bits(LENGTH_EXTRA[li]!);
        const ds = decode(dist);
        if (ds >= 30) throw new InflateError('invalid', 'Invalid distance symbol');
        const d = DIST_BASE[ds]! + bits(DIST_EXTRA[ds]!);
        if (d > outLen) throw new InflateError('invalid', 'Distance too far back');
        need(len);
        for (let i = 0; i < len; i++) {
          out[outLen] = out[outLen - d]!;
          outLen++;
        }
      }
    }
  };
  const stored = (): void => {
    bitBuf = 0;
    bitCnt = 0;
    if (pos + 4 > input.length) throw new InflateError('truncated', 'Unexpected end of data');
    const len = input[pos]! | (input[pos + 1]! << 8);
    const nlen = input[pos + 2]! | (input[pos + 3]! << 8);
    pos += 4;
    if (len !== (~nlen & 0xffff)) throw new InflateError('invalid', 'Stored length mismatch');
    if (pos + len > input.length) throw new InflateError('truncated', 'Unexpected end of data');
    need(len);
    out.set(input.subarray(pos, pos + len), outLen);
    outLen += len;
    pos += len;
  };
  const dynamic = (): void => {
    const nlen = bits(5) + 257;
    const ndist = bits(5) + 1;
    const ncode = bits(4) + 4;
    if (nlen > 286 || ndist > 30) throw new InflateError('invalid', 'Bad code counts');
    const lengths = new Uint8Array(320);
    for (let i = 0; i < ncode; i++) lengths[CODE_LENGTH_ORDER[i]!] = bits(3);
    const lencodeBuilt = buildHuffman(lengths, 19);
    if (lencodeBuilt.left !== 0) throw new InflateError('invalid', 'Incomplete code lengths');
    const lencode = lencodeBuilt.h;
    lengths.fill(0);
    let index = 0;
    while (index < nlen + ndist) {
      let sym = decode(lencode);
      if (sym < 16) {
        lengths[index++] = sym;
        continue;
      }
      let len = 0;
      if (sym === 16) {
        if (index === 0) throw new InflateError('invalid', 'Repeat with no previous length');
        len = lengths[index - 1]!;
        sym = 3 + bits(2);
      } else if (sym === 17) {
        sym = 3 + bits(3);
      } else {
        sym = 11 + bits(7);
      }
      if (index + sym > nlen + ndist) throw new InflateError('invalid', 'Too many lengths');
      while (sym--) lengths[index++] = len;
    }
    if (lengths[256] === 0) throw new InflateError('invalid', 'Missing end-of-block code');
    const lit = buildHuffman(lengths.subarray(0, nlen), nlen);
    if (lit.left < 0 || (lit.left > 0 && nlen !== lit.h.count[0]! + lit.h.count[1]!)) {
      throw new InflateError('invalid', 'Bad literal/length code');
    }
    const dist = buildHuffman(lengths.subarray(nlen, nlen + ndist), ndist);
    if (dist.left < 0 || (dist.left > 0 && ndist !== dist.h.count[0]! + dist.h.count[1]!)) {
      throw new InflateError('invalid', 'Bad distance code');
    }
    codes(lit.h, dist.h);
  };

  let last: number;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) stored();
    else if (type === 1) codes(fixed().lit, fixed().dist);
    else if (type === 2) dynamic();
    else throw new InflateError('invalid', 'Invalid block type');
  } while (!last);
  return out.slice(0, outLen);
}

// ---------------------------------------------------------------------------------------------
// Compression (fixed Huffman + LZ77)

class BitWriter {
  private buf: Uint8Array;
  private len = 0;
  private acc = 0;
  private cnt = 0;
  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(64, capacity));
  }
  /** Writes `n` bits of `value`, least significant bit first. */
  write(value: number, n: number): void {
    this.acc |= value << this.cnt;
    this.cnt += n;
    while (this.cnt >= 8) {
      this.byte(this.acc & 0xff);
      this.acc >>>= 8;
      this.cnt -= 8;
    }
  }
  /** Writes a Huffman code (most significant bit first). */
  code(code: number, n: number): void {
    let rev = 0;
    for (let i = 0; i < n; i++) rev |= ((code >> i) & 1) << (n - 1 - i);
    this.write(rev, n);
  }
  finish(): Uint8Array {
    if (this.cnt > 0) this.byte(this.acc & 0xff);
    this.acc = 0;
    this.cnt = 0;
    return this.buf.slice(0, this.len);
  }
  get length(): number {
    return this.len;
  }
  private byte(b: number): void {
    if (this.len === this.buf.length) {
      const grown = new Uint8Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf[this.len++] = b;
  }
}

function writeFixedLiteral(w: BitWriter, sym: number): void {
  if (sym < 144) w.code(0x30 + sym, 8);
  else if (sym < 256) w.code(0x190 + sym - 144, 9);
  else if (sym < 280) w.code(sym - 256, 7);
  else w.code(0xc0 + sym - 280, 8);
}

function lengthSymbol(len: number): number {
  let i = LENGTH_BASE.length - 1;
  while (LENGTH_BASE[i]! > len) i--;
  return i;
}
function distSymbol(d: number): number {
  let i = DIST_BASE.length - 1;
  while (DIST_BASE[i]! > d) i--;
  return i;
}

const WINDOW = 32768;
const HASH_BITS = 13;
const MAX_CHAIN = 32;
const MIN_MATCH = 3;
const MAX_MATCH = 258;

function deflateFixed(data: Uint8Array): Uint8Array {
  const w = new BitWriter(data.length + 16);
  w.write(1, 1); // final block
  w.write(1, 2); // fixed Huffman
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(data.length);
  const hash = (i: number): number =>
    ((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & ((1 << HASH_BITS) - 1);
  const insert = (i: number): void => {
    if (i + MIN_MATCH > data.length) return;
    const h = hash(i);
    prev[i] = head[h]!;
    head[h] = i;
  };
  let i = 0;
  while (i < data.length) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + MIN_MATCH <= data.length) {
      let cand = head[hash(i)]!;
      let chain = MAX_CHAIN;
      const maxLen = Math.min(MAX_MATCH, data.length - i);
      while (cand >= 0 && i - cand <= WINDOW && chain-- > 0) {
        let l = 0;
        while (l < maxLen && data[cand + l] === data[i + l]) l++;
        if (l > bestLen) {
          bestLen = l;
          bestDist = i - cand;
          if (l === maxLen) break;
        }
        cand = prev[cand]!;
      }
    }
    if (bestLen >= MIN_MATCH) {
      const ls = lengthSymbol(bestLen);
      writeFixedLiteral(w, 257 + ls);
      w.write(bestLen - LENGTH_BASE[ls]!, LENGTH_EXTRA[ls]!);
      const ds = distSymbol(bestDist);
      w.code(ds, 5);
      w.write(bestDist - DIST_BASE[ds]!, DIST_EXTRA[ds]!);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      writeFixedLiteral(w, data[i]!);
      insert(i);
      i++;
    }
  }
  writeFixedLiteral(w, 256);
  return w.finish();
}

function deflateStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 0xffff));
  const out = new Uint8Array(data.length + blocks * 5);
  let o = 0;
  for (let b = 0; b < blocks; b++) {
    const start = b * 0xffff;
    const len = Math.min(0xffff, data.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff;
    out[o++] = len >>> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), o);
    o += len;
  }
  return out;
}

/** Compresses to a raw deflate stream readable by any inflater (PHP gzinflate, DecompressionStream). */
export function deflateRawSync(data: Uint8Array): Uint8Array {
  const huff = deflateFixed(data);
  const storedSize = data.length + Math.max(1, Math.ceil(data.length / 0xffff)) * 5;
  return huff.length <= storedSize ? huff : deflateStored(data);
}
