/**
 * Object snapping (pure): points of the other objects (wall ends and middles, door ends and middles,
 * corners and centre of the box of any other object) that a moved selection can stick to.
 */
import type { MapObject, Point } from '../contracts';
import { objectBox, wallSegments } from './geometry';

/** Result of a snap search: the shift to add to the moved points, and the point snapped to. */
export interface SnapShift {
  readonly dx: number;
  readonly dy: number;
  readonly target: Point;
}

/** Corners and centre of the box of an object, plus its own vertices for walls, doors and windows. */
export function objectAnchors(o: MapObject): Point[] {
  const b = objectBox(o);
  const out: Point[] = [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x0, b.y1],
    [b.x1, b.y1],
    [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2],
  ];
  if (o.type === 'wall') out.push(...o.geometry.points);
  else if (o.type === 'door' || o.type === 'window') out.push(o.geometry.a, o.geometry.b);
  return out;
}

/** Candidate points of the objects not excluded: anchors, plus segment middles of walls. */
export function snapTargets(
  objects: readonly MapObject[],
  exclude: (o: MapObject) => boolean = () => false,
): Point[] {
  const out: Point[] = [];
  for (const o of objects) {
    if (exclude(o)) continue;
    out.push(...objectAnchors(o));
    if (o.type === 'wall') {
      for (const [a, b] of wallSegments(o)) out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
  }
  return out;
}

/**
 * Smallest shift that brings one of `anchors` onto one of `targets`, if closer than `tolerance`
 * (cells). Null when nothing is in range.
 */
export function nearestSnapShift(
  anchors: readonly Point[],
  targets: readonly Point[],
  tolerance: number,
): SnapShift | null {
  let best: SnapShift | null = null;
  let bestD = tolerance;
  for (const a of anchors) {
    for (const t of targets) {
      const d = Math.hypot(t[0] - a[0], t[1] - a[1]);
      if (d < bestD) {
        bestD = d;
        best = { dx: t[0] - a[0], dy: t[1] - a[1], target: t };
      }
    }
  }
  return best;
}
