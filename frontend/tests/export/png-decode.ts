/**
 * Reference PNG decoder for the tests (8-bit RGB / RGBA, no interlace): chunk walk with CRC
 * check (independent table-less CRC), node:zlib for the zlib stream, all 5 filter types.
 */
import { inflateSync } from 'node:zlib';

export interface DecodedChunk {
  readonly type: string;
  readonly data: Uint8Array;
}

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
  readonly channels: number;
  /** Always RGBA (alpha 255 for RGB images). */
  readonly rgba: Uint8Array;
  readonly chunks: readonly DecodedChunk[];
}

/** Bitwise CRC-32 (deliberately not the encoder's table). */
export function referenceCrc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function readChunks(png: Uint8Array): DecodedChunk[] {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  sig.forEach((b, i) => {
    if (png[i] !== b) throw new Error('bad signature');
  });
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: DecodedChunk[] = [];
  let o = 8;
  while (o < png.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    const data = png.subarray(o + 8, o + 8 + len);
    const crc = view.getUint32(o + 8 + len);
    if (crc !== referenceCrc32(png.subarray(o + 4, o + 8 + len)))
      throw new Error(`bad CRC ${type}`);
    chunks.push({ type, data });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  if (o !== png.length) throw new Error('trailing data');
  return chunks;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(png: Uint8Array): DecodedPng {
  const chunks = readChunks(png);
  const ihdr = chunks[0];
  if (ihdr?.type !== 'IHDR') throw new Error('IHDR first');
  const v = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, 13);
  const width = v.getUint32(0);
  const height = v.getUint32(4);
  const colorType = ihdr.data[9]!;
  if (ihdr.data[8] !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error('unsupported');
  const channels = colorType === 6 ? 4 : 3;
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = inflateSync(idat);
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new Error(`bad data length ${raw.length}`);
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= channels ? out[y * stride + i - channels]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = y > 0 && i >= channels ? out[(y - 1) * stride + i - channels]! : 0;
      const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      if (f > 4) throw new Error('bad filter');
      out[y * stride + i] = (x + p) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = out[p * channels]!;
    rgba[p * 4 + 1] = out[p * channels + 1]!;
    rgba[p * 4 + 2] = out[p * channels + 2]!;
    rgba[p * 4 + 3] = channels === 4 ? out[p * channels + 3]! : 255;
  }
  return { width, height, colorType, channels, rgba, chunks };
}

/** Collects the output of a sink into one buffer. */
export function collector(): { sink: (b: Uint8Array) => void; bytes: () => Uint8Array } {
  const parts: Uint8Array[] = [];
  return {
    sink: (b) => {
      parts.push(b);
    },
    bytes: () => new Uint8Array(Buffer.concat(parts)),
  };
}
