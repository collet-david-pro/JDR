/**
 * Map thumbnail rendering (P4c): the tile layers of the document drawn with Canvas 2D on the
 * grid theme background, ≤ 512 px on the longest side, encoded as WebP (PNG when the browser
 * cannot encode WebP), ≤ 512 KB.
 *
 * Canvas 2D rather than the Pixi engine: the engine only builds the visible blocks (culling,
 * per-block caches), a thumbnail needs the whole map; the cell drawing rules are the engine's
 * (variant strips, rotation/mirror flags, fallback colour while an image is missing).
 */
import {
  CHUNK_SIZE,
  type ChunkKey,
  type GridSpec,
  type MapView,
  type TileLayerId,
} from '../contracts';
import { decodeFlags, variantFrame, variantFrameCount } from '../../engine/cell-transform';
import { colorToCss, fallbackColor } from '../../engine/fallback-color';
import { gridTheme } from '../../engine/grid-themes';

export const THUMBNAIL_MAX_PX = 512;
export const THUMBNAIL_MAX_BYTES = 512 * 1024;
/** Below this cell size, each cell is one averaged colour (fast path for big maps). */
export const DETAILED_MIN_CELL_PX = 4;

export interface ThumbnailSize {
  readonly width: number;
  readonly height: number;
  /** Pixels per cell in the thumbnail. */
  readonly cellPx: number;
}

/** Thumbnail dimensions: the longest side ≤ maxPx, never enlarged past the map's cell size. */
export function thumbnailSize(grid: GridSpec, maxPx = THUMBNAIL_MAX_PX): ThumbnailSize {
  const side = Math.max(1, grid.width, grid.height);
  const cellPx = Math.min(grid.cellPx, maxPx / side);
  return {
    width: Math.max(1, Math.min(maxPx, Math.round(grid.width * cellPx))),
    height: Math.max(1, Math.min(maxPx, Math.round(grid.height * cellPx))),
    cellPx,
  };
}

type Img = HTMLImageElement | ImageBitmap;
type Ctx = CanvasRenderingContext2D;

interface LoadedImage {
  readonly image: Img;
  readonly frames: number;
  readonly frameW: number;
  readonly frameH: number;
  /** Average colour of the first frame, [r, g, b, a] (0-255). */
  readonly average: readonly [number, number, number, number];
}

export interface ThumbnailRendererOptions {
  readonly loadImage?: (url: string) => Promise<Img>;
  readonly createCanvas?: (width: number, height: number) => HTMLCanvasElement;
}

function defaultLoadImage(url: string): Promise<Img> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  return img.decode().then(() => img);
}

function defaultCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** Keeps the palette images loaded between two thumbnails of the same editing session. */
export class ThumbnailRenderer {
  private readonly images = new Map<string, Promise<LoadedImage | null>>();
  private readonly loadImage: (url: string) => Promise<Img>;
  private readonly createCanvas: (width: number, height: number) => HTMLCanvasElement;

  constructor(options: ThumbnailRendererOptions = {}) {
    this.loadImage = options.loadImage ?? defaultLoadImage;
    this.createCanvas = options.createCanvas ?? defaultCanvas;
  }

  /**
   * Renders and encodes (WebP by default, PNG when asked or when WebP cannot be encoded); the
   * size is reduced until the image fits THUMBNAIL_MAX_BYTES.
   */
  async render(
    view: MapView,
    maxPx = THUMBNAIL_MAX_PX,
    type: 'image/webp' | 'image/png' = 'image/webp',
  ): Promise<Blob> {
    let px = maxPx;
    for (let attempt = 0; ; attempt++) {
      const canvas = await this.draw(view, px);
      const blob =
        (type === 'image/webp' ? await toBlob(canvas, 'image/webp', 0.82) : null) ??
        (await toBlob(canvas, 'image/png'));
      if (blob === null) throw new Error('Thumbnail encoding failed');
      if (blob.size <= THUMBNAIL_MAX_BYTES || attempt >= 3) return blob;
      px = Math.max(64, Math.round(px * 0.7));
    }
  }

  /** Draws the map on a new canvas. */
  async draw(view: MapView, maxPx = THUMBNAIL_MAX_PX): Promise<HTMLCanvasElement> {
    const size = thumbnailSize(view.grid, maxPx);
    const palette = await this.loadPalette(view);
    const canvas = this.createCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('Canvas 2D unavailable');
    ctx.fillStyle = colorToCss(gridTheme(view.theme).background);
    ctx.fillRect(0, 0, size.width, size.height);
    for (const layer of view.layers) {
      if (layer.kind !== 'tiles' || !layer.visible || layer.opacity <= 0) continue;
      const id = layer.id as TileLayerId;
      ctx.globalAlpha = layer.opacity;
      if (size.cellPx >= DETAILED_MIN_CELL_PX) this.drawDetailed(ctx, view, id, size, palette);
      else this.drawAveraged(ctx, view, id, size, palette);
    }
    ctx.globalAlpha = 1;
    return canvas;
  }

