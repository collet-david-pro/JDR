/**
 * P14 image objects drawn with Canvas 2D (map thumbnail): the images a player would see (layer
 * other than gm and visible, visibility `all`), in object layer order, with their rotation,
 * mirrors and opacity. Same placement rule as the engine: `background` before the tiles,
 * `above` after them.
 */
import type { LayerDef, MapView, ObjectLayerId, SceneView } from '../contracts';
import type { ImageObject } from '../contracts-images';
import { imageCenter } from '../model/image-values';

type Img = HTMLImageElement | ImageBitmap;

const LAYER_ORDER: readonly ObjectLayerId[] = ['walls', 'props', 'lighting', 'labels', 'gm'];

/** A visible image object and the URL of its asset. */
export interface PictureToDraw {
  readonly obj: ImageObject;
  readonly url: string;
  /** Object opacity × layer opacity. */
  readonly alpha: number;
}

/** Image objects of a document a player would see, bottom → top (empty without a scene). */
export function playerPictures(view: MapView): PictureToDraw[] {
  const scene = view as MapView & Partial<SceneView>;
  if (typeof scene.objects !== 'function' || typeof scene.imageAsset !== 'function') return [];
  const order = [
    ...view.layers.map((l) => l.id as ObjectLayerId).filter((id) => LAYER_ORDER.includes(id)),
    ...LAYER_ORDER,
  ];
  const layerOf = (id: string): LayerDef | undefined => view.layers.find((l) => l.id === id);
  const out: { p: PictureToDraw; rank: number; i: number }[] = [];
  scene.objects().forEach((o, i) => {
    if (o.type !== 'image' || o.layer === 'gm' || o.visibility !== 'all') return;
    const layer = layerOf(o.layer);
    if (layer !== undefined && (!layer.visible || layer.gmOnly === true || layer.opacity <= 0))
      return;
    const url = scene.imageAsset?.(o.props.asset_id)?.url ?? null;
    if (url === null) return;
    const alpha = o.props.opacity * (layer?.opacity ?? 1);
    out.push({ p: { obj: o, url, alpha }, rank: order.indexOf(o.layer), i });
  });
  return out.sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => x.p);
}

/** Draws the pictures of one placement; `cellPx` = pixels per cell of the canvas. */
export function drawPictures(
  ctx: CanvasRenderingContext2D,
  pictures: readonly PictureToDraw[],
  images: ReadonlyMap<string, Img | null>,
  cellPx: number,
  placement: 'background' | 'above',
): void {
  for (const { obj, url, alpha } of pictures) {
    if (obj.props.placement !== placement || !(alpha > 0)) continue;
    const image = images.get(url) ?? null;
    if (image === null) continue;
    const g = obj.geometry;
    const [cx, cy] = imageCenter(g);
    const rot = (g.rotation * Math.PI) / 180;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.translate(cx * cellPx, cy * cellPx);
    ctx.rotate(rot);
    ctx.scale(obj.props.flip_h ? -1 : 1, obj.props.flip_v ? -1 : 1);
    ctx.drawImage(image, (-g.w * cellPx) / 2, (-g.h * cellPx) / 2, g.w * cellPx, g.h * cellPx);
    ctx.restore();
  }
}
