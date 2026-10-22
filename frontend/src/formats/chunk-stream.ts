/**
 * Binary answer of GET /maps/{id}/chunks (projet.md 11.4, contract P4b): a sequence of records
 * `[cx u16 LE][cy u16 LE][layer u8][len u32 LE][data]` where `data` is a raw-deflate block
 * (12.2). Decompression and validation of each block are done by chunk-codec.
 */
import type { ChunkKey, TileLayerId } from '../editor/contracts';
import { TILE_LAYERS, TILE_LAYER_CODES } from './chunk-codec';

export const CHUNK_RECORD_HEADER_BYTES = 9;
/** A compressed 4 104-byte block is far smaller; anything larger is a corrupt stream. */
export const MAX_CHUNK_RECORD_BYTES = 64 * 1024;

export interface ChunkRecord {
  readonly cx: number;
  readonly cy: number;
  readonly layer: TileLayerId;
  readonly key: ChunkKey;
  /** Compressed block (a view on the stream buffer). */
  readonly data: Uint8Array;
}

export class ChunkStreamError extends Error {
  override readonly name = 'ChunkStreamError';
}

/** Parses a whole chunk stream. Throws ChunkStreamError on a truncated or corrupt stream. */
export function parseChunkStream(bytes: Uint8Array): ChunkRecord[] {
  const out: ChunkRecord[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  while (o < bytes.length) {
    if (o + CHUNK_RECORD_HEADER_BYTES > bytes.length) {
      throw new ChunkStreamError(`Truncated record header at byte ${o}`);
    }
    const cx = view.getUint16(o, true);
    const cy = view.getUint16(o + 2, true);
    const code = view.getUint8(o + 4);
    const len = view.getUint32(o + 5, true);
    const layer = TILE_LAYERS[code];
    if (layer === undefined) throw new ChunkStreamError(`Unknown layer ${code} at byte ${o}`);
    if (len === 0 || len > MAX_CHUNK_RECORD_BYTES) {
      throw new ChunkStreamError(`Invalid block length ${len} at byte ${o}`);
    }
    const start = o + CHUNK_RECORD_HEADER_BYTES;
    if (start + len > bytes.length) throw new ChunkStreamError(`Truncated block at byte ${o}`);
    out.push({ cx, cy, layer, key: `${cx}:${cy}`, data: bytes.subarray(start, start + len) });
    o = start + len;
  }
  return out;
}

/** Builds a chunk stream (tests, fixtures). */
export function encodeChunkStream(
  records: readonly { cx: number; cy: number; layer: TileLayerId; data: Uint8Array }[],
): Uint8Array {
  const size = records.reduce((n, r) => n + CHUNK_RECORD_HEADER_BYTES + r.data.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let o = 0;
  for (const r of records) {
    view.setUint16(o, r.cx, true);
    view.setUint16(o + 2, r.cy, true);
    view.setUint8(o + 4, TILE_LAYER_CODES[r.layer]);
    view.setUint32(o + 5, r.data.length, true);
    out.set(r.data, o + CHUNK_RECORD_HEADER_BYTES);
    o += CHUNK_RECORD_HEADER_BYTES + r.data.length;
  }
  return out;
}
