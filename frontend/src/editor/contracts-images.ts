/**
 * P14 contract of the image objects (map background, free pictures). Kept apart from contracts.ts.
 *
 * Server side (app/Maps/ObjectRulesImage.php): type `image`, geometry {x, y, w, h, rotation} in
 * cells (top-left corner, size; rotation in degrees around the centre, normalized to [0, 360)),
 * props {asset_id, opacity 0-1, flip_h, flip_v, placement}. x in [-width, width], w in
 * [0.1, 2 x width] (same for y / h), the rectangle overlapping the map. `placement: background` is
 * drawn under the tiles (right after the theme background), `above` on the objects, under the
 * tokens. An image blocks neither vision, light nor movement. On the `gm` layer it never reaches a
 * player nor a screen. The asset must be usable by the editor in the game and of a kind of
 * IMAGE_ASSET_KINDS (422 `...props.asset_id = not_found`).
 *
 * URLs: GET /maps/{id} and the snapshots carry `map.images: ImageAssetWire[]`, the assets of the
 * image objects the reader sees (signed URLs; names empty for players).
 */

import type { ObjectLayerId, ObjectVisibility } from './contracts';

export type ImagePlacement = 'background' | 'above';

export const IMAGE_PLACEMENTS: readonly ImagePlacement[] = ['background', 'above'];

/** Asset kinds an image object may use. */
export const IMAGE_ASSET_KINDS = ['background', 'object', 'token', 'texture'] as const;

/** Smallest side of an image, cells. */
export const IMAGE_SIZE_MIN = 0.1;

export interface ImageGeometry {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Degrees, [0, 360). */
  readonly rotation: number;
}

/**
 * Piece of a big picture (battlemap over the image limits, cut in the browser): the picture is
 * `tw` x `th` pixels, this object shows its rectangle (x, y, w, h) in pixels. All the pieces of a
 * picture share `group`; the editor moves them together. Optional: a one-piece image has none.
 */
export interface ImageTile {
  readonly group: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly tw: number;
  readonly th: number;
}

export interface ImageProps {
  /** Asset id (string in answers; ops also accept a number). */
  readonly asset_id: string;
  readonly opacity: number;
  readonly flip_h: boolean;
  readonly flip_v: boolean;
  readonly placement: ImagePlacement;
  /** Set when the object is one piece of a tiled picture. */
  readonly tile?: ImageTile;
}

/** Image object. Default layer `props`. */
export interface ImageObject {
  readonly uid: string;
  readonly floor: string;
  readonly type: 'image';
  readonly layer: ObjectLayerId;
  readonly visibility: ObjectVisibility;
  readonly locked: boolean;
  readonly sort_order: number;
  readonly rev: number;
  readonly geometry: ImageGeometry;
  readonly props: ImageProps;
}

/** One entry of `map.images` (server form). */
export interface ImageAssetWire {
  readonly asset_id: string;
  readonly name: string;
  /** Signed URL, null when the asset is deleted (placeholder drawn). */
  readonly url: string | null;
  readonly thumb_url: string | null;
  /** Native size, px. */
  readonly width: number;
  readonly height: number;
  readonly animated: boolean;
}

/** What the engine needs to draw an image object (SceneView.imageAsset). */
export interface ImageAssetView {
  readonly assetId: string;
  readonly name: string;
  readonly url: string | null;
  readonly width: number;
  readonly height: number;
  /** Animated GIF / WebP: every frame is shown (first frame where the browser cannot decode). */
  readonly animated?: boolean;
}

/** Wire entry -> view. */
export function imageAssetFromWire(w: ImageAssetWire): ImageAssetView {
  return {
    assetId: String(w.asset_id),
    name: w.name,
    url: w.url,
    width: w.width,
    height: w.height,
    animated: w.animated,
  };
}

/** Narrowing helper. */
export function isImageObject(o: { readonly type: string }): o is ImageObject {
  return o.type === 'image';
}
