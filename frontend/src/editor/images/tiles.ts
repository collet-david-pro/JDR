/**
 * Big battlemaps (over the image limits): the picture is cut in the browser (lib/assets/tiling.ts)
 * and each piece is an ordinary background image object placed side by side, so the editor, the
 * session, the PNG export and the thumbnail draw them with no special case. `props.tile` records
 * the pixel rectangle of the piece in the whole picture and a shared group, which lets the
 * background dialog move or recalibrate all the pieces at once.
 */
import { failureFromError, failureText } from '../../lib/assets/upload-errors';
import type { AssetsClient } from '../../lib/assets/assets-client';
import { inspectFile, UploadRejected, type Rasterizer } from '../../lib/assets/reduce';
import { cutTiles, tilingDecision, type TileRect } from '../../lib/assets/tiling';
import type { Translate } from '../../lib/translator';
import type { Asset } from '../../lib/types';
import type { MapObject } from '../contracts';
import type { ImageAssetView, ImageGeometry, ImageObject, ImageTile } from '../contracts-images';
import { newObjectUid } from '../util/uid';
import { ImageUploadError, imageAssetOf, uploadImage } from './library';

/** One sent piece of a big picture. */
export interface TilePart {
  readonly assetId: string;
  readonly rect: TileRect;
}

/** A big picture cut in pieces already sent to the library. */
export interface TiledImage {
  readonly group: string;
  readonly width: number;
  readonly height: number;
  readonly parts: readonly TilePart[];
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Geometry (cells) of one piece when the whole picture occupies `whole`. */
export function tileGeometry(whole: ImageGeometry, tile: Omit<ImageTile, 'group'>): ImageGeometry {
  const x0 = r3(whole.x + (whole.w * tile.x) / tile.tw);
  const y0 = r3(whole.y + (whole.h * tile.y) / tile.th);
  const x1 = r3(whole.x + (whole.w * (tile.x + tile.w)) / tile.tw);
  const y1 = r3(whole.y + (whole.h * (tile.y + tile.h)) / tile.th);
  return { x: x0, y: y0, w: r3(x1 - x0), h: r3(y1 - y0), rotation: 0 };
}

/** The `tile` prop of a part. */
export function tileProp(tiled: TiledImage, part: TilePart): ImageTile {
  const { x, y, w, h } = part.rect;
  return { group: tiled.group, x, y, w, h, tw: tiled.width, th: tiled.height };
}

/** Pieces of a picture as locked background objects (a new group, or an existing one). */
export function tileObjects(
  floor: string,
  whole: ImageGeometry,
  tiled: TiledImage,
  newUid: () => string = newObjectUid,
): ImageObject[] {
  return tiled.parts.map((part) => {
    const tile = tileProp(tiled, part);
    return {
      uid: newUid(),
      floor,
      type: 'image',
      layer: 'props',
      geometry: tileGeometry(whole, tile),
      props: {
        asset_id: part.assetId,
        opacity: 1,
        flip_h: false,
        flip_v: false,
        placement: 'background',
        tile,
      },
      visibility: 'all',
      locked: true,
      sort_order: -1000,
      rev: 1,
    } satisfies ImageObject;
  });
}

/** The objects of the picture the object belongs to (the object alone when it has no tile). */
export function tileGroupOf(objects: readonly MapObject[], target: ImageObject): ImageObject[] {
  const group = target.props.tile?.group;
  if (group === undefined) return [target];
  return objects.filter(
    (o): o is ImageObject =>
      o.type === 'image' && o.floor === target.floor && o.props.tile?.group === group,
  );
}

/** The whole picture rebuilt from the pieces of a group (rectangle in cells, size in pixels). */
export function tiledOfGroup(
  members: readonly ImageObject[],
): { tiled: TiledImage; geometry: ImageGeometry } | null {
  const first = members[0]?.props.tile;
  if (first === undefined) return null;
  const parts: TilePart[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of members) {
    const tile = m.props.tile;
    if (tile === undefined || tile.group !== first.group) continue;
    parts.push({ assetId: m.props.asset_id, rect: { x: tile.x, y: tile.y, w: tile.w, h: tile.h } });
    x0 = Math.min(x0, m.geometry.x);
    y0 = Math.min(y0, m.geometry.y);
    x1 = Math.max(x1, m.geometry.x + m.geometry.w);
    y1 = Math.max(y1, m.geometry.y + m.geometry.h);
  }
  if (parts.length === 0) return null;
  return {
    tiled: { group: first.group, width: first.tw, height: first.th, parts },
    geometry: { x: r3(x0), y: r3(y0), w: r3(x1 - x0), h: r3(y1 - y0), rotation: 0 },
  };
}

export type BackgroundUpload =
  | { readonly kind: 'single'; readonly asset: Asset; readonly reduced: boolean }
  | {
      readonly kind: 'tiled';
      readonly tiled: TiledImage;
      /** The whole picture as one asset view (first piece, full size) for the calibration. */
      readonly view: ImageAssetView;
      /** Pieces as library assets (urls for the preview). */
      readonly assets: readonly Asset[];
    };

/**
 * Sends a background. An image over the dimension limits is cut into pieces (each within the
 * limits, so the server never decodes more than one piece); any other image goes through
 * uploadImage as before.
 */
export async function uploadBackground(
  client: AssetsClient,
  file: File,
  t: Translate,
  options: {
    onProgress?: (done: number, count: number) => void;
    rasterizer?: Rasterizer;
  } = {},
): Promise<BackgroundUpload> {
  let limits = null;
  try {
    limits = await client.limits();
    const info = await inspectFile(file);
    const decision = tilingDecision(info, limits);
    if (decision === 'reject') throw new UploadRejected('too_big_to_reduce');
    if (decision === 'single' || info === null) {
      const r = await uploadImage(client, file, 'background', t);
      return { kind: 'single', asset: r.asset, reduced: r.reduced };
    }
    const assets: Asset[] = [];
    const parts: TilePart[] = [];
    const plan = await cutTiles(
      file,
      info,
      limits,
      async (tile, index, count) => {
        options.onProgress?.(index, count);
        const result = await client.upload(tile.blob, tile.fileName, { kind: 'background' });
        assets.push(result.asset);
        parts.push({ assetId: String(result.asset.id), rect: tile.rect });
      },
      options.rasterizer,
    );
    options.onProgress?.(plan.length, plan.length);
    const width = Math.max(...plan.map((r) => r.x + r.w));
    const height = Math.max(...plan.map((r) => r.y + r.h));
    const first = assets[0]!;
    return {
      kind: 'tiled',
      tiled: { group: newObjectUid(), width, height, parts },
      view: { ...imageAssetOf(first), width, height },
      assets,
    };
  } catch (error) {
    if (error instanceof ImageUploadError) throw error;
    const failure = failureFromError(error, limits);
    throw new ImageUploadError(failureText(failure, t));
  }
}
