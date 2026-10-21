/**
 * Geometry helpers for the edit overlay (pure).
 */

export interface CellRun {
  readonly x: number;
  readonly y: number;
  /** Number of cells, ≥ 1. */
  readonly w: number;
}

/** Merges cells into horizontal runs (sorted by row then column, duplicates removed). */
export function cellRuns(cells: readonly (readonly [number, number])[]): CellRun[] {
  if (cells.length === 0) return [];
  const sorted = cells
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => [Math.floor(x), Math.floor(y)] as const)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const runs: CellRun[] = [];
  let current: { x: number; y: number; w: number } | null = null;
  for (const [x, y] of sorted) {
    if (current !== null && current.y === y) {
      const end: number = current.x + current.w;
      if (x < end) continue; // duplicate
      if (x === end) {
        current.w++;
        continue;
      }
    }
    if (current !== null) runs.push(current);
    current = { x, y, w: 1 };
  }
  if (current !== null) runs.push(current);
  return runs;
}

/** Rectangle with non-negative width/height (a drag may go up/left). */
export function normalizeRect(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: w < 0 ? x + w : x,
    y: h < 0 ? y + h : y,
    w: Math.abs(w),
    h: Math.abs(h),
  };
}

export type Segment = readonly [x0: number, y0: number, x1: number, y1: number];

/**
 * Dashes along the segment (x0, y0) → (x1, y1): `dash` long, `gap` apart, starting at
 * `phase` along the pattern. Returns the "on" segments.
 */
export function dashSegments(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dash: number,
  gap: number,
  phase = 0,
): Segment[] {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const period = dash + gap;
  if (!(length > 0) || !(dash > 0) || !(period > 0)) return [];
  const ux = (x1 - x0) / length;
  const uy = (y1 - y0) / length;
  const out: Segment[] = [];
  let t = -(((phase % period) + period) % period);
  while (t < length) {
    const a = Math.max(0, t);
    const b = Math.min(length, t + dash);
    if (b > a) out.push([x0 + ux * a, y0 + uy * a, x0 + ux * b, y0 + uy * b]);
    t += period;
    if (out.length > 10_000) break;
  }
  return out;
}

/** Dashes around a rectangle (clockwise, continuous pattern). */
export function rectDashes(
  x: number,
  y: number,
  w: number,
  h: number,
  dash: number,
  gap: number,
): Segment[] {
  const corners: [number, number][] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ];
  const out: Segment[] = [];
  let travelled = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i] as [number, number];
    const [bx, by] = corners[i + 1] as [number, number];
    out.push(...dashSegments(ax, ay, bx, by, dash, gap, travelled));
    travelled += Math.hypot(bx - ax, by - ay);
  }
  return out;
}
