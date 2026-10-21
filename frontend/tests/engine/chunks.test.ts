import { describe, expect, it } from 'vitest';
import type { ChunkKey, GridSpec } from '../../src/editor/contracts';
import {
  CHUNK_RELEASE_AFTER_MS,
  ChunkResidency,
  chunkKey,
  chunkOfCell,
  isEmptyRange,
  keysInRange,
  mapChunkRange,
  parseChunkKey,
  rangeSize,
  visibleChunkRange,
} from '../../src/engine/chunk-math';
import { chunkDisplay, planChunkWork, type ChunkState } from '../../src/engine/chunk-plan';

const grid: GridSpec = { width: 200, height: 200, cellPx: 64, unitLabel: 'ft', unitPerCell: 5 };

describe('chunk keys', () => {
  it('formats and parses', () => {
    expect(chunkKey(3, -1)).toBe('3:-1');
    expect(parseChunkKey('3:-1')).toEqual({ cx: 3, cy: -1 });
    expect(parseChunkKey('x:1')).toBeNull();
  });

  it('finds the chunk of a cell', () => {
    expect(chunkOfCell(0, 31)).toEqual({ cx: 0, cy: 0 });
    expect(chunkOfCell(32, 64)).toEqual({ cx: 1, cy: 2 });
    expect(chunkOfCell(-1, 0)).toEqual({ cx: -1, cy: 0 });
  });

  it('covers the map', () => {
    expect(mapChunkRange(grid)).toEqual({ cx0: 0, cy0: 0, cx1: 6, cy1: 6 });
    expect(isEmptyRange(mapChunkRange({ ...grid, width: 0 }))).toBe(true);
  });
});

describe('culling', () => {
  // zoom 1, 64 px per cell: 1024 × 1024 viewport = 16 × 16 cells.
  const vp = { width: 1024, height: 1024 };

  it('keeps chunks intersecting the viewport', () => {
    // Centre (48, 48): cells 40..56 ⇒ chunks 1..1.
    const r = visibleChunkRange({ x: 48, y: 48, zoom: 1 }, vp, grid, 0);
    expect(r).toEqual({ cx0: 1, cy0: 1, cx1: 1, cy1: 1 });
    // Centre (32, 32): cells 24..40 ⇒ chunks 0..1.
    expect(visibleChunkRange({ x: 32, y: 32, zoom: 1 }, vp, grid, 0)).toEqual({
      cx0: 0,
      cy0: 0,
      cx1: 1,
      cy1: 1,
    });
  });

  it('a chunk only touching the edge is not visible', () => {
    // Cells 16..32 exactly: chunk 1 starts at 32 ⇒ excluded.
    expect(visibleChunkRange({ x: 24, y: 24, zoom: 1 }, vp, grid, 0)).toEqual({
      cx0: 0,
      cy0: 0,
      cx1: 0,
      cy1: 0,
    });
  });

  it('adds the margin and clips to the map', () => {
    expect(visibleChunkRange({ x: 48, y: 48, zoom: 1 }, vp, grid, 1)).toEqual({
      cx0: 0,
      cy0: 0,
      cx1: 2,
      cy1: 2,
    });
    expect(visibleChunkRange({ x: 0, y: 0, zoom: 1 }, vp, grid, 1)).toEqual({
      cx0: 0,
      cy0: 0,
      cx1: 1,
      cy1: 1,
    });
    const all = visibleChunkRange({ x: 100, y: 100, zoom: 0.05 }, vp, grid, 1);
    expect(all).toEqual(mapChunkRange(grid));
    expect(rangeSize(all)).toBe(49);
  });

  it('is empty outside the map or for an empty viewport', () => {
    expect(isEmptyRange(visibleChunkRange({ x: -100, y: 0, zoom: 1 }, vp, grid, 1))).toBe(true);
    expect(
      isEmptyRange(visibleChunkRange({ x: 0, y: 0, zoom: 1 }, { width: 0, height: 0 }, grid)),
    ).toBe(true);
  });

  it('lists existing chunks in range, nearest to the centre first', () => {
    const existing = new Set<ChunkKey>(['0:0', '1:1', '2:2', '6:6', '1:0']);
    const keys = keysInRange({ cx0: 0, cy0: 0, cx1: 2, cy1: 2 }, existing);
    expect(keys[0]).toBe('1:1');
    expect(new Set(keys)).toEqual(new Set(['0:0', '1:1', '2:2', '1:0']));
    // Same result when iterating the set (range larger than the set).
    const keys2 = keysInRange({ cx0: 0, cy0: 0, cx1: 100, cy1: 100 }, existing);
    expect(new Set(keys2)).toEqual(existing);
  });
});

