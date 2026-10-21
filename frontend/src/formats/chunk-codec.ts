/**
 * Tile chunk codec (projet.md 12.2).
 *
 * Raw block = 4 104 bytes: 8-byte header ("J", "C", version u8 = 1, layer u8 (0 ground,
 * 1 terrain, 2 decor), 4 reserved bytes = 0) then 1 024 cells row by row, 4 bytes each:
 * palette_index u16 LE, variant u8, flags u8. Stored compressed with raw deflate.
 *
 * In memory a chunk is a Uint16Array of 32×32×4 values (index, variant, flags, 0) — the layout
 * of MapView.chunkCells (src/editor/contracts.ts).
 */
import { CHUNK_SIZE, type TileLayerId } from '../editor/contracts';
import { CompressionError, deflateRaw, inflateRaw, type CompressionOptions } from './compression';

export const CHUNK_CELLS = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_HEADER_BYTES = 8;
export const CHUNK_RAW_BYTES = CHUNK_HEADER_BYTES + CHUNK_CELLS * 4;
export const CHUNK_FORMAT_VERSION = 1;
/** Uint16 values per cell in the in-memory layout. */
export const CELL_STRIDE = 4;

export const TILE_LAYERS: readonly TileLayerId[] = ['ground', 'terrain', 'decor'];
export const TILE_LAYER_CODES: Readonly<Record<TileLayerId, number>> = {
  ground: 0,
  terrain: 1,
  decor: 2,
};

export type ChunkCodecErrorCode =
  | 'bad_cells'
  | 'bad_size'
  | 'bad_magic'
  | 'bad_version'
  | 'bad_layer'
  | 'bad_palette_index'
  | 'bad_compression';

export class ChunkCodecError extends Error {
  override readonly name = 'ChunkCodecError';
  constructor(
    readonly code: ChunkCodecErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface DecodedChunk {
  readonly layer: TileLayerId;
  /** 32×32×4 values: index, variant, flags, 0. */
  readonly cells: Uint16Array;
  /** Number of non-empty cells (index ≠ 0). */
  readonly filled: number;
}

export interface DecodeOptions {
  /** Palette length: every index must be < paletteSize. */
  readonly paletteSize: number;
  /** When set, the header layer must match. */
  readonly layer?: TileLayerId;
}

/** Allocates an empty in-memory chunk. */
export function createChunkCells(): Uint16Array {
  return new Uint16Array(CHUNK_CELLS * CELL_STRIDE);
}

/** Encodes in-memory cells to a raw block. Returns null for an entirely empty block (12.2). */
export function encodeChunkRaw(layer: TileLayerId, cells: Uint16Array): Uint8Array | null {
  if (cells.length !== CHUNK_CELLS * CELL_STRIDE) {
    throw new ChunkCodecError('bad_cells', `Expected ${CHUNK_CELLS * CELL_STRIDE} values`);
  }
  const raw = new Uint8Array(CHUNK_RAW_BYTES);
  raw[0] = 0x4a; // "J"
  raw[1] = 0x43; // "C"
  raw[2] = CHUNK_FORMAT_VERSION;
  raw[3] = TILE_LAYER_CODES[layer];
  let filled = 0;
  for (let i = 0, o = CHUNK_HEADER_BYTES; i < CHUNK_CELLS; i++, o += 4) {
    const s = i * CELL_STRIDE;
    const index = cells[s]!;
    const variant = cells[s + 1]!;
    const flags = cells[s + 2]!;
    if (index === 0) {
      if (variant !== 0 || flags !== 0) {
        throw new ChunkCodecError('bad_cells', `Empty cell ${i} has a variant or flags`);
      }
      continue;
    }
    if (variant > 0xff || flags > 0xff) {
      throw new ChunkCodecError('bad_cells', `Cell ${i}: variant/flags out of range`);
    }
    filled++;
    raw[o] = index & 0xff;
    raw[o + 1] = index >>> 8;
    raw[o + 2] = variant;
    raw[o + 3] = flags;
  }
  return filled === 0 ? null : raw;
}

/** Validates and decodes a raw block. Returns null when every cell is empty. */
export function decodeChunkRaw(raw: Uint8Array, options: DecodeOptions): DecodedChunk | null {
  if (raw.length !== CHUNK_RAW_BYTES) {
    throw new ChunkCodecError('bad_size', `Expected ${CHUNK_RAW_BYTES} bytes, got ${raw.length}`);
  }
  if (raw[0] !== 0x4a || raw[1] !== 0x43) throw new ChunkCodecError('bad_magic', 'Bad magic');
  if (raw[2] !== CHUNK_FORMAT_VERSION) {
    throw new ChunkCodecError('bad_version', `Unsupported chunk version ${raw[2]}`);
  }
  const layer = TILE_LAYERS[raw[3]!];
  if (layer === undefined) throw new ChunkCodecError('bad_layer', `Unknown layer ${raw[3]}`);
  if (options.layer !== undefined && options.layer !== layer) {
    throw new ChunkCodecError('bad_layer', `Expected layer ${options.layer}, got ${layer}`);
  }
  const cells = createChunkCells();
  let filled = 0;
  for (let i = 0, o = CHUNK_HEADER_BYTES; i < CHUNK_CELLS; i++, o += 4) {
    const index = raw[o]! | (raw[o + 1]! << 8);
    if (index === 0) continue; // variant/flags of an empty cell are ignored
    if (index >= options.paletteSize) {
      throw new ChunkCodecError('bad_palette_index', `Cell ${i}: palette index ${index} too large`);
    }
    const s = i * CELL_STRIDE;
    cells[s] = index;
    cells[s + 1] = raw[o + 2]!;
    cells[s + 2] = raw[o + 3]!;
    filled++;
  }
  return filled === 0 ? null : { layer, cells, filled };
}

/** Encodes and compresses (raw deflate). Null for an empty block. */
export async function encodeChunk(
  layer: TileLayerId,
  cells: Uint16Array,
  options: CompressionOptions = {},
): Promise<Uint8Array | null> {
  const raw = encodeChunkRaw(layer, cells);
  return raw === null ? null : deflateRaw(raw, options);
}

/** Decompresses (bounded to 4 104 bytes) and decodes a block. */
export async function decodeChunk(
  data: Uint8Array,
  options: DecodeOptions & CompressionOptions,
): Promise<DecodedChunk | null> {
  let raw: Uint8Array;
  try {
    raw = await inflateRaw(data, CHUNK_RAW_BYTES, options);
  } catch (e) {
    if (e instanceof CompressionError) {
      throw new ChunkCodecError(
        e.code === 'output_limit' ? 'bad_size' : 'bad_compression',
        e.message,
      );
    }
    throw e;
  }
  return decodeChunkRaw(raw, options);
}
