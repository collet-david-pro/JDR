/**
 * Reveal / hide fog tool (F, projet.md 15.2, 12.3): disc brush, rectangle or "room" (flood
 * fill bounded by the walls). Reveal by default; the hide option or Alt hides. Each gesture is
 * one undoable command of fog.reveal / fog.hide ops carrying only the bits that change.
 */
import type { ChunkKey, FogBitmap, MapOp, Point } from '../contracts';
import { fogRasterizers } from '../../vision/index';
import { effectiveFog, fogOps, mergeFog, type FogOpType } from '../model/fog-wire';
import { command } from './object-common';
import { brushCellsAround, rectBetweenPoints } from './fog-cells';
import {
  FOG_BRUSH_MAX,
  FOG_BRUSH_MIN,
  type Tool,
  type ToolContext,
  type ToolResult,
} from './types';

/** Cell budget of the room fill (bigger regions are "not closed"). */
export const ROOM_MAX_CELLS = 20_000;

/** fog ops for a raster, restricted to the bits that change the document. */
export function fogCommandOps(
  ctx: ToolContext,
  type: FogOpType,
  raster: ReadonlyMap<ChunkKey, FogBitmap>,
): MapOp[] {
  const changes = effectiveFog(type, raster, (k) => ctx.doc.fogChunk(k));
  return fogOps(type, ctx.doc.floor, changes);
}

export function createFogTool(ctx: ToolContext): Tool {
  let last: Point | null = null;
  let rectFrom: Point | null = null;
  let hide = false;
  let stroke = 0;

  const opType = (): FogOpType => (hide ? 'fog.hide' : 'fog.reveal');
  const label = (): string => (hide ? 'editor.command.fog_hide' : 'editor.command.fog_reveal');
  const radius = (): number =>
    Math.min(FOG_BRUSH_MAX, Math.max(FOG_BRUSH_MIN, ctx.settings.fogBrush));
  const { width, height } = ctx.doc.grid;

  const brushOverlay = (p: Point, erase: boolean): ToolResult => ({
    overlay: { kind: 'cells', cells: brushCellsAround(p, radius(), width, height), erase },
  });

  /** Discs from `from` to `to`, every half radius. */
  const strokeRaster = (from: Point, to: Point) => {
    const r = radius();
    const out = new Map<ChunkKey, FogBitmap>();
    const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.ceil(d / (r / 2)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from[0] + (to[0] - from[0]) * t;
      const y = from[1] + (to[1] - from[1]) * t;
      mergeFog(out, fogRasterizers.disc(x, y, r, width, height));
    }
    return out;
  };

  const brushCommand = (from: Point, to: Point): ToolResult => {
    const ops = fogCommandOps(ctx, opType(), strokeRaster(from, to));
    return ops.length === 0 ? {} : { command: command(label(), ops, `fog-stroke:${stroke}`) };
  };

  return {
    id: 'fog',
    shortcut: 'F',
    onPointer(e): ToolResult {
      const p: Point = [e.world.x, e.world.y];
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          hide = ctx.settings.fogHide !== e.mods.alt;
          const shape = ctx.settings.fogShape;
          if (shape === 'rect') {
            rectFrom = p;
            const r = rectBetweenPoints(p, p);
            return { overlay: { kind: 'area', ...r, erase: hide } };
          }
          if (shape === 'room') {
            const core = ctx.visionCore?.();
            const raster =
              core === undefined
                ? null
                : fogRasterizers.room(core, p[0], p[1], width, height, ROOM_MAX_CELLS);
            if (raster === null) return { notice: { code: 'room_open' } };
            const ops = fogCommandOps(ctx, opType(), raster);
            return ops.length === 0 ? {} : { command: command(label(), ops) };
          }
          stroke++;
          last = p;
          return { ...brushOverlay(p, hide), ...brushCommand(p, p) };
        }
        case 'move': {
          if (rectFrom !== null) {
            return { overlay: { kind: 'area', ...rectBetweenPoints(rectFrom, p), erase: hide } };
          }
          if (last === null) {
            return ctx.settings.fogShape === 'brush'
              ? brushOverlay(p, ctx.settings.fogHide !== e.mods.alt)
              : { overlay: null };
          }
          const from = last;
          last = p;
          return { ...brushOverlay(p, hide), ...brushCommand(from, p) };
        }
        case 'up': {
          if (rectFrom !== null) {
            const r = rectBetweenPoints(rectFrom, p);
            rectFrom = null;
            if (r.w <= 0 || r.h <= 0) return { overlay: null };
            const ops = fogCommandOps(
              ctx,
              opType(),
              fogRasterizers.rect(r.x, r.y, r.w, r.h, width, height),
            );
            return { overlay: null, ...(ops.length > 0 ? { command: command(label(), ops) } : {}) };
          }
          last = null;
          return {};
        }
        case 'leave':
          return last === null && rectFrom === null ? { overlay: null } : {};
      }
    },
    cancel() {
      last = null;
      rectFrom = null;
      return { overlay: null };
    },
    deactivate() {
      return this.cancel();
    },
  };
}
