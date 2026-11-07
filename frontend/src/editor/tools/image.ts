/**
 * Image tool (P14, key J): places the library image chosen in the tool options at its native size
 * (asset pixels at the map's cell size, 1 cell when unknown), centred on the pointer, and edits
 * the image objects: drag inside to move, corner handles to resize (opposite corner fixed, Shift
 * keeps the proportions), the handle above the top edge to rotate. Alt: no snapping. A locked
 * image (map backgrounds are locked by default) is selected but not moved.
 */
import type { MapPointerEvent, Overlay, Point } from '../contracts';
import type { ImageGeometry, ImageObject } from '../contracts-images';
import { imageContains, imageCorners } from '../model/image-values';
import {
  imageHandleAt,
  imageHandlePoints,
  moveImage,
  placeImage,
  resizeImage,
  rotateImage,
  type ImageHandle,
} from '../images/transform';
import { command, lockedLayer, pixelSize, tolerance, uid } from './object-common';
import type { ObjectSelection, Tool, ToolContext, ToolResult } from './types';

type Drag =
  | { readonly kind: 'move'; readonly obj: ImageObject; readonly start: Point }
  | {
      readonly kind: 'handle';
      readonly obj: ImageObject;
      readonly handle: ImageHandle;
      readonly start: Point;
    };

/** Topmost image under p (`above` images first, then by layer list order and sort order). */
export function imageAt(
  objects: readonly { readonly type: string }[],
  p: Point,
): ImageObject | null {
  let best: ImageObject | null = null;
  for (const o of objects) {
    if (o.type !== 'image') continue;
    const img = o as ImageObject;
    if (!imageContains(img.geometry, p[0], p[1])) continue;
    if (best === null || rankOf(img) >= rankOf(best)) best = img;
  }
  return best;
}

function rankOf(o: ImageObject): number {
  return (o.props.placement === 'above' ? 1 : 0) * 1e7 + o.sort_order;
}

/** Outline and handles of an image (overlay). */
export function imageOverlay(g: ImageGeometry, cellsPerPx: number): Overlay {
  const h = imageHandlePoints(g, cellsPerPx);
  return {
    kind: 'group',
    items: [
      { kind: 'polyline', points: imageCorners(g), closed: true },
      { kind: 'segment', a: h.topMiddle, b: h.rotate, valid: true },
      ...h.corners.map((c): Overlay => ({ kind: 'snap', x: c[0], y: c[1] })),
      { kind: 'snap', x: h.rotate[0], y: h.rotate[1] },
    ],
  };
}

