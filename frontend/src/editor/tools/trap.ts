/**
 * Trap tool (P9b2a): a point (click) or a polygon, layer `props`, hidden until the GM reveals it
 * (visibility `hidden_until_revealed`, imposed by the server). Options: shape, note, reveal effect.
 */
import type { Point } from '../contracts';
import { clampPoint, snapToGrid } from './geometry';
import { newNoteObject, pointOf, polygonOf, validNote } from './note-objects';
import { command, lockedLayer } from './object-common';
import { createPolygonDraw } from './polygon-draw';
import type { Tool, ToolContext, ToolResult } from './types';

/** Creates the trap tool. */
export function createTrapTool(ctx: ToolContext): Tool {
  const draw = createPolygonDraw(ctx);

  const centre = (world: { x: number; y: number }, alt: boolean): Point => {
    const raw: Point = [world.x, world.y];
    const { width, height } = ctx.doc.grid;
    return clampPoint(alt ? raw : snapToGrid(raw), width, height);
  };

  const add = (geometry: unknown): ToolResult => {
    const s = ctx.settings;
    const trap = newNoteObject(ctx, 'trap', 'props', 'hidden_until_revealed', geometry, {
      note: validNote(ctx, s.trapNote),
      reveal_effect: s.trapReveal,
    });
    return {
      overlay: null,
      command: command('editor.command.trap', [{ type: 'object.add', object: trap }]),
    };
  };

  return {
    id: 'trap',
    shortcut: '',
    onPointer(e): ToolResult {
      const polygon = ctx.settings.trapShape === 'polygon';
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          const locked = lockedLayer(ctx, 'props');
          if (locked !== null) return { notice: locked };
          if (!polygon) return add(pointOf(centre(e.world, e.mods.alt)));
          const step = draw.press(e);
          return step.done === null ? step.result : add(polygonOf(step.done));
        }
        case 'move': {
          if (polygon) return draw.move(e);
          const p = centre(e.world, e.mods.alt);
          return { overlay: { kind: 'rect', x: p[0] - 0.3, y: p[1] - 0.3, w: 0.6, h: 0.6 } };
        }
        case 'up':
          return {};
        case 'leave':
          return draw.points.length === 0 ? { overlay: null } : {};
      }
    },
    onAction(action) {
      if (action !== 'confirm') return {};
      const step = draw.confirm();
      return step.done === null ? step.result : add(polygonOf(step.done));
    },
    cancel() {
      return draw.cancel();
    },
    deactivate() {
      return draw.cancel();
    },
  };
}
