import type { ChunkKey, MapObject, PlacedToken, TileLayerId } from './contracts';
import { CHUNK_SIZE } from './contracts';
import { TILE_LAYERS, CELL_STRIDE } from '../formats/chunk-codec';

/** Resize dialog: where the old map sits inside the new one (or which side is cropped). */
export const ANCHORS = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'] as const;
export type Anchor = (typeof ANCHORS)[number];
export const DEFAULT_ANCHOR: Anchor = 'tl';
/** Server bounds of a side, in cells (MapInput::GRID_MIN / GRID_MAX). */
export const MAP_SIDE_MIN = 1;
export const MAP_SIDE_MAX = 400;

export interface Shift {
  readonly dx: number;
  readonly dy: number;
}

function axisShift(start: boolean, end: boolean, from: number, to: number): number {
  if (start) return 0;
  if (end) return to - from;
  return Math.floor((to - from) / 2);
}

/** Cells the content moves by for this anchor (positive when the map grows on the left / top). */
export function anchorShift(
  anchor: Anchor,
  from: { width: number; height: number },
  to: { width: number; height: number },
): Shift {
  return {
    dx: axisShift(anchor.includes('l'), anchor.includes('r'), from.width, to.width),
    dy: axisShift(anchor.includes('t'), anchor.includes('b'), from.height, to.height),
  };
}

/** What the document gives the counter (the shown MapDocument fits). */
export interface ResizeSource {
  floors(): readonly { readonly uid: string }[];
  objectsOf(floor: string): readonly MapObject[];
  tokensOf(floor: string): readonly PlacedToken[];
  chunkKeysOf(floor: string, layer: TileLayerId): readonly ChunkKey[];
  chunkCellsOf(floor: string, layer: TileLayerId, key: ChunkKey): Uint16Array | null;
}

export interface Lost {
  readonly objects: number;
  readonly tokens: number;
  readonly tiles: number;
}

type Point = readonly [number, number];

function pointsOf(object: MapObject): Point[] {
  const g = object.geometry as unknown as Record<string, unknown>;
  const out: Point[] = [];
  const add = (p: unknown): void => {
    if (Array.isArray(p)) out.push([Number(p[0]), Number(p[1])]);
    else if (typeof p === 'object' && p !== null) {
      const q = p as { x: number; y: number };
      out.push([q.x, q.y]);
    }
  };
  if (typeof g['x'] === 'number' && typeof g['y'] === 'number') out.push([g['x'], g['y']]);
  add(g['a']);
  add(g['b']);
  for (const key of ['points', 'polygon']) {
    const list = g[key];
    if (Array.isArray(list)) list.forEach(add);
  }
  return out;
}

/**
 * Same rule as the server (ObjectRules::fitsIn after the move): an object stays only when it is
 * whole inside the new map; an image only needs to keep a part of itself on it.
 */
export function objectFits(
  object: MapObject,
  shift: Shift,
  width: number,
  height: number,
): boolean {
  const g = object.geometry as unknown as Record<string, number>;
  if (object.type === 'image') {
    const x = g['x']! + shift.dx;
    const y = g['y']! + shift.dy;
    return (
      Math.abs(x) <= width &&
      Math.abs(y) <= height &&
      x + g['w']! > 0 &&
      y + g['h']! > 0 &&
      g['w']! <= 2 * width &&
      g['h']! <= 2 * height
    );
  }
  const points = pointsOf(object).map(([x, y]): Point => [x + shift.dx, y + shift.dy]);
  if (object.type === 'stairs') {
    points.push([points[0]![0] + g['w']!, points[0]![1] + g['h']!]);
  }
  return points.every(([x, y]) => x >= 0 && y >= 0 && x <= width && y <= height);
}

/** Objects, placed tokens and tiles (of the floors in memory) that the resize would delete. */
export function lostByResize(
  source: ResizeSource,
  shift: Shift,
  width: number,
  height: number,
): Lost {
  let objects = 0;
  let tokens = 0;
  let tiles = 0;
  for (const { uid } of source.floors()) {
    for (const object of source.objectsOf(uid)) {
      if (!objectFits(object, shift, width, height)) objects++;
    }
    for (const token of source.tokensOf(uid)) {
      const x = token.x + shift.dx;
      const y = token.y + shift.dy;
      if (x < 0 || y < 0 || x > width || y > height) tokens++;
    }
    for (const layer of TILE_LAYERS) {
      for (const key of source.chunkKeysOf(uid, layer)) {
        const cells = source.chunkCellsOf(uid, layer, key);
        if (cells === null) continue;
        const [cx, cy] = key.split(':').map(Number) as [number, number];
        for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
          if (cells[i * CELL_STRIDE] === 0) continue;
          const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE) + shift.dx;
          const y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE) + shift.dy;
          if (x < 0 || y < 0 || x >= width || y >= height) tiles++;
        }
      }
    }
  }
  return { objects, tokens, tiles };
}
