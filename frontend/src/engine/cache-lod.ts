/**
 * Chunk render mode (pure). projet.md 14.1: each chunk is rendered once into a texture and
 * reused while it does not change. The cache texture resolution follows the zoom ("level" =
 * texture pixels per cell, power of two) so that its memory stays proportional to the screen
 * area; when cells get large on screen the chunks are drawn directly (sharp at any zoom,
 * few chunks visible).
 */

import { CHUNK_SIZE } from '../editor/contracts';

/** Highest cache level (texture pixels per cell): 32 × 32 = 1024² texture per chunk. */
export const CACHE_MAX_LEVEL = 32;
export const CACHE_MIN_LEVEL = 1;
/** Above this many device pixels per cell, chunks are drawn directly. */
export const DIRECT_THRESHOLD = CACHE_MAX_LEVEL * Math.SQRT2;
/** While the zoom keeps changing, the level is only switched when off by this factor. */
export const LEVEL_FORCE_RATIO = 4;

export type ChunkRenderMode =
  { readonly kind: 'direct' } | { readonly kind: 'cached'; readonly level: number };

/** Ideal mode for a given cell size in device pixels. */
export function idealRenderMode(devicePxPerCell: number): ChunkRenderMode {
  if (!(devicePxPerCell > 0)) return { kind: 'cached', level: CACHE_MIN_LEVEL };
  if (devicePxPerCell > DIRECT_THRESHOLD) return { kind: 'direct' };
  const level = 2 ** Math.round(Math.log2(devicePxPerCell));
  return { kind: 'cached', level: Math.min(CACHE_MAX_LEVEL, Math.max(CACHE_MIN_LEVEL, level)) };
}

/**
 * Mode to use now. While zooming (`settled` false) a cached level is kept unless it is off by
 * LEVEL_FORCE_RATIO or more, to avoid re-rendering every chunk at each wheel step; once the
 * zoom has settled the ideal level is applied. Switching to/from direct is immediate.
 */
export function nextRenderMode(
  current: ChunkRenderMode | null,
  devicePxPerCell: number,
  settled: boolean,
): ChunkRenderMode {
  const ideal = idealRenderMode(devicePxPerCell);
  if (current === null || settled || ideal.kind !== 'cached' || current.kind !== 'cached') {
    return ideal;
  }
  const ratio = Math.max(ideal.level / current.level, current.level / ideal.level);
  return ratio >= LEVEL_FORCE_RATIO ? ideal : current;
}

export function modesEqual(a: ChunkRenderMode | null, b: ChunkRenderMode | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === 'direct' || (b.kind === 'cached' && a.level === b.level);
}

/** Side of the cache texture of one chunk, in texture pixels. */
export function cacheTextureSize(level: number): number {
  return CHUNK_SIZE * level;
}

/** GPU memory of one chunk cache texture (RGBA8), in bytes. */
export function cacheTextureBytes(level: number): number {
  const side = cacheTextureSize(level);
  return side * side * 4;
}
