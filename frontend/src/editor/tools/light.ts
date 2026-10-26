/**
 * Light tool (L, projet.md 15.2): click = light of the chosen preset; drag = outer radius
 * (the bright radius keeps the preset ratio). Centre snapped to the half-cell grid (Alt: free).
 */
import type { MapObject, MapPointerEvent, Point } from '../contracts';
import { round3 } from '../model/scene-values';
import { command, LIGHT_PRESETS, lockedLayer, newLight, pixelSize } from './object-common';
import { clampPoint, dist, project, snapToGrid, wallSegments } from './geometry';
import type { Tool, ToolContext, ToolResult } from './types';

/** A drag shorter than this (screen px) is a click. */
const DRAG_PX = 6;
/** A light exactly on a wall would light both sides: it is moved this far off it. */
export const LIGHT_WALL_OFFSET = 0.01;

/**
 * Moves a light lying on a wall / door / window segment (within 1e-6) by LIGHT_WALL_OFFSET
 * along the segment normal, on the side of `towards` (the click), so that it lights one side.
 */
export function offsetFromWalls(
  p: Point,
  towards: Point,
  objects: readonly MapObject[],
  width: number,
  height: number,
): Point {
  for (const o of objects) {
    const segments: [Point, Point][] =
      o.type === 'wall'
        ? wallSegments(o)
        : o.type === 'door' || o.type === 'window'
          ? [[o.geometry.a, o.geometry.b]]
          : [];
    for (const [a, b] of segments) {
      if (project(p, a, b).distance > 1e-6) continue;
      const len = dist(a, b);
      if (len === 0) continue;
      let nx = -(b[1] - a[1]) / len;
      let ny = (b[0] - a[0]) / len;
      const side = (towards[0] - p[0]) * nx + (towards[1] - p[1]) * ny;
      if (side < 0) {
        nx = -nx;
        ny = -ny;
      }
      const q: Point = [
        round3(p[0] + nx * LIGHT_WALL_OFFSET),
        round3(p[1] + ny * LIGHT_WALL_OFFSET),
      ];
      // Inside the map; the other side when the map edge is in the way.
      if (q[0] >= 0 && q[1] >= 0 && q[0] <= width && q[1] <= height) return q;
      return clampPoint(
        [p[0] - nx * LIGHT_WALL_OFFSET, p[1] - ny * LIGHT_WALL_OFFSET],
        width,
        height,
      );
    }
  }
  return p;
}

export function createLightTool(ctx: ToolContext): Tool {
  let anchor: Point | null = null;
  let dragRadius: number | null = null;

  const centre = (e: MapPointerEvent): Point => {
    const raw: Point = [e.world.x, e.world.y];
    const { width, height } = ctx.doc.grid;
    const p = clampPoint(e.mods.alt ? raw : snapToGrid(raw), width, height);
    return offsetFromWalls(p, raw, ctx.doc.objects(), width, height);
  };

  const overlay = (p: Point, dim?: number): ToolResult => {
    const preset = LIGHT_PRESETS[ctx.settings.lightPreset];
    const dimRadius = dim ?? preset.dim_radius;
    return {
      overlay: {
        kind: 'light',
        x: p[0],
        y: p[1],
        radius: (preset.radius / preset.dim_radius) * dimRadius,
        dimRadius,
      },
    };
  };

  return {
    id: 'light',
    shortcut: 'L',
    onPointer(e): ToolResult {
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          const locked = lockedLayer(ctx, 'lighting');
          if (locked !== null) return { notice: locked };
          anchor = centre(e);
          dragRadius = null;
          return overlay(anchor);
        }
        case 'move': {
          if (anchor === null) return overlay(centre(e));
          const d = dist(anchor, [e.world.x, e.world.y]);
          dragRadius = d >= DRAG_PX * pixelSize(ctx) ? Math.min(100, d) : null;
          return overlay(anchor, dragRadius ?? undefined);
        }
        case 'up': {
          if (anchor === null) return {};
          const at = anchor;
          const radius = dragRadius;
          anchor = null;
          dragRadius = null;
          const light = newLight(ctx, at[0], at[1], ctx.settings.lightPreset, radius ?? undefined);
          return {
            overlay: null,
            command: command('editor.command.light', [{ type: 'object.add', object: light }]),
          };
        }
        case 'leave':
          return anchor === null ? { overlay: null } : {};
      }
    },
    cancel() {
      anchor = null;
      dragRadius = null;
      return { overlay: null };
    },
    deactivate() {
      return this.cancel();
    },
  };
}
