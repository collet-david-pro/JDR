/** Outlines, polyline chaining, marching squares, Douglas-Peucker (pure; Math.sqrt only). */
import { BitGrid } from './grid';

export type Point2 = [number, number];
/** Directed segment a -> b. */
export interface Segment {
  a: Point2;
  b: Point2;
}
export interface Polyline {
  points: Point2[];
  closed: boolean;
}

export const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Outline of the non-zero cells of a mask: segments on cell borders between floor and non-floor
 * (outside the grid counts as non-floor), collinear runs merged. Each segment is oriented
 * clockwise around its floor cell (floor on the right, y down), so closed loops chain naturally.
 * Order: top edges, right edges, bottom edges, left edges, each in scan order.
 */
export function maskOutline(mask: BitGrid): Segment[] {
  const { w, h } = mask;
  const on = (x: number, y: number): boolean => mask.get(x, y) !== 0;
  const out: Segment[] = [];
  // Top edges (+x).
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!(on(x, y) && !on(x, y - 1))) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < w && on(x, y) && !on(x, y - 1)) x++;
      out.push({ a: [x0, y], b: [x, y] });
    }
  }
  // Right edges (+y), scanned by column.
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!(on(x, y) && !on(x + 1, y))) {
        y++;
        continue;
      }
      const y0 = y;
      while (y < h && on(x, y) && !on(x + 1, y)) y++;
      out.push({ a: [x + 1, y0], b: [x + 1, y] });
    }
  }
  // Bottom edges (-x).
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!(on(x, y) && !on(x, y + 1))) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < w && on(x, y) && !on(x, y + 1)) x++;
      out.push({ a: [x, y + 1], b: [x0, y + 1] });
    }
  }
  // Left edges (-y).
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!(on(x, y) && !on(x - 1, y))) {
        y++;
        continue;
      }
      const y0 = y;
      while (y < h && on(x, y) && !on(x - 1, y)) y++;
      out.push({ a: [x, y], b: [x, y0] });
    }
  }
  return out;
}

const keyOf = (p: Point2): string => p[0] + ',' + p[1];

function sameDir(p: Point2, q: Point2, r: Point2): boolean {
  const ax = q[0] - p[0];
  const ay = q[1] - p[1];
  const bx = r[0] - q[0];
  const by = r[1] - q[1];
  return ax * by - ay * bx === 0 && ax * bx + ay * by > 0;
}

function dropCollinear(points: Point2[], closed: boolean): Point2[] {
  if (points.length < 3) return points;
  const out: Point2[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n]!;
    const cur = points[i]!;
    const next = points[(i + 1) % n]!;
    if (!closed && (i === 0 || i === n - 1)) out.push(cur);
    else if (!sameDir(prev, cur, next)) out.push(cur);
  }
  return out;
}

/**
 * Chains directed segments (end of one = start of the next) into polylines. Open chains first
 * (those starting at a point nobody ends at), then closed loops, in input order. Where several
 * segments leave a point, the first unused one is taken. Collinear vertices are dropped.
 * Closed polylines do not repeat their first point.
 */
export function chainSegments(segments: readonly Segment[]): Polyline[] {
  const outgoing = new Map<string, number[]>();
  const ends = new Set<string>();
  segments.forEach((s, i) => {
    const k = keyOf(s.a);
    const list = outgoing.get(k);
    if (list === undefined) outgoing.set(k, [i]);
    else list.push(i);
    ends.add(keyOf(s.b));
  });
  const used = new Uint8Array(segments.length);
  const result: Polyline[] = [];
  const walk = (first: number): Polyline => {
    const points: Point2[] = [segments[first]!.a];
    let cur = first;
    let closed = false;
    for (;;) {
      used[cur] = 1;
      const end = segments[cur]!.b;
      if (keyOf(end) === keyOf(segments[first]!.a)) {
        closed = true;
        break;
      }
      const next = (outgoing.get(keyOf(end)) ?? []).find((i) => used[i] === 0);
      if (next === undefined) {
        points.push(end);
        break;
      }
      points.push(end);
      cur = next;
    }
    return { points: dropCollinear(points, closed), closed };
  };
  for (let i = 0; i < segments.length; i++) {
    if (used[i] === 0 && !ends.has(keyOf(segments[i]!.a))) result.push(walk(i));
  }
  for (let i = 0; i < segments.length; i++) if (used[i] === 0) result.push(walk(i));
  return result;
}

