/**
 * Image header reader (pure, no decoding): real type from the binary signature, dimensions,
 * and for GIF / WebP the number of frames and the total duration. Mirrors the server checks
 * of projet.md 11.3 (steps 3 to 5) so that obviously refused files are not sent; the server
 * remains the authority.
 */

import type { AssetMime } from '../types';

export interface ImageInfo {
  readonly mime: AssetMime;
  readonly width: number;
  readonly height: number;
  /** More than one frame (GIF) or animation flag + ANMF chunks (WebP). APNG = static. */
  readonly animated: boolean;
  readonly frames: number;
  readonly durationMs: number;
  /** The bytes ended before the end of the image structure (partial read). */
  readonly truncated: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

const u8 = (b: Uint8Array, o: number): number => b[o] ?? 0;
const be16 = (b: Uint8Array, o: number): number => (u8(b, o) << 8) | u8(b, o + 1);
const le16 = (b: Uint8Array, o: number): number => u8(b, o) | (u8(b, o + 1) << 8);
const le24 = (b: Uint8Array, o: number): number => le16(b, o) | (u8(b, o + 2) << 16);
const be32 = (b: Uint8Array, o: number): number => be16(b, o) * 0x10000 + be16(b, o + 2);
const le32 = (b: Uint8Array, o: number): number => le16(b, o) + le16(b, o + 2) * 0x10000;

/** Real type by signature (PNG, JPEG, GIF, WebP), or null. Extension and MIME are ignored. */
export function sniffMime(bytes: Uint8Array): AssetMime | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  const head6 = ascii(bytes, 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Reads the header of an image; null when the type is unknown or the header unreadable. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  switch (sniffMime(bytes)) {
    case 'image/png':
      return readPng(bytes);
    case 'image/jpeg':
      return readJpeg(bytes);
    case 'image/gif':
      return readGif(bytes);
    case 'image/webp':
      return readWebp(bytes);
    default:
      return null;
  }
}

function staticInfo(mime: AssetMime, width: number, height: number): ImageInfo | null {
  if (width <= 0 || height <= 0) return null;
  return { mime, width, height, animated: false, frames: 1, durationMs: 0, truncated: false };
}

function readPng(b: Uint8Array): ImageInfo | null {
  // Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4).
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  // APNG is accepted as a static image (first frame) by the server (Q5).
  return staticInfo('image/png', be32(b, 16), be32(b, 20));
}

function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readJpeg(b: Uint8Array): ImageInfo | null {
  let offset = 2;
  while (offset + 4 <= b.length) {
    if (u8(b, offset) !== 0xff) return null;
    let marker = u8(b, offset + 1);
    // Fill bytes.
    while (marker === 0xff && offset + 2 < b.length) {
      offset++;
      marker = u8(b, offset + 1);
    }
    offset += 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // no length
    if (marker === 0xd9 || marker === 0xda) return null; // end / scan before any SOF
    const length = be16(b, offset);
    if (length < 2) return null;
    if (isSofMarker(marker)) {
      if (offset + 7 > b.length) return null;
      return staticInfo('image/jpeg', be16(b, offset + 5), be16(b, offset + 3));
    }
    offset += length;
  }
  return null;
}

/** Skips GIF data sub-blocks; returns the offset after the terminator, or -1 if truncated. */
function skipSubBlocks(b: Uint8Array, offset: number): number {
  let o = offset;
  while (o < b.length) {
    const size = u8(b, o);
    o += 1;
    if (size === 0) return o;
    o += size;
  }
  return -1;
}

function readGif(b: Uint8Array): ImageInfo | null {
  if (b.length < 13) return null;
  const width = le16(b, 6);
  const height = le16(b, 8);
  if (width <= 0 || height <= 0) return null;
  const packed = u8(b, 10);
  let o = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  let frames = 0;
  let durationMs = 0;
  let pendingDelay = 0;
  let truncated = true;

  while (o < b.length) {
    const block = u8(b, o);
    if (block === 0x3b) {
      truncated = false;
      break;
    }
    if (block === 0x21) {
      const label = u8(b, o + 1);
      if (label === 0xf9 && u8(b, o + 2) >= 4 && o + 6 < b.length) {
        pendingDelay = le16(b, o + 4) * 10;
      }
      const next = skipSubBlocks(b, o + 2);
      if (next < 0) break;
      o = next;
    } else if (block === 0x2c) {
      if (o + 10 > b.length) break;
      const local = u8(b, o + 9);
      o += 10 + (local & 0x80 ? 3 * 2 ** ((local & 0x07) + 1) : 0);
      o += 1; // LZW minimum code size
      const next = skipSubBlocks(b, o);
      frames++;
      durationMs += pendingDelay;
      pendingDelay = 0;
      if (next < 0) break;
      o = next;
    } else {
      return null; // invalid structure
    }
  }
  if (frames === 0 && !truncated) return null;
  return {
    mime: 'image/gif',
    width,
    height,
    animated: frames > 1,
    frames: Math.max(frames, 1),
    durationMs: frames > 1 ? durationMs : 0,
    truncated,
  };
}

function readWebp(b: Uint8Array): ImageInfo | null {
  let o = 12;
  let width = 0;
  let height = 0;
  let animatedFlag = false;
  let frames = 0;
  let durationMs = 0;
  let truncated = true;
  const riffEnd = Math.min(b.length, le32(b, 4) + 8);

  while (o + 8 <= riffEnd) {
    const fourcc = ascii(b, o, 4);
    const size = le32(b, o + 4);
    const p = o + 8;
    if (fourcc === 'VP8X' && p + 10 <= b.length) {
      animatedFlag = (u8(b, p) & 0x02) !== 0;
      width = le24(b, p + 4) + 1;
      height = le24(b, p + 7) + 1;
    } else if (fourcc === 'VP8 ' && width === 0 && p + 10 <= b.length) {
      width = le16(b, p + 6) & 0x3fff;
      height = le16(b, p + 8) & 0x3fff;
    } else if (fourcc === 'VP8L' && width === 0 && p + 5 <= b.length) {
      const bits = le32(b, p + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (fourcc === 'ANMF') {
      frames++;
      if (p + 15 <= b.length) durationMs += le24(b, p + 12);
    }
    o = p + size + (size % 2);
    if (o >= riffEnd) {
      truncated = riffEnd < le32(b, 4) + 8 || o > riffEnd;
      break;
    }
  }
  if (width <= 0 || height <= 0) return null;
  const animated = animatedFlag && frames > 1;
  return {
    mime: 'image/webp',
    width,
    height,
    animated,
    frames: animatedFlag ? Math.max(frames, 1) : 1,
    durationMs: animated ? durationMs : 0,
    truncated,
  };
}
