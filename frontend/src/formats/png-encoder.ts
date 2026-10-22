/**
 * Streaming PNG encoder (projet.md 17).
 *
 * signature, IHDR (RGBA 8 bits, or RGB 8 bits when the image is opaque), optional pHYs (print
 * density), tEXt (iTXt when a value is not Latin-1), then the filtered rows (Sub or Paeth, chosen
 * per row by the minimum sum of absolute differences) compressed as a **zlib** stream
 * (CompressionStream('deflate'), never 'deflate-raw' here) cut into IDAT chunks of 64 KB with
 * their CRC32, then IEND. Without CompressionStream a JS zlib stream built on formats/deflate.ts
 * is used (see DeflateStream).
 *
 * Rows go in by bands (writeRows) and bytes come out through an async sink: every await in the
 * chain propagates back-pressure, so memory stays bounded by one band plus the stream buffers.
 * Emitted Uint8Arrays are never reused by the encoder (they can be transferred).
 */
import { deflateRawSync } from './deflate';

/* ---- Checksums -------------------------------------------------------------------------------- */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO 3309, as used by PNG and ZIP); pass the previous value to continue a running CRC. */
export function crc32(data: Uint8Array, previous = 0): number {
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 (zlib trailer); pass the previous value to continue. */
export function adler32(data: Uint8Array, previous = 1): number {
  let a = previous & 0xffff;
  let b = previous >>> 16;
  let i = 0;
  while (i < data.length) {
    const end = Math.min(data.length, i + 5552);
    for (; i < end; i++) {
      a += data[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/* ---- Deflate streams (zlib or raw) -------------------------------------------------------------- */

export type ByteSink = (bytes: Uint8Array) => void | Promise<void>;

export interface DeflateStream {
  /** Resolves when `data` has been consumed (back-pressure). `data` must not be modified after. */
  write(data: Uint8Array): Promise<void>;
  /** Flushes and ends the stream (all output delivered to the sink). */
  close(): Promise<void>;
  abort(reason?: unknown): void;
}

export type DeflateFormat = 'zlib' | 'raw';

let nativeDeflate: boolean | null = null;

/** True when CompressionStream supports both 'deflate' (zlib) and 'deflate-raw'. */
export function hasNativeDeflate(): boolean {
  if (nativeDeflate === null) {
    try {
      new CompressionStream('deflate');
      new CompressionStream('deflate-raw');
      nativeDeflate = true;
    } catch {
      nativeDeflate = false;
    }
  }
  return nativeDeflate;
}

class NativeDeflateStream implements DeflateStream {
  private readonly writer: WritableStreamDefaultWriter<BufferSource>;
  private readonly pumping: Promise<void>;
  private failure: unknown = null;

  constructor(format: DeflateFormat, sink: ByteSink) {
    const cs = new CompressionStream(format === 'zlib' ? 'deflate' : 'deflate-raw');
    this.writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    this.pumping = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          await sink(value);
        }
      } catch (error) {
        this.failure = error;
        // Errors the writable side too, so a pending write() rejects instead of hanging.
        await reader.cancel(error).catch(() => undefined);
        throw error;
      }
    })();
    this.pumping.catch(() => undefined);
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.failure !== null) throw this.failure;
    try {
      await this.writer.write(data as Uint8Array<ArrayBuffer>);
    } catch (error) {
      throw this.failure ?? error;
    }
  }

  async close(): Promise<void> {
    if (this.failure !== null) throw this.failure;
    await this.writer.close().catch((error: unknown) => {
      throw this.failure ?? error;
    });
    await this.pumping;
  }

  abort(reason?: unknown): void {
    this.writer.abort(reason).catch(() => undefined);
  }
}

/** Extra bits of the length symbols 257..285 and of the distance symbols 0..29 (RFC 1951). */
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const distExtra = (d: number): number => (d < 4 ? 0 : (d >> 1) - 1);

/**
 * Bit length of the single fixed-Huffman block written by deflateRawSync (header and end-of-block
 * code included): needed to append further blocks after it.
 */
