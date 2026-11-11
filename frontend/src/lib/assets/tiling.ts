/**
 * Big battlemaps: an image over the dimension limits is cut in the browser into tiles that each
 * fit the limits of the image pipeline (the server never decodes more than one tile at a time, so
 * the memory of a shared host is not exceeded). Neighbouring tiles overlap by one pixel on their
 * right and bottom edges so that no seam shows when the renderer places them side by side.
 * Pure planning here; the rasterizer is injectable (see reduce.ts).
 */

import type { AssetLimits, AssetMime } from '../types';
import type { ImageInfo } from './image-info';
import { MAX_DECODE_PIXELS, outputMime, renameForMime } from './reduce-plan';
import { defaultRasterizer, UploadRejected, type RasterSource, type Rasterizer } from './reduce';

/** Pixels shared by two neighbouring tiles. */
export const TILE_OVERLAP = 1;
/** Encodings tried in turn until a tile fits the upload weight (WebP after the source format). */
export const ENCODE_ATTEMPTS: readonly { readonly webp: boolean; readonly quality: number }[] = [
  { webp: false, quality: 0.9 },
  { webp: true, quality: 0.9 },
  { webp: true, quality: 0.75 },
  { webp: true, quality: 0.6 },
];

export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Largest side of a tile under the limits. */
export function tileSide(limits: AssetLimits): number {
  return Math.max(
    2,
    Math.min(limits.max_dimension_px, Math.floor(Math.sqrt(limits.max_total_pixels))),
  );
}

/** Starts of the tiles along one axis (each at most `side` long, overlapping by TILE_OVERLAP). */
function axis(total: number, side: number): { start: number; size: number }[] {
  if (total <= side) return [{ start: 0, size: total }];
  const step = side - TILE_OVERLAP;
  const count = Math.ceil((total - side) / step) + 1;
  const out: { start: number; size: number }[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * step;
    out.push({ start, size: Math.min(side, total - start) });
  }
  return out;
}

/** The tiles (row-major) of an image of `width` x `height` pixels. */
export function planTiles(width: number, height: number, side: number): TileRect[] {
  const cols = axis(width, side);
  const rows = axis(height, side);
  const out: TileRect[] = [];
  for (const r of rows) {
    for (const c of cols) out.push({ x: c.start, y: r.start, w: c.size, h: r.size });
  }
  return out;
}

/** Biggest tiled image accepted (browser decoding budget, same as the reduction). */
export const MAX_TILED_PIXELS = MAX_DECODE_PIXELS;

export type TilingDecision = 'single' | 'tiles' | 'reject';

/**
 * Whether a file must be cut: a static image over the dimension limits (not the weight alone:
 * a heavy small image is still reduced as before). Animated images are never cut.
 */
export function tilingDecision(info: ImageInfo | null, limits: AssetLimits): TilingDecision {
  if (info === null || info.animated || !limits.accepted_mimes.includes(info.mime)) return 'single';
  const side = tileSide(limits);
  if (info.width <= side && info.height <= side) return 'single';
  return info.width * info.height > MAX_TILED_PIXELS ? 'reject' : 'tiles';
}

export interface EncodedTile {
  readonly rect: TileRect;
  readonly blob: Blob;
  readonly fileName: string;
}

/** Same image name with a tile suffix: "map.png" => "map_r1c2.png" (extension from the mime). */
export function tileFileName(base: string, mime: AssetMime, row: number, col: number): string {
  const stem = base.replace(/\.[^./\\]+$/, '');
  return renameForMime(`${stem}_r${row + 1}c${col + 1}.x`, mime);
}

/**
 * Cuts and encodes the tiles one at a time (only one tile canvas alive at once). `emit` receives
 * each tile as soon as it is encoded so that the caller can send it and drop it.
 */
export async function cutTiles(
  file: File,
  info: ImageInfo,
  limits: AssetLimits,
  emit: (tile: EncodedTile, index: number, count: number) => Promise<void>,
  rasterizer: Rasterizer = defaultRasterizer(),
): Promise<TileRect[]> {
  let source;
  try {
    source = await rasterizer.open(file);
  } catch {
    throw new UploadRejected('unreadable');
  }
  try {
    if (source.encodeRegion === undefined) throw new UploadRejected('reduce_failed');
    const plan = planTiles(source.width, source.height, tileSide(limits));
    const cols = new Set(plan.map((t) => t.x)).size;
    const base = outputMime(info.mime);
    for (let i = 0; i < plan.length; i++) {
      const rect = plan[i]!;
      const encoded = await encodeTile(source, rect, base, limits);
      await emit(
        {
          rect,
          blob: encoded.blob,
          fileName: tileFileName(file.name, encoded.mime, Math.floor(i / cols), i % cols),
        },
        i,
        plan.length,
      );
    }
    return plan;
  } finally {
    source.close();
  }
}

async function encodeTile(
  source: RasterSource,
  rect: TileRect,
  base: AssetMime,
  limits: AssetLimits,
): Promise<{ blob: Blob; mime: AssetMime }> {
  const region = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
  for (const attempt of ENCODE_ATTEMPTS) {
    const wanted: AssetMime = attempt.webp ? 'image/webp' : base;
    if (attempt.webp && !limits.accepted_mimes.includes('image/webp')) continue;
    let blob: Blob;
    try {
      blob = await source.encodeRegion!(region, wanted, attempt.quality);
    } catch {
      throw new UploadRejected('reduce_failed');
    }
    // Browsers fall back to PNG for formats they cannot encode.
    const produced = (blob.type === '' ? wanted : blob.type) as AssetMime;
    if (!limits.accepted_mimes.includes(produced)) throw new UploadRejected('reduce_failed');
    if (blob.size <= limits.max_upload_bytes) return { blob, mime: produced };
  }
  throw new UploadRejected('reduce_failed');
}
