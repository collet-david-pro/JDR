/** Cell rasterisation helpers. Points are [x, y] integer cells. */
import type { BrushShape, CellRect } from './types';

export type Point = readonly [number, number];

/** Bresenham line, both ends included. */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Point[] {
  const out: Point[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** Normalised rectangle spanning two corner cells (inclusive). */
export function rectBetween(a: Point, b: Point): CellRect {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 };
}

export function rectCells(r: CellRect, filled: boolean): Point[] {
  const out: Point[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (filled || x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1) {
        out.push([x, y]);
      }
    }
  }
  return out;
}

/** Ellipse inscribed in the rectangle (cell centres inside), filled or 4-connected outline. */
export function ellipseCells(r: CellRect, filled: boolean): Point[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const inside = (x: number, y: number): boolean => {
    if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return false;
    const nx = (x + 0.5 - cx) / rx;
    const ny = (y + 0.5 - cy) / ry;
    return nx * nx + ny * ny <= 1;
  };
  const out: Point[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!inside(x, y)) continue;
      if (
        filled ||
        !inside(x - 1, y) ||
        !inside(x + 1, y) ||
        !inside(x, y - 1) ||
        !inside(x, y + 1)
      ) {
        out.push([x, y]);
      }
    }
  }
  return out;
}

const footprintCache = new Map<string, readonly Point[]>();

/** Brush footprint offsets for a size (1-16) and shape, centred on the cursor cell. */
export function brushFootprint(size: number, shape: BrushShape): readonly Point[] {
  const key = `${size}:${shape}`;
  const cached = footprintCache.get(key);
  if (cached !== undefined) return cached;
  const start = 0 - Math.floor((size - 1) / 2);
  const centre = start + (size - 1) / 2;
  const r = size / 2 - 0.25;
  const out: Point[] = [];
  for (let dy = start; dy < start + size; dy++) {
    for (let dx = start; dx < start + size; dx++) {
      const ox = dx - centre;
      const oy = dy - centre;
      if (shape === 'square' || size <= 2 || ox * ox + oy * oy <= r * r) out.push([dx, dy]);
    }
  }
  footprintCache.set(key, out);
  return out;
}