export function fixedBlockBitLength(data: Uint8Array): number {
  let pos = 3;
  const bit = (): number => {
    const byte = data[pos >> 3];
    if (byte === undefined) throw new Error('Truncated deflate block');
    const b = (byte >> (pos & 7)) & 1;
    pos++;
    return b;
  };
  const bits = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v |= bit() << i;
    return v;
  };
  for (;;) {
    let code = 0;
    for (let i = 0; i < 7; i++) code = (code << 1) | bit();
    let sym: number;
    if (code <= 0x17) sym = 256 + code;
    else {
      code = (code << 1) | bit();
      if (code >= 0x30 && code <= 0xbf) sym = code - 0x30;
      else if (code >= 0xc0 && code <= 0xc7) sym = 280 + code - 0xc0;
      else sym = 144 + ((code << 1) | bit()) - 0x190;
    }
    if (sym === 256) return pos;
    if (sym < 256) continue;
    bits(LENGTH_EXTRA[sym - 257] ?? 0);
    let dist = 0;
    for (let i = 0; i < 5; i++) dist = (dist << 1) | bit();
    bits(distExtra(dist));
  }
}

/** Uncompressed bytes per JS deflate segment (independent blocks; small ratio loss). */
export const JS_SEGMENT_BYTES = 256 * 1024;
const SYNC_TAIL = new Uint8Array([0, 0, 0xff, 0xff]);

/**
 * Deflate stream on top of the synchronous deflateRawSync (fixed Huffman, fast level): data is
 * cut into segments compressed independently; every non-final segment gets its BFINAL bit
 * cleared and is followed by an empty stored block (sync flush) so that the next one starts on a
 * byte boundary. zlib format adds the 2-byte header and the Adler-32 trailer.
 */
class JsDeflateStream implements DeflateStream {
  private parts: Uint8Array[] = [];
  private size = 0;
  private adler = 1;
  private started = false;
  private aborted: unknown = null;

  constructor(
    private readonly format: DeflateFormat,
    private readonly sink: ByteSink,
    private readonly segment = JS_SEGMENT_BYTES,
  ) {}

  async write(data: Uint8Array): Promise<void> {
    if (this.aborted !== null) throw this.aborted;
    if (this.format === 'zlib') this.adler = adler32(data, this.adler);
    this.parts.push(data);
    this.size += data.length;
    while (this.size >= this.segment) await this.flushSegment(false);
  }

  async close(): Promise<void> {
    if (this.aborted !== null) throw this.aborted;
    await this.flushSegment(true);
    if (this.format === 'zlib') {
      const a = this.adler;
      await this.sink(new Uint8Array([a >>> 24, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff]));
    }
  }

  abort(reason?: unknown): void {
    this.aborted = reason ?? new Error('aborted');
    this.parts = [];
    this.size = 0;
  }

  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      const p = this.parts[0]!;
      const k = Math.min(p.length, n - o);
      out.set(p.subarray(0, k), o);
      o += k;
      if (k === p.length) this.parts.shift();
      else this.parts[0] = p.subarray(k);
    }
    this.size -= n;
    return out;
  }

  private async flushSegment(final: boolean): Promise<void> {
    const data = this.take(final ? this.size : this.segment);
    let out = deflateRawSync(data);
    if (!final) out = unfinalize(out);
    if (this.format === 'zlib' && !this.started) {
      // CMF 0x78 (deflate, 32 KB window), FLG 0x01 (fastest; (CMF*256+FLG) % 31 = 0).
      const withHeader = new Uint8Array(out.length + 2);
      withHeader[0] = 0x78;
      withHeader[1] = 0x01;
      withHeader.set(out, 2);
      out = withHeader;
    }
    this.started = true;
    await this.sink(out);
  }
}

/** Turns a final deflateRawSync output into a non-final run ending on a byte boundary. */
function unfinalize(block: Uint8Array): Uint8Array {
  const type = (block[0]! >> 1) & 3;
  if (type === 0) {
    // Stored blocks (byte aligned): clear BFINAL of the last one.
    const out = block.slice();
    const last = Math.max(0, Math.ceil((out.length - 5) / 0x10004) - 1) * 0x10004;
    out[last] = out[last]! & ~1;
    return out;
  }
  const bitLen = fixedBlockBitLength(block);
  // 3 zero bits (BFINAL 0, BTYPE 00) right after the end-of-block code, padding to the byte, then
  // LEN 0 / NLEN 0xFFFF: an empty stored block.
  const head = Math.ceil((bitLen + 3) / 8);
  const out = new Uint8Array(head + SYNC_TAIL.length);
  out.set(block.subarray(0, Math.min(head, block.length)));
  out[0] = out[0]! & ~1;
  // Bits after bitLen in the copied bytes are deflateRawSync's zero padding.
  out.set(SYNC_TAIL, head);
  return out;
}

