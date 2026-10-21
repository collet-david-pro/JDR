/**
 * Chunk addressing, culling and residency (pure, no Pixi). projet.md 12.2 and 14.1:
 * culling per chunk with a one-chunk margin, GPU release of chunks off screen for 30 s.
 */

import { CHUNK_SIZE, type CameraState, type ChunkKey, type GridSpec } from '../editor/contracts';
import { screenToWorld, type Viewport } from './camera';

/** Off-screen chunks keep their GPU resources this long (ms). */
export const CHUNK_RELEASE_AFTER_MS = 30_000;
/** Chunks around the visible ones that are prepared ahead (built, not drawn). */
export const CHUNK_MARGIN = 1;

export function chunkKey(cx: number, cy: number): ChunkKey {
  return `${cx}:${cy}`;
}

export function parseChunkKey(key: string): { cx: number; cy: number } | null {
  const match = /^(-?\d+):(-?\d+)$/.exec(key);
  if (match === null) return null;
  return { cx: Number(match[1]), cy: Number(match[2]) };
}

/** Chunk containing a cell. */
export function chunkOfCell(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) };
}

/** Inclusive chunk index range; empty when cx1 < cx0 or cy1 < cy0. */
export interface ChunkRange {
  readonly cx0: number;
  readonly cy0: number;
  readonly cx1: number;
  readonly cy1: number;
}

export const EMPTY_RANGE: ChunkRange = { cx0: 0, cy0: 0, cx1: -1, cy1: -1 };

export function isEmptyRange(r: ChunkRange): boolean {
  return r.cx1 < r.cx0 || r.cy1 < r.cy0;
}

export function rangeSize(r: ChunkRange): number {
  return isEmptyRange(r) ? 0 : (r.cx1 - r.cx0 + 1) * (r.cy1 - r.cy0 + 1);
}

export function rangeContains(r: ChunkRange, cx: number, cy: number): boolean {
  return cx >= r.cx0 && cx <= r.cx1 && cy >= r.cy0 && cy <= r.cy1;
}

export function rangesEqual(a: ChunkRange, b: ChunkRange): boolean {
  if (isEmptyRange(a) && isEmptyRange(b)) return true;
  return a.cx0 === b.cx0 && a.cy0 === b.cy0 && a.cx1 === b.cx1 && a.cy1 === b.cy1;
}

/** All chunks of the map. */
export function mapChunkRange(grid: GridSpec): ChunkRange {
  if (grid.width <= 0 || grid.height <= 0) return EMPTY_RANGE;
  return {
    cx0: 0,
    cy0: 0,
    cx1: Math.ceil(grid.width / CHUNK_SIZE) - 1,
    cy1: Math.ceil(grid.height / CHUNK_SIZE) - 1,
  };
}

export function intersectRanges(a: ChunkRange, b: ChunkRange): ChunkRange {
  const r = {
    cx0: Math.max(a.cx0, b.cx0),
    cy0: Math.max(a.cy0, b.cy0),
    cx1: Math.min(a.cx1, b.cx1),
    cy1: Math.min(a.cy1, b.cy1),
  };
  return isEmptyRange(r) ? EMPTY_RANGE : r;
}

/**
 * Chunks intersecting the viewport, grown by `margin` chunks, limited to the map.
 * A chunk only touching the viewport edge is not counted.
 */
export function visibleChunkRange(
  camera: CameraState,
  viewport: Viewport,
  grid: GridSpec,
  margin = 0,
): ChunkRange {
  if (viewport.width <= 0 || viewport.height <= 0) return EMPTY_RANGE;
  const tl = screenToWorld(camera, viewport, grid.cellPx, 0, 0);
  const br = screenToWorld(camera, viewport, grid.cellPx, viewport.width, viewport.height);
  const eps = 1e-9;
  const view: ChunkRange = {
    cx0: Math.floor(tl.x / CHUNK_SIZE) - margin,
    cy0: Math.floor(tl.y / CHUNK_SIZE) - margin,
    cx1: Math.floor((br.x - eps) / CHUNK_SIZE) + margin,
    cy1: Math.floor((br.y - eps) / CHUNK_SIZE) + margin,
  };
  return intersectRanges(view, mapChunkRange(grid));
}

/**
 * Keys of `existing` inside `range`, nearest to the range centre first (build order).
 * Iterates whichever is smaller: the range or the set.
 */
export function keysInRange(range: ChunkRange, existing: ReadonlySet<ChunkKey>): ChunkKey[] {
  if (isEmptyRange(range)) return [];
  const out: ChunkKey[] = [];
  if (rangeSize(range) <= existing.size) {
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        const key = chunkKey(cx, cy);
        if (existing.has(key)) out.push(key);
      }
    }
  } else {
    for (const key of existing) {
      const p = parseChunkKey(key);
      if (p !== null && rangeContains(range, p.cx, p.cy)) out.push(key);
    }
  }
  const mx = (range.cx0 + range.cx1) / 2;
  const my = (range.cy0 + range.cy1) / 2;
  const dist = (key: ChunkKey): number => {
    const p = parseChunkKey(key);
    return p === null ? Infinity : Math.hypot(p.cx - mx, p.cy - my);
  };
  return out.sort((a, b) => dist(a) - dist(b));
}

/**
 * Tracks when each built chunk was last inside the culling range, to release the GPU
 * resources of chunks that stayed outside it for CHUNK_RELEASE_AFTER_MS.
 */
export class ChunkResidency {
  private readonly lastSeen = new Map<ChunkKey, number>();

  constructor(private readonly ttlMs = CHUNK_RELEASE_AFTER_MS) {}

  touch(key: ChunkKey, now: number): void {
    this.lastSeen.set(key, now);
  }

  forget(key: ChunkKey): void {
    this.lastSeen.delete(key);
  }

  clear(): void {
    this.lastSeen.clear();
  }

  has(key: ChunkKey): boolean {
    return this.lastSeen.has(key);
  }

  get size(): number {
    return this.lastSeen.size;
  }

  /** Keys not seen for the TTL and not currently in `inRange` (they are forgotten). */
  expire(now: number, inRange: (key: ChunkKey) => boolean): ChunkKey[] {
    const out: ChunkKey[] = [];
    for (const [key, seen] of this.lastSeen) {
      if (inRange(key)) continue;
      if (now - seen >= this.ttlMs) out.push(key);
    }
    for (const key of out) this.lastSeen.delete(key);
    return out;
  }
}
