/**
 * Fog rasterisers (contract FogRasterizers, ./types.ts; projet.md 12.3, 14.2): 4×4 sub-cells
 * per cell, one bit per sub-cell, chunks of 128×128 sub-cells. A sub-cell belongs to a shape
 * when its centre does: polygons use the even-odd rule with half-open spans, discs are closed.
 * Shapes are filled by scanline (one span list per sub-cell row), never point by point.
 */
import type { ChunkKey, Point, Polygon, VisibleScene } from '../editor/contracts';
import { FOG_SIDE, FOG_SUBCELLS, createFogBitmap } from '../formats/fog-codec';
import type { VisionCoreImpl } from './core';
import type { FogRaster, FogRasterizers, VisionCore } from './types';

/** Centre (cells) of sub-cell index s. */
function centre(s: number): number {
  return (s + 0.5) / FOG_SUBCELLS;
}

/** Smallest sub-cell index whose centre is ≥ x. */
function firstAtLeast(x: number): number {
  let s = Math.ceil(x * FOG_SUBCELLS - 0.5);
  while (centre(s) < x) s++;
  while (centre(s - 1) >= x) s--;
  return s;
}

/** Smallest sub-cell index whose centre is > x. */
function firstAbove(x: number): number {
  let s = Math.floor(x * FOG_SUBCELLS - 0.5);
  while (centre(s) <= x) s++;
  while (centre(s - 1) > x) s--;
  return s;
}

/** Accumulates sub-cell spans into chunk bitmaps, clipped to the map. */
export class RasterBuilder {
  readonly out: FogRaster = new Map();
  readonly sw: number;
  readonly sh: number;

  constructor(width: number, height: number) {
    this.sw = Math.max(0, Math.floor(width * FOG_SUBCELLS));
    this.sh = Math.max(0, Math.floor(height * FOG_SUBCELLS));
  }

  /** Sets sub-cells [s0, s1) of row sy. */
  span(sy: number, s0: number, s1: number): void {
    if (sy < 0 || sy >= this.sh) return;
    let a = Math.max(0, s0);
    const b = Math.min(this.sw, s1);
    const cy = Math.floor(sy / FOG_SIDE);
    const row = sy - cy * FOG_SIDE;
    while (a < b) {
      const cx = Math.floor(a / FOG_SIDE);
      const end = Math.min(b, (cx + 1) * FOG_SIDE);
      const key = `${cx}:${cy}` as ChunkKey;
      let bits = this.out.get(key);
      if (bits === undefined) {
        bits = createFogBitmap();
        this.out.set(key, bits);
      }
      setBits(bits, row * FOG_SIDE + (a - cx * FOG_SIDE), row * FOG_SIDE + (end - cx * FOG_SIDE));
      a = end;
    }
  }

  set(sx: number, sy: number): void {
    this.span(sy, sx, sx + 1);
  }
}

/** Sets bits [i0, i1) of a bitmap (most significant bit first). */
function setBits(bits: Uint8Array, i0: number, i1: number): void {
  let i = i0;
  while (i < i1 && (i & 7) !== 0) {
    bits[i >> 3]! |= 0x80 >> (i & 7);
    i++;
  }
  while (i + 8 <= i1) {
    bits[i >> 3] = 0xff;
    i += 8;
  }
  while (i < i1) {
    bits[i >> 3]! |= 0x80 >> (i & 7);
    i++;
  }
}

/** Flat polygon (x0, y0, …) of either representation. */
function flat(points: Polygon | readonly Point[]): ArrayLike<number> {
  if (points instanceof Float32Array) return points;
  const out = new Float64Array((points as readonly Point[]).length * 2);
  (points as readonly Point[]).forEach(([x, y], i) => {
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  });
  return out;
}

function bounds(p: ArrayLike<number>): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    x0 = Math.min(x0, p[i]!);
    x1 = Math.max(x1, p[i]!);
    y0 = Math.min(y0, p[i + 1]!);
    y1 = Math.max(y1, p[i + 1]!);
  }
  return { x0, y0, x1, y1 };
}

