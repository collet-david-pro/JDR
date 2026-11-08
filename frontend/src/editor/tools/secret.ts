/**
 * Secret tool (P9b2a): `passage` = two clicks (0.1 to 20 cells, layer `walls`), `room` /
 * `object` = polygon (layer `props`). Hidden until the GM reveals it. Option: linked note.
 */
import type { MapPointerEvent, Overlay, Point } from '../contracts';
import { dist, snapPoint } from './geometry';
import { newNoteObject, polygonOf, validNote } from './note-objects';
import { command, lockedLayer, snapMark, snapStep, tolerance } from './object-common';
import { createPolygonDraw } from './polygon-draw';
import type { Tool, ToolContext, ToolResult } from './types';

/** Minimum passage width. */
export const PASSAGE_MIN = 0.1;
/** Maximum passage width. */
export const PASSAGE_MAX = 20;

/** Creates the secret tool. */
export function createSecretTool(ctx: ToolContext): Tool {
  const draw = createPolygonDraw(ctx);
  let from: Point | null = null;

  const snap = (e: MapPointerEvent): Point =>
    snapPoint(
      [e.world.x, e.world.y],
      ctx.doc.objects(),
      tolerance(ctx),
      ctx.doc.grid,
      e.mods.alt,
      undefined,
      snapStep(ctx),
    ).point;

  const props = (kind: 'passage' | 'room' | 'object') => ({
    kind,
    note: validNote(ctx, ctx.settings.secretNote),
  });

  const preview = (to: Point | null): Overlay | null => {
    if (from === null) return null;
    if (to === null) return snapMark(ctx, from);
    const len = dist(from, to);
    return { kind: 'segment', a: from, b: to, valid: len >= PASSAGE_MIN && len <= PASSAGE_MAX };
  };

  const addPolygon = (done: Point[]): ToolResult => {
    const kind = ctx.settings.secretKind === 'object' ? 'object' : 'room';
    const o = newNoteObject(
      ctx,
      'secret',
      'props',
      'hidden_until_revealed',
      polygonOf(done),
      props(kind),
    );
    return {
      overlay: null,
      command: command('editor.command.secret', [{ type: 'object.add', object: o }]),
    };
  };

  return {
    id: 'secret',
    shortcut: '',
    onPointer(e): ToolResult {
      const passage = ctx.settings.secretKind === 'passage';
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          const locked = lockedLayer(ctx, passage ? 'walls' : 'props');
          if (locked !== null) return { notice: locked };
          if (!passage) {
            const step = draw.press(e);
            return step.done === null ? step.result : addPolygon(step.done);
          }
          const p = snap(e);
          if (from === null) {
            from = p;
            return { overlay: preview(null) };
          }
          const len = dist(from, p);
          if (len < PASSAGE_MIN || len > PASSAGE_MAX) {
            return { notice: { code: 'passage_length' }, overlay: preview(p) };
          }
          const a = from;
          from = null;
          const o = newNoteObject(
            ctx,
            'secret',
            'walls',
            'hidden_until_revealed',
            { a: [a[0], a[1]], b: [p[0], p[1]] },
            props('passage'),
          );
          return {
            overlay: null,
            command: command('editor.command.secret', [{ type: 'object.add', object: o }]),
          };
        }
        case 'move':
          return passage ? { overlay: preview(snap(e)) } : draw.move(e);
        case 'up':
          return {};
        case 'leave':
          return from === null && draw.points.length === 0 ? { overlay: null } : {};
      }
    },
    onAction(action) {
      if (action !== 'confirm' || ctx.settings.secretKind === 'passage') return {};
      const step = draw.confirm();
      return step.done === null ? step.result : addPolygon(step.done);
    },
    cancel() {
      from = null;
      return draw.cancel();
    },
    deactivate() {
      from = null;
      return draw.cancel();
    },
  };
}
