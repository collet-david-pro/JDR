/** Builders and geometry helpers of the vision tests (deterministic, no Math.random). */
import type {
  DoorObject,
  DoorProps,
  LightObject,
  LightProps,
  Point,
  WallObject,
  WallProps,
  WindowObject,
} from '../../src/editor/contracts';
import type { VisionScene, Viewer } from '../../src/vision/types';

let uidCounter = 0;
const nextUid = (): string => `o${++uidCounter}`;

const base = { floor: 'f1', visibility: 'all', locked: false, sort_order: 0, rev: 1 } as const;

export const WALL: WallProps = {
  kind: 'stone',
  thickness: 0.2,
  blocks_vision: true,
  blocks_light: true,
  blocks_move: true,
  texture_asset: null,
  height: null,
};

export function wall(
  points: readonly Point[],
  closed = false,
  props: Partial<WallProps> = {},
): WallObject {
  return {
    ...base,
    uid: nextUid(),
    type: 'wall',
    layer: 'walls',
    geometry: { points, closed },
    props: { ...WALL, ...props },
  };
}

export function door(a: Point, b: Point, props: Partial<DoorProps> = {}): DoorObject {
  return {
    ...base,
    uid: nextUid(),
    type: 'door',
    layer: 'walls',
    geometry: { a, b },
    props: {
      state: 'closed',
      locked: false,
      secret: false,
      asset_open: null,
      asset_closed: null,
      swing: 'a',
      ...props,
    },
  };
}

export function windowObj(a: Point, b: Point): WindowObject {
  return {
    ...base,
    uid: nextUid(),
    type: 'window',
    layer: 'walls',
    geometry: { a, b },
    props: { kind: 'glass' },
  };
}

export function light(x: number, y: number, props: Partial<LightProps> = {}): LightObject {
  return {
    ...base,
    uid: nextUid(),
    type: 'light',
    layer: 'lighting',
    geometry: { x, y },
    props: {
      radius: 3,
      dim_radius: 6,
      color: '#ffffff',
      intensity: 1,
      flicker: { type: 'none', amp: 0, speed: 1 },
      cone: null,
      enabled: true,
      follows_token: null,
      ...props,
    },
  };
}

export function scene(
  objects: VisionScene['objects'],
  width = 20,
  height = 20,
  viewer: Viewer = 'gm',
  revision = 1,
): VisionScene {
  return { floor: 'f1', width, height, objects, viewer, revision };
}

/** Mulberry32 PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Flat = ArrayLike<number>;

export function flatOf(points: readonly Point[]): number[] {
  return points.flatMap(([x, y]) => [x, y]);
}

/** Classic even-odd point-in-polygon test (reference). */
export function inside(p: Flat, x: number, y: number): boolean {
  const n = p.length >> 1;
  let res = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = p[i * 2 + 1]!;
    const yj = p[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((p[j * 2]! - p[i * 2]!) * (y - yi)) / (yj - yi) + p[i * 2]!) {
      res = !res;
    }
  }
  return res;
}

export function distToSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2));
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
}

export function distToBoundary(p: Flat, x: number, y: number): number {
  const n = p.length >> 1;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    best = Math.min(best, distToSegment(x, y, p[j * 2]!, p[j * 2 + 1]!, p[i * 2]!, p[i * 2 + 1]!));
  }
  return best;
}

export function area(p: Flat): number {
  const n = p.length >> 1;
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    s += p[j * 2]! * p[i * 2 + 1]! - p[i * 2]! * p[j * 2 + 1]!;
  }
  return Math.abs(s) / 2;
}

/**
 * Points of the polygon boundary (vertices and points along each edge) that lie outside
 * `room` by more than `tol`.
 */
export function leaks(poly: Flat, room: Flat, tol = 2e-3, steps = 6): Point[] {
  const out: Point[] = [];
  const n = poly.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      const x = poly[j * 2]! + (poly[i * 2]! - poly[j * 2]!) * f;
      const y = poly[j * 2 + 1]! + (poly[i * 2 + 1]! - poly[j * 2 + 1]!) * f;
      if (!inside(room, x, y) && distToBoundary(room, x, y) > tol) out.push([x, y]);
    }
  }
  return out;
}

/** True when every coordinate is finite. */
export function finite(p: Flat): boolean {
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i]!)) return false;
  return true;
}
