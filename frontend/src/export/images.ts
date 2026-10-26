/**
 * Palette images for the export (worker or main thread): fetch + createImageBitmap (no DOM),
 * same-origin signed URLs (CSP connect-src 'self'). Entries without a URL or whose image fails
 * to load use the engine's fallback tile (cell-render.ts fallbackTilePixels).
 */
import { fallbackTilePixels, frameRect, type FrameRect } from './cell-render';
import type { SnapshotPaletteEntry } from './scene';
import type { SnapshotTokenImage } from './scene-snapshot';

export interface TileSource extends FrameRect {
  readonly image: CanvasImageSource;
  /** Linear filtering (images) or nearest (fallback checkerboard), as in the engine. */
  readonly smooth: boolean;
}

export interface TileImages {
  tile(index: number, variant: number): TileSource;
  /** Palette entries that had a URL but could not be loaded. */
  readonly failed: readonly SnapshotPaletteEntry[];
  close(): void;
}

export type ImageLoader = (url: string, signal: AbortSignal) => Promise<ImageBitmap>;

export const fetchImage: ImageLoader = async (url, signal) => {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return createImageBitmap(await response.blob());
};

/** Fallback bitmaps (2×2) need ImageData + createImageBitmap, available in workers. */
export type FallbackFactory = (pixels: Uint8ClampedArray) => Promise<CanvasImageSource>;

export const bitmapFallback: FallbackFactory = (pixels) =>
  createImageBitmap(new ImageData(new Uint8ClampedArray(pixels), 2, 2));

/** Loads every palette entry (a few in parallel). */
export async function loadTileImages(
  palette: readonly SnapshotPaletteEntry[],
  signal: AbortSignal,
  load: ImageLoader = fetchImage,
  makeFallback: FallbackFactory = bitmapFallback,
  concurrency = 6,
): Promise<TileImages> {
  const images = new Map<number, ImageBitmap>();
  const failed: SnapshotPaletteEntry[] = [];
  const queue = palette.filter((p) => p.url !== null);
  const worker = async (): Promise<void> => {
    for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
      signal.throwIfAborted();
      try {
        images.set(entry.index, await load(entry.url!, signal));
      } catch (error) {
        if (signal.aborted) throw error;
        failed.push(entry);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  signal.throwIfAborted();

  const fallbacks = new Map<number, TileSource>();
  const needed = new Set<number>();
  for (const p of palette)
    if (!images.has(p.index)) for (let v = 0; v < 4; v++) needed.add(p.index * 4 + v);
  for (const key of needed) {
    const image = await makeFallback(fallbackTilePixels(key >> 2, key & 3));
    fallbacks.set(key, { image, sx: 0, sy: 0, sw: 2, sh: 2, smooth: false });
  }
  const frames = new Map<number, TileSource>();
  let unknown: TileSource | null = null;

  return {
    failed,
    tile(index, variant) {
      const bitmap = images.get(index);
      if (bitmap !== undefined) {
        const key = index * 65536 + variant;
        let source = frames.get(key);
        if (source === undefined) {
          source = {
            image: bitmap,
            smooth: true,
            ...frameRect(bitmap.width, bitmap.height, variant),
          };
          frames.set(key, source);
        }
        return source;
      }
      const fb = fallbacks.get(index * 4 + (variant & 3));
      if (fb !== undefined) return fb;
      // Index not in the snapshot palette (should not happen): first fallback found.
      unknown ??= fallbacks.values().next().value ?? null;
      if (unknown === null) throw new Error(`No tile for palette index ${index}`);
      return unknown;
    },
    close() {
      for (const b of images.values()) b.close();
      for (const f of fallbacks.values()) if ('close' in f.image) (f.image as ImageBitmap).close();
    },
  };
}

/** A loaded token image with its size (CanvasImageSource has no common size property). */
export interface TokenImage {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

export interface TokenImages {
  /** Image of SnapshotToken.image, null when it failed (drawn as a disc with initials). */
  get(index: number): TokenImage | null;
  /** Entries that could not be loaded (reported like the tiles, index −1 − token image). */
  readonly failed: readonly SnapshotPaletteEntry[];
  close(): void;
}

export const NO_TOKEN_IMAGES: TokenImages = {
  get: () => null,
  failed: [],
  close: () => undefined,
};

/** Loads the token images of the export (same loader and limits as the tiles). */
export async function loadTokenImages(
  entries: readonly SnapshotTokenImage[],
  signal: AbortSignal,
  load: ImageLoader = fetchImage,
  concurrency = 6,
): Promise<TokenImages> {
  const images = new Map<number, TokenImage>();
  const failed: SnapshotPaletteEntry[] = [];
  const queue = [...entries];
  const worker = async (): Promise<void> => {
    for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
      signal.throwIfAborted();
      try {
        const bitmap = await load(entry.url, signal);
        images.set(entry.index, { image: bitmap, width: bitmap.width, height: bitmap.height });
      } catch (error) {
        if (signal.aborted) throw error;
        failed.push({ index: -1 - entry.index, name: entry.name, url: entry.url });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  signal.throwIfAborted();
  return {
    failed,
    get: (index) => images.get(index) ?? null,
    close() {
      for (const i of images.values()) {
        if ('close' in i.image) (i.image as ImageBitmap).close();
      }
    },
  };
}
