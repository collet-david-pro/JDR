import { describe, expect, it } from 'vitest';
import {
  ANIMATION_PIXEL_BUDGET,
  animationScale,
  canDecodeAnimations,
  frameAt,
  frameDelay,
  frameTiming,
} from '../../src/engine/scene/image-animation';

describe('animated images: frame timing', () => {
  it('normalizes missing or tiny delays to 100 ms, like the browsers', () => {
    expect(frameDelay(null)).toBe(100);
    expect(frameDelay(undefined)).toBe(100);
    expect(frameDelay(0)).toBe(100);
    expect(frameDelay(10)).toBe(100);
    expect(frameDelay(NaN)).toBe(100);
    expect(frameDelay(40)).toBe(40);
    expect(frameTiming([50, 0, 150])).toEqual({ delays: [50, 100, 150], total: 300 });
  });

  it('picks the frame at a time, looping, with the time left before the next one', () => {
    const timing = frameTiming([50, 100, 150]);
    expect(frameAt(timing, 0)).toEqual({ index: 0, nextInMs: 50 });
    expect(frameAt(timing, 49)).toEqual({ index: 0, nextInMs: 1 });
    expect(frameAt(timing, 50)).toEqual({ index: 1, nextInMs: 100 });
    expect(frameAt(timing, 200)).toEqual({ index: 2, nextInMs: 100 });
    expect(frameAt(timing, 310)).toEqual({ index: 0, nextInMs: 40 });
    expect(frameAt(timing, 3_000_000_175)).toEqual({ index: 2, nextInMs: 125 });
    expect(frameAt(timing, -10).index).toBe(2);
  });

  it('never changes a single frame', () => {
    expect(frameAt(frameTiming([80]), 1234)).toEqual({ index: 0, nextInMs: Infinity });
    expect(frameAt(frameTiming([]), 5)).toEqual({ index: 0, nextInMs: Infinity });
  });
});

describe('animated images: decoded size', () => {
  it('keeps the native size when it fits the GPU and the memory budget', () => {
    expect(animationScale(256, 256, 20, 4096)).toBe(1);
  });

  it('reduces to the GPU limit and to the memory budget', () => {
    expect(animationScale(8192, 4096, 2, 4096)).toBe(0.5);
    const k = animationScale(2000, 2000, 40, 8192);
    expect(k).toBeLessThan(1);
    expect(2000 * 2000 * k * k * 40).toBeLessThanOrEqual(ANIMATION_PIXEL_BUDGET + 1);
  });

  it('gives up (first frame only) on a single frame or a too large animation', () => {
    expect(animationScale(256, 256, 1, 4096)).toBe(0);
    expect(animationScale(4000, 4000, 500, 8192)).toBe(0);
    expect(animationScale(0, 256, 10, 4096)).toBe(0);
  });

  it('detects the WebCodecs decoder', () => {
    expect(canDecodeAnimations()).toBe(typeof globalThis.ImageDecoder === 'function');
  });
});