export interface DeflateStreamOptions {
  /** 'auto' (native when available), or force one implementation (tests). */
  readonly impl?: 'auto' | 'native' | 'js';
  /** JS segment size (tests). */
  readonly jsSegmentBytes?: number;
}

export function createDeflateStream(
  format: DeflateFormat,
  sink: ByteSink,
  options: DeflateStreamOptions = {},
): DeflateStream {
  const impl = options.impl ?? 'auto';
  if (impl === 'native' || (impl === 'auto' && hasNativeDeflate())) {
    return new NativeDeflateStream(format, sink);
  }
  return new JsDeflateStream(format, sink, options.jsSegmentBytes ?? JS_SEGMENT_BYTES);
}

/* ---- PNG -------------------------------------------------------------------------------------- */

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const PNG_MAX_DIMENSION = 0x7fffffff;
export const IDAT_SIZE = 64 * 1024;
export const FILTER_SUB = 1;
export const FILTER_PAETH = 4;

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** One PNG chunk: length, type, data, CRC32(type + data). */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(ascii(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const isLatin1 = (s: string): boolean => [...s].every((c) => c.charCodeAt(0) <= 0xff);

/** tEXt chunk, or iTXt (UTF-8) when the value is not Latin-1. Keywords are 1-79 Latin-1 chars. */
export function textChunk(keyword: string, value: string): Uint8Array {
  const key = ascii(keyword.slice(0, 79));
  if (isLatin1(value)) {
    const v = ascii(value);
    const data = new Uint8Array(key.length + 1 + v.length);
    data.set(key);
    data.set(v, key.length + 1);
    return pngChunk('tEXt', data);
  }
  const v = new TextEncoder().encode(value);
  // keyword \0, compression flag 0, method 0, language "" \0, translated keyword "" \0, text.
  const data = new Uint8Array(key.length + 5 + v.length);
  data.set(key);
  data.set(v, key.length + 5);
  return pngChunk('iTXt', data);
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

const cost = (v: number): number => (v < 128 ? v : 256 - v);

/**
 * Filters one row into `out` (filter type byte + row): Sub or Paeth, whichever has the smaller
 * sum of absolute (signed) residuals. `prev` is the previous unfiltered row (zeros for the first).
 */
export function filterRow(row: Uint8Array, prev: Uint8Array, bpp: number, out: Uint8Array): number {
  const n = row.length;
  let sub = 0;
  let pae = 0;
  for (let i = 0; i < n; i++) {
    const a = i >= bpp ? row[i - bpp]! : 0;
    const c = i >= bpp ? prev[i - bpp]! : 0;
    sub += cost((row[i]! - a) & 0xff);
    pae += cost((row[i]! - paeth(a, prev[i]!, c)) & 0xff);
  }
  const type = pae < sub ? FILTER_PAETH : FILTER_SUB;
  out[0] = type;
  for (let i = 0; i < n; i++) {
    const a = i >= bpp ? row[i - bpp]! : 0;
    const p = type === FILTER_SUB ? a : paeth(a, prev[i]!, i >= bpp ? prev[i - bpp]! : 0);
    out[i + 1] = (row[i]! - p) & 0xff;
  }
  return type;
}

export interface PngTextEntry {
  readonly keyword: string;
  readonly value: string;
}

export interface PngEncoderOptions {
  readonly width: number;
  readonly height: number;
  /** true: RGBA; false: RGB (the alpha of the input rows is dropped). */
  readonly alpha: boolean;
  /** pHYs density in pixels per metre (print mode); omitted when null/undefined. */
  readonly pixelsPerMeter?: number | null;
  readonly text?: readonly PngTextEntry[];
  readonly idatSize?: number;
  readonly deflate?: DeflateStreamOptions;
}

export class PngEncoder {
  private readonly bpp: number;
  private prev: Uint8Array;
  private row: Uint8Array;
  private idat: Uint8Array;
  private idatLength = 0;
  private stream: DeflateStream | null = null;
  private rows = 0;
  private state: 'new' | 'open' | 'done' | 'aborted' = 'new';

  constructor(
    private readonly options: PngEncoderOptions,
    private readonly sink: ByteSink,
  ) {
    const { width, height } = options;
    for (const v of [width, height]) {
      if (!Number.isInteger(v) || v < 1 || v > PNG_MAX_DIMENSION) {
        throw new RangeError(`Invalid PNG dimension: ${v}`);
      }
    }
    this.bpp = options.alpha ? 4 : 3;
    this.prev = new Uint8Array(width * this.bpp);
    this.row = new Uint8Array(width * this.bpp);
    this.idat = new Uint8Array(options.idatSize ?? IDAT_SIZE);
  }

  get rowsWritten(): number {
    return this.rows;
  }

  /** Writes the signature and the header chunks. */
  async begin(): Promise<void> {
    if (this.state !== 'new') throw new Error('PNG encoder already started');
    this.state = 'open';
    const { width, height, alpha, pixelsPerMeter, text } = this.options;
    const ihdr = new Uint8Array(13);
    const v = new DataView(ihdr.buffer);
    v.setUint32(0, width);
    v.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = alpha ? 6 : 2; // colour type RGBA / RGB
    // compression 0, filter method 0, no interlace
    const head: Uint8Array[] = [PNG_SIGNATURE.slice(), pngChunk('IHDR', ihdr)];
    if (pixelsPerMeter != null && pixelsPerMeter > 0) {
      const phys = new Uint8Array(9);
      const ppm = Math.min(0xffffffff, Math.round(pixelsPerMeter));
      new DataView(phys.buffer).setUint32(0, ppm);
      new DataView(phys.buffer).setUint32(4, ppm);
      phys[8] = 1; // unit: metre
      head.push(pngChunk('pHYs', phys));
    }
    for (const entry of text ?? []) head.push(textChunk(entry.keyword, entry.value));
    for (const chunk of head) await this.sink(chunk);
    this.stream = createDeflateStream(
      'zlib',
      (bytes) => this.onCompressed(bytes),
      this.options.deflate,
    );
  }

  /**
   * Appends `count` rows of RGBA pixels (width × 4 bytes each, row-major, starting at `offset`).
   * Resolves once the compressor accepted them.
   */
  async writeRows(rgba: Uint8Array | Uint8ClampedArray, count: number, offset = 0): Promise<void> {
    if (this.state !== 'open' || this.stream === null) throw new Error('PNG encoder not open');
    const { width, height } = this.options;
    if (this.rows + count > height) throw new RangeError('Too many rows');
    if (rgba.length < offset + count * width * 4) throw new RangeError('Row data too short');
    const stride = width * this.bpp;
    const out = new Uint8Array(count * (stride + 1));
    for (let r = 0; r < count; r++) {
      const src = offset + r * width * 4;
      if (this.bpp === 4) {
        this.row.set(rgba.subarray(src, src + width * 4));
      } else {
        const row = this.row;
        for (let x = 0, s = src, d = 0; x < width; x++, s += 4, d += 3) {
          row[d] = rgba[s]!;
          row[d + 1] = rgba[s + 1]!;
          row[d + 2] = rgba[s + 2]!;
        }
      }
      filterRow(
        this.row,
        this.prev,
        this.bpp,
        out.subarray(r * (stride + 1), (r + 1) * (stride + 1)),
      );
      const swap = this.prev;
      this.prev = this.row;
      this.row = swap;
    }
    this.rows += count;
    await this.stream.write(out);
  }

  /** Ends the zlib stream, writes the last IDAT and IEND. All rows must have been written. */
  async end(): Promise<void> {
    if (this.state !== 'open' || this.stream === null) throw new Error('PNG encoder not open');
    if (this.rows !== this.options.height) {
      throw new Error(`PNG incomplete: ${this.rows}/${this.options.height} rows`);
    }
    await this.stream.close();
    if (this.idatLength > 0) await this.emitIdat();
    await this.sink(pngChunk('IEND', new Uint8Array(0)));
    this.state = 'done';
  }

  abort(reason?: unknown): void {
    if (this.state === 'done') return;
    this.state = 'aborted';
    this.stream?.abort(reason);
  }

  private async onCompressed(bytes: Uint8Array): Promise<void> {
    let o = 0;
    while (o < bytes.length) {
      const k = Math.min(bytes.length - o, this.idat.length - this.idatLength);
      this.idat.set(bytes.subarray(o, o + k), this.idatLength);
      this.idatLength += k;
      o += k;
      if (this.idatLength === this.idat.length) await this.emitIdat();
    }
  }

  private async emitIdat(): Promise<void> {
    const chunk = pngChunk('IDAT', this.idat.subarray(0, this.idatLength));
    this.idatLength = 0;
    await this.sink(chunk);
  }
}
