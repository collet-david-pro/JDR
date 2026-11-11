/**
 * P14 image objects: normalisation (same rules as app/Maps/ObjectRulesImage.php) and pure geometry
 * (corners, bounding box, hit test) shared by the editor tools, the renderers and the export.
 */
import type { Point } from '../contracts';
import {
  IMAGE_PLACEMENTS,
  IMAGE_SIZE_MIN,
  type ImageGeometry,
  type ImageObject,
  type ImageProps,
  type ImageTile,
} from '../contracts-images';
import { MapOpError } from './ops';

interface Bounds {
  readonly width: number;
  readonly height: number;
}

function bad(message: string): never {
  throw new MapOpError('bad_object', message);
}

function num(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) bad(`Invalid ${what}`);
  return v;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Degrees in [0, 360), 2 decimals. */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let r = deg % 360;
  if (r < 0) r += 360;
  r = Math.round(r * 100) / 100;
  return r >= 360 ? 0 : r;
}

/** Validated, rounded image geometry (throws MapOpError). */
export function imageGeometry(g: unknown, b: Bounds): ImageGeometry {
  if (typeof g !== 'object' || g === null) bad('Invalid image geometry');
  const v = g as Record<string, unknown>;
  const x = r3(num(v.x, -b.width, b.width, 'image x'));
  const y = r3(num(v.y, -b.height, b.height, 'image y'));
  const w = r3(num(v.w, IMAGE_SIZE_MIN, Math.max(IMAGE_SIZE_MIN, 2 * b.width), 'image w'));
  const h = r3(num(v.h, IMAGE_SIZE_MIN, Math.max(IMAGE_SIZE_MIN, 2 * b.height), 'image h'));
  const rotation = normalizeRotation(num(v.rotation, -360, 360, 'image rotation'));
  if (x + w <= 0 || y + h <= 0) bad('Image out of bounds');
  return { x, y, w, h, rotation };
}

/** Validated image props (throws MapOpError). */
export function imageProps(p: unknown): ImageProps {
  if (typeof p !== 'object' || p === null) bad('Invalid image props');
  const v = p as Record<string, unknown>;
  const id = typeof v.asset_id === 'number' ? String(v.asset_id) : v.asset_id;
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(id)) bad('Invalid image asset');
  if (typeof v.flip_h !== 'boolean' || typeof v.flip_v !== 'boolean') bad('Invalid image flip');
  const placement = v.placement;
  if (
    typeof placement !== 'string' ||
    !(IMAGE_PLACEMENTS as readonly string[]).includes(placement)
  ) {
    bad('Invalid image placement');
  }
  const props: ImageProps = {
    asset_id: id,
    opacity: r3(num(v.opacity, 0, 1, 'image opacity')),
    flip_h: v.flip_h,
    flip_v: v.flip_v,
    placement: placement as ImageProps['placement'],
  };
  return v.tile === undefined || v.tile === null ? props : { ...props, tile: imageTile(v.tile) };
}

const TILE_GROUP = /^[A-Za-z0-9_-]{1,64}$/;

/** Validated tile of a big picture (same rules as ObjectRulesImage::tile). */
export function imageTile(t: unknown): ImageTile {
  if (typeof t !== 'object' || t === null) bad('Invalid image tile');
  const v = t as Record<string, unknown>;
  if (typeof v.group !== 'string' || !TILE_GROUP.test(v.group)) bad('Invalid image tile group');
  const int = (value: unknown, min: number, what: string): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > 1_000_000) {
      bad(`Invalid image tile ${what}`);
    }
    return value;
  };
  const tile = {
    group: v.group,
    x: int(v.x, 0, 'x'),
    y: int(v.y, 0, 'y'),
    w: int(v.w, 1, 'w'),
    h: int(v.h, 1, 'h'),
    tw: int(v.tw, 1, 'tw'),
    th: int(v.th, 1, 'th'),
  };
  if (tile.x + tile.w > tile.tw || tile.y + tile.h > tile.th) bad('Image tile out of its picture');
  return tile;
}

/** Clamps a geometry into the accepted bounds of a map (sizes first, then the position). */
export function clampImageGeometry(g: ImageGeometry, b: Bounds): ImageGeometry {
  const w = r3(Math.min(Math.max(g.w, IMAGE_SIZE_MIN), Math.max(IMAGE_SIZE_MIN, 2 * b.width)));
  const h = r3(Math.min(Math.max(g.h, IMAGE_SIZE_MIN), Math.max(IMAGE_SIZE_MIN, 2 * b.height)));
  const x = r3(Math.min(Math.max(g.x, -b.width, -w + 0.001), b.width));
  const y = r3(Math.min(Math.max(g.y, -b.height, -h + 0.001), b.height));
  return { x, y, w, h, rotation: normalizeRotation(g.rotation) };
}

/** Centre of the image, cells. */
export function imageCenter(g: ImageGeometry): Point {
  return [g.x + g.w / 2, g.y + g.h / 2];
}

/** Corners (top-left, top-right, bottom-right, bottom-left) after rotation, cells. */
export function imageCorners(g: ImageGeometry): readonly Point[] {
  const [cx, cy] = imageCenter(g);
  const a = (g.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [
    [-g.w / 2, -g.h / 2],
    [g.w / 2, -g.h / 2],
    [g.w / 2, g.h / 2],
    [-g.w / 2, g.h / 2],
  ].map(([dx, dy]) => [cx + dx! * cos - dy! * sin, cy + dx! * sin + dy! * cos] as Point);
}

/** Axis-aligned bounding box [x1, y1, x2, y2] of the rotated rectangle, cells. */
export function imageBBox(g: ImageGeometry): readonly [number, number, number, number] {
  const c = imageCorners(g);
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Point (cells) in the image's local frame: [u, v] in [0, 1] when inside. */
export function imageLocal(g: ImageGeometry, x: number, y: number): Point {
  const [cx, cy] = imageCenter(g);
  const a = (-g.rotation * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return [lx / g.w + 0.5, ly / g.h + 0.5];
}

/** True when (x, y) (cells) is inside the rotated rectangle, with a margin in cells. */
export function imageContains(g: ImageGeometry, x: number, y: number, margin = 0): boolean {
  const [u, v] = imageLocal(g, x, y);
  const mu = margin / g.w;
  const mv = margin / g.h;
  return u >= -mu && u <= 1 + mu && v >= -mv && v <= 1 + mv;
}

/** Image objects drawn under the tiles / above the objects. */
export function imagePlacementOf(o: ImageObject): 'background' | 'above' {
  return o.props.placement;
}
