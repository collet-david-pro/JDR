/** Helpers shared by the tile tools. */
import type { CellValue, Command, TileCell, TileLayerId } from '../contracts';
import { EMPTY_CELL, tilesSet } from '../model/ops';
import type { Point } from './raster';
import { BRUSH_MAX, BRUSH_MIN, type ToolContext, type ToolNotice } from './types';

export function clampBrushSize(size: number): number {
  return Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Math.round(size) || BRUSH_MIN));
}

/** Active layer if it is an unlocked tile layer of the document, else a notice. */
export function editableLayer(ctx: ToolContext): TileLayerId | ToolNotice {
  const id = ctx.settings.layer;
  const def = ctx.doc.layers.find((l) => l.id === id);
  if (def === undefined || def.kind !== 'tiles' || def.locked) return { code: 'layer_locked' };
  return id;
}

/** Value written for one cell: the tile, with optional random variant and rotation. */
export function paintValue(ctx: ToolContext, tile: CellValue): CellValue {
  const { variantCount, randomRotation } = ctx.settings;
  if (tile.index === 0) return EMPTY_CELL;
  const variant =
    variantCount > 1 ? ctx.rng.int(Math.min(256, Math.floor(variantCount))) : tile.variant;
  const flags = randomRotation ? (tile.flags & ~3) | ctx.rng.int(4) : tile.flags;
  return { index: tile.index, variant, flags };
}

export function inMap(ctx: ToolContext, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < ctx.doc.grid.width && y < ctx.doc.grid.height;
}

export function clipPoints(ctx: ToolContext, points: readonly Point[]): Point[] {
  return points.filter(([x, y]) => inMap(ctx, x, y));
}

/**
 * tiles.set command for the given cells (outside / unchanged cells dropped), with the inverse read
 * from the document. Null when nothing would change.
 */
export function tilesCommand(
  ctx: ToolContext,
  layer: TileLayerId,
  cells: readonly TileCell[],
  label: string,
  mergeKey?: string,
): Command | null {
  const ops: TileCell[] = [];
  const inverse: TileCell[] = [];
  for (const c of cells) {
    const x = c[0];
    const y = c[1];
    const index = c[2];
    const variant = c[3];
    const flags = c[4];
    if (!inMap(ctx, x, y)) continue;
    const cur = ctx.doc.getCell(layer, x, y);
    if (
      index === 0
        ? cur.index === 0
        : cur.index === index && cur.variant === variant && cur.flags === flags
    ) {
      continue;
    }
    ops.push(c);
    inverse.push([x, y, cur.index, cur.variant, cur.flags]);
  }
  if (ops.length === 0) return null;
  const floor = ctx.doc.floor;
  return {
    label,
    ops: [tilesSet(floor, layer, ops)],
    inverseOps: [tilesSet(floor, layer, inverse)],
    ...(mergeKey !== undefined ? { mergeKey } : {}),
  };
}
