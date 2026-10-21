/** Cell selection (V): rectangle drag; Shift adds to the selection (simple union of rectangles). */
import type { Overlay } from '../contracts';
import { rectBetween } from './raster';
import type { CellRect, Tool, ToolContext, ToolResult } from './types';

export interface SelectTool extends Tool {
  readonly selection: readonly CellRect[];
  setSelection(rects: readonly CellRect[]): ToolResult;
}

function contains(a: CellRect, b: CellRect): boolean {
  return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
}

/** Adds a rectangle to a union: drops it if already covered, drops rectangles it covers. */
export function unionRects(rects: readonly CellRect[], add: CellRect): CellRect[] {
  if (rects.some((r) => contains(r, add))) return [...rects];
  return [...rects.filter((r) => !contains(add, r)), add];
}

/** Clips a rectangle to the map; null when nothing is left. */
export function clipRect(r: CellRect, width: number, height: number): CellRect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Overlay for a selection: a rectangle, or the cells of a multi-rectangle union. */
export function selectionOverlay(rects: readonly CellRect[]): Overlay | null {
  if (rects.length === 0) return null;
  if (rects.length === 1) return { kind: 'selection', ...rects[0]! };
  const seen = new Set<string>();
  const cells: (readonly [number, number])[] = [];
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const k = `${x},${y}`;
        if (!seen.has(k)) {
          seen.add(k);
          cells.push([x, y]);
        }
      }
    }
  }
  return { kind: 'cells', cells };
}

export function createSelectTool(ctx: ToolContext): SelectTool {
  let rects: CellRect[] = [];
  let anchor: readonly [number, number] | null = null;
  let additive = false;

  const dragRect = (x: number, y: number): CellRect | null =>
    anchor === null
      ? null
      : clipRect(rectBetween(anchor, [x, y]), ctx.doc.grid.width, ctx.doc.grid.height);

  const result = (): ToolResult => ({ selection: rects, overlay: selectionOverlay(rects) });

  return {
    id: 'select',
    shortcut: 'V',
    get selection() {
      return rects;
    },
    setSelection(next) {
      rects = [...next];
      return result();
    },
    onPointer(e) {
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          anchor = [e.cell.x, e.cell.y];
          additive = e.mods.shift;
          const r = dragRect(e.cell.x, e.cell.y);
          return {
            overlay:
              r === null ? selectionOverlay(additive ? rects : []) : { kind: 'selection', ...r },
          };
        }
        case 'move': {
          const r = dragRect(e.cell.x, e.cell.y);
          return r === null ? {} : { overlay: { kind: 'selection', ...r } };
        }
        case 'up': {
          if (anchor === null) return {};
          const r = dragRect(e.cell.x, e.cell.y);
          anchor = null;
          if (r === null) rects = additive ? rects : [];
          else rects = additive ? unionRects(rects, r) : [r];
          return result();
        }
        case 'leave':
          return {};
      }
    },
    cancel() {
      anchor = null;
      rects = [];
      return result();
    },
    deactivate() {
      anchor = null;
      return { overlay: null };
    },
  };
}