/** Sub-cell rows whose centre lies in [y0, y1]. */
function rowRange(y0: number, y1: number, sh: number): [number, number] {
  return [Math.max(0, firstAtLeast(y0)), Math.min(sh, firstAbove(y1))];
}

/**
 * Sub-cell spans [s0, s1, s2, s3, …) of a polygon on the row whose centre is y (even-odd rule,
 * same crossing formula as the classic point-in-polygon test, so both agree exactly).
 */
export function polygonSpans(p: ArrayLike<number>, y: number, out: number[]): number[] {
  out.length = 0;
  const n = p.length >> 1;
  const xs: number[] = [];
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = p[i * 2 + 1]!;
    const yj = p[j * 2 + 1]!;
    if (yi > y !== yj > y) {
      const xi = p[i * 2]!;
      xs.push(((p[j * 2]! - xi) * (y - yi)) / (yj - yi) + xi);
    }
  }
  xs.sort((a, b) => a - b);
  for (let k = 0; k + 1 < xs.length; k += 2) {
    // centre x inside ⇔ xs[k] ≤ x < xs[k+1].
    const s0 = firstAtLeast(xs[k]!);
    const s1 = firstAtLeast(xs[k + 1]!);
    if (s1 > s0) out.push(s0, s1);
  }
  return out;
}

/** Sub-cells [s0, s1) of the row centred on y whose centre is within r of (cx, cy). */
function discSpan(cx: number, cy: number, r: number, y: number): [number, number] | null {
  const dy = y - cy;
  const h2 = r * r - dy * dy;
  if (h2 < 0) return null;
  const h = Math.sqrt(h2);
  let s0 = Math.floor((cx - h) * FOG_SUBCELLS - 0.5);
  let s1 = Math.ceil((cx + h) * FOG_SUBCELLS - 0.5);
  const inside = (s: number): boolean => {
    const dx = centre(s) - cx;
    return dx * dx + dy * dy <= r * r;
  };
  while (s0 <= s1 && !inside(s0)) s0++;
  while (s1 >= s0 && !inside(s1)) s1--;
  if (s1 < s0) return null;
  return [s0, s1 + 1];
}

/** Union of spans (flat [a, b, a, b, …], unsorted) as sorted disjoint spans. */
function unionSpans(spans: number[]): number[] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < spans.length; i += 2) pairs.push([spans[i]!, spans[i + 1]!]);
  pairs.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (const [a, b] of pairs) {
    const n = out.length;
    if (n > 0 && a <= out[n - 1]!) out[n - 1] = Math.max(out[n - 1]!, b);
    else out.push(a, b);
  }
  return out;
}

/** Intersection of two sorted disjoint span lists. */
function intersectSpans(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i]!, b[j]!);
    const hi = Math.min(a[i + 1]!, b[j + 1]!);
    if (hi > lo) out.push(lo, hi);
    if (a[i + 1]! < b[j + 1]!) i += 2;
    else j += 2;
  }
  return out;
}

function fillPolygon(builder: RasterBuilder, p: ArrayLike<number>): void {
  if (p.length < 6) return;
  const box = bounds(p);
  const [r0, r1] = rowRange(box.y0, box.y1, builder.sh);
  const spans: number[] = [];
  for (let sy = r0; sy < r1; sy++) {
    polygonSpans(p, centre(sy), spans);
    for (let k = 0; k < spans.length; k += 2) builder.span(sy, spans[k]!, spans[k + 1]!);
  }
}

