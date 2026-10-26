/**
 * Visibility polygon by angular sweep (projet.md 14.2).
 *
 * For a source P and a radius R: the segments near P (spatial grid) give events at the angles
 * of their endpoints, sorted (O(n log n)); between two consecutive events the set of segments
 * crossed by the rays is constant, so the closest one (taken on the middle ray) is the visible
 * boundary of that angular interval. Because the occluder set has no crossing segments
 * (occluders.ts), that segment stays the closest over the whole interval; consecutive
 * intervals meet on the event rays, which yields the radial edges behind wall ends without any
 * ±ε ray (no leak at joints). The boundary is clipped to the circle of radius R, approximated
 * by a fixed 64-gon (vertices at k·2π/64), and to a cone when one is given.
 *
 * Degenerate cases: a segment whose line passes within 1e-6 cell of P (P on a wall, at a wall
 * end, or a wall seen edge-on) does not occlude: a source standing exactly on a wall sees (or
 * lights) both sides of it.
 */
import type { LightCone } from '../editor/contracts';
import type { OccluderSet } from './occluders';

export const CIRCLE_SEGMENTS = 64;
const TWO_PI = Math.PI * 2;
const STEP = TWO_PI / CIRCLE_SEGMENTS;
/** A source closer than this to a segment line stands on it (cells). */
const ON_WALL = 1e-6;
/** Angular intervals narrower than this are not sampled (their ends are). */
const MIN_INTERVAL = 1e-12;

/** Reusable buffers (one per core: not re-entrant). */
export class SweepScratch {
  readonly ids: number[] = [];
  /** Per candidate: ax, ay, bx, by relative to P, a = start (smaller angle). */
  rel = new Float64Array(64 * 4);
  /** Events: angle, then (segment index + 1) × (+1 start / −1 end). */
  evAngle = new Float64Array(128);
  evCode = new Int32Array(128);
  order: number[] = [];
  readonly active: number[] = [];
  readonly out: number[] = [];

  ensure(candidates: number): void {
    if (this.rel.length < candidates * 4) this.rel = new Float64Array(candidates * 8);
    if (this.evAngle.length < candidates * 2) {
      this.evAngle = new Float64Array(candidates * 4);
      this.evCode = new Int32Array(candidates * 4);
    }
  }
}

/**
 * Polygon (x0, y0, x1, y1, … in cells) of what P sees within `radius`, optionally inside a
 * cone (degrees, 0 = +X, clockwise on screen). `set` null = no occluder (plain disc / sector).
 */