// Edge indices of a square: 0 = top, 1 = right, 2 = bottom, 3 = left. Segments go from -> to
// with the inside (value >= iso) on the right (y down).
const T = 0;
const R = 1;
const B = 2;
const L = 3;
const CASES: readonly (readonly (readonly [number, number])[])[] = [
  [], // 0
  [[T, L]], // 1 tl
  [[R, T]], // 2 tr
  [[R, L]], // 3
  [[B, R]], // 4 br
  [], // 5 saddle (resolved below)
  [[B, T]], // 6
  [[B, L]], // 7
  [[L, B]], // 8 bl
  [[T, B]], // 9
  [], // 10 saddle
  [[R, B]], // 11
  [[L, R]], // 12
  [[T, R]], // 13
  [[L, T]], // 14
  [], // 15
];

/**
 * Iso-contours of a w x h scalar field (sample (x, y) at integer coordinates; add 0.5 for cell
 * centres). Samples >= iso are inside. The field is padded with an outside border, so every
 * contour is closed. Linear interpolation; saddles resolved with the mean of the 4 corners.
 */
export function marchingSquares(
  field: Float32Array | Float64Array | BitGrid,
  w: number,
  h: number,
  iso = 0.5,
): Polyline[] {
  const data = field instanceof BitGrid ? field.data : field;
  const W = w + 2;
  const H = h + 2;
  const val = (x: number, y: number): number =>
    x < 1 || y < 1 || x > w || y > h ? -Infinity : data[(y - 1) * w + (x - 1)]!;
  // Edge ids: horizontal edge (x,y)-(x+1,y) = 2*(y*W+x); vertical (x,y)-(x,y+1) = 2*(y*W+x)+1.
  const edgeId = (x: number, y: number, e: number): number => {
    if (e === T) return 2 * (y * W + x);
    if (e === B) return 2 * ((y + 1) * W + x);
    if (e === L) return 2 * (y * W + x) + 1;
    return 2 * (y * W + x + 1) + 1;
  };
  const next = new Map<number, number>();
  const order: number[] = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = val(x, y);
      const tr = val(x + 1, y);
      const br = val(x + 1, y + 1);
      const bl = val(x, y + 1);
      const c =
        (tl >= iso ? 1 : 0) | (tr >= iso ? 2 : 0) | (br >= iso ? 4 : 0) | (bl >= iso ? 8 : 0);
      let segs = CASES[c]!;
      if (c === 5 || c === 10) {
        const centre = (tl + tr + br + bl) / 4 >= iso;
        if (c === 5) {
          segs = centre
            ? [
                [T, R],
                [B, L],
              ]
            : [
                [T, L],
                [B, R],
              ];
        } else {
          segs = centre
            ? [
                [L, T],
                [R, B],
              ]
            : [
                [R, T],
                [L, B],
              ];
        }
      }
      for (const [f, t] of segs) {
        const from = edgeId(x, y, f);
        next.set(from, edgeId(x, y, t));
        order.push(from);
      }
    }
  }
  const point = (id: number): Point2 => {
    const horizontal = id % 2 === 0;
    const cell = (id - (horizontal ? 0 : 1)) / 2;
    const x = cell % W;
    const y = (cell - x) / W;
    const a = val(x, y);
    if (horizontal) {
      const b = val(x + 1, y);
      return [x - 1 + frac(a, b, iso), y - 1];
    }
    const b = val(x, y + 1);
    return [x - 1, y - 1 + frac(a, b, iso)];
  };
  const seen = new Set<number>();
  const out: Polyline[] = [];
  for (const start of order) {
    if (seen.has(start)) continue;
    const pts: Point2[] = [];
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      pts.push(point(cur));
      const n = next.get(cur);
      if (n === undefined) break;
      cur = n;
    }
    out.push({ points: pts, closed: true });
  }
  return out;
}

/** Position in [0, 1] of the iso crossing between samples a and b (one of them is -Infinity). */
function frac(a: number, b: number, iso: number): number {
  if (a === -Infinity) return 1;
  if (b === -Infinity) return 0;
  if (a === b) return 0.5;
  return Math.min(1, Math.max(0, (iso - a) / (b - a)));
}

/** Douglas-Peucker simplification of an open polyline (end points kept). */
export function douglasPeucker(points: readonly Point2[], tol: number): Point2[] {
  const n = points.length;
  if (n < 3) return points.map((p) => [p[0], p[1]]);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [i0, i1] = stack.pop()!;
    const a = points[i0]!;
    const b = points[i1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    let best = -1;
    let bi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = points[i]!;
      const d =
        len === 0
          ? Math.sqrt((p[0] - a[0]) * (p[0] - a[0]) + (p[1] - a[1]) * (p[1] - a[1]))
          : Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / len;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (bi !== -1 && best > tol) {
      keep[bi] = 1;
      stack.push([i0, bi], [bi, i1]);
    }
  }
  const out: Point2[] = [];
  for (let i = 0; i < n; i++) if (keep[i] === 1) out.push([points[i]![0], points[i]![1]]);
  return out;
}
