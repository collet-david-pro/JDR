import { describe, expect, it } from 'vitest';
import { readImageInfo, sniffMime } from '../src/lib/assets/image-info';
import { gif, jpeg, png, webpAnimated, webpLossless, webpLossy } from './fixtures/images';

describe('sniffMime', () => {
  it('recognises the four accepted signatures and nothing else', () => {
    expect(sniffMime(png(1, 1))).toBe('image/png');
    expect(sniffMime(jpeg(1, 1))).toBe('image/jpeg');
    expect(sniffMime(gif(1, 1, [0]))).toBe('image/gif');
    expect(sniffMime(webpLossless(1, 1))).toBe('image/webp');
    expect(sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
      null,
    );
    expect(sniffMime(new TextEncoder().encode('<?php echo 1;'))).toBe(null);
    expect(sniffMime(new Uint8Array([]))).toBe(null);
  });
});

describe('readImageInfo', () => {
  it('reads PNG dimensions (APNG treated as static)', () => {
    expect(readImageInfo(png(800, 600))).toMatchObject({
      mime: 'image/png',
      width: 800,
      height: 600,
      animated: false,
      frames: 1,
    });
  });

  it('reads JPEG dimensions from the SOF segment', () => {
    expect(readImageInfo(jpeg(4000, 3000))).toMatchObject({
      mime: 'image/jpeg',
      width: 4000,
      height: 3000,
    });
  });

  it('counts GIF frames and sums the delays', () => {
    const info = readImageInfo(gif(64, 32, [10, 20, 30]));
    expect(info).toMatchObject({
      mime: 'image/gif',
      width: 64,
      height: 32,
      animated: true,
      frames: 3,
      durationMs: 600,
      truncated: false,
    });
  });

  it('treats a one-frame GIF as static and flags a truncated GIF', () => {
    expect(readImageInfo(gif(10, 10, [50]))).toMatchObject({ animated: false, durationMs: 0 });
    expect(readImageInfo(gif(10, 10, [5, 5], false))).toMatchObject({
      animated: true,
      truncated: true,
    });
  });

  it('reads lossy, lossless and animated WebP', () => {
    expect(readImageInfo(webpLossy(320, 200))).toMatchObject({ width: 320, height: 200 });
    expect(readImageInfo(webpLossless(5000, 7))).toMatchObject({
      width: 5000,
      height: 7,
      animated: false,
    });
    expect(readImageInfo(webpAnimated(128, 96, [100, 100, 250]))).toMatchObject({
      width: 128,
      height: 96,
      animated: true,
      frames: 3,
      durationMs: 450,
    });
  });

  it('returns null for unknown or broken data', () => {
    expect(readImageInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(readImageInfo(new TextEncoder().encode('hello'))).toBeNull();
  });
});
