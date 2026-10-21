import { describe, expect, it } from 'vitest';
import type { ImageInfo } from '../src/lib/assets/image-info';
import {
  MAX_DECODE_PIXELS,
  assetNameFromFile,
  dimensionScale,
  nextScale,
  planUpload,
  renameForMime,
  scaledSize,
} from '../src/lib/assets/reduce-plan';
import type { AssetLimits } from '../src/lib/types';

const MB = 1024 * 1024;
const limits: AssetLimits = {
  max_upload_bytes: 10 * MB,
  max_dimension_px: 4096,
  max_total_pixels: 4096 * 4096,
  max_frames: 300,
  max_animation_ms: 60_000,
  accepted_mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
};

function info(partial: Partial<ImageInfo>): ImageInfo {
  return {
    mime: 'image/png',
    width: 100,
    height: 100,
    animated: false,
    frames: 1,
    durationMs: 0,
    truncated: false,
    ...partial,
  };
}

describe('planUpload', () => {
  it('sends images within the limits unchanged', () => {
    expect(planUpload({ size: MB, info: info({}) }, limits)).toEqual({ kind: 'send' });
  });

  it('refuses unknown and non-accepted types before sending', () => {
    expect(planUpload({ size: 10, info: null }, limits)).toEqual({
      kind: 'reject',
      reason: 'unsupported_type',
    });
    const noWebp = { ...limits, accepted_mimes: ['image/png'] };
    expect(planUpload({ size: 10, info: info({ mime: 'image/webp' }) }, noWebp)).toMatchObject({
      reason: 'unsupported_type',
    });
  });

  it('resizes a static image that is too large (dimensions)', () => {
    const plan = planUpload({ size: MB, info: info({ width: 8192, height: 4096 }) }, limits);
    expect(plan).toEqual({ kind: 'resize', scale: 0.5, outputMime: 'image/png' });
  });

  it('resizes a static image that is too heavy, keeping the format', () => {
    const plan = planUpload(
      { size: 40 * MB, info: info({ mime: 'image/jpeg', width: 3000, height: 2000 }) },
      limits,
    );
    expect(plan.kind).toBe('resize');
    if (plan.kind !== 'resize') return;
    expect(plan.outputMime).toBe('image/jpeg');
    expect(plan.scale).toBeCloseTo(Math.sqrt(10 / 40) * 0.95, 5);
  });

  it('turns a static GIF into PNG when it must be reduced', () => {
    const plan = planUpload({ size: MB, info: info({ mime: 'image/gif', width: 5000 }) }, limits);
    expect(plan).toMatchObject({ kind: 'resize', outputMime: 'image/png' });
  });

  it('never reduces animations: explicit refusals', () => {
    const anim = { mime: 'image/gif' as const, animated: true, frames: 10, durationMs: 1000 };
    expect(planUpload({ size: MB, info: info(anim) }, limits)).toEqual({ kind: 'send' });
    expect(planUpload({ size: 11 * MB, info: info(anim) }, limits)).toMatchObject({
      reason: 'animated_too_heavy',
    });
    expect(planUpload({ size: MB, info: info({ ...anim, width: 5000 }) }, limits)).toMatchObject({
      reason: 'animated_too_big',
    });
    expect(planUpload({ size: MB, info: info({ ...anim, frames: 1000 }) }, limits)).toMatchObject({
      reason: 'animation_too_long',
    });
    expect(
      planUpload({ size: MB, info: info({ ...anim, durationMs: 61_000 }) }, limits),
    ).toMatchObject({ reason: 'animation_too_long' });
  });

  it('does not flatten a partially read GIF/WebP and refuses absurd sizes', () => {
    expect(
      planUpload({ size: 80 * MB, info: info({ mime: 'image/gif', truncated: true }) }, limits),
    ).toMatchObject({ reason: 'animated_too_heavy' });
    expect(
      planUpload({ size: MB, info: info({ width: 20_000, height: 20_000 }) }, limits),
    ).toMatchObject({ reason: 'too_big_to_reduce' });
    expect(20_000 * 20_000).toBeGreaterThan(MAX_DECODE_PIXELS);
  });
});

describe('target size computations', () => {
  it('dimensionScale respects width, height and total pixels', () => {
    expect(dimensionScale(100, 100, limits)).toBe(1);
    expect(dimensionScale(8192, 100, limits)).toBe(0.5);
    const small = { ...limits, max_total_pixels: 10_000 };
    expect(dimensionScale(200, 200, small)).toBeCloseTo(0.5, 10);
  });

  it('scaledSize floors, stays ≥ 1 px and within the limits', () => {
    expect(scaledSize(8000, 6000, 0.5, limits)).toEqual({ width: 4000, height: 3000 });
    expect(scaledSize(10_000, 3, 0.1, limits)).toEqual({ width: 1000, height: 1 });
    const size = scaledSize(5000, 5000, 1, limits);
    expect(size.width).toBeLessThanOrEqual(4096);
    expect(size.width * size.height).toBeLessThanOrEqual(limits.max_total_pixels);
    const tight = { ...limits, max_total_pixels: 1000 };
    const t = scaledSize(333, 31, 1, tight);
    expect(t.width * t.height).toBeLessThanOrEqual(1000);
  });

  it('nextScale shrinks proportionally to the overshoot', () => {
    expect(nextScale(1, 40, 10)).toBeCloseTo(0.45, 10);
    expect(nextScale(0.5, 11, 10)).toBeLessThan(0.5);
  });

  it('renames files whose format changed and derives asset names', () => {
    expect(renameForMime('carte.gif', 'image/png')).toBe('carte.png');
    expect(renameForMime('photo.JPEG', 'image/jpeg')).toBe('photo.JPEG');
    expect(renameForMime('sans-extension', 'image/png')).toBe('sans-extension.png');
    expect(assetNameFromFile('mur_de_pierre.png')).toBe('mur de pierre');
    expect(assetNameFromFile('.png')).toBe('.png');
    expect(assetNameFromFile(`${'a'.repeat(200)}.png`)).toHaveLength(120);
  });
});
