/**
 * P14 glue between the library and the image objects: asset -> ImageAssetView, upload of a new
 * image (same reduction / errors as the library, with what to do when it is too large), fetch of
 * the assets of images added by another editor, property patches.
 */
import type { ApiClient } from '../../lib/api';
import type { AssetsClient } from '../../lib/assets/assets-client';
import { prepareFile } from '../../lib/assets/reduce';
import { failureFromError, failureText } from '../../lib/assets/upload-errors';
import type { Translate } from '../../lib/translator';
import type { Asset, AssetKind } from '../../lib/types';
import type { MapObject, ObjectPatch, SceneChangedEvent } from '../contracts';
import type { ImageAssetView, ImageObject, ImageProps } from '../contracts-images';

/** Library asset -> what the engine needs. */
export function imageAssetOf(asset: Asset): ImageAssetView {
  return {
    assetId: String(asset.id),
    name: asset.name,
    url: asset.urls.full,
    width: asset.width,
    height: asset.height,
    animated: asset.is_animated,
  };
}

/** Failure keys after which the user is told how to get a smaller image. */
const TOO_LARGE_KEYS = new Set([
  'library.upload.errors.image_too_large',
  'library.upload.errors.file_too_large',
  'library.upload.reject.too_big_to_reduce',
  'library.upload.reject.reduce_failed',
]);

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

/**
 * Sends an image to the library (reduced in the browser like the library uploads). Throws an
 * ImageUploadError with a translated message; a too large image gets the advice to reduce it or
 * to ask the administrator to raise the image limits.
 */
export async function uploadImage(
  client: AssetsClient,
  file: File,
  kind: AssetKind,
  t: Translate,
): Promise<{ asset: Asset; reduced: boolean }> {
  let limits = null;
  try {
    limits = await client.limits();
    const prepared = await prepareFile(file, limits);
    const result = await client.upload(prepared.blob, prepared.fileName, { kind });
    return { asset: result.asset, reduced: prepared.reduced };
  } catch (error) {
    const failure = failureFromError(error, limits);
    let text = failureText(failure, t);
    if (TOO_LARGE_KEYS.has(failure.key)) text += ' ' + t('editor.images.too_large_hint');
    throw new ImageUploadError(text);
  }
}

/** Minimal document side of the watcher (MapDocument implements it). */
export interface ImageAssetHost {
  object(uid: string): MapObject | undefined;
  imageAsset(assetId: string): ImageAssetView | null;
  setImageAssets(assets: readonly ImageAssetView[]): void;
  onSceneChanged(listener: (event: SceneChangedEvent) => void): () => void;
}

/**
 * Fetches (GET /assets/{id}, once per id) the asset of every image object that appears without a
 * known asset (added by another editor, restored version). Returns the unsubscribe function.
 */
export function watchImageAssets(host: ImageAssetHost, api: Pick<ApiClient, 'get'>): () => void {
  const asked = new Set<string>();
  return host.onSceneChanged((event) => {
    for (const uid of event.objects) {
      const o = host.object(uid);
      if (o === undefined || o.type !== 'image') continue;
      const id = o.props.asset_id;
      if (asked.has(id) || host.imageAsset(id) !== null) continue;
      asked.add(id);
      void api
        .get<Asset>(`/assets/${encodeURIComponent(id)}`)
        .then((r) => host.setImageAssets([imageAssetOf(r.data)]))
        .catch(() => undefined);
    }
  });
}

/** Patch of an image property change (null for another type). */
export function imagePatch(o: MapObject, change: Partial<ImageProps>): ObjectPatch | null {
  if (o.type !== 'image') return null;
  const props = { ...o.props, ...change };
  const opacity = Math.round(Math.min(1, Math.max(0, props.opacity)) * 1000) / 1000;
  return { props: { ...props, opacity } };
}

/** Image objects of a list. */
export function imagesOf(objects: readonly MapObject[]): ImageObject[] {
  return objects.filter((o): o is ImageObject => o.type === 'image');
}

/** Background images (placement background) of a floor, bottom first. */
export function backgroundsOf(objects: readonly MapObject[]): ImageObject[] {
  return imagesOf(objects).filter((o) => o.props.placement === 'background');
}