describe('GPU release after 30 s off screen', () => {
  it('expires only chunks outside the range for the TTL', () => {
    const r = new ChunkResidency();
    r.touch('0:0', 0);
    r.touch('1:0', 0);
    r.touch('2:0', 20_000);
    const inRange = (k: ChunkKey): boolean => k === '1:0';
    expect(r.expire(CHUNK_RELEASE_AFTER_MS - 1, inRange)).toEqual([]);
    expect(r.expire(CHUNK_RELEASE_AFTER_MS, inRange)).toEqual(['0:0']);
    expect(r.has('0:0')).toBe(false);
    expect(r.has('1:0')).toBe(true);
    expect(r.expire(50_000, inRange)).toEqual(['2:0']);
    expect(r.size).toBe(1);
  });
});

describe('chunk work planning', () => {
  const fresh: ChunkState = {
    hasContent: true,
    contentDirty: false,
    cacheLevel: 8,
    cacheValid: true,
  };
  const cached8 = { kind: 'cached', level: 8 } as const;
  const direct = { kind: 'direct' } as const;

  it('does nothing for an up-to-date chunk', () => {
    expect(planChunkWork(fresh, cached8)).toEqual({ build: false, cacheLevel: null });
    expect(planChunkWork(fresh, direct)).toEqual({ build: false, cacheLevel: null });
    expect(planChunkWork({ ...fresh, hasContent: false }, cached8)).toEqual({
      build: false,
      cacheLevel: null,
    });
  });

  it('rebuilds edited chunks', () => {
    const edited = { ...fresh, contentDirty: true, cacheValid: false };
    expect(planChunkWork(edited, cached8)).toEqual({ build: true, cacheLevel: 8 });
    expect(planChunkWork(edited, direct)).toEqual({ build: true, cacheLevel: null });
  });

  it('only re-renders the cache on a level change when the content is kept', () => {
    expect(planChunkWork(fresh, { kind: 'cached', level: 16 })).toEqual({
      build: false,
      cacheLevel: 16,
    });
    expect(planChunkWork({ ...fresh, hasContent: false }, { kind: 'cached', level: 16 })).toEqual({
      build: true,
      cacheLevel: 16,
    });
  });

  it('builds content when switching to direct', () => {
    expect(planChunkWork({ ...fresh, hasContent: false }, direct)).toEqual({
      build: true,
      cacheLevel: null,
    });
  });

  it('keeps showing something while work is pending', () => {
    expect(chunkDisplay(fresh, cached8)).toBe('cache');
    expect(chunkDisplay({ ...fresh, cacheValid: false }, cached8)).toBe('cache');
    expect(chunkDisplay(fresh, direct)).toBe('content');
    expect(chunkDisplay({ ...fresh, contentDirty: true }, direct)).toBe('cache');
    expect(chunkDisplay({ ...fresh, cacheLevel: null }, cached8)).toBe('content');
    expect(
      chunkDisplay(
        { hasContent: false, contentDirty: true, cacheLevel: null, cacheValid: false },
        direct,
      ),
    ).toBe('none');
  });
});
