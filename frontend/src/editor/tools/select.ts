/**
 * Selection (V). Cells (P4): rectangle drag, Shift adds (simple union of rectangles).
 * Objects and placed tokens (P5): click (priority tokens > lights > doors / windows > walls,
 * tolerance in screen pixels), Shift toggles, the rectangle also selects the objects inside it;
 * drag moves the selection (snapped, Alt: free), handles edit wall vertices / door ends / light
 * radius; Delete removes; double click on a door opens / closes it.
 */
import type { Overlay, Point } from '../contracts';
import { snapPoint } from './geometry';
import { handleAt, hitTest, insideRect, type HandleHit, type Hit } from './hit';
import { command, DoubleClick, pixelSize, tolerance } from './object-common';
import { rectBetween } from './raster';
import {
  clampDelta,
  deleteOps,
  editable,
  handlePatch,
  moveOps,
  movePreview,
  shapeOverlay,
  snapDelta,
  toggleDoorOp,
} from './select-edit';
import {
  EMPTY_OBJECT_SELECTION,
  type CellRect,
  type ObjectSelection,
  type Tool,
  type ToolContext,
  type ToolResult,
} from './types';

export interface SelectTool extends Tool {
  readonly selection: readonly CellRect[];
  readonly objectSelection: ObjectSelection;
  setSelection(rects: readonly CellRect[]): ToolResult;
  setObjectSelection(selection: ObjectSelection): ToolResult;
}

/** A press that moves less than this (screen px) is a click. */
const DRAG_PX = 4;

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

/** Overlay for a selection (null when empty). */
export function selectionOverlay(rects: readonly CellRect[]): Overlay | null {
  return rects.length === 0 ? null : { kind: 'selection', rects };
}

/** Cells and objects selected (P4 overlay unchanged when no object is selected). */
export function fullSelectionOverlay(
  rects: readonly CellRect[],
  sel: ObjectSelection,
  extra: readonly Overlay[] = [],
): Overlay | null {
  const cells = selectionOverlay(rects);
  if (sel.objects.length === 0 && sel.tokens.length === 0 && extra.length === 0) return cells;
  const items: Overlay[] = [];
  if (cells !== null) items.push(cells);
  if (sel.objects.length > 0 || sel.tokens.length > 0) {
    items.push({ kind: 'objects', objects: sel.objects, tokens: sel.tokens });
  }
  items.push(...extra);
  return { kind: 'group', items };
}

function toggled(sel: ObjectSelection, hit: Hit): ObjectSelection {
  const key = hit.kind === 'token' ? 'tokens' : 'objects';
  const list = sel[key];
  const next = list.includes(hit.uid) ? list.filter((u) => u !== hit.uid) : [...list, hit.uid];
  return { ...sel, [key]: next };
}

function isSelected(sel: ObjectSelection, hit: Hit): boolean {
  return (hit.kind === 'token' ? sel.tokens : sel.objects).includes(hit.uid);
}

function union(a: ObjectSelection, b: ObjectSelection): ObjectSelection {
  return {
    objects: [...new Set([...a.objects, ...b.objects])],
    tokens: [...new Set([...a.tokens, ...b.tokens])],
  };
}

type Gesture =
  | { readonly kind: 'cells'; readonly anchor: readonly [number, number]; readonly start: Point }
  | { readonly kind: 'move'; readonly start: Point; moved: boolean }
  | { readonly kind: 'handle'; readonly handle: HandleHit; moved: boolean };

