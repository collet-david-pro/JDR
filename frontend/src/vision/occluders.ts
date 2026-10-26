/**
 * Occluders of a floor (projet.md 12.4, 14.2): segments of the walls (split around the doors
 * and windows placed on them), closed doors, windows (movement only), secret doors (a wall for
 * players) and the map border, per mode (vision / light / move).
 *
 * Joints are made watertight before any visibility query:
 * 1. endpoints closer than EPS are welded into one vertex;
 * 2. a segment is split where another one ends on it (T joint, within EPS) or crosses it
 *    (X joint): after this step no two segments cross, they only share vertices, which the
 *    angular sweep (visibility.ts) relies on;
 * 3. duplicates are removed and collinear chains (a vertex shared by exactly two collinear
 *    segments) are merged into one segment.
 * Walls are their centre line (zero width); the minimum thickness (MIN_THICKNESS) only widens
 * the tolerance used to find the wall a door sits on.
 */
import type { DoorObject, MapObject, WindowObject } from '../editor/contracts';
import { SpatialGrid } from './spatial-grid';
import type { OccluderMode, Viewer } from './types';

/** Geometric tolerance in cells (14.2). */
export const EPS = 1e-4;
/** Minimal wall thickness in cells (14.2). */
export const MIN_THICKNESS = 0.05;
/** A door / window cuts a wall when it is nearly parallel to it (sine of the angle). */
const OPENING_MAX_SIN = 0.1;

export const OCCLUDER_MODES: readonly OccluderMode[] = ['vision', 'light', 'move'];

export interface OccluderSet {
  readonly mode: OccluderMode;
  readonly count: number;
  /** 4 numbers per segment: ax, ay, bx, by (cells). */
  readonly coords: Float64Array;
  readonly grid: SpatialGrid;
}

/** One raw occluding piece with what it blocks. */
export interface RawPiece {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly vision: boolean;
  readonly light: boolean;
  readonly move: boolean;
}

interface Opening {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly vision: boolean;
  readonly light: boolean;
  readonly move: boolean;
  /** Ends projected on the first wall it cuts (watertight joint with the wall pieces). */
  projected: [number, number, number, number] | null;
}

function openingOf(o: DoorObject | WindowObject, viewer: Viewer): Opening {
  const [ax, ay] = o.geometry.a;
  const [bx, by] = o.geometry.b;
  let vision = false;
  let light = false;
  let move = false;
  if (o.type === 'window') {
    move = true;
  } else if (viewer === 'player' && o.props.secret) {
    // A hidden secret door is a plain wall for the players (12.4), even when "open".
    vision = light = move = true;
  } else if (o.props.state === 'closed') {
    vision = light = move = true;
  }
  return { ax, ay, bx, by, vision, light, move, projected: null };
}

/** Wall segments cut by the openings, closed doors, windows (mode independent). */
export function rawPieces(objects: readonly MapObject[], viewer: Viewer): RawPiece[] {
  const openings: Opening[] = [];
  for (const o of objects) {
    if (o.type === 'door' || o.type === 'window') openings.push(openingOf(o, viewer));
  }
  const out: RawPiece[] = [];
  for (const o of objects) {
    if (o.type !== 'wall') continue;
    const p = o.props;
    if (!p.blocks_vision && !p.blocks_light && !p.blocks_move) continue;
    const pts = o.geometry.points;
    const n = pts.length;
    const segs = o.geometry.closed && n > 2 ? n : n - 1;
    const tol = Math.max(p.thickness / 2, MIN_THICKNESS) + EPS;
    for (let i = 0; i < segs; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[(i + 1) % n]!;
      cutWall(ax, ay, bx, by, tol, openings, (x0, y0, x1, y1) =>
        out.push({
          ax: x0,
          ay: y0,
          bx: x1,
          by: y1,
          vision: p.blocks_vision,
          light: p.blocks_light,
          move: p.blocks_move,
        }),
      );
    }
  }
  for (const o of openings) {
    if (!o.vision && !o.light && !o.move) continue;
    const [ax, ay, bx, by] = o.projected ?? [o.ax, o.ay, o.bx, o.by];
    out.push({ ax, ay, bx, by, vision: o.vision, light: o.light, move: o.move });
  }
  return out;
}