function visible(scene: VisibleScene, width: number, height: number): FogRaster {
  const builder = new RasterBuilder(width, height);
  const lights = scene.lights.map((l) => ({ ...l, box: bounds(l.polygon) }));
  const lit = scene.darkness < 0.3;
  const vspans: number[] = [];
  const lspans: number[] = [];
  for (const v of scene.viewers) {
    if (v.polygon.length < 6) continue;
    const box = bounds(v.polygon);
    const [r0, r1] = rowRange(box.y0, box.y1, builder.sh);
    for (let sy = r0; sy < r1; sy++) {
      const y = centre(sy);
      polygonSpans(v.polygon, y, vspans);
      if (vspans.length === 0) continue;
      let spans: readonly number[] = vspans;
      if (!lit) {
        const allowed: number[] = [];
        if (v.dark > 0) {
          const d = discSpan(v.x, v.y, v.dark, y);
          if (d !== null) allowed.push(d[0], d[1]);
        }
        for (const l of lights) {
          if (y < l.box.y0 || y > l.box.y1 || l.polygon.length < 6) continue;
          const d = discSpan(l.x, l.y, l.dimRadius, y);
          if (d === null) continue;
          polygonSpans(l.polygon, y, lspans);
          for (let k = 0; k < lspans.length; k += 2) {
            const a = Math.max(lspans[k]!, d[0]);
            const b = Math.min(lspans[k + 1]!, d[1]);
            if (b > a) allowed.push(a, b);
          }
        }
        spans = intersectSpans(vspans, unionSpans(allowed));
      }
      for (let k = 0; k < spans.length; k += 2) builder.span(sy, spans[k]!, spans[k + 1]!);
    }
  }
  return builder.out;
}

function rect(x: number, y: number, w: number, h: number, width: number, height: number) {
  const builder = new RasterBuilder(width, height);
  if (!(w > 0) || !(h > 0)) return builder.out;
  // Centre inside [x, x + w) × [y, y + h).
  const r0 = Math.max(0, firstAtLeast(y));
  const r1 = Math.min(builder.sh, firstAtLeast(y + h));
  const s0 = firstAtLeast(x);
  const s1 = firstAtLeast(x + w);
  for (let sy = r0; sy < r1; sy++) builder.span(sy, s0, s1);
  return builder.out;
}

function disc(x: number, y: number, r: number, width: number, height: number): FogRaster {
  const builder = new RasterBuilder(width, height);
  if (!(r > 0)) return builder.out;
  const [r0, r1] = rowRange(y - r, y + r, builder.sh);
  for (let sy = r0; sy < r1; sy++) {
    const d = discSpan(x, y, r, centre(sy));
    if (d !== null) builder.span(sy, d[0], d[1]);
  }
  return builder.out;
}

interface Crossing {
  crosses(mode: 'vision', ax: number, ay: number, bx: number, by: number): boolean;
}

function hasCrosses(core: VisionCore): core is VisionCore & Crossing {
  return typeof (core as Partial<VisionCoreImpl>).crosses === 'function';
}

/**
 * Flood fill (4-neighbour) of the sub-cells reachable from (x, y) without crossing a vision
 * occluder of `core` (the move between two sub-cell centres must not touch one). Null when
 * more than maxCells cells are reached (the area is not a closed room) or (x, y) is outside.
 */
function room(
  core: VisionCore,
  x: number,
  y: number,
  width: number,
  height: number,
  maxCells: number,
): FogRaster | null {
  const builder = new RasterBuilder(width, height);
  const { sw, sh } = builder;
  const sx = Math.floor(x * FOG_SUBCELLS);
  const sy = Math.floor(y * FOG_SUBCELLS);
  if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) return null;
  const blocked = hasCrosses(core)
    ? (ax: number, ay: number, bx: number, by: number) => core.crosses('vision', ax, ay, bx, by)
    : (ax: number, ay: number, bx: number, by: number) =>
        core.firstHit('vision', [ax, ay], [bx, by]) !== null ||
        core.firstHit('vision', [bx, by], [ax, ay]) !== null;
  const limit = Math.max(0, maxCells) * FOG_SUBCELLS * FOG_SUBCELLS;
  const seen = new Set<number>([sy * sw + sx]);
  const queue = [sy * sw + sx];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const cx = id % sw;
    const cy = (id - cx) / sw;
    builder.set(cx, cy);
    const ax = centre(cx);
    const ay = centre(cy);
    for (const [nx, ny] of [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
      const nid = ny * sw + nx;
      if (seen.has(nid)) continue;
      if (blocked(ax, ay, centre(nx), centre(ny))) continue;
      seen.add(nid);
      if (seen.size > limit) return null;
      queue.push(nid);
    }
  }
  return builder.out;
}

export const fogRasterizers: FogRasterizers = {
  visible,
  rect,
  polygon(points, width, height) {
    const builder = new RasterBuilder(width, height);
    fillPolygon(builder, flat(points));
    return builder.out;
  },
  disc,
  room,
};
