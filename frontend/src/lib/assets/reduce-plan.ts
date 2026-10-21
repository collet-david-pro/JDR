/**
 * Client-side automatic reduction before upload (projet.md 11.3, note): pure decisions.
 *
 * - Unknown or non-accepted types are refused before sending.
 * - Animated images (GIF, WebP) are never reduced: refused when over a limit.
 * - Static images over the dimension or weight limits are resized (same format, quality
 *   0.9; a static GIF becomes a PNG because canvas cannot encode GIF).
 * The server stays the authority: these checks only avoid pointless uploads.
 */

import type { AssetLimits, AssetMime } from '../types';
import type { ImageInfo } from './image-info';

/** Beyond this number of pixels the browser is not asked to decode the image at all. */
export const MAX_DECODE_PIXELS = 100_000_000;
/** Safety margin applied to the weight-based scale estimate. */
export const BYTES_MARGIN = 0.95;
/** Encoding quality of JPEG / WebP re-encodings. */
export const ENCODE_QUALITY = 0.9;
/** Maximum number of encodings while the result is still too heavy. */
export const MAX_ENCODE_ATTEMPTS = 5;

export type RejectReason =
  | 'unsupported_type'
  | 'animation_too_long'
  | 'animated_too_big'
  | 'animated_too_heavy'
  | 'too_big_to_reduce'
  | 'unreadable'
  | 'reduce_failed';

export const REJECT_REASONS: readonly RejectReason[] = [
  'unsupported_type',
  'animation_too_long',
  'animated_too_big',
  'animated_too_heavy',
  'too_big_to_reduce',
  'unreadable',
  'reduce_failed',
];

export type ReducePlan =
  | { readonly kind: 'send' }
  | { readonly kind: 'resize'; readonly scale: number; readonly outputMime: AssetMime }
  | { readonly kind: 'reject'; readonly reason: RejectReason };

export interface PlanInput {
  readonly size: number;
  /** null when the header could not be read (unknown type). */
  readonly info: ImageInfo | null;
}

function fitsDimensions(width: number, height: number, limits: AssetLimits): boolean {
  return (
    width <= limits.max_dimension_px &&
    height <= limits.max_dimension_px &&
    width * height <= limits.max_total_pixels
  );
}

/** Scale (≤ 1) that brings the dimensions within the limits. */
export function dimensionScale(width: number, height: number, limits: AssetLimits): number {
  return Math.min(
    1,
    limits.max_dimension_px / width,
    limits.max_dimension_px / height,
    Math.sqrt(limits.max_total_pixels / (width * height)),
  );
}

/** Output format of a re-encoding: same format, PNG for GIF. */
export function outputMime(mime: AssetMime): AssetMime {
  return mime === 'image/gif' ? 'image/png' : mime;
}

export function planUpload(input: PlanInput, limits: AssetLimits): ReducePlan {
  const { info, size } = input;
  if (info === null || !limits.accepted_mimes.includes(info.mime)) {
    return { kind: 'reject', reason: 'unsupported_type' };
  }
  const { width, height } = info;

  if (info.animated) {
    if (info.frames > limits.max_frames || info.durationMs > limits.max_animation_ms) {
      return { kind: 'reject', reason: 'animation_too_long' };
    }
    if (!fitsDimensions(width, height, limits))
      return { kind: 'reject', reason: 'animated_too_big' };
    if (size > limits.max_upload_bytes) return { kind: 'reject', reason: 'animated_too_heavy' };
    return { kind: 'send' };
  }

  const tooHeavy = size > limits.max_upload_bytes;
  if (fitsDimensions(width, height, limits) && !tooHeavy) return { kind: 'send' };
  // A GIF/WebP read partially may hide frames: never flatten it.
  if (info.truncated && (info.mime === 'image/gif' || info.mime === 'image/webp')) {
    return { kind: 'reject', reason: 'animated_too_heavy' };
  }
  if (width * height > MAX_DECODE_PIXELS) return { kind: 'reject', reason: 'too_big_to_reduce' };

  const bytesScale = tooHeavy ? Math.sqrt(limits.max_upload_bytes / size) * BYTES_MARGIN : 1;
  const scale = Math.min(dimensionScale(width, height, limits), bytesScale);
  return { kind: 'resize', scale, outputMime: outputMime(info.mime) };
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Target size of a decoded image for a scale, always within the dimension limits. */
export function scaledSize(
  width: number,
  height: number,
  scale: number,
  limits: AssetLimits,
): Size {
  const s = Math.min(scale, dimensionScale(width, height, limits));
  let w = Math.max(1, Math.min(limits.max_dimension_px, Math.floor(width * s)));
  let h = Math.max(1, Math.min(limits.max_dimension_px, Math.floor(height * s)));
  // Rounding can leave the product a few pixels over the limit.
  while (w * h > limits.max_total_pixels && (w > 1 || h > 1)) {
    if (w >= h) w--;
    else h--;
  }
  return { width: w, height: h };
}

/** Next scale after an encoding that produced `producedBytes` (> maxBytes). */
export function nextScale(scale: number, producedBytes: number, maxBytes: number): number {
  return scale * Math.sqrt(maxBytes / producedBytes) * 0.9;
}

/** "carte.gif" + image/png ⇒ "carte.png"; other names unchanged. */
export function renameForMime(fileName: string, mime: AssetMime): string {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[
    mime
  ];
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const current = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  if (current === ext || (ext === 'jpg' && current === 'jpeg')) return fileName;
  return `${base}.${ext}`;
}

/** Asset name proposed from a file name: no extension, trimmed, at most 120 characters. */
export function assetNameFromFile(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[_]+/g, ' ').trim();
  return (base === '' ? fileName : base).slice(0, 120);
}
