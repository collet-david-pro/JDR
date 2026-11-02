/**
 * Zone tool (P9b2a): a polygon of the GM layer, visibility `gm` (never sent to the players).
 * Options: linked note, "show on enter".
 */
import { newNoteObject, polygonOf, validNote } from './note-objects';
import { command, lockedLayer } from './object-common';
import { createPolygonDraw } from './polygon-draw';
import type { Tool, ToolContext, ToolResult } from './types';

export function createZoneTool(ctx: ToolContext): Tool {
  const draw = createPolygonDraw(ctx);

  const build = (done: NonNullable<ReturnType<typeof draw.confirm>['done']>): ToolResult => {
    const s = ctx.settings;
    const zone = newNoteObject(ctx, 'zone', 'gm', 'gm', polygonOf(done), {
      kind: 'description',
      note: validNote(ctx, s.zoneNote),
      show_on_enter: s.zoneShowOnEnter,
    });
    return {
      overlay: null,
      command: command('editor.command.zone', [{ type: 'object.add', object: zone }]),
    };
  };

  return {
    id: 'zone',
    shortcut: '',
    onPointer(e): ToolResult {
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          const locked = lockedLayer(ctx, 'gm');
          if (locked !== null) return { notice: locked };
          const step = draw.press(e);
          return step.done === null ? step.result : build(step.done);
        }
        case 'move':
          return draw.move(e);
        case 'up':
          return {};
        case 'leave':
          return draw.points.length === 0 ? { overlay: null } : {};
      }
    },
    onAction(action) {
      if (action !== 'confirm') return {};
      const step = draw.confirm();
      return step.done === null ? step.result : build(step.done);
    },
    cancel() {
      return draw.cancel();
    },
    deactivate() {
      return draw.cancel();
    },
  };
}
