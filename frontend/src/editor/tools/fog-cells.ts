/** Small geometry helpers of the fog tool previews. */
import type { Point } from '../contracts';

/** Cells whose centre is within r of p (the brush preview), clipped to the map. */
export function brushCellsAround(
  p: Point,
  r: number,
  width: number,
  height: number,
): [number, number][] {
  const out: [number, number][] = [];
  const x0 = Math.max(0, Math.floor(p[0] - r));
  const y0 = Math.max(0, Math.floor(p[1] - r));
  const x1 = Math.min(width - 1, Math.floor(p[0] + r));
  const y1 = Math.min(height - 1, Math.floor(p[1] + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]) <= r) out.push([x, y]);
    }
  }
  return out;
}

/** Float rectangle between two points. */
export function rectBetweenPoints(
  a: Point,
  b: Point,
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}
