/**
 * Fog chunk codec (projet.md 12.3): 32×32 cells × 4×4 sub-cells = 128×128 bits = 2 048 bytes,
 * row-major, most significant bit first, bit set = explored. Stored and sent compressed with
 * raw deflate (like the tile chunks, 12.2); an all-zero bitmap is never stored.
 */
import { CHUNK_SIZE, type FogBitmap } from '../editor/contracts';
import { CompressionError, deflateRaw, inflateRaw, type CompressionOptions } from './compression';

export const FOG_SUBCELLS = 4;
/** Sub-cells per chunk side. */
export const FOG_SIDE = CHUNK_SIZE * FOG_SUBCELLS;
export const FOG_RAW_BYTES = (FOG_SIDE * FOG_SIDE) / 8;

export class FogCodecError extends Error {
  override readonly name = 'FogCodecError';
  constructor(
    readonly code: 'bad_size' | 'bad_compression',
    message: string,
  ) {
    super(message);
  }
}

export function createFogBitmap(): FogBitmap {
  return new Uint8Array(FOG_RAW_BYTES);
}

/** Bit index of sub-cell (sx, sy) of a chunk, 0 ≤ sx, sy < 128. */
export function fogBitIndex(sx: number, sy: number): number {
  return sy * FOG_SIDE + sx;
}

export function getFogBit(bits: FogBitmap, sx: number, sy: number): boolean {
  const i = fogBitIndex(sx, sy);
  return (bits[i >> 3]! & (0x80 >> (i & 7))) !== 0;
}

export function setFogBit(bits: FogBitmap, sx: number, sy: number, value = true): void {
  const i = fogBitIndex(sx, sy);
  if (value) bits[i >> 3]! |= 0x80 >> (i & 7);
  else bits[i >> 3]! &= ~(0x80 >> (i & 7));
}

export function isFogEmpty(bits: FogBitmap): boolean {
  for (let i = 0; i < bits.length; i++) if (bits[i] !== 0) return false;
  return true;
}

/** target |= src. Returns the bits newly set (null when nothing changed). */
export function fogOr(target: FogBitmap, src: FogBitmap): FogBitmap | null {
  checkSize(target);
  checkSize(src);
  let added: FogBitmap | null = null;
  for (let i = 0; i < FOG_RAW_BYTES; i++) {
    const add = src[i]! & ~target[i]!;
    if (add === 0) continue;
    added ??= createFogBitmap();
    added[i] = add;
    target[i]! |= add;
  }
  return added;
}

/** target &= ~src. Returns the bits actually cleared (null when nothing changed). */
export function fogAndNot(target: FogBitmap, src: FogBitmap): FogBitmap | null {
  checkSize(target);
  checkSize(src);
  let removed: FogBitmap | null = null;
  for (let i = 0; i < FOG_RAW_BYTES; i++) {
    const del = src[i]! & target[i]!;
    if (del === 0) continue;
    removed ??= createFogBitmap();
    removed[i] = del;
    target[i]! &= ~del;
  }
  return removed;
}

/** Compresses a bitmap; null for an all-zero bitmap. */
export async function encodeFog(
  bits: FogBitmap,
  options: CompressionOptions = {},
): Promise<Uint8Array | null> {
  checkSize(bits);
  if (isFogEmpty(bits)) return null;
  return deflateRaw(bits, options);
}

/** Decompresses and checks a stored bitmap (exact size, bounded output). */
export async function decodeFog(
  data: Uint8Array,
  options: CompressionOptions = {},
): Promise<FogBitmap> {
  let raw: Uint8Array;
  try {
    raw = await inflateRaw(data, FOG_RAW_BYTES, options);
  } catch (e) {
    if (e instanceof CompressionError) {
      throw new FogCodecError(
        e.code === 'output_limit' ? 'bad_size' : 'bad_compression',
        e.message,
      );
    }
    throw e;
  }
  checkSize(raw);
  return raw;
}

function checkSize(bits: Uint8Array): void {
  if (bits.length !== FOG_RAW_BYTES) {
    throw new FogCodecError('bad_size', `Fog bitmap must be ${FOG_RAW_BYTES} bytes`);
  }
}

/** Base64 of bytes (wire form of FogChunkWire). */
export function fogToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Bytes of a base64 string; throws FogCodecError on invalid text. */
export function fogFromBase64(text: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new FogCodecError('bad_compression', 'Invalid base64');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