export function visibilityPolygon(
  set: OccluderSet | null,
  px: number,
  py: number,
  radius: number,
  cone: LightCone | null,
  scratch: SweepScratch = new SweepScratch(),
): Float32Array {
  if (!(radius > 0) || !Number.isFinite(px) || !Number.isFinite(py)) return new Float32Array(0);
  const R = radius;
  let start = -Math.PI;
  let sweep = TWO_PI;
  const isCone = cone !== null && cone.angle > 0 && cone.angle < 360;
  if (isCone) {
    sweep = (cone.angle * Math.PI) / 180;
    start = (cone.direction * Math.PI) / 180 - sweep / 2;
  }

  // Candidate segments and their events.
  const ids = set === null ? [] : set.grid.queryBox(px - R, py - R, px + R, py + R, scratch.ids);
  scratch.ensure(ids.length);
  const rel = scratch.rel;
  const evAngle = scratch.evAngle;
  const evCode = scratch.evCode;
  const active = scratch.active;
  active.length = 0;
  let nc = 0;
  let ne = 0;
  const coords = set?.coords;
  for (const id of ids) {
    let ax = coords![id * 4]! - px;
    let ay = coords![id * 4 + 1]! - py;
    let bx = coords![id * 4 + 2]! - px;
    let by = coords![id * 4 + 3]! - py;
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey;
    // Closest point of the segment to P.
    const t = Math.min(1, Math.max(0, -(ax * ex + ay * ey) / len2));
    const cx = ax + ex * t;
    const cy = ay + ey * t;
    if (cx * cx + cy * cy > R * R) continue;
    let cr = ax * by - ay * bx;
    if (Math.abs(cr) <= ON_WALL * Math.sqrt(len2)) continue;
    if (cr < 0) {
      [ax, ay, bx, by] = [bx, by, ax, ay];
      cr = -cr;
    }
    const span = Math.atan2(cr, ax * bx + ay * by);
    const rs = mod2pi(Math.atan2(ay, ax) - start);
    const re = rs + span;
    const k = nc++;
    rel[k * 4] = ax;
    rel[k * 4 + 1] = ay;
    rel[k * 4 + 2] = bx;
    rel[k * 4 + 3] = by;
    if (re > TWO_PI) {
      // Crosses the start ray: active from the beginning, ends, then may start again.
      active.push(k);
      if (re - TWO_PI < sweep) {
        evAngle[ne] = re - TWO_PI;
        evCode[ne++] = -(k + 1);
      }
      if (rs < sweep) {
        evAngle[ne] = rs;
        evCode[ne++] = k + 1;
      }
    } else if (rs < sweep) {
      evAngle[ne] = rs;
      evCode[ne++] = k + 1;
      if (re < sweep) {
        evAngle[ne] = re;
        evCode[ne++] = -(k + 1);
      }
    }
  }
  const order = scratch.order;
  order.length = ne;
  for (let i = 0; i < ne; i++) order[i] = i;
  order.sort((i, j) => evAngle[i]! - evAngle[j]! || evCode[i]! - evCode[j]!);

  const out = scratch.out;
  out.length = 0;
  if (isCone) out.push(px, py);
  const push = (x: number, y: number): void => {
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2]! - x) < 1e-9 && Math.abs(out[n - 1]! - y) < 1e-9) return;
    out.push(x, y);
  };
  const arc = (a0: number, a1: number): void => {
    push(px + Math.cos(a0) * R, py + Math.sin(a0) * R);
    for (let k = Math.floor(a0 / STEP) + 1; k * STEP < a1; k++) {
      const a = k * STEP;
      push(px + Math.cos(a) * R, py + Math.sin(a) * R);
    }
    push(px + Math.cos(a1) * R, py + Math.sin(a1) * R);
  };
  /** Boundary over absolute angles [a0, a1] where segment k (or nothing: -1) is the closest. */
  const emit = (a0: number, a1: number, k: number): void => {
    if (k < 0) {
      arc(a0, a1);
      return;
    }
    const ax = rel[k * 4]!;
    const ay = rel[k * 4 + 1]!;
    const ex = rel[k * 4 + 2]! - ax;
    const ey = rel[k * 4 + 3]! - ay;
    const el = Math.hypot(ex, ey);
    // Foot of the perpendicular from P to the segment line: distance h at angle phi.
    const hs = (ax * -ey + ay * ex) / el;
    const h = Math.abs(hs);
    if (h >= R) {
      arc(a0, a1);
      return;
    }
    let phi = Math.atan2((ex / el) * hs, (-ey / el) * hs);
    const mid = (a0 + a1) / 2;
    phi += Math.round((mid - phi) / TWO_PI) * TWO_PI;
    const alpha = Math.acos(h / R);
    const in0 = Math.max(a0, phi - alpha);
    const in1 = Math.min(a1, phi + alpha);
    if (in1 <= in0) {
      arc(a0, a1);
      return;
    }
    if (in0 > a0) arc(a0, in0);
    const hit = (a: number): void => {
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const den = dx * ey - dy * ex;
      let t = R;
      if (Math.abs(den) > 1e-15) t = Math.min(R, Math.max(0, (ax * ey - ay * ex) / den));
      push(px + dx * t, py + dy * t);
    };
    hit(in0);
    hit(in1);
    if (in1 < a1) arc(in1, a1);
  };
  const closest = (a: number): number => {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = -1;
    let bestT = Infinity;
    for (const k of active) {
      const ax = rel[k * 4]!;
      const ay = rel[k * 4 + 1]!;
      const ex = rel[k * 4 + 2]! - ax;
      const ey = rel[k * 4 + 3]! - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) <= 1e-15) continue;
      const t = (ax * ey - ay * ex) / den;
      if (t > 0 && t < bestT) {
        bestT = t;
        best = k;
      }
    }
    return best;
  };

  let e = 0;
  const apply = (upTo: number): void => {
    while (e < ne && evAngle[order[e]!]! <= upTo) {
      const code = evCode[order[e++]!]!;
      if (code > 0) active.push(code - 1);
      else {
        const i = active.indexOf(-code - 1);
        if (i >= 0) {
          active[i] = active[active.length - 1]!;
          active.pop();
        }
      }
    }
  };
  let theta = 0;
  apply(0);
  while (theta < sweep) {
    const next = e < ne ? Math.min(evAngle[order[e]!]!, sweep) : sweep;
    if (next - theta > MIN_INTERVAL) {
      emit(start + theta, start + next, closest(start + (theta + next) / 2));
    }
    theta = next;
    apply(theta);
    if (next >= sweep) break;
  }

  // Full circle: the last point repeats the first one.
  let n = out.length;
  if (!isCone && n >= 4 && Math.abs(out[0]! - out[n - 2]!) < 1e-9) {
    if (Math.abs(out[1]! - out[n - 1]!) < 1e-9) n -= 2;
  }
  return Float32Array.from(n === out.length ? out : out.slice(0, n));
}

function mod2pi(a: number): number {
  const m = a % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}
