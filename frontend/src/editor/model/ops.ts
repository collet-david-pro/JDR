/** Map op helpers (projet.md 11.4) shared by the document and the history. */
import {
  CHUNK_SIZE,
  type CellValue,
  type ChunkKey,
  type LayerDef,
  type MapOp,
  type TileCell,
  type TileLayerId,
} from '../contracts';

export type MapOpErrorCode =
  | 'unknown_floor'
  | 'unknown_layer'
  | 'bad_cell'
  | 'bad_palette_index'
  | 'palette_conflict'
  | 'bad_layers'
  | 'unknown_op';

export class MapOpError extends Error {
  override readonly name = 'MapOpError';
  constructor(
    readonly code: MapOpErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const EMPTY_CELL: CellValue = Object.freeze({ index: 0, variant: 0, flags: 0 });

/** Default layer stack of a new map (projet.md 12.1). */
export const DEFAULT_LAYERS: readonly LayerDef[] = Object.freeze([
  { id: 'ground', kind: 'tiles', visible: true, locked: false, opacity: 1 },
  { id: 'terrain', kind: 'tiles', visible: true, locked: false, opacity: 1 },
  { id: 'decor', kind: 'tiles', visible: true, locked: false, opacity: 1 },
  { id: 'walls', kind: 'objects', visible: true, locked: false, opacity: 1 },
  { id: 'props', kind: 'objects', visible: true, locked: false, opacity: 1 },
  { id: 'lighting', kind: 'objects', visible: true, locked: false, opacity: 1 },
  { id: 'labels', kind: 'objects', visible: true, locked: false, opacity: 1 },
  { id: 'gm', kind: 'objects', visible: true, locked: false, opacity: 1, gmOnly: true },
] satisfies LayerDef[]);

export function chunkKey(cx: number, cy: number): ChunkKey {
  return `${cx}:${cy}`;
}

export function parseChunkKey(key: string): { cx: number; cy: number } | null {
  const m = /^(\d{1,5}):(\d{1,5})$/.exec(key);
  return m === null ? null : { cx: Number(m[1]), cy: Number(m[2]) };
}

export function chunkKeyOfCell(x: number, y: number): ChunkKey {
  return chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
}

export function sameCell(a: CellValue, b: CellValue): boolean {
  return a.index === b.index && a.variant === b.variant && a.flags === b.flags;
}

export function tileCell(x: number, y: number, v: CellValue): TileCell {
  return [x, y, v.index, v.variant, v.flags];
}

/** Builds a tiles.set op. */
export function tilesSet(floor: string, layer: TileLayerId, cells: readonly TileCell[]): MapOp {
  return { type: 'tiles.set', floor, layer, cells };
}

/**
 * Merges adjacent tiles.set ops that target the same floor/layer (the last value of a cell wins).
 * Applying the result is equivalent to applying `ops` in order.
 */
export function compactOps(ops: readonly MapOp[]): MapOp[] {
  const out: MapOp[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.type !== 'tiles.set') {
      out.push(op);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < ops.length) {
      const next = ops[j]!;
      if (next.type !== 'tiles.set' || next.floor !== op.floor || next.layer !== op.layer) break;
      j++;
    }
    if (j === i + 1) {
      out.push(dedupeOp(op));
    } else {
      const merged = new Map<number, TileCell>();
      for (let k = i; k < j; k++) {
        const o = ops[k]!;
        if (o.type !== 'tiles.set') continue;
        for (const c of o.cells) {
          const key = cellKey(c);
          merged.set(key, c); // last write wins
        }
      }
      out.push(tilesSet(op.floor, op.layer, [...merged.values()]));
    }
    i = j;
  }
  return out;
}

function dedupeOp(op: MapOp & { type: 'tiles.set' }): MapOp {
  const seen = new Map<number, TileCell>();
  for (const c of op.cells) {
    const key = cellKey(c);
    seen.set(key, c);
  }
  return seen.size === op.cells.length ? op : tilesSet(op.floor, op.layer, [...seen.values()]);
}

/** Numeric key of a cell (maps are at most 400×400, far below 65 536). */
function cellKey(c: TileCell): number {
  return c[1] * 65536 + c[0];
}

/** Total number of cells carried by tiles.set ops. */
export function countCells(ops: readonly MapOp[]): number {
  let n = 0;
  for (const op of ops) if (op.type === 'tiles.set') n += op.cells.length;
  return n;
}
