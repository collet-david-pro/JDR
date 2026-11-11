import { describe, expect, it } from 'vitest';
import { minimapLayout, minimapPointToWorld, viewRect } from '../src/lib/minimap';

const grid = { width: 100, height: 50, cellPx: 64 };

describe('minimap', () => {
  it('fits the map keeping the aspect ratio', () => {
    const l = minimapLayout(grid, 200, 200);
    expect(l).toEqual({ width: 200, height: 100, scale: 2 });
  });

  it('computes the view rectangle', () => {
    const l = minimapLayout(grid, 200, 200);
    const r = viewRect({ x: 50, y: 25, zoom: 1 }, { width: 640, height: 320 }, grid, l);
    // 10 x 5 cells at scale 2, centred at (100, 50).
    expect(r).toEqual({ x: 90, y: 45, width: 20, height: 10 });
  });

  it('clips the rectangle to the minimap', () => {
    const l = minimapLayout(grid, 200, 200);
    const r = viewRect({ x: 0, y: 0, zoom: 1 }, { width: 640, height: 320 }, grid, l);
    expect(r).toEqual({ x: 0, y: 0, width: 10, height: 5 });
    const all = viewRect({ x: 50, y: 25, zoom: 0.05 }, { width: 6400, height: 3200 }, grid, l);
    expect(all.width).toBeLessThanOrEqual(200);
  });

  it('maps a minimap point back to cells and clamps', () => {
    const l = minimapLayout(grid, 200, 200);
    expect(minimapPointToWorld(100, 50, grid, l)).toEqual({ x: 50, y: 25 });
    expect(minimapPointToWorld(-10, 999, grid, l)).toEqual({ x: 0, y: 50 });
  });
});
