import { describe, expect, it, vi } from 'vitest';
import {
  UploadRejected,
  prepareFile,
  type RasterSource,
  type Rasterizer,
} from '../src/lib/assets/reduce';
import type { AssetLimits, AssetMime } from '../src/lib/types';
import { fileOf, gif, jpeg, png } from './fixtures/images';

const limits: AssetLimits = {
  max_upload_bytes: 1000,
  max_dimension_px: 1000,
  max_total_pixels: 1_000_000,
  max_frames: 100,
  max_animation_ms: 10_000,
  accepted_mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
};

/** Fake rasterizer: the encoded size is width × height × bytesPerPixel. */
function fakeRasterizer(
  width: number,
  height: number,
  bytesPerPixel: number,
  producedType?: string,
): Rasterizer & { calls: { width: number; height: number; mime: AssetMime; quality: number }[] } {
  const calls: { width: number; height: number; mime: AssetMime; quality: number }[] = [];
  const source: RasterSource = {
    width,
    height,
    encode: (w, h, mime, quality) => {
      calls.push({ width: w, height: h, mime, quality });
      const size = Math.ceil(w * h * bytesPerPixel);
      return Promise.resolve(new Blob([new Uint8Array(size)], { type: producedType ?? mime }));
    },
    close: vi.fn(),
  };
  return { calls, open: () => Promise.resolve(source) };
}

describe('prepareFile', () => {
  it('sends a compliant file untouched', async () => {
    const file = fileOf(png(100, 100), 'a.png', 500);
    const rasterizer = fakeRasterizer(100, 100, 0.01);
    const prepared = await prepareFile(file, limits, { rasterizer });
    expect(prepared.blob).toBe(file);
    expect(prepared.reduced).toBe(false);
    expect(rasterizer.calls).toHaveLength(0);
  });

  it('resizes an oversized static image in the same format, quality 0.9', async () => {
    const file = fileOf(jpeg(2000, 1000), 'photo.jpg', 800);
    const rasterizer = fakeRasterizer(2000, 1000, 0.0001);
    const onReduce = vi.fn();
    const prepared = await prepareFile(file, limits, { rasterizer, onReduce });
    expect(onReduce).toHaveBeenCalledOnce();
    expect(prepared.reduced).toBe(true);
    expect(prepared.fileName).toBe('photo.jpg');
    expect(rasterizer.calls).toEqual([
      { width: 1000, height: 500, mime: 'image/jpeg', quality: 0.9 },
    ]);
  });

  it('encodes again, smaller, while the result is too heavy', async () => {
    const file = fileOf(png(500, 500), 'big.png', 4000);
    // First estimate 237×237 at 0.03 B/px = 1685 B > 1000: several attempts are needed.
    const rasterizer = fakeRasterizer(500, 500, 0.03);
    const prepared = await prepareFile(file, limits, { rasterizer });
    expect(prepared.blob.size).toBeLessThanOrEqual(1000);
    expect(rasterizer.calls.length).toBeGreaterThan(1);
    const widths = rasterizer.calls.map((c) => c.width);
    expect([...widths].sort((a, b) => b - a)).toEqual(widths);
  });

  it('gives up after the maximum number of attempts', async () => {
    const file = fileOf(png(500, 500), 'huge.png', 4000);
    await expect(
      prepareFile(file, limits, { rasterizer: fakeRasterizer(500, 500, 1e6) }),
    ).rejects.toMatchObject({ reason: 'reduce_failed' });
  });

  it('converts a static GIF to PNG', async () => {
    const file = fileOf(gif(2000, 10, [0]), 'flat.gif');
    const rasterizer = fakeRasterizer(2000, 10, 0.001);
    const prepared = await prepareFile(file, limits, { rasterizer });
    expect(prepared.fileName).toBe('flat.png');
    expect(rasterizer.calls[0]?.mime).toBe('image/png');
  });

  it('refuses before sending: unknown type, heavy animation, undecodable file', async () => {
    const text = new File(['<svg/>'], 'x.png');
    await expect(prepareFile(text, limits)).rejects.toBeInstanceOf(UploadRejected);
    const anim = fileOf(gif(10, 10, [10, 10]), 'anim.gif', 5000);
    await expect(prepareFile(anim, limits)).rejects.toMatchObject({
      reason: 'animated_too_heavy',
    });
    const broken: Rasterizer = { open: () => Promise.reject(new Error('decode')) };
    await expect(
      prepareFile(fileOf(png(5000, 10), 'x.png'), limits, { rasterizer: broken }),
    ).rejects.toMatchObject({ reason: 'unreadable' });
  });

  it('refuses when the browser produced a non-accepted format', async () => {
    const file = fileOf(png(2000, 10), 'x.png');
    await expect(
      prepareFile(file, limits, { rasterizer: fakeRasterizer(2000, 10, 0.001, 'image/bmp') }),
    ).rejects.toMatchObject({ reason: 'reduce_failed' });
  });
});
