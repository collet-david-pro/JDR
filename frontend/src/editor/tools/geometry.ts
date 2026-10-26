/**
 * Geometry helpers of the object tools (cells, floats): segments, projection, snapping
 * (projet.md 15.2: grid, half cell, wall ends and middles; Alt disables it).
 */
import type { MapObject, Point, WallObject } from '../contracts';
import { round3 } from '../model/scene-values';

export interface Projection {
  /** Closest point of the segment. */
  readonly point: Point;
  /** 0..1 along the segment. */
  readonly t: number;
  readonly distance: number;
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function project(p: Point, a: Point, b: Point): Projection {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const point: Point = [a[0] + dx * t, a[1] + dy * t];
  return { point, t, distance: dist(p, point) };
}

/** Segments [a, b] of a wall polyline (closing segment included when closed). */
export function wallSegments(wall: WallObject): [Point, Point][] {
  const pts = wall.geometry.points;
  const out: [Point, Point][] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i]!, pts[i + 1]!]);
  if (wall.geometry.closed && pts.length > 2) out.push([pts[pts.length - 1]!, pts[0]!]);
  return out;
}

export function clampPoint(p: Point, width: number, height: number): Point {
  return [round3(Math.min(width, Math.max(0, p[0]))), round3(Math.min(height, Math.max(0, p[1])))];
}

export type SnapKind = 'none' | 'grid' | 'wall_end' | 'wall_middle';

export interface Snapped {
  readonly point: Point;
  readonly kind: SnapKind;
}

/** Nearest multiple of `step` (grid = 1, half cell = 0.5). */
export function snapToGrid(p: Point, step = 0.5): Point {
  return [round3(Math.round(p[0] / step) * step), round3(Math.round(p[1] / step) * step)];
}

/**
 * Snapped point: wall ends then wall middles within `tolerance` cells, else the half-cell grid.
 * `alt`: no snapping (rounded to 3 decimals). The result is clamped to the map.
 */
export function snapPoint(
  p: Point,
  objects: readonly MapObject[],
  tolerance: number,
  bounds: { readonly width: number; readonly height: number },
  alt: boolean,
  exclude?: (o: MapObject) => boolean,
): Snapped {
  if (alt) return { point: clampPoint(p, bounds.width, bounds.height), kind: 'none' };
  let best: Snapped | null = null;
  let bestD = tolerance;
  const consider = (q: Point, kind: SnapKind) => {
    const d = dist(p, q);
    // Ends win over middles at equal distance.
    if (d < bestD || (d === bestD && best?.kind === 'wall_middle' && kind === 'wall_end')) {
      bestD = d;
      best = { point: q, kind };
    }
  };
  for (const o of objects) {
    if (exclude?.(o) === true) continue;
    if (o.type === 'wall') {
      for (const pt of o.geometry.points) consider(pt, 'wall_end');
      for (const [a, b] of wallSegments(o)) {
        consider([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'wall_middle');
      }
    } else if (o.type === 'door' || o.type === 'window') {
      consider(o.geometry.a, 'wall_end');
      consider(o.geometry.b, 'wall_end');
    }
  }
  if (best !== null) {
    const found: Snapped = best;
    return { point: clampPoint(found.point, bounds.width, bounds.height), kind: found.kind };
  }
  return { point: clampPoint(snapToGrid(p), bounds.width, bounds.height), kind: 'grid' };
}

export function samePoint(a: Point, b: Point, eps = 1e-6): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

/** Points without consecutive duplicates. */
export function dedupePoints(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) if (out.length === 0 || !samePoint(out[out.length - 1]!, p)) out.push(p);
  return out;
}

/** Bounding box of an object (cells), for rectangle selection. */
export function objectBox(o: MapObject): { x0: number; y0: number; x1: number; y1: number } {
  const pts: Point[] =
    o.type === 'wall'
      ? [...o.geometry.points]
      : o.type === 'light'
        ? [[o.geometry.x, o.geometry.y]]
        : [o.geometry.a, o.geometry.b];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}
