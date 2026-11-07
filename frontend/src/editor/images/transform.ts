/**
 * P14 image tool geometry (pure): placement at the native size, move, corner resize (opposite
 * corner fixed, Shift keeps the proportions), rotation around the centre, handle positions.
 * Without Alt, positions snap to half cells and angles to 15° steps.
 */
import type { GridSpec, Point } from '../contracts';
import { IMAGE_SIZE_MIN, type ImageAssetView, type ImageGeometry } from '../contracts-images';
import {
  clampImageGeometry,
  imageCenter,
  imageCorners,
  normalizeRotation,
} from '../model/image-values';

/** Corner handles: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left (unrotated frame). */
export type ImageHandle =
  { readonly kind: 'corner'; readonly index: 0 | 1 | 2 | 3 } | { readonly kind: 'rotate' };

const SNAP_STEP = 0.5;
const ANGLE_STEP = 15;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const snap = (v: number, free: boolean): number =>
  free ? v : Math.round(v / SNAP_STEP) * SNAP_STEP;

/** Native size of an asset in cells (its pixels at the map's cell size), 1 × 1 when unknown. */
export function nativeSize(
  asset: Pick<ImageAssetView, 'width' | 'height'> | null,
  grid: Pick<GridSpec, 'width' | 'height' | 'cellPx'>,
): { w: number; h: number } {
  if (asset === null || !(asset.width > 0) || !(asset.height > 0) || !(grid.cellPx > 0)) {
    return { w: 1, h: 1 };
  }
  let w = asset.width / grid.cellPx;
  let h = asset.height / grid.cellPx;
  // Never larger than the accepted bounds (twice the map): scaled down, proportions kept.
  const k = Math.min(1, (2 * grid.width) / w, (2 * grid.height) / h);
  w *= k;
  h *= k;
  return { w: r3(Math.max(IMAGE_SIZE_MIN, w)), h: r3(Math.max(IMAGE_SIZE_MIN, h)) };
}

/** Geometry of a new image centred on `at` (cells). */
export function placeImage(
  asset: Pick<ImageAssetView, 'width' | 'height'> | null,
  at: Point,
  grid: Pick<GridSpec, 'width' | 'height' | 'cellPx'>,
  free: boolean,
): ImageGeometry {
  const { w, h } = nativeSize(asset, grid);
  const x = snap(at[0] - w / 2, free);
  const y = snap(at[1] - h / 2, free);
  return clampImageGeometry({ x, y, w, h, rotation: 0 }, grid);
}

/** Geometry moved by (dx, dy) cells (the top-left corner snapped unless `free`). */
export function moveImage(
  g: ImageGeometry,
  dx: number,
  dy: number,
  free: boolean,
  bounds: { readonly width: number; readonly height: number },
): ImageGeometry {
  return clampImageGeometry({ ...g, x: snap(g.x + dx, free), y: snap(g.y + dy, free) }, bounds);
}

/** Unrotated sign of each corner relative to the centre. */
const CORNER_SIGNS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Geometry after dragging a corner to `p` (cells): the opposite corner stays where it is.
 * `keepRatio` (Shift): the proportions of `g` are kept. `free` (Alt): no snapping (an unrotated
 * image snaps the dragged corner to half cells).
 */
export function resizeImage(
  g: ImageGeometry,
  index: 0 | 1 | 2 | 3,
  p: Point,
  keepRatio: boolean,
  free: boolean,
  bounds: { readonly width: number; readonly height: number },
): ImageGeometry {
  const corners = imageCorners(g);
  const opposite = corners[(index + 2) % 4]!;
  const target: Point = g.rotation === 0 && !free ? [snap(p[0], false), snap(p[1], false)] : p;
  const a = (g.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = target[0] - opposite[0];
  const dy = target[1] - opposite[1];
  // Pointer relative to the fixed corner, in the image frame.
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const [sx, sy] = CORNER_SIGNS[index]!;
  let w = Math.max(IMAGE_SIZE_MIN, lx * sx);
  let h = Math.max(IMAGE_SIZE_MIN, ly * sy);
  if (keepRatio && g.w > 0 && g.h > 0) {
    const k = Math.max(w / g.w, h / g.h);
    w = Math.max(IMAGE_SIZE_MIN, g.w * k);
    h = Math.max(IMAGE_SIZE_MIN, g.h * k);
  }
  // New centre: from the fixed corner, half the new size along the image axes.
  const hx = (sx * w) / 2;
  const hy = (sy * h) / 2;
  const cx = opposite[0] + hx * cos - hy * sin;
  const cy = opposite[1] + hx * sin + hy * cos;
  return clampImageGeometry({ x: cx - w / 2, y: cy - h / 2, w, h, rotation: g.rotation }, bounds);
}

/** Geometry after a rotation drag from `start` to `p` (cells), snapped to 15° unless `free`. */
export function rotateImage(
  g: ImageGeometry,
  start: Point,
  p: Point,
  free: boolean,
): ImageGeometry {
  const [cx, cy] = imageCenter(g);
  const a0 = Math.atan2(start[1] - cy, start[0] - cx);
  const a1 = Math.atan2(p[1] - cy, p[0] - cx);
  let deg = g.rotation + ((a1 - a0) * 180) / Math.PI;
  if (!free) deg = Math.round(deg / ANGLE_STEP) * ANGLE_STEP;
  return { ...g, rotation: normalizeRotation(deg) };
}

/** Handle positions (cells): four corners, then the rotation handle above the top edge. */
export function imageHandlePoints(
  g: ImageGeometry,
  cellsPerPx: number,
): {
  readonly corners: readonly Point[];
  readonly rotate: Point;
  readonly topMiddle: Point;
} {
  const corners = imageCorners(g);
  const tl = corners[0]!;
  const tr = corners[1]!;
  const topMiddle: Point = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2];
  const a = (g.rotation * Math.PI) / 180;
  const off = 24 * cellsPerPx;
  // "Up" in the image frame is (sin a, -cos a).
  const rotate: Point = [topMiddle[0] + Math.sin(a) * off, topMiddle[1] - Math.cos(a) * off];
  return { corners, rotate, topMiddle };
}

/** Handle under p (cells), tolerance in cells; null when none. */
export function imageHandleAt(
  g: ImageGeometry,
  p: Point,
  tol: number,
  cellsPerPx: number,
): ImageHandle | null {
  const h = imageHandlePoints(g, cellsPerPx);
  if (Math.hypot(p[0] - h.rotate[0], p[1] - h.rotate[1]) <= tol) return { kind: 'rotate' };
  for (let i = 0; i < 4; i++) {
    const c = h.corners[i]!;
    if (Math.hypot(p[0] - c[0], p[1] - c[1]) <= tol) {
      return { kind: 'corner', index: i as 0 | 1 | 2 | 3 };
    }
  }
  return null;
}
