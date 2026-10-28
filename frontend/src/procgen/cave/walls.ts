/** Natural walls of a cave: marching squares on the floor mask, clipped to the zone rectangle. */
import { douglasPeucker, marchingSquares, round3, type Point2 } from '../geometry';
import type { BitGrid } from '../grid';
import type { GenWall } from '../types';

const TOL = 0.35;

/** Part of the segment a-b inside [0, w] x [0, h] (Liang-Barsky), or null. */
function clipSegment(a: Point2, b: Point2, w: number, h: number): [Point2, Point2] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const tests: [number, number][] = [
    [-dx, a[0]],
    [dx, w - a[0]],
    [-dy, a[1]],
    [dy, h - a[1]],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  const s: Point2 = t0 === 0 ? a : [a[0] + t0 * dx, a[1] + t0 * dy];
  const e: Point2 = t1 === 1 ? b : [a[0] + t1 * dx, a[1] + t1 * dy];
  return [s, e];
}

const same = (a: Point2, b: Point2): boolean => a[0] === b[0] && a[1] === b[1];

/** Cuts a closed polyline to the rectangle: returns open runs, or the ring itself when untouched. */
export function clipClosed(
  ring: readonly Point2[],
  w: number,
  h: number,
): { points: Point2[]; closed: boolean }[] {
  const outside = (p: Point2): boolean => p[0] < 0 || p[1] < 0 || p[0] > w || p[1] > h;
  const n = ring.length;
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (outside(ring[i]!)) {
      first = i;
      break;
    }
  }
  if (first === -1) return [{ points: ring.map((p) => [p[0], p[1]]), closed: true }];
  const runs: Point2[][] = [];
  let cur: Point2[] | null = null;
  for (let k = 0; k < n; k++) {
    const a = ring[(first + k) % n]!;
    const b = ring[(first + k + 1) % n]!;
    const c = clipSegment(a, b, w, h);
    if (c === null) {
      cur = null;
      continue;
    }
    if (cur === null || !same(cur[cur.length - 1]!, c[0])) {
      cur = [c[0]];
      runs.push(cur);
    }
    cur.push(c[1]);
    if (!same(c[1], b)) cur = null;
  }
  return runs.map((points) => ({ points, closed: false }));
}

/**
 * Walls of the floor mask. `openings` (zone) are border cells whose outside neighbour is floor:
 * no wall is drawn on their outer edge. Every point lies in [0, w] x [0, h].
 */
export function caveWalls(
  floor: BitGrid,
  openings: readonly (readonly [number, number])[],
  kind: GenWall['kind'],
): GenWall[] {
  const { w, h } = floor;
  const W = w + 2;
  const field = new Float64Array(W * (h + 2));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) field[(y + 1) * W + x + 1] = floor.get(x, y);
  for (const [x, y] of openings) {
    if (x === 0) field[(y + 1) * W] = 1;
    if (x === w - 1) field[(y + 1) * W + w + 1] = 1;
    if (y === 0) field[x + 1] = 1;
    if (y === h - 1) field[(h + 1) * W + x + 1] = 1;
  }
  const walls: GenWall[] = [];
  for (const pl of marchingSquares(field, W, h + 2, 0.5)) {
    const ring: Point2[] = pl.points.map(([x, y]) => [x - 0.5, y - 0.5]);
    for (const piece of clipClosed(ring, w, h)) {
      let pts: Point2[];
      if (piece.closed) {
        pts = douglasPeucker([...piece.points, piece.points[0]!], TOL);
        pts.pop();
        if (pts.length < 3) continue;
      } else {
        pts = douglasPeucker(piece.points, TOL);
        if (pts.length < 2) continue;
      }
      walls.push({
        points: pts.map(([x, y]): [number, number] => [round3(x), round3(y)]),
        closed: piece.closed,
        kind,
      });
    }
  }
  return walls;
}
