/**
 * Synchronous fog chunk (de)serialisation for the document and the tools (projet.md 12.3):
 * the wire form of a chunk is `[cx, cy, base64(raw deflate(2 048-byte bitmap))]`. The document
 * applies ops synchronously, so the pure JavaScript deflate is used here (2 KB per chunk).
 */
import type { ChunkKey, FogBitmap, FogChunkWire, MapOp } from '../contracts';
import { deflateRawSync, inflateRawSync } from '../../formats/deflate';
import {
  FOG_RAW_BYTES,
  createFogBitmap,
  fogFromBase64,
  fogToBase64,
  isFogEmpty,
} from '../../formats/fog-codec';
import { MapOpError, chunkKey } from './ops';

/** Server limit: chunks per fog op (etapes/P05 contract). */
export const MAX_FOG_CHUNKS_PER_OP = 200;
/** Keeps a fog op far below the 1 MB body limit (base64 text, worst case ≈ 2.8 KB a chunk). */
const MAX_FOG_OP_CHARS = 300_000;

export type FogOpType = 'fog.reveal' | 'fog.hide';

/** Bitmap of a wire chunk (throws MapOpError bad_fog on invalid data). */
export function decodeFogData(data: string): FogBitmap {
  try {
    const raw = inflateRawSync(fogFromBase64(data), FOG_RAW_BYTES);
    if (raw.length !== FOG_RAW_BYTES) throw new Error('size');
    return raw;
  } catch {
    throw new MapOpError('bad_fog', 'Invalid fog chunk data');
  }
}

/** Wire data (base64 of raw deflate) of a bitmap. */
export function encodeFogData(bits: FogBitmap): string {
  return fogToBase64(deflateRawSync(bits));
}

export function fogChunkWire(key: ChunkKey, bits: FogBitmap): FogChunkWire {
  const [cx, cy] = key.split(':').map(Number) as [number, number];
  return [cx, cy, encodeFogData(bits)];
}

/**
 * Fog ops carrying the given bitmaps (empty ones skipped), split to respect the server limits.
 * Keys are sorted so that the ops are deterministic.
 */
export function fogOps(
  type: FogOpType,
  floor: string,
  chunks: ReadonlyMap<ChunkKey, FogBitmap>,
): MapOp[] {
  const ops: MapOp[] = [];
  let current: FogChunkWire[] = [];
  let chars = 0;
  const keys = [...chunks.keys()].sort(compareKeys);
  for (const key of keys) {
    const bits = chunks.get(key)!;
    if (isFogEmpty(bits)) continue;
    const wire = fogChunkWire(key, bits);
    if (
      current.length > 0 &&
      (current.length >= MAX_FOG_CHUNKS_PER_OP || chars + wire[2].length > MAX_FOG_OP_CHARS)
    ) {
      ops.push({ type, floor, chunks: current });
      current = [];
      chars = 0;
    }
    current.push(wire);
    chars += wire[2].length + 16;
  }
  if (current.length > 0) ops.push({ type, floor, chunks: current });
  return ops;
}

/**
 * Bits of `wanted` that would actually change the current fog: for a reveal the bits not yet
 * explored, for a hide the explored ones. Only non-empty chunks are returned.
 */
export function effectiveFog(
  type: FogOpType,
  wanted: ReadonlyMap<ChunkKey, FogBitmap>,
  current: (key: ChunkKey) => FogBitmap | null,
): Map<ChunkKey, FogBitmap> {
  const out = new Map<ChunkKey, FogBitmap>();
  for (const [key, bits] of wanted) {
    const cur = current(key);
    let diff: FogBitmap | null = null;
    for (let i = 0; i < FOG_RAW_BYTES; i++) {
      const c = cur === null ? 0 : cur[i]!;
      const d = type === 'fog.reveal' ? bits[i]! & ~c : bits[i]! & c;
      if (d === 0) continue;
      diff ??= createFogBitmap();
      diff[i] = d;
    }
    if (diff !== null) out.set(key, diff);
  }
  return out;
}

/** Bitwise OR of `src` into `target` (chunk maps). */
export function mergeFog(target: Map<ChunkKey, FogBitmap>, src: ReadonlyMap<ChunkKey, FogBitmap>) {
  for (const [key, bits] of src) {
    const t = target.get(key);
    if (t === undefined) target.set(key, bits.slice());
    else for (let i = 0; i < FOG_RAW_BYTES; i++) t[i]! |= bits[i]!;
  }
}

export function fogKey(cx: number, cy: number): ChunkKey {
  return chunkKey(cx, cy);
}

function compareKeys(a: string, b: string): number {
  const [ax, ay] = a.split(':').map(Number) as [number, number];
  const [bx, by] = b.split(':').map(Number) as [number, number];
  return ay - by || ax - bx;
}
