/**
 * Thumbnail of a generation: one RGBA pixel per cell (width x height of the result), pure and
 * testable under Node. The caller puts it in an ImageData / canvas and scales it up.
 * Empty cells stay transparent. Order of painting: ground, terrain, decor, walls, doors.
 */
import { packKey } from '../../procgen/pack-keys';
import type { GenFloor, GenResult } from '../../procgen/types';

type Rgb = readonly [number, number, number];

const GROUND: Readonly<Record<string, Rgb>> = {
  'floor.stone': [150, 150, 156],
  'floor.flagstone': [128, 128, 136],
  'floor.wood': [160, 118, 72],
  'floor.grass': [96, 150, 70],
  'floor.sand': [214, 190, 120],
  'floor.snow': [236, 240, 246],
  'floor.ice': [176, 214, 232],
  'floor.cave': [112, 98, 88],
  // roads
  'floor.cobble': [190, 176, 150],
  'floor.dirt': [160, 128, 86],
};
const FALLBACK_GROUND: Rgb = [140, 140, 140];
const TERRAIN: Readonly<Record<string, Rgb>> = {
  'terrain.water': [64, 130, 205],
  'terrain.deep_water': [32, 78, 150],
  'terrain.lava': [226, 80, 24],
  'terrain.mud': [104, 80, 52],
};
const DECOR_BLOCKING: Rgb = [70, 56, 44];
const DECOR_FREE: Rgb = [110, 100, 70];
const WALL: Rgb = [24, 22, 28];
const DOOR: Rgb = [255, 64, 200];
const WINDOW: Rgb = [90, 220, 255];

function isBlockingDecor(key: string): boolean {
  try {
    return packKey(key).blocking;
  } catch {
    return false;
  }
}

/** Cells touched by a segment (both sides of an axis-aligned edge, else the cells it crosses). */
function segmentCells(
  a: readonly [number, number],
  b: readonly [number, number],
  put: (x: number, y: number) => void,
): void {
  const [ax, ay] = a;
  const [bx, by] = b;
  const eps = 1e-6;
  if (Math.abs(ay - by) < eps) {
    const y = Math.round(ay);
    for (let x = Math.floor(Math.min(ax, bx) + eps); x < Math.ceil(Math.max(ax, bx) - eps); x++) {
      put(x, y - 1);
      put(x, y);
    }
    return;
  }
  if (Math.abs(ax - bx) < eps) {
    const x = Math.round(ax);
    for (let y = Math.floor(Math.min(ay, by) + eps); y < Math.ceil(Math.max(ay, by) - eps); y++) {
      put(x - 1, y);
      put(x, y);
    }
    return;
  }
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    put(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t));
  }
}

function paint(f: GenFloor, width: number, height: number, px: Uint8ClampedArray): void {
  const set = (x: number, y: number, c: Rgb): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = 255;
  };
  for (const c of f.ground) set(c.x, c.y, GROUND[c.key] ?? FALLBACK_GROUND);
  for (const c of f.terrain) set(c.x, c.y, TERRAIN[c.key] ?? FALLBACK_GROUND);
  for (const c of f.decor) set(c.x, c.y, isBlockingDecor(c.key) ? DECOR_BLOCKING : DECOR_FREE);
  for (const w of f.walls) {
    const pts = w.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      segmentCells(pts[i]!, pts[i + 1]!, (x, y) => set(x, y, WALL));
    }
    if (w.closed && pts.length > 2) {
      segmentCells(pts[pts.length - 1]!, pts[0]!, (x, y) => set(x, y, WALL));
    }
  }
  for (const w of f.windows) segmentCells(w.a, w.b, (x, y) => set(x, y, WINDOW));
  for (const d of f.doors) segmentCells(d.a, d.b, (x, y) => set(x, y, DOOR));
}

/** RGBA, row-major, `result.width * result.height * 4` bytes (first floor). */
export function previewPixels(result: GenResult): Uint8ClampedArray {
  const px = new Uint8ClampedArray(result.width * result.height * 4);
  const f = result.floors[0];
  if (f !== undefined) paint(f, result.width, result.height, px);
  return px;
}
