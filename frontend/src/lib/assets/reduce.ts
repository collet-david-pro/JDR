/**
 * Prepares a file before upload: reads its header, applies the reduction plan
 * (reduce-plan.ts) and, when needed, resizes it with a canvas. The rasterizer is
 * injectable so that the logic can be tested without a browser.
 */

import type { AssetLimits, AssetMime } from '../types';
import { readImageInfo, sniffMime, type ImageInfo } from './image-info';
import {
  ENCODE_QUALITY,
  MAX_ENCODE_ATTEMPTS,
  nextScale,
  planUpload,
  renameForMime,
  scaledSize,
  type RejectReason,
} from './reduce-plan';

/** Header bytes read for PNG / JPEG (enough for large EXIF segments). */
export const HEADER_BYTES = 512 * 1024;
/** GIF / WebP are scanned entirely (frames, duration) up to this size. */
export const MAX_SCAN_BYTES = 64 * 1024 * 1024;

export class UploadRejected extends Error {
  override readonly name = 'UploadRejected';
  constructor(readonly reason: RejectReason) {
    super(`Upload refused before sending: ${reason}`);
  }
}

/** A decoded image that can be encoded at several sizes. */
export interface RasterSource {
  readonly width: number;
  readonly height: number;
  encode(width: number, height: number, mime: AssetMime, quality: number): Promise<Blob>;
  close(): void;
}

export interface Rasterizer {
  open(blob: Blob): Promise<RasterSource>;
}

export interface PreparedFile {
  readonly blob: Blob;
  readonly fileName: string;
  readonly reduced: boolean;
  readonly originalSize: number;
  readonly info: ImageInfo | null;
}

export interface PrepareOptions {
  readonly rasterizer?: Rasterizer;
  readonly signal?: AbortSignal;
  /** Called when a resize starts (status "reducing"). */
  readonly onReduce?: () => void;
}

async function readBytes(blob: Blob, length: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, length).arrayBuffer());
}

/** Reads what is needed to describe the image (header, or whole GIF / WebP). */
export async function inspectFile(file: Blob): Promise<ImageInfo | null> {
  const head = await readBytes(file, Math.min(file.size, HEADER_BYTES));
  const mime = sniffMime(head);
  if (mime === 'image/gif' || mime === 'image/webp') {
    if (file.size <= head.length) return readImageInfo(head);
    return readImageInfo(await readBytes(file, Math.min(file.size, MAX_SCAN_BYTES)));
  }
  return readImageInfo(head);
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError');
}

export async function prepareFile(
  file: File,
  limits: AssetLimits,
  options: PrepareOptions = {},
): Promise<PreparedFile> {
  const info = await inspectFile(file);
  checkAborted(options.signal);
  const plan = planUpload({ size: file.size, info }, limits);
  const base = { originalSize: file.size, info };
  if (plan.kind === 'reject') throw new UploadRejected(plan.reason);
  if (plan.kind === 'send') return { ...base, blob: file, fileName: file.name, reduced: false };

  options.onReduce?.();
  const rasterizer = options.rasterizer ?? defaultRasterizer();
  let source: RasterSource;
  try {
    source = await rasterizer.open(file);
  } catch {
    throw new UploadRejected('unreadable');
  }
  try {
    let scale = plan.scale;
    for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt++) {
      checkAborted(options.signal);
      const size = scaledSize(source.width, source.height, scale, limits);
      let blob: Blob;
      try {
        blob = await source.encode(size.width, size.height, plan.outputMime, ENCODE_QUALITY);
      } catch {
        throw new UploadRejected('reduce_failed');
      }
      // Browsers fall back to PNG for formats they cannot encode (WebP on old Safari).
      const produced = (blob.type === '' ? plan.outputMime : blob.type) as AssetMime;
      if (!limits.accepted_mimes.includes(produced)) throw new UploadRejected('reduce_failed');
      if (blob.size <= limits.max_upload_bytes) {
        return { ...base, blob, fileName: renameForMime(file.name, produced), reduced: true };
      }
      scale = nextScale(scale, blob.size, limits.max_upload_bytes);
    }
    throw new UploadRejected('reduce_failed');
  } finally {
    source.close();
  }
}

/* ---------------------------------------------------------------- browser rasterizer -- */

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(
  width: number,
  height: number,
): {
  context: Canvas2D;
  toBlob: (mime: string, quality: number) => Promise<Blob>;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('2D context unavailable');
    return { context, toBlob: (type, quality) => canvas.convertToBlob({ type, quality }) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D context unavailable');
  return {
    context,
    toBlob: (type, quality) =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob === null ? reject(new Error('Encoding failed')) : resolve(blob)),
          type,
          quality,
        );
      }),
  };
}

/** createImageBitmap + (Offscreen)Canvas; EXIF orientation is applied by the decoder. */
export function defaultRasterizer(): Rasterizer {
  return {
    async open(blob) {
      const bitmap = await createImageBitmap(blob);
      return {
        width: bitmap.width,
        height: bitmap.height,
        async encode(width, height, mime, quality) {
          const { context, toBlob } = makeCanvas(width, height);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(bitmap, 0, 0, width, height);
          return toBlob(mime, quality);
        },
        close() {
          bitmap.close();
        },
      };
    },
  };
}
