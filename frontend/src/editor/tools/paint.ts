/** Tile brush (B) and eraser (E): continuous strokes, one undo step per stroke (mergeKey). */
import type { CellValue, MapPointerEvent, Overlay, TileCell, TileLayerId } from '../contracts';
import { EMPTY_CELL } from '../model/ops';
import {
  clampBrushSize,
  clipPoints,
  editableLayer,
  inMap,
  paintValue,
  tilesCommand,
} from './common';
import { brushFootprint, lineCells, type Point } from './raster';
import { isIdentity, symmetricCells } from './symmetry';
import type { Tool, ToolContext, ToolResult } from './types';

interface Stroke {
  readonly id: number;
  readonly layer: TileLayerId;
  readonly tile: CellValue;
  readonly painted: Set<number>;
  last: Point;
}

let strokeSeq = 0;

/** Creates the brush or eraser tool for tile painting. */
export function createPaintTool(ctx: ToolContext, mode: 'brush' | 'eraser'): Tool {
  let stroke: Stroke | null = null;
  const erase = mode === 'eraser';

  /** Cells plus their mirrored / repeated copies (tile brush only; the eraser mirrors too). */
  const withSymmetry = (cells: readonly Point[]): Point[] => {
    const spec = ctx.settings.symmetry;
    if (spec === undefined || isIdentity(spec)) return [...cells];
    return symmetricCells(cells, spec, ctx.doc.grid.width, ctx.doc.grid.height);
  };
  const footprintAt = (x: number, y: number): Point[] => {
    const fp = brushFootprint(clampBrushSize(ctx.settings.brushSize), ctx.settings.brushShape);
    return withSymmetry(
      clipPoints(
        ctx,
        fp.map(([dx, dy]) => [x + dx, y + dy] as const),
      ),
    );
  };
  const hover = (e: MapPointerEvent): Overlay => ({
    kind: 'cells',
    cells: footprintAt(e.cell.x, e.cell.y),
    ...(erase ? { erase: true } : {}),
  });

  const stamp = (s: Stroke, path: readonly Point[], e: MapPointerEvent): ToolResult => {
    const fp = brushFootprint(clampBrushSize(ctx.settings.brushSize), ctx.settings.brushShape);
    const w = ctx.doc.grid.width;
    const cells: TileCell[] = [];
    for (const [px, py] of path) {
      const footprint = fp.map(([dx, dy]) => [px + dx, py + dy] as Point);
      for (const [x, y] of withSymmetry(footprint)) {
        if (!inMap(ctx, x, y)) continue;
        const lin = y * w + x;
        if (s.painted.has(lin)) continue;
        s.painted.add(lin);
        const v = erase ? EMPTY_CELL : paintValue(ctx, s.tile);
        cells.push([x, y, v.index, v.variant, v.flags]);
      }
    }
    const command = tilesCommand(
      ctx,
      s.layer,
      cells,
      erase ? 'editor.command.erase' : 'editor.command.paint',
      `${mode}:${s.id}`,
    );
    return { overlay: hover(e), ...(command !== null ? { command } : {}) };
  };

  return {
    id: mode,
    shortcut: erase ? 'E' : 'B',
    onPointer(e) {
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          const layer = editableLayer(ctx);
          if (typeof layer !== 'string') return { notice: layer, overlay: hover(e) };
          const tile = erase ? EMPTY_CELL : ctx.settings.tile;
          if (tile === null || (!erase && tile.index === 0)) {
            return { notice: { code: 'no_tile' }, overlay: hover(e) };
          }
          const at: Point = [e.cell.x, e.cell.y];
          stroke = { id: ++strokeSeq, layer, tile, painted: new Set(), last: at };
          return stamp(stroke, [at], e);
        }
        case 'move': {
          if (stroke === null) return { overlay: hover(e) };
          const to: Point = [e.cell.x, e.cell.y];
          if (to[0] === stroke.last[0] && to[1] === stroke.last[1]) return { overlay: hover(e) };
          const path = lineCells(stroke.last[0], stroke.last[1], to[0], to[1]);
          stroke.last = to;
          return stamp(stroke, path, e);
        }
        case 'up':
          stroke = null;
          return { overlay: hover(e) };
        case 'leave':
          stroke = null;
          return { overlay: null };
      }
    },
    cancel() {
      stroke = null;
      return { overlay: null };
    },
    deactivate() {
      return this.cancel();
    },
  };
}
