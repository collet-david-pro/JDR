/**
 * Animated image objects (GIF / WebP of the library): frame timing (pure) and decoding of every
 * frame with the WebCodecs ImageDecoder. Without ImageDecoder (older browsers) or when decoding
 * fails, the caller keeps the first frame. Frames are decoded once per asset URL, at a reduced
 * size when the animation would not fit the GPU texture limit or the memory budget.
 */
import type { Texture } from '../pixi';

/** Delays at or below this are shown at DEFAULT_DELAY_MS, like the browsers do for GIF. */
const MIN_DELAY_MS = 10;
const DEFAULT_DELAY_MS = 100;
/** Most frames decoded per animation. */
export const ANIMATION_MAX_FRAMES = 500;
/** Pixel budget of one decoded animation (all frames), ~128 MB of RGBA. */
export const ANIMATION_PIXEL_BUDGET = 32_000_000;
/** Below this scale the animation is not worth it: the first frame stays. */
const MIN_SCALE = 0.2;

export interface FrameTiming {
  /** Delay of each frame, ms (normalized). */
  readonly delays: readonly number[];
  /** Sum of the delays, ms. */
  readonly total: number;
}

export interface DecodedAnimation extends FrameTiming {
  readonly frames: readonly Texture[];
  readonly bitmaps: readonly ImageBitmap[];
}

/** Normalized delay of one frame, ms (missing / tiny delays become 100 ms). */
export function frameDelay(ms: number | null | undefined): number {
  return ms === null || ms === undefined || !Number.isFinite(ms) || ms <= MIN_DELAY_MS
    ? DEFAULT_DELAY_MS
    : ms;
}

export function frameTiming(delays: readonly (number | null | undefined)[]): FrameTiming {
  const d = delays.map(frameDelay);
  return { delays: d, total: d.reduce((a, b) => a + b, 0) };
}

/**
 * Frame shown at time `t` (ms, looping) and the time left before the next one (ms).
 * One frame (or none): index 0, never changes (Infinity).
 */
export function frameAt(timing: FrameTiming, t: number): { index: number; nextInMs: number } {
  const n = timing.delays.length;
  if (n <= 1 || !(timing.total > 0)) return { index: 0, nextInMs: Infinity };
  let rest = ((t % timing.total) + timing.total) % timing.total;
  for (let i = 0; i < n; i++) {
    const d = timing.delays[i]!;
    if (rest < d) return { index: i, nextInMs: d - rest };
    rest -= d;
  }
  return { index: n - 1, nextInMs: timing.delays[n - 1]! };
}

/** Scale of the decoded frames (1 = native size), or 0 when the animation is not kept. */
export function animationScale(
  width: number,
  height: number,
  frames: number,
  maxTexture: number,
  budget = ANIMATION_PIXEL_BUDGET,
): number {
  if (!(width > 0) || !(height > 0) || frames < 2) return 0;
  const side = Math.max(width, height);
  const gpu = side > maxTexture && maxTexture > 0 ? maxTexture / side : 1;
  const mem = Math.sqrt(budget / (width * height * frames));
  const k = Math.min(1, gpu, mem);
  return k < MIN_SCALE ? 0 : k;
}

/** True when this browser can decode animations (WebCodecs ImageDecoder). */
export function canDecodeAnimations(): boolean {
  return typeof globalThis.ImageDecoder === 'function';
}

/**
 * Decodes every frame of an animated image; null when it has a single frame, cannot be decoded
 * here, or is too large. `alive()` false aborts (the renderer was destroyed). `toTexture` makes
 * the GPU texture of a frame (Texture.from; injected so that this module stays free of Pixi).
 */
export async function decodeAnimation(
  url: string,
  size: { readonly width: number; readonly height: number },
  maxTexture: number,
  alive: () => boolean,
  toTexture: (bitmap: ImageBitmap) => Texture,
): Promise<DecodedAnimation | null> {
  if (!canDecodeAnimations()) return null;
  const response = await fetch(url, { credentials: 'same-origin' });
  const type = (response.headers.get('Content-Type') ?? '').split(';')[0]!.trim();
  if (type === '' || !(await ImageDecoder.isTypeSupported(type))) return null;
  const decoder = new ImageDecoder({ data: await response.arrayBuffer(), type });
  const bitmaps: ImageBitmap[] = [];
  const delays: number[] = [];
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const count = Math.min(ANIMATION_MAX_FRAMES, decoder.tracks.selectedTrack?.frameCount ?? 0);
    const scale = animationScale(size.width, size.height, count, maxTexture);
    if (scale === 0) return null;
    const resizeWidth = Math.max(1, Math.floor(size.width * scale));
    const resizeHeight = Math.max(1, Math.floor(size.height * scale));
    for (let i = 0; i < count; i++) {
      if (!alive()) throw new Error('aborted');
      const { image } = await decoder.decode({ frameIndex: i });
      try {
        delays.push(image.duration === null ? DEFAULT_DELAY_MS : image.duration / 1000);
        bitmaps.push(
          await createImageBitmap(
            image,
            scale < 1 ? { resizeWidth, resizeHeight, resizeQuality: 'high' } : {},
          ),
        );
      } finally {
        image.close();
      }
    }
  } catch {
    for (const b of bitmaps) b.close();
    return null;
  } finally {
    decoder.close();
  }
  if (bitmaps.length < 2) {
    for (const b of bitmaps) b.close();
    return null;
  }
  return { ...frameTiming(delays), frames: bitmaps.map(toTexture), bitmaps };
}

/** Frees the textures and bitmaps of a decoded animation. */
export function releaseAnimation(anim: DecodedAnimation): void {
  for (const t of anim.frames) t.destroy(true);
  for (const b of anim.bitmaps) b.close();
}
