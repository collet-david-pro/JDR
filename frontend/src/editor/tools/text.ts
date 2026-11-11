/** Text tool (lot l17): one click puts a text label (content, size, colour, font, rotation of the options). */
import type { MapObject, Point } from '../contracts';
import { TEXT_FONTS, TEXT_MAX, TEXT_SIZE_MAX, TEXT_SIZE_MIN } from '../contracts-text';
import { round3 } from '../model/scene-values';
import { clampPoint, snapToGrid } from './geometry';
import { command, lockedLayer, uid } from './object-common';
import type { Tool, ToolContext, ToolResult } from './types';

/** Creates the text tool. */
export function createTextTool(ctx: ToolContext): Tool {
  const centre = (world: { x: number; y: number }, alt: boolean): Point => {
    const raw: Point = [world.x, world.y];
    const { width, height } = ctx.doc.grid;
    return clampPoint(alt ? raw : snapToGrid(raw), width, height);
  };

  return {
    id: 'text',
    shortcut: '',
    onPointer(e): ToolResult {
      switch (e.type) {
        case 'move': {
          const p = centre(e.world, e.mods.alt);
          return { overlay: { kind: 'rect', x: p[0] - 0.3, y: p[1] - 0.3, w: 0.6, h: 0.6 } };
        }
        case 'down': {
          if (e.button !== 0) return {};
          const s = ctx.settings;
          const layer = s.textLayer ?? 'labels';
          const locked = lockedLayer(ctx, layer);
          if (locked !== null) return { notice: locked };
          const text = [...(s.textContent ?? '').trim()].slice(0, TEXT_MAX).join('');
          if (text === '') return { notice: { code: 'no_text' } };
          const [x, y] = centre(e.world, e.mods.alt);
          const font = TEXT_FONTS.includes(s.textFont ?? 'sans') ? (s.textFont ?? 'sans') : 'sans';
          const object = {
            uid: uid(ctx),
            floor: ctx.doc.floor,
            type: 'text' as const,
            layer,
            geometry: { x: round3(x), y: round3(y) },
            props: {
              text,
              size: Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, s.textSize ?? 0.6)),
              color: s.textColor ?? '#222222',
              font,
              rotation: s.textRotation ?? 0,
            },
            visibility: 'all' as const,
            locked: false,
            sort_order: 0,
            rev: 1,
          } as MapObject;
          return { command: command('editor.command.text', [{ type: 'object.add', object }]) };
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
