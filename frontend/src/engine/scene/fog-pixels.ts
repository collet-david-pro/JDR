/**
 * Fog chunk ⇒ texture pixels (pure). A 2 048-byte bitmap (12.3, 128 × 128 sub-cells, MSB
 * first) becomes a 128 × 128 RGBA mask, premultiplied white:
 * - 'unexplored' (GM veil): opaque where the bit is 0;
 * - 'explored' (player / display mask): opaque where the bit is 1.
 */

import { CHUNK_SIZE, type FogBitmap } from '../../editor/contracts';
import { FOG_RAW_BYTES, FOG_SIDE, FOG_SUBCELLS } from '../../formats/fog-codec';

export type FogMaskKind = 'unexplored' | 'explored';

export const FOG_TEXTURE_BYTES = FOG_SIDE * FOG_SIDE * 4;

export function fogPixels(
  bits: FogBitmap | null,
  kind: FogMaskKind,
  out: Uint8Array = new Uint8Array(FOG_TEXTURE_BYTES),
): Uint8Array {
  const on = kind === 'explored' ? 255 : 0;
  const off = 255 - on;
  if (bits === null || bits.length !== FOG_RAW_BYTES) {
    out.fill(off);
    return out;
  }
  for (let byte = 0; byte < FOG_RAW_BYTES; byte++) {
    const v = bits[byte]!;
    const base = byte * 32;
    if (v === 0 || v === 255) {
      out.fill(v === 0 ? off : on, base, base + 32);
      continue;
    }
    for (let bit = 0; bit < 8; bit++) {
      const value = (v & (0x80 >> bit)) !== 0 ? on : off;
      const p = base + bit * 4;
      out[p] = value;
      out[p + 1] = value;
      out[p + 2] = value;
      out[p + 3] = value;
    }
  }
  return out;
}

/** Part of a chunk inside the map, in sub-cells (edge chunks are cropped). */
export function fogFrame(
  cx: number,
  cy: number,
  width: number,
  height: number,
): { readonly w: number; readonly h: number } {
  const w = Math.min(FOG_SIDE, Math.max(0, (width - cx * CHUNK_SIZE) * FOG_SUBCELLS));
  const h = Math.min(FOG_SIDE, Math.max(0, (height - cy * CHUNK_SIZE) * FOG_SUBCELLS));
  return { w, h };
}

/** All chunk keys of a map (the GM veil covers chunks without any bitmap). */
export function mapChunkKeys(width: number, height: number): `${number}:${number}`[] {
  const out: `${number}:${number}`[] = [];
  const nx = Math.ceil(width / CHUNK_SIZE);
  const ny = Math.ceil(height / CHUNK_SIZE);
  for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) out.push(`${cx}:${cy}`);
  return out;
}
