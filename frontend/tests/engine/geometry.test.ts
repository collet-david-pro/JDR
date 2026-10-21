import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../../src/editor/contracts';
import {
  FLAG_MIRROR_H,
  FLAG_MIRROR_V,
  cellSprite,
  decodeFlags,
  encodeFlags,
  variantFrame,
  variantFrameCount,
} from '../../src/engine/cell-transform';
import {
  GRID_FULL_FROM_PX,
  GRID_HIDE_BELOW_PX,
  computeGridLines,
  gridFade,
  intersectRect,
  mapScreenRect,
  snap,
} from '../../src/engine/grid-lines';
import {
  cellRuns,
  dashSegments,
  normalizeRect,
  rectDashes,
} from '../../src/engine/overlay-geometry';

describe('cell flags', () => {
  it('decodes rotation and mirrors (12.2)', () => {
    expect(decodeFlags(0)).toEqual({ quarterTurns: 0, mirrorH: false, mirrorV: false });
    expect(decodeFlags(3 | FLAG_MIRROR_V)).toEqual({
      quarterTurns: 3,
      mirrorH: false,
      mirrorV: true,
    });
    expect(decodeFlags(0xf0 | 1 | FLAG_MIRROR_H).mirrorH).toBe(true);
    for (let f = 0; f < 16; f++) expect(encodeFlags(decodeFlags(f))).toBe(f);
  });

  it('places a centred sprite covering the cell', () => {
    const s = cellSprite(2, 3, 70, 140, 70, 1 | FLAG_MIRROR_H);
    expect(s.x).toBe(175);
    expect(s.y).toBe(245);
    expect(s.scaleX).toBe(-0.5);
    expect(s.scaleY).toBe(1);
    expect(s.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(cellSprite(0, 0, 64, 32, 32, FLAG_MIRROR_V).scaleY).toBe(-2);
  });
});

describe('variants', () => {
  it('reads horizontal strips of square frames', () => {
    expect(variantFrameCount(512, 128)).toBe(4);
    expect(variantFrameCount(128, 128)).toBe(1);
    expect(variantFrameCount(300, 128)).toBe(1);
    expect(variantFrameCount(0, 0)).toBe(1);
    expect(variantFrame(5, 4)).toBe(1);
    expect(variantFrame(5, 1)).toBe(0);
  });
});

describe('grid lines', () => {
  const grid: GridSpec = { width: 10, height: 5, cellPx: 50, unitLabel: 'ft', unitPerCell: 5 };
  const vp = { width: 1000, height: 600 };

  it('fades with the cell size on screen', () => {
    expect(gridFade(GRID_HIDE_BELOW_PX)).toBe(0);
    expect(gridFade(GRID_FULL_FROM_PX)).toBe(1);
    const mid = gridFade((GRID_HIDE_BELOW_PX + GRID_FULL_FROM_PX) / 2);
    expect(mid).toBeCloseTo(0.5, 9);
  });

  it('lists the inner lines in screen space', () => {
    const cam = { x: 5, y: 2.5, zoom: 1 };
    const lines = computeGridLines(cam, vp, grid, 1);
    expect(lines.fade).toBe(1);
    expect(lines.xs).toEqual([300, 350, 400, 450, 500, 550, 600, 650, 700]);
    expect(lines.ys).toEqual([225, 275, 325, 375]);
    expect(lines.clip).toEqual({ x: 250, y: 175, w: 500, h: 250 });
  });

  it('clips to the viewport and snaps to device pixels', () => {
    const cam = { x: 5, y: 2.5, zoom: 3.333 };
    const lines = computeGridLines(cam, vp, grid, 2);
    for (const x of lines.xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(vp.width);
      expect(Number.isInteger(x * 2)).toBe(true);
    }
    expect(lines.xs.length).toBeLessThan(9);
  });

  it('hides the lines at low zoom', () => {
    const lines = computeGridLines({ x: 5, y: 2.5, zoom: 0.05 }, vp, grid, 1);
    expect(lines.fade).toBe(0);
    expect(lines.xs).toEqual([]);
  });

  it('computes the map rectangle and intersections', () => {
    expect(mapScreenRect({ x: 5, y: 2.5, zoom: 1 }, vp, grid)).toEqual({
      x: 250,
      y: 175,
      w: 500,
      h: 250,
    });
    expect(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 })).toBeNull();
    expect(snap(10.26, 2)).toBe(10.5);
  });
});

describe('overlay geometry', () => {
  it('merges cells into runs (sorted, deduplicated)', () => {
    expect(
      cellRuns([
        [2, 0],
        [0, 0],
        [1, 0],
        [1, 0],
        [5, 0],
        [0, 1],
      ]),
    ).toEqual([
      { x: 0, y: 0, w: 3 },
      { x: 5, y: 0, w: 1 },
      { x: 0, y: 1, w: 1 },
    ]);
    expect(cellRuns([])).toEqual([]);
  });

  it('normalises dragged rectangles', () => {
    expect(normalizeRect(5, 5, -3, 2)).toEqual({ x: 2, y: 5, w: 3, h: 2 });
  });

  it('dashes segments', () => {
    const d = dashSegments(0, 0, 20, 0, 6, 4);
    expect(d).toEqual([
      [0, 0, 6, 0],
      [10, 0, 16, 0],
    ]);
    expect(dashSegments(0, 0, 0, 0, 6, 4)).toEqual([]);
    const around = rectDashes(0, 0, 10, 10, 6, 4);
    const on = around.reduce((sum, [a, b, c, e]) => sum + Math.hypot(c - a, e - b), 0);
    expect(on).toBeCloseTo(24, 6); // 40 px perimeter, 60 % on
  });
});