/** Emits the parts of wall segment A→B not covered by an opening. */
function cutWall(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tol: number,
  openings: Opening[],
  emit: (x0: number, y0: number, x1: number, y1: number) => void,
): void {
  const len = Math.hypot(bx - ax, by - ay);
  if (len <= EPS) return;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const cuts: [number, number][] = [];
  for (const o of openings) {
    if (
      Math.max(o.ax, o.bx) < Math.min(ax, bx) - tol ||
      Math.min(o.ax, o.bx) > Math.max(ax, bx) + tol ||
      Math.max(o.ay, o.by) < Math.min(ay, by) - tol ||
      Math.min(o.ay, o.by) > Math.max(ay, by) + tol
    ) {
      continue;
    }
    const da = ux * (o.ay - ay) - uy * (o.ax - ax);
    const db = ux * (o.by - ay) - uy * (o.bx - ax);
    if (Math.abs(da) > tol || Math.abs(db) > tol) continue;
    const ol = Math.hypot(o.bx - o.ax, o.by - o.ay);
    if (ol <= EPS) continue;
    if (Math.abs(ux * (o.by - o.ay) - uy * (o.bx - o.ax)) / ol > OPENING_MAX_SIN) continue;
    const ta = ux * (o.ax - ax) + uy * (o.ay - ay);
    const tb = ux * (o.bx - ax) + uy * (o.by - ay);
    const lo = Math.max(0, Math.min(ta, tb));
    const hi = Math.min(len, Math.max(ta, tb));
    if (hi - lo <= EPS) continue;
    cuts.push([lo, hi]);
    o.projected ??= [ax + ux * ta, ay + uy * ta, ax + ux * tb, ay + uy * tb];
  }
  if (cuts.length === 0) {
    emit(ax, ay, bx, by);
    return;
  }
  cuts.sort((p, q) => p[0] - q[0]);
  const at = (t: number): [number, number] =>
    t <= 0 ? [ax, ay] : t >= len ? [bx, by] : [ax + ux * t, ay + uy * t];
  let t0 = 0;
  for (const [lo, hi] of cuts) {
    if (lo - t0 > EPS) {
      const [x0, y0] = at(t0);
      const [x1, y1] = at(lo);
      emit(x0, y0, x1, y1);
    }
    t0 = Math.max(t0, hi);
  }
  if (len - t0 > EPS) {
    const [x0, y0] = at(t0);
    emit(x0, y0, bx, by);
  }
}

/** Vertex welding: points closer than EPS share one vertex (first one wins). */
class Welder {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  private readonly buckets = new Map<string, number[]>();

  id(x: number, y: number): number {
    const ix = Math.floor(x / EPS);
    const iy = Math.floor(y / EPS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.buckets.get(`${ix + dx},${iy + dy}`);
        if (bucket === undefined) continue;
        for (const v of bucket) {
          if (Math.hypot(this.xs[v]! - x, this.ys[v]! - y) <= EPS) return v;
        }
      }
    }
    const v = this.xs.length;
    this.xs.push(x);
    this.ys.push(y);
    const key = `${ix},${iy}`;
    const bucket = this.buckets.get(key);
    if (bucket === undefined) this.buckets.set(key, [v]);
    else bucket.push(v);
    return v;
  }
}

export interface Bounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Watertight segment set of one mode (see the file comment). */
export function buildOccluderSet(
  mode: OccluderMode,
  pieces: readonly RawPiece[],
  bounds: Bounds | null,
): OccluderSet {
  const w = new Welder();
  let segs: number[] = [];
  const add = (ax: number, ay: number, bx: number, by: number): void => {
    const a = w.id(ax, ay);
    const b = w.id(bx, by);
    if (a !== b) segs.push(a, b);
  };
  for (const p of pieces) if (p[mode]) add(p.ax, p.ay, p.bx, p.by);
  if (bounds !== null) {
    const { x0, y0, x1, y1 } = bounds;
    add(x0, y0, x1, y0);
    add(x1, y0, x1, y1);
    add(x1, y1, x0, y1);
    add(x0, y1, x0, y0);
  }
  segs = splitJoints(w, segs);
  segs = dedupe(segs);
  segs = mergeCollinear(w, segs);
  segs = dedupe(segs);
  const count = segs.length / 2;
  const coords = new Float64Array(count * 4);
  for (let i = 0; i < count; i++) {
    const a = segs[i * 2]!;
    const b = segs[i * 2 + 1]!;
    coords[i * 4] = w.xs[a]!;
    coords[i * 4 + 1] = w.ys[a]!;
    coords[i * 4 + 2] = w.xs[b]!;
    coords[i * 4 + 3] = w.ys[b]!;
  }
  const box = bounds ?? coordsBounds(coords);
  return { mode, count, coords, grid: new SpatialGrid(coords, count, box) };
}

function coordsBounds(coords: Float64Array): Bounds {
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < coords.length; i += 2) {
    x0 = Math.min(x0, coords[i]!);
    x1 = Math.max(x1, coords[i]!);
    y0 = Math.min(y0, coords[i + 1]!);
    y1 = Math.max(y1, coords[i + 1]!);
  }
  return { x0, y0, x1, y1 };
}

