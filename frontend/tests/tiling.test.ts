import { describe, expect, it } from 'vitest';
import type { ImageInfo } from '../src/lib/assets/image-info';
import type { Rasterizer } from '../src/lib/assets/reduce';
import {
  cutTiles,
  planTiles,
  tileFileName,
  tileSide,
  tilingDecision,
} from '../src/lib/assets/tiling';
import type { AssetLimits } from '../src/lib/types';

const limits: AssetLimits = {
  max_upload_bytes: 10_000_000,
  max_dimension_px: 4096,
  max_total_pixels: 16_777_216,
  max_frames: 300,
  max_animation_ms: 20_000,
  accepted_mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
};

const info = (width: number, height: number, over: Partial<ImageInfo> = {}): ImageInfo => ({
  mime: 'image/png',
  width,
  height,
  animated: false,
  frames: 1,
  durationMs: 0,
  truncated: false,
  ...over,
});

describe('planTiles', () => {
  it('keeps one tile for an image within the side', () => {
    expect(planTiles(4096, 100, 4096)).toEqual([{ x: 0, y: 0, w: 4096, h: 100 }]);
  });

  it('covers the image with 1 px overlaps and no tile over the side', () => {
    for (const [w, h] of [
      [4097, 10],
      [8192, 5000],
      [12000, 9000],
      [4096 * 2 - 1, 4096 * 3 - 2],
    ] as const) {
      const tiles = planTiles(w, h, 4096);
      const covered = new Set<string>();
      for (const t of tiles) {
        expect(t.w).toBeLessThanOrEqual(4096);
        expect(t.h).toBeLessThanOrEqual(4096);
        expect(t.w).toBeGreaterThan(1);
        expect(t.x + t.w).toBeLessThanOrEqual(w);
        expect(t.y + t.h).toBeLessThanOrEqual(h);
        covered.add(`${t.x}`);
      }
      expect(Math.max(...tiles.map((t) => t.x + t.w))).toBe(w);
      expect(Math.max(...tiles.map((t) => t.y + t.h))).toBe(h);
      // neighbours overlap by exactly one pixel
      const xs = [...new Set(tiles.map((t) => t.x))].sort((a, b) => a - b);
      const first = tiles.find((t) => t.x === xs[0] && t.y === 0)!;
      if (xs.length > 1) expect(first.x + first.w - xs[1]!).toBe(1);
    }
  });

  it('is row-major', () => {
    const tiles = planTiles(5000, 5000, 4096);
    expect(tiles.map((t) => [t.x, t.y])).toEqual([
      [0, 0],
      [4095, 0],
      [0, 4095],
      [4095, 4095],
    ]);
  });
});

describe('tilingDecision', () => {
  it('cuts static images over the side only', () => {
    expect(tilingDecision(info(4096, 4096), limits)).toBe('single');
    expect(tilingDecision(info(4097, 100), limits)).toBe('tiles');
    expect(tilingDecision(info(9000, 7000), limits)).toBe('tiles');
  });

  it('never cuts animations, refuses what the browser cannot decode', () => {
    expect(tilingDecision(info(9000, 100, { animated: true, frames: 3 }), limits)).toBe('single');
    expect(tilingDecision(info(20000, 20000), limits)).toBe('reject');
    expect(tilingDecision(null, limits)).toBe('single');
  });

  it('follows the pixel budget of the server', () => {
    const small = { ...limits, max_total_pixels: 1_000_000 };
    expect(tileSide(small)).toBe(1000);
    expect(tilingDecision(info(1500, 10), small)).toBe('tiles');
  });
});

describe('cutTiles', () => {
  function fake(
    width: number,
    height: number,
    sizes: (mime: string, q: number) => number,
  ): {
    rasterizer: Rasterizer;
    calls: string[];
  } {
    const calls: string[] = [];
    return {
      calls,
      rasterizer: {
        open: async () => ({
          width,
          height,
          encode: async () => new Blob([]),
          encodeRegion: async (r, mime, q) => {
            calls.push(`${r.x},${r.y},${r.width}x${r.height},${mime},${q}`);
            return new Blob([new Uint8Array(sizes(mime, q))], { type: mime });
          },
          close: () => undefined,
        }),
      },
    };
  }
  const file = new File([new Uint8Array(4)], 'carte.png', { type: 'image/png' });

  it('emits every tile one by one with a numbered name', async () => {
    const { rasterizer } = fake(5000, 4100, () => 10);
    const names: string[] = [];
    const plan = await cutTiles(
      file,
      info(5000, 4100),
      limits,
      async (t) => void names.push(t.fileName),
      rasterizer,
    );
    expect(plan).toHaveLength(4);
    expect(names).toEqual(['carte_r1c1.png', 'carte_r1c2.png', 'carte_r2c1.png', 'carte_r2c2.png']);
  });

  it('falls back to WebP when a PNG tile is too heavy', async () => {
    const { rasterizer, calls } = fake(5000, 100, (mime) =>
      mime === 'image/png' ? 20_000_000 : 5_000_000,
    );
    const names: string[] = [];
    await cutTiles(
      file,
      info(5000, 100),
      limits,
      async (t) => void names.push(t.fileName),
      rasterizer,
    );
    expect(calls[0]).toContain('image/png');
    expect(calls[1]).toContain('image/webp');
    expect(names[0]).toBe('carte_r1c1.webp');
  });

  it('refuses a tile that stays too heavy', async () => {
    const { rasterizer } = fake(5000, 100, () => 50_000_000);
    await expect(
      cutTiles(file, info(5000, 100), limits, async () => undefined, rasterizer),
    ).rejects.toThrow('reduce_failed');
  });
});

describe('tileFileName', () => {
  it('replaces the extension', () => {
    expect(tileFileName('Donjon.final.jpeg', 'image/jpeg', 0, 2)).toBe('Donjon.final_r1c3.jpg');
  });
});
