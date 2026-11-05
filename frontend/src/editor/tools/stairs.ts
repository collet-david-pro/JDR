/**
 * Stairs tool (P9a2): drag a rectangle on the grid (1-10 whole cells per side; a click makes one cell).
 * The stairs lead to another floor of the map (the chosen one, else the first other floor) or, with a
 * link, to another map; the GM takes them from the console. Layer 'props', nothing blocks.
 */
import type { MapPointerEvent, StairsObject } from '../contracts';
import { command, lockedLayer, uid } from './object-common';
import type { CellRect, Tool, ToolContext, ToolResult } from './types';

/** Maximum stairs side, in cells. */
export const STAIRS_MAX_SIDE = 10;

/** Floor the next stairs lead to: the chosen one when it is another floor, else the first other one. */
export function stairsTarget(ctx: ToolContext): string | null {
  const others = ctx.doc.floors().filter((f) => f.uid !== ctx.doc.floor);
  const wanted = ctx.settings.stairsTarget;
  return others.find((f) => f.uid === wanted)?.uid ?? others[0]?.uid ?? null;
}

/** Rectangle of whole cells from the press cell to the current cell, clamped to the map and 1-10 per side. */
export function stairsRect(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  width: number,
  height: number,
): CellRect {
  const side = (rawFrom: number, rawTo: number, max: number): [number, number] => {
    const from = Math.max(0, Math.min(max - 1, rawFrom));
    const to = Math.max(0, Math.min(max - 1, rawTo));
    const len = Math.max(1, Math.min(STAIRS_MAX_SIDE, max, Math.abs(to - from) + 1));
    // The pressed cell stays an end of the rectangle when the drag is longer than 10 cells.
    const origin = to >= from ? from : from - len + 1;
    return [Math.max(0, Math.min(max - len, origin)), len];
  };
  const [x, w] = side(a.x, b.x, width);
  const [y, h] = side(a.y, b.y, height);
  return { x, y, w, h };
}

/** Creates the stairs tool. */
export function createStairsTool(ctx: ToolContext): Tool {
  let anchor: { x: number; y: number } | null = null;

  const rect = (e: MapPointerEvent): CellRect =>
    stairsRect(anchor ?? e.cell, e.cell, ctx.doc.grid.width, ctx.doc.grid.height);

  const overlay = (r: CellRect): ToolResult => ({ overlay: { kind: 'rect', ...r } });

  return {
    id: 'stairs',
    shortcut: '',
    onPointer(e): ToolResult {
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          const locked = lockedLayer(ctx, 'props');
          if (locked !== null) return { notice: locked };
          if (stairsTarget(ctx) === null && ctx.settings.stairsLink === null) {
            return { notice: { code: 'stairs_no_target' } };
          }
          anchor = { x: e.cell.x, y: e.cell.y };
          return overlay(rect(e));
        }
        case 'move':
          return overlay(rect(e));
        case 'up': {
          if (anchor === null) return {};
          const r = rect(e);
          anchor = null;
          const to = stairsTarget(ctx);
          if (to === null) return { overlay: null, notice: { code: 'stairs_no_target' } };
          const link = ctx.settings.stairsLink;
          const stairs: StairsObject = {
            uid: uid(ctx),
            floor: ctx.doc.floor,
            type: 'stairs',
            layer: 'props',
            geometry: { x: r.x, y: r.y, w: r.w, h: r.h },
            props: {
              direction: ctx.settings.stairsDirection,
              to_floor: to,
              ...(link !== null ? { link } : {}),
            },
            visibility: 'all',
            locked: false,
            sort_order: 0,
            rev: 1,
          };
          return {
            overlay: null,
            command: command('editor.command.stairs', [{ type: 'object.add', object: stairs }]),
          };
        }
        case 'leave':
          return anchor === null ? { overlay: null } : {};
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
