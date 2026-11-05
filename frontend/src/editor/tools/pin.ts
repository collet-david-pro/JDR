/** Pin tool (P9b2a): one click puts a pin (icon, colour, optional note). Visibility `gm`. */
import type { Point } from '../contracts';
import { clampPoint, snapToGrid } from './geometry';
import { newNoteObject, pointOf, validNote } from './note-objects';
import { command, lockedLayer } from './object-common';
import type { Tool, ToolContext, ToolResult } from './types';

/** Creates the pin tool. */
export function createPinTool(ctx: ToolContext): Tool {
  const centre = (world: { x: number; y: number }, alt: boolean): Point => {
    const raw: Point = [world.x, world.y];
    const { width, height } = ctx.doc.grid;
    return clampPoint(alt ? raw : snapToGrid(raw), width, height);
  };

  return {
    id: 'pin',
    shortcut: '',
    onPointer(e): ToolResult {
      switch (e.type) {
        case 'move': {
          const p = centre(e.world, e.mods.alt);
          return { overlay: { kind: 'rect', x: p[0] - 0.3, y: p[1] - 0.3, w: 0.6, h: 0.6 } };
        }
        case 'down': {
          if (e.button !== 0) return {};
          const locked = lockedLayer(ctx, 'props');
          if (locked !== null) return { notice: locked };
          const s = ctx.settings;
          const pin = newNoteObject(
            ctx,
            'pin',
            'props',
            'gm',
            pointOf(centre(e.world, e.mods.alt)),
            { icon: s.pinIcon, color: s.pinColor, note: validNote(ctx, s.pinNote) },
          );
          return { command: command('editor.command.pin', [{ type: 'object.add', object: pin }]) };
        }
        case 'up':
          return {};
        case 'leave':
          return { overlay: null };
      }
    },
    cancel() {
      return { overlay: null };
    },
    deactivate() {
      return { overlay: null };
    },
  };
}
