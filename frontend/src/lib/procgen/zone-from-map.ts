/**
 * Zone of a selection for the zone generators (dungeon, cave): the bounding rectangle of the
 * selection and the "openings" through which the new area must connect to what already exists.
 */
import type { CellRect, MapView, SceneView } from '../../editor/contracts';

export interface GenZone {
  width: number;
  height: number;
  /** Cells of the inner edge of the rectangle, local coordinates [x, y]. */
  openings: [number, number][];
}

/** Bounding rectangle of the rectangles (null when empty). Not clipped to the grid. */
export function selectionBounds(selection: readonly CellRect[]): CellRect | null {
  if (selection.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of selection) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A wall segment must overlap the shared cell edge by more than this (in cells) to close it. */
const COVER = 0.5;
const EPS = 0.05;

interface Seg {
  a: readonly [number, number];
  b: readonly [number, number];
}

function wallSegments(doc: SceneView, floor: string): Seg[] {
  const out: Seg[] = [];
  for (const o of doc.objects()) {
    if (o.type !== 'wall' || o.floor !== floor) continue;
    const pts = o.geometry.points;
    for (let i = 0; i + 1 < pts.length; i++) out.push({ a: pts[i]!, b: pts[i + 1]! });
    if (o.geometry.closed && pts.length > 2) out.push({ a: pts[pts.length - 1]!, b: pts[0]! });
  }
  return out;
}

/** True when a segment lies on the vertical line x = c (or horizontal y = c) and covers [lo, lo+1]. */
function covers(segs: readonly Seg[], vertical: boolean, c: number, lo: number): boolean {
  for (const s of segs) {
    const [fix0, fix1, v0, v1] = vertical
      ? [s.a[0], s.b[0], s.a[1], s.b[1]]
      : [s.a[1], s.b[1], s.a[0], s.b[0]];
    if (Math.abs(fix0 - c) > EPS || Math.abs(fix1 - c) > EPS) continue;
    const overlap = Math.min(Math.max(v0, v1), lo + 1) - Math.max(Math.min(v0, v1), lo);
    if (overlap > COVER) return true;
  }
  return false;
}

/**
 * `rect` (usually `selectionBounds(...)`) is clipped to the grid. An opening is a cell of the
 * inner edge whose outer neighbour (inside the grid) has a non-empty ground tile and whose common
 * edge is not covered by any wall segment of the floor. Coordinates are local to the rectangle.
 */
export function zoneFromSelection(
  doc: MapView & SceneView,
  floor: string,
  rect: CellRect,
): GenZone {
  const g = doc.grid;
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(g.width, rect.x + rect.w);
  const y1 = Math.min(g.height, rect.y + rect.h);
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const openings: [number, number][] = [];
  if (width === 0 || height === 0) return { width, height, openings };
  const segs = wallSegments(doc, floor);
  const seen = new Set<number>();
  const hasGround = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < g.width && y < g.height && doc.getCell('ground', x, y).index !== 0;
  const add = (x: number, y: number): void => {
    const key = (y - y0) * width + (x - x0);
    if (seen.has(key)) return;
    seen.add(key);
    openings.push([x - x0, y - y0]);
  };
  for (let x = x0; x < x1; x++) {
    if (hasGround(x, y0 - 1) && !covers(segs, false, y0, x)) add(x, y0);
    if (hasGround(x, y1) && !covers(segs, false, y1, x)) add(x, y1 - 1);
  }
  for (let y = y0; y < y1; y++) {
    if (hasGround(x0 - 1, y) && !covers(segs, true, x0, y)) add(x0, y);
    if (hasGround(x1, y) && !covers(segs, true, x1, y)) add(x1 - 1, y);
  }
  return { width, height, openings };
}