  private async loadPalette(view: MapView): Promise<(LoadedImage | null)[]> {
    return Promise.all(
      view.palette.map((entry) => {
        if (entry === null || entry.url === null) return Promise.resolve(null);
        let loaded = this.images.get(entry.url);
        if (loaded === undefined) {
          loaded = this.loadImage(entry.url)
            .then((image) => this.describe(image))
            .catch(() => null);
          this.images.set(entry.url, loaded);
        }
        return loaded;
      }),
    );
  }

  private describe(image: Img): LoadedImage {
    const frames = variantFrameCount(image.width, image.height);
    const frameW = image.width / frames;
    const frameH = image.height;
    let average: [number, number, number, number] = [0, 0, 0, 0];
    try {
      const probe = this.createCanvas(1, 1).getContext('2d', { willReadFrequently: true });
      if (probe !== null) {
        probe.drawImage(image, 0, 0, frameW, frameH, 0, 0, 1, 1);
        const d = probe.getImageData(0, 0, 1, 1).data;
        average = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
      }
    } catch {
      // Tainted or unreadable: the fallback colour is used for the small thumbnails.
      average = [0, 0, 0, 0];
    }
    return { image, frames, frameW, frameH, average };
  }

  private drawDetailed(
    ctx: Ctx,
    view: MapView,
    layer: TileLayerId,
    size: ThumbnailSize,
    palette: readonly (LoadedImage | null)[],
  ): void {
    const c = size.cellPx;
    // Integer-snapped cell edges avoid hairline gaps between cells.
    const edge = (n: number): number => Math.round(n * c);
    for (const key of view.chunkKeys(layer)) {
      const cells = view.chunkCells(layer, key as ChunkKey);
      if (cells === null) continue;
      const [cx, cy] = key.split(':').map(Number) as [number, number];
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const index = cells[i * 4]!;
        if (index === 0) continue;
        const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
        const y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        if (x >= view.grid.width || y >= view.grid.height) continue;
        const variant = cells[i * 4 + 1]!;
        const flags = cells[i * 4 + 2]!;
        const x0 = edge(x);
        const y0 = edge(y);
        const w = edge(x + 1) - x0;
        const h = edge(y + 1) - y0;
        const img = palette[index] ?? null;
        if (img === null) {
          ctx.fillStyle = colorToCss(fallbackColor(index, variant));
          ctx.fillRect(x0, y0, w, h);
          continue;
        }
        const sx = variantFrame(variant, img.frames) * img.frameW;
        if (flags === 0) {
          ctx.drawImage(img.image, sx, 0, img.frameW, img.frameH, x0, y0, w, h);
          continue;
        }
        const f = decodeFlags(flags);
        ctx.save();
        ctx.translate(x0 + w / 2, y0 + h / 2);
        ctx.rotate((f.quarterTurns * Math.PI) / 2);
        ctx.scale(f.mirrorH ? -1 : 1, f.mirrorV ? -1 : 1);
        ctx.drawImage(img.image, sx, 0, img.frameW, img.frameH, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
    }
  }

  private drawAveraged(
    ctx: Ctx,
    view: MapView,
    layer: TileLayerId,
    size: ThumbnailSize,
    palette: readonly (LoadedImage | null)[],
  ): void {
    const { width, height } = view.grid;
    const layerCanvas = this.createCanvas(width, height);
    const lctx = layerCanvas.getContext('2d');
    if (lctx === null) return;
    const data = lctx.createImageData(width, height);
    const px = data.data;
    for (const key of view.chunkKeys(layer)) {
      const cells = view.chunkCells(layer, key as ChunkKey);
      if (cells === null) continue;
      const [cx, cy] = key.split(':').map(Number) as [number, number];
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const index = cells[i * 4]!;
        if (index === 0) continue;
        const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
        const y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        if (x >= width || y >= height) continue;
        const img = palette[index] ?? null;
        const o = (y * width + x) * 4;
        if (img !== null && img.average[3] > 0) {
          px[o] = img.average[0];
          px[o + 1] = img.average[1];
          px[o + 2] = img.average[2];
          px[o + 3] = img.average[3];
        } else {
          const [r, g, b] = rgbOf(fallbackColor(index, cells[i * 4 + 1]!));
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = b;
          px[o + 3] = 255;
        }
      }
    }
    lctx.putImageData(data, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(layerCanvas, 0, 0, size.width, size.height);
    ctx.imageSmoothingEnabled = true;
  }
}

/** Maps whose thumbnail must be refreshed when the editor opens again (after a restore). */
const stale = new Set<string>();

export function markThumbnailStale(mapId: string): void {
  stale.add(mapId);
}

/** True once per marked map. */
export function takeThumbnailStale(mapId: string): boolean {
  return stale.delete(mapId);
}