/** Creates the image tool. */
export function createImageTool(ctx: ToolContext): Tool {
  let selected: string | null = null;
  let drag: Drag | null = null;
  let preview: ImageGeometry | null = null;

  const current = (): ImageObject | null => {
    if (selected === null) return null;
    const o = ctx.doc.object(selected);
    return o !== undefined && o.type === 'image' ? o : null;
  };
  const point = (e: MapPointerEvent): Point => [e.world.x, e.world.y];
  const bounds = (): { width: number; height: number } => ({
    width: ctx.doc.grid.width,
    height: ctx.doc.grid.height,
  });
  const selection = (uidValue: string | null): ObjectSelection => ({
    objects: uidValue === null ? [] : [uidValue],
    tokens: [],
  });
  const overlayOf = (g: ImageGeometry | null): Overlay | null =>
    g === null ? null : imageOverlay(g, pixelSize(ctx));
  const asset = () => {
    const id = ctx.settings.imageAssetId ?? null;
    return id === null ? null : { id, view: ctx.doc.imageAsset?.(id) ?? null };
  };

  const ghost = (e: MapPointerEvent): ToolResult => {
    const a = asset();
    if (a === null) return { overlay: overlayOf(current()?.geometry ?? null) };
    const g = placeImage(a.view, point(e), ctx.doc.grid, e.mods.alt);
    const sel = current();
    return {
      overlay: {
        kind: 'group',
        items: [
          { kind: 'area', x: g.x, y: g.y, w: g.w, h: g.h },
          ...(sel === null ? [] : [imageOverlay(sel.geometry, pixelSize(ctx))]),
        ],
      },
    };
  };

  const dragged = (e: MapPointerEvent, d: Drag): ImageGeometry => {
    const p = point(e);
    const g = d.obj.geometry;
    if (d.kind === 'move') {
      return moveImage(g, p[0] - d.start[0], p[1] - d.start[1], e.mods.alt, bounds());
    }
    if (d.handle.kind === 'rotate') return rotateImage(g, d.start, p, e.mods.alt);
    return resizeImage(g, d.handle.index, p, e.mods.shift, e.mods.alt, bounds());
  };

  const down = (e: MapPointerEvent): ToolResult => {
    const p = point(e);
    const sel = current();
    if (sel !== null) {
      const handle = imageHandleAt(sel.geometry, p, tolerance(ctx), pixelSize(ctx));
      if (handle !== null) {
        if (sel.locked) return { notice: { code: 'object_locked' } };
        drag = { kind: 'handle', obj: sel, handle, start: p };
        preview = sel.geometry;
        return { overlay: overlayOf(preview) };
      }
    }
    const hit = imageAt(ctx.doc.objects(), p);
    if (hit !== null && (asset() === null || hit.uid === selected || e.mods.ctrlOrMeta)) {
      selected = hit.uid;
      if (hit.locked) {
        return { objectSelection: selection(hit.uid), overlay: overlayOf(hit.geometry) };
      }
      drag = { kind: 'move', obj: hit, start: p };
      preview = hit.geometry;
      return { objectSelection: selection(hit.uid), overlay: overlayOf(preview) };
    }
    const a = asset();
    if (a === null) {
      selected = null;
      return hit === null ? { notice: { code: 'no_image' }, objectSelection: selection(null) } : {};
    }
    const layer = ctx.settings.imageLayer ?? 'props';
    const locked = lockedLayer(ctx, layer);
    if (locked !== null) return { notice: locked };
    const placement = ctx.settings.imagePlacement ?? 'above';
    const obj: ImageObject = {
      uid: uid(ctx),
      floor: ctx.doc.floor,
      type: 'image',
      layer,
      geometry: placeImage(a.view, p, ctx.doc.grid, e.mods.alt),
      props: { asset_id: a.id, opacity: 1, flip_h: false, flip_v: false, placement },
      visibility: 'all',
      locked: placement === 'background',
      sort_order: 0,
      rev: 1,
    };
    selected = obj.uid;
    return {
      command: command('editor.command.image', [{ type: 'object.add', object: obj }]),
      objectSelection: selection(obj.uid),
      overlay: overlayOf(obj.geometry),
    };
  };

  const up = (e: MapPointerEvent): ToolResult => {
    const d = drag;
    drag = null;
    preview = null;
    if (d === null) return {};
    const g = dragged(e, d);
    const before = d.obj.geometry;
    const same =
      g.x === before.x &&
      g.y === before.y &&
      g.w === before.w &&
      g.h === before.h &&
      g.rotation === before.rotation;
    const live = ctx.doc.object(d.obj.uid);
    if (same || live === undefined || live.type !== 'image')
      return { overlay: overlayOf(live?.type === 'image' ? live.geometry : null) };
    return {
      command: command('editor.command.image_edit', [
        { type: 'object.update', uid: live.uid, rev: live.rev, patch: { geometry: g } },
      ]),
      overlay: overlayOf(g),
    };
  };

  return {
    id: 'image',
    shortcut: 'J',
    onPointer(e): ToolResult {
      switch (e.type) {
        case 'move':
          if (drag !== null) {
            preview = dragged(e, drag);
            return { overlay: overlayOf(preview) };
          }
          return ghost(e);
        case 'down':
          if (e.button !== 0) return {};
          return down(e);
        case 'up':
          return up(e);
        case 'leave':
          return drag !== null ? {} : { overlay: overlayOf(current()?.geometry ?? null) };
      }
    },
    cancel(): ToolResult {
      drag = null;
      preview = null;
      selected = null;
      return { overlay: null, objectSelection: selection(null) };
    },
    deactivate(): ToolResult {
      drag = null;
      preview = null;
      return { overlay: null };
    },
    onAction(action): ToolResult {
      const sel = current();
      if (action !== 'delete' || sel === null) return {};
      if (sel.locked) return { notice: { code: 'object_locked' } };
      selected = null;
      return {
        command: command('editor.command.image_remove', [{ type: 'object.remove', uid: sel.uid }]),
        overlay: null,
        objectSelection: selection(null),
      };
    },
  };
}
