/**
 * Shapes (U): rectangle / ellipse / Bresenham line, filled or outline. Drag to preview, release
 * to apply. Shift: square / circle / 45° line.
 */
import type { MapPointerEvent, TileCell } from '../contracts';
import { clipPoints, editableLayer, paintValue, tilesCommand } from './common';
import { ellipseCells, lineCells, rectBetween, rectCells, type Point } from './raster';
import type { ShapeKind, Tool, ToolContext, ToolResult } from './types';

/** Cells of a shape between two corner/end cells. */
export function shapeCells(
  kind: ShapeKind,
  filled: boolean,
  from: Point,
  to: Point,
  constrain: boolean,
): Point[] {
  let end = to;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (constrain) {
    if (kind === 'line') {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ax > 2 * ay) end = [to[0], from[1]];
      else if (ay > 2 * ax) end = [from[0], to[1]];
      else {
        const d = Math.max(ax, ay);
        end = [from[0] + Math.sign(dx) * d, from[1] + Math.sign(dy) * d];
      }
    } else {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      end = [from[0] + (dx < 0 ? -d : d), from[1] + (dy < 0 ? -d : d)];
    }
  }
  if (kind === 'line') return lineCells(from[0], from[1], end[0], end[1]);
  const r = rectBetween(from, end);
  return kind === 'rect' ? rectCells(r, filled) : ellipseCells(r, filled);
}

export function createShapeTool(ctx: ToolContext): Tool {
  let anchor: Point | null = null;

  const current = (e: MapPointerEvent): Point[] =>
    anchor === null
      ? []
      : clipPoints(
          ctx,
          shapeCells(
            ctx.settings.shapeKind,
            ctx.settings.shapeFilled,
            anchor,
            [e.cell.x, e.cell.y],
            e.mods.shift,
          ),
        );

  return {
    id: 'shape',
    shortcut: 'U',
    onPointer(e): ToolResult {
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          const layer = editableLayer(ctx);
          if (typeof layer !== 'string') return { notice: layer };
          if (ctx.settings.tile === null || ctx.settings.tile.index === 0) {
            return { notice: { code: 'no_tile' } };
          }
          anchor = [e.cell.x, e.cell.y];
          return { overlay: { kind: 'cells', cells: current(e) } };
        }
        case 'move':
          return anchor === null ? {} : { overlay: { kind: 'cells', cells: current(e) } };
        case 'up': {
          if (anchor === null) return {};
          const points = current(e);
          anchor = null;
          const layer = editableLayer(ctx);
          const tile = ctx.settings.tile;
          if (typeof layer !== 'string') return { overlay: null, notice: layer };
          if (tile === null || tile.index === 0)
            return { overlay: null, notice: { code: 'no_tile' } };
          const cells: TileCell[] = points.map(([x, y]) => {
            const v = paintValue(ctx, tile);
            return [x, y, v.index, v.variant, v.flags];
          });
          const command = tilesCommand(ctx, layer, cells, 'editor.command.shape');
          return { overlay: null, ...(command !== null ? { command } : {}) };
        }
        case 'leave':
          // Keep the gesture: the pointer may come back before release.
          return {};
      }
    },
    cancel() {
      anchor = null;
      return { overlay: null };
    },
    deactivate() {
      return this.cancel();
    },
  };
}
