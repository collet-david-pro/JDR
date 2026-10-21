/** Fill (G): 4-connected region of the same tile (palette index), at most 50 000 cells. */
import type { TileCell, TileLayerId } from '../contracts';
import { editableLayer, paintValue, tilesCommand } from './common';
import { FILL_LIMIT, type Tool, type ToolContext, type ToolDocument } from './types';

/**
 * Cells (linear indexes y*width+x) of the 4-connected region of `index` containing (x, y).
 * Returns null when the region exceeds `limit` cells.
 */
export function floodRegion(
  doc: ToolDocument,
  layer: TileLayerId,
  x: number,
  y: number,
  limit: number,
): Int32Array | null {
  const { width: w, height: h } = doc.grid;
  if (x < 0 || y < 0 || x >= w || y >= h) return new Int32Array(0);
  const target = doc.getIndex(layer, x, y);
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(Math.min(w * h, limit + 1));
  let head = 0;
  let tail = 0;
  const start = y * w + x;
  visited[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const p = queue[head++]!;
    const px = p % w;
    const py = (p - px) / w;
    for (let k = 0; k < 4; k++) {
      let nx = px;
      let ny = py;
      if (k === 0) nx--;
      else if (k === 1) nx++;
      else if (k === 2) ny--;
      else ny++;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (visited[n] === 1 || doc.getIndex(layer, nx, ny) !== target) continue;
      visited[n] = 1;
      if (tail >= limit) return null;
      queue[tail++] = n;
    }
  }
  return queue.subarray(0, tail);
}

export function createFillTool(ctx: ToolContext): Tool {
  return {
    id: 'fill',
    shortcut: 'G',
    onPointer(e) {
      if (e.type !== 'down' || e.button !== 0) return {};
      const layer = editableLayer(ctx);
      if (typeof layer !== 'string') return { notice: layer };
      const tile = ctx.settings.tile;
      if (tile === null || tile.index === 0) return { notice: { code: 'no_tile' } };
      const { x, y } = e.cell;
      const seed = ctx.doc.getIndex(layer, x, y);
      const randomised = ctx.settings.variantCount > 1 || ctx.settings.randomRotation;
      if (seed === tile.index && !randomised) {
        const cur = ctx.doc.getCell(layer, x, y);
        if (cur.variant === tile.variant && cur.flags === tile.flags) {
          return { notice: { code: 'fill_nothing' } };
        }
      }
      const region = floodRegion(ctx.doc, layer, x, y, FILL_LIMIT);
      if (region === null) return { notice: { code: 'fill_limit', params: { limit: FILL_LIMIT } } };
      if (region.length === 0) return { notice: { code: 'fill_nothing' } };
      const w = ctx.doc.grid.width;
      const cells: TileCell[] = new Array<TileCell>(region.length);
      for (let i = 0; i < region.length; i++) {
        const p = region[i]!;
        const v = paintValue(ctx, tile);
        cells[i] = [p % w, Math.floor(p / w), v.index, v.variant, v.flags];
      }
      const command = tilesCommand(ctx, layer, cells, 'editor.command.fill');
      return command === null ? { notice: { code: 'fill_nothing' } } : { command };
    },
    cancel: () => ({}),
    deactivate: () => ({}),
  };
}
