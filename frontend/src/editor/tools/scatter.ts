/**
 * Object brush: scatters image objects chosen in the library along a stroke (density, minimal
 * spacing, random rotation and scale). Objects are ordinary image objects added with `object.add`;
 * one history entry per stroke (mergeKey).
 */
import type { MapPointerEvent, Overlay, Point } from '../contracts';
import type { ImageObject } from '../contracts-images';
import { clampImageGeometry } from '../model/image-values';
import { MAX_OBJECTS } from '../model/scene-values';
import { placeImage } from '../images/transform';
import { command, lockedLayer, uid } from './object-common';
import {
  SCATTER_STROKE_MAX,
  normalizeScatter,
  scatterAlong,
  type ScatterOptions,
} from './scatter-math';
import type { Tool, ToolContext, ToolResult } from './types';

interface Stroke {
  readonly id: number;
  readonly placed: Point[];
  count: number;
  last: Point;
}

let strokeSeq = 0;

const DEFAULT_OPTIONS: ScatterOptions = {
  density: 0.5,
  spacing: 0,
  radius: 2,
  randomRotation: false,
  scaleVariation: 0,
};

/** Creates the object brush tool. */
export function createScatterTool(ctx: ToolContext): Tool {
  let stroke: Stroke | null = null;

  const options = (): ScatterOptions => normalizeScatter(ctx.settings.scatter ?? DEFAULT_OPTIONS);
  const hover = (e: MapPointerEvent): Overlay => ({
    kind: 'area',
    x: e.world.x - options().radius,
    y: e.world.y - options().radius,
    w: options().radius * 2,
    h: options().radius * 2,
  });

  const spread = (s: Stroke, from: Point, to: Point, e: MapPointerEvent): ToolResult => {
    const ids = ctx.settings.scatterAssetIds ?? [];
    const layer = ctx.settings.imageLayer ?? 'props';
    const room = Math.max(
      0,
      Math.min(SCATTER_STROKE_MAX - s.count, MAX_OBJECTS - ctx.doc.objects().length),
    );
    const items = scatterAlong(
      from,
      to,
      options(),
      s.placed,
      ctx.rng,
      ids.length,
      room,
      ctx.doc.grid,
    );
    if (items.length === 0) return { overlay: hover(e) };
    s.count += items.length;
    const ops = items.map((it) => {
      const id = ids[it.asset] ?? ids[0]!;
      const base = placeImage(ctx.doc.imageAsset?.(id) ?? null, [it.x, it.y], ctx.doc.grid, true);
      const w = base.w * it.scale;
      const h = base.h * it.scale;
      const obj: ImageObject = {
        uid: uid(ctx),
        floor: ctx.doc.floor,
        type: 'image',
        layer,
        geometry: clampImageGeometry(
          { x: it.x - w / 2, y: it.y - h / 2, w, h, rotation: it.rotation },
          ctx.doc.grid,
        ),
        props: { asset_id: id, opacity: 1, flip_h: false, flip_v: false, placement: 'above' },
        visibility: 'all',
        locked: false,
        sort_order: 0,
        rev: 1,
      };
      return { type: 'object.add' as const, object: obj };
    });
    return {
      command: command('editor.command.scatter', ops, `scatter:${s.id}`),
      overlay: hover(e),
    };
  };

  return {
    id: 'scatter',
    shortcut: '',
    onPointer(e) {
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          if ((ctx.settings.scatterAssetIds ?? []).length === 0) {
            return { notice: { code: 'no_image' }, overlay: hover(e) };
          }
          const locked = lockedLayer(ctx, ctx.settings.imageLayer ?? 'props');
          if (locked !== null) return { notice: locked, overlay: hover(e) };
          const at: Point = [e.world.x, e.world.y];
          stroke = { id: ++strokeSeq, placed: [], count: 0, last: at };
          return spread(stroke, at, at, e);
        }
        case 'move': {
          if (stroke === null) return { overlay: hover(e) };
          const to: Point = [e.world.x, e.world.y];
          const from = stroke.last;
          stroke.last = to;
          return spread(stroke, from, to, e);
        }
        case 'up':
          stroke = null;
          return { overlay: hover(e) };
        case 'leave':
          stroke = null;
          return { overlay: null };
      }
    },
    cancel() {
      stroke = null;
      return { overlay: null };
    },
    deactivate() {
      return this.cancel();
    },
  };
}
