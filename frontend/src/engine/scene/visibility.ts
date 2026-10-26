/**
 * Current visibility (pure, projet.md 14.2, contracts.ts VisibleScene): a point is visible when
 * it is inside a viewer polygon AND (inside a light polygon, OR within `dark` cells of that
 * viewer, OR darkness < 0.3). Plus the emission throttle of onVisibility (≤ 1 per 100 ms).
 */

import type { Polygon, VisibleScene } from '../../editor/contracts';

/** Below this effective darkness everything in a vision polygon is visible. */
export const BRIGHT_DARKNESS = 0.3;
export const VISIBILITY_EMIT_MS = 100;

export function pointInPolygon(poly: Polygon, x: number, y: number): boolean {
  const n = poly.length >> 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]!;
    const yi = poly[i * 2 + 1]!;
    const xj = poly[j * 2]!;
    const yj = poly[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The rule of VisibleScene for one point. */
export function pointVisible(scene: VisibleScene, x: number, y: number): boolean {
  for (const v of scene.viewers) {
    if (!pointInPolygon(v.polygon, x, y)) continue;
    if (scene.darkness < BRIGHT_DARKNESS) return true;
    if (Math.hypot(x - v.x, y - v.y) <= v.dark) return true;
    for (const l of scene.lights) {
      if (Math.hypot(x - l.x, y - l.y) <= l.dimRadius && pointInPolygon(l.polygon, x, y)) {
        return true;
      }
    }
  }
  return false;
}

/** Whether lights / darkvision limit what the viewers see (else: their polygons only). */
export function lightLimited(darkness: number): boolean {
  return darkness >= BRIGHT_DARKNESS;
}

/** Emission throttle: at most one emission per interval, the last value always emitted. */
export class EmitThrottle {
  private last = -Infinity;

  constructor(private readonly intervalMs = VISIBILITY_EMIT_MS) {}

  /** Delay before the next emission may happen (0 = now). */
  delay(now: number): number {
    return Math.max(0, this.last + this.intervalMs - now);
  }

  mark(now: number): void {
    this.last = now;
  }

  reset(): void {
    this.last = -Infinity;
  }
}
