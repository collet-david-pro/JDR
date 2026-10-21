/**
 * Per-chunk decisions (pure): which chunks must be rebuilt / re-rendered for the current
 * render mode, and what a chunk displays meanwhile.
 */

import type { ChunkRenderMode } from './cache-lod';

export interface ChunkState {
  /** Particle content exists. */
  readonly hasContent: boolean;
  /** Content is out of date (chunk edited, layers or textures changed) or missing. */
  readonly contentDirty: boolean;
  /** Level of the cache texture, null when there is none. */
  readonly cacheLevel: number | null;
  /** The cache texture matches the current content. */
  readonly cacheValid: boolean;
}

export interface ChunkWork {
  /** (Re)build the particle content from MapView.chunkCells(). */
  readonly build: boolean;
  /** Render the cache at this level, or null. */
  readonly cacheLevel: number | null;
}

export const NO_WORK: ChunkWork = { build: false, cacheLevel: null };

export function planChunkWork(s: ChunkState, mode: ChunkRenderMode): ChunkWork {
  const needsBuild = !s.hasContent || s.contentDirty;
  if (mode.kind === 'direct') return needsBuild ? { build: true, cacheLevel: null } : NO_WORK;
  if (s.cacheLevel === mode.level && s.cacheValid) return NO_WORK;
  return { build: needsBuild, cacheLevel: mode.level };
}

export function hasWork(w: ChunkWork): boolean {
  return w.build || w.cacheLevel !== null;
}

/**
 * What to show: in direct mode the fresh content (else the stale cache, else the stale
 * content); in cached mode the cache (even stale, until re-rendered), else the content.
 */
export function chunkDisplay(s: ChunkState, mode: ChunkRenderMode): 'content' | 'cache' | 'none' {
  const hasCache = s.cacheLevel !== null;
  if (mode.kind === 'direct') {
    if (s.hasContent && !s.contentDirty) return 'content';
    if (hasCache) return 'cache';
    return s.hasContent ? 'content' : 'none';
  }
  if (hasCache) return 'cache';
  return s.hasContent ? 'content' : 'none';
}