export function createSelectTool(ctx: ToolContext): SelectTool {
  let rects: CellRect[] = [];
  let objSel: ObjectSelection = EMPTY_OBJECT_SELECTION;
  let gesture: Gesture | null = null;
  let additive = false;
  const dbl = new DoubleClick(ctx);
  const { width, height } = ctx.doc.grid;

  const dragRect = (x: number, y: number): CellRect | null =>
    gesture?.kind !== 'cells' ? null : clipRect(rectBetween(gesture.anchor, [x, y]), width, height);

  const result = (): ToolResult => ({
    selection: rects,
    objectSelection: objSel,
    overlay: fullSelectionOverlay(rects, objSel),
  });

  const moveDelta = (p: Point, start: Point, free: boolean) => {
    const { objects, tokens } = editable(ctx.doc, objSel);
    const [sx, sy] = snapDelta(ctx.doc, tokens, p[0] - start[0], p[1] - start[1], free);
    const [dx, dy] = clampDelta(objects, tokens, sx, sy, width, height);
    return { objects, tokens, dx, dy };
  };

  const handlePoint = (handle: HandleHit, p: Point, free: boolean): Point =>
    snapPoint(p, ctx.doc.objects(), tolerance(ctx), ctx.doc.grid, free, (o) => o.uid === handle.uid)
      .point;

  /** Double click on a door: open / close it (checked before the handles of its ends). */
  const doorToggle = (hit: Hit | null, p: Point, shift: boolean): ToolResult | null => {
    const o = hit?.kind === 'object' ? ctx.doc.object(hit.uid) : undefined;
    if (o?.type !== 'door' || shift) {
      dbl.reset();
      return null;
    }
    if (!dbl.press(p)) return null;
    objSel = { objects: [o.uid], tokens: [] };
    rects = [];
    return { ...result(), command: command('editor.command.door_toggle', [toggleDoorOp(o)]) };
  };

  const pressObject = (hit: Hit, p: Point, shift: boolean): ToolResult => {
    if (shift) {
      objSel = toggled(objSel, hit);
      return result();
    }
    if (!isSelected(objSel, hit)) {
      objSel =
        hit.kind === 'token'
          ? { objects: [], tokens: [hit.uid] }
          : { objects: [hit.uid], tokens: [] };
    }
    rects = [];
    gesture = { kind: 'move', start: p, moved: false };
    return result();
  };

  return {
    id: 'select',
    shortcut: 'V',
    get selection() {
      return rects;
    },
    get objectSelection() {
      return objSel;
    },
    setSelection(next) {
      rects = [...next];
      return result();
    },
    setObjectSelection(next) {
      objSel = { objects: [...next.objects], tokens: [...next.tokens] };
      return result();
    },
    onPointer(e) {
      const p: Point = [e.world.x, e.world.y];
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          additive = e.mods.shift;
          const tol = tolerance(ctx);
          const hit = hitTest(ctx.doc, ctx.doc.layers, p, tol, pixelSize(ctx));
          const toggle = doorToggle(hit, p, additive);
          if (toggle !== null) return toggle;
          const handle = additive ? null : handleAt(ctx.doc, objSel, p, tol);
          if (handle !== null) {
            gesture = { kind: 'handle', handle, moved: false };
            return {};
          }
          if (hit !== null) return pressObject(hit, p, additive);
          gesture = { kind: 'cells', anchor: [e.cell.x, e.cell.y], start: p };
          if (!additive) objSel = EMPTY_OBJECT_SELECTION;
          const r = dragRect(e.cell.x, e.cell.y);
          const cells =
            r === null ? (additive ? rects : []) : additive ? unionRects(rects, r) : [r];
          return { overlay: fullSelectionOverlay(cells, objSel) };
        }
        case 'move': {
          if (gesture === null) return {};
          if (gesture.kind === 'cells') {
            const r = dragRect(e.cell.x, e.cell.y);
            return r === null
              ? {}
              : { overlay: fullSelectionOverlay(additive ? unionRects(rects, r) : [r], objSel) };
          }
          if (gesture.kind === 'move') {
            const far = Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]);
            if (!gesture.moved && far < DRAG_PX * pixelSize(ctx)) return {};
            gesture.moved = true;
            dbl.reset();
            const { objects, tokens, dx, dy } = moveDelta(p, gesture.start, e.mods.alt);
            return {
              overlay: fullSelectionOverlay(
                rects,
                objSel,
                movePreview(ctx.doc, objects, tokens, dx, dy),
              ),
            };
          }
          gesture.moved = true;
          const o = ctx.doc.object(gesture.handle.uid);
          const patch =
            o === undefined
              ? null
              : handlePatch(o, gesture.handle, handlePoint(gesture.handle, p, e.mods.alt));
          const preview =
            o !== undefined && patch !== null ? [shapeOverlay({ ...o, ...patch } as typeof o)] : [];
          return { overlay: fullSelectionOverlay(rects, objSel, preview) };
        }
        case 'up': {
          const g = gesture;
          gesture = null;
          if (g === null) return {};
          if (g.kind === 'cells') {
            const r = clipRect(rectBetween(g.anchor, [e.cell.x, e.cell.y]), width, height);
            if (r === null) rects = additive ? rects : [];
            else rects = additive ? unionRects(rects, r) : [r];
            // Objects inside the dragged area (world coordinates, not whole cells).
            const far = Math.hypot(p[0] - g.start[0], p[1] - g.start[1]);
            if (far >= DRAG_PX * pixelSize(ctx)) {
              const x = Math.min(p[0], g.start[0]);
              const y = Math.min(p[1], g.start[1]);
              const inside = insideRect(ctx.doc, ctx.doc.layers, {
                x,
                y,
                w: Math.abs(p[0] - g.start[0]),
                h: Math.abs(p[1] - g.start[1]),
              });
              objSel = additive ? union(objSel, inside) : inside;
            }
            return result();
          }
          if (g.kind === 'move') {
            if (!g.moved) return result();
            const { objects, tokens, dx, dy } = moveDelta(p, g.start, e.mods.alt);
            const ops = moveOps(objects, tokens, dx, dy);
            if (objects.length + tokens.length < objSel.objects.length + objSel.tokens.length) {
              return {
                ...result(),
                ...(ops.length > 0 ? { command: command('editor.command.move', ops) } : {}),
                notice: { code: 'object_locked' },
              };
            }
            return {
              ...result(),
              ...(ops.length > 0 ? { command: command('editor.command.move', ops) } : {}),
            };
          }
          const o = ctx.doc.object(g.handle.uid);
          if (!g.moved || o === undefined) return result();
          if (editable(ctx.doc, { objects: [o.uid], tokens: [] }).objects.length === 0) {
            return { ...result(), notice: { code: 'object_locked' } };
          }
          const patch = handlePatch(o, g.handle, handlePoint(g.handle, p, e.mods.alt));
          if (patch === null) return result();
          return {
            ...result(),
            command: command('editor.command.edit_object', [
              { type: 'object.update', uid: o.uid, rev: o.rev, patch },
            ]),
          };
        }
        case 'leave':
          return {};
      }
    },
    onAction(action) {
      if (action !== 'delete') return {};
      const { objects, tokens } = editable(ctx.doc, objSel);
      const ops = deleteOps(objects, tokens);
      const notice =
        objects.length + tokens.length < objSel.objects.length + objSel.tokens.length
          ? { notice: { code: 'object_locked' as const } }
          : {};
      if (ops.length === 0) return notice;
      objSel = {
        objects: objSel.objects.filter((u) => !objects.some((o) => o.uid === u)),
        tokens: objSel.tokens.filter((u) => !tokens.some((t) => t.uid === u)),
      };
      return { ...result(), ...notice, command: command('editor.command.delete', ops) };
    },
    cancel() {
      gesture = null;
      rects = [];
      objSel = EMPTY_OBJECT_SELECTION;
      dbl.reset();
      return { selection: rects, objectSelection: objSel, overlay: null };
    },
    deactivate() {
      gesture = null;
      return { overlay: null };
    },
  };
}