/** Parameter (0..1) of the projection of P on A→B when P lies on its interior within EPS. */
function onInterior(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number | null {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const margin = EPS / Math.sqrt(len2);
  if (t <= margin || t >= 1 - margin) return null;
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  return qx * qx + qy * qy <= EPS * EPS ? t : null;
}

/** Splits segments at T and X joints (shared vertices afterwards). */
function splitJoints(w: Welder, segs: number[]): number[] {
  const n = segs.length / 2;
  const coords = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    coords.set(
      [w.xs[segs[i * 2]!]!, w.ys[segs[i * 2]!]!, w.xs[segs[i * 2 + 1]!]!, w.ys[segs[i * 2 + 1]!]!],
      i * 4,
    );
  }
  const splits: [number, number][][] = Array.from({ length: n }, () => []);
  const grid = new SpatialGrid(coords, n, coordsBounds(coords));
  grid.forEachPair((i, j) => {
    const ia = segs[i * 2]!;
    const ib = segs[i * 2 + 1]!;
    const ja = segs[j * 2]!;
    const jb = segs[j * 2 + 1]!;
    const [ax, ay, bx, by] = [
      coords[i * 4]!,
      coords[i * 4 + 1]!,
      coords[i * 4 + 2]!,
      coords[i * 4 + 3]!,
    ];
    const [cx, cy, dx, dy] = [
      coords[j * 4]!,
      coords[j * 4 + 1]!,
      coords[j * 4 + 2]!,
      coords[j * 4 + 3]!,
    ];
    let touched = false;
    // Endpoints of one segment lying on the other (T joints, collinear overlaps).
    for (const [v, px, py] of [
      [ia, ax, ay],
      [ib, bx, by],
    ] as const) {
      if (v === ja || v === jb) continue;
      const t = onInterior(px, py, cx, cy, dx, dy);
      if (t !== null) {
        splits[j]!.push([t, v]);
        touched = true;
      }
    }
    for (const [v, px, py] of [
      [ja, cx, cy],
      [jb, dx, dy],
    ] as const) {
      if (v === ia || v === ib) continue;
      const t = onInterior(px, py, ax, ay, bx, by);
      if (t !== null) {
        splits[i]!.push([t, v]);
        touched = true;
      }
    }
    if (touched || ia === ja || ia === jb || ib === ja || ib === jb) return;
    // Proper crossing.
    const ex = bx - ax;
    const ey = by - ay;
    const fx = dx - cx;
    const fy = dy - cy;
    const denom = ex * fy - ey * fx;
    const l1 = Math.hypot(ex, ey);
    const l2 = Math.hypot(fx, fy);
    if (Math.abs(denom) <= 1e-12 * l1 * l2) return;
    const t = ((cx - ax) * fy - (cy - ay) * fx) / denom;
    const u = ((cx - ax) * ey - (cy - ay) * ex) / denom;
    if (t <= EPS / l1 || t >= 1 - EPS / l1 || u <= EPS / l2 || u >= 1 - EPS / l2) return;
    const v = w.id(ax + ex * t, ay + ey * t);
    splits[i]!.push([t, v]);
    splits[j]!.push([u, v]);
  });
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const list = splits[i]!;
    let prev = segs[i * 2]!;
    if (list.length > 0) {
      list.sort((p, q) => p[0] - q[0]);
      for (const [, v] of list) {
        if (v !== prev) out.push(prev, v);
        prev = v;
      }
    }
    const last = segs[i * 2 + 1]!;
    if (last !== prev) out.push(prev, last);
  }
  return out;
}

function dedupe(segs: number[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (let i = 0; i < segs.length; i += 2) {
    const a = segs[i]!;
    const b = segs[i + 1]!;
    if (a === b) continue;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a, b);
  }
  return out;
}

/** Merges a–v–b into a–b when v joins exactly these two collinear segments. */
function mergeCollinear(w: Welder, segs: number[]): number[] {
  const n = segs.length / 2;
  const a = segs.filter((_, k) => k % 2 === 0);
  const b = segs.filter((_, k) => k % 2 === 1);
  const alive: number[] = new Array<number>(n).fill(1);
  const incident = new Map<number, number[]>();
  const link = (v: number, s: number): void => {
    const list = incident.get(v);
    if (list === undefined) incident.set(v, [s]);
    else list.push(s);
  };
  for (let s = 0; s < n; s++) {
    link(a[s]!, s);
    link(b[s]!, s);
  }
  for (const [v, list] of incident) {
    const live = list.filter((s) => alive[s] === 1);
    incident.set(v, live);
    if (live.length !== 2) continue;
    const [s1, s2] = live as [number, number];
    const p = a[s1] === v ? b[s1]! : a[s1]!;
    const q = a[s2] === v ? b[s2]! : a[s2]!;
    if (p === q) continue;
    const px = w.xs[p]!;
    const py = w.ys[p]!;
    const qx = w.xs[q]!;
    const qy = w.ys[q]!;
    const vx = w.xs[v]!;
    const vy = w.ys[v]!;
    const len = Math.hypot(qx - px, qy - py);
    const dist = Math.abs((qx - px) * (vy - py) - (qy - py) * (vx - px)) / len;
    if (dist > EPS / 10 || (px - vx) * (qx - vx) + (py - vy) * (qy - vy) >= 0) continue;
    alive[s1] = 0;
    alive[s2] = 0;
    const s3 = a.length;
    a.push(p);
    b.push(q);
    alive[s3] = 1;
    incident.set(v, []);
    for (const [end, old] of [
      [p, s1],
      [q, s2],
    ] as const) {
      const l = incident.get(end)!;
      const k = l.indexOf(old);
      if (k >= 0) l[k] = s3;
      else l.push(s3);
    }
  }
  const out: number[] = [];
  for (let s = 0; s < a.length; s++) if (alive[s] === 1) out.push(a[s]!, b[s]!);
  return out;
}
