import { describe, expect, it } from 'vitest';
import {
  cropRect,
  defaultDesign,
  panCrop,
  parseDesign,
  serializeDesign,
  sourceSize,
  zoomCrop,
  ZOOM_MAX,
  type PortraitCrop,
} from '../../src/lib/player-tokens/design';
import { EMBLEM_IDS } from '../../src/lib/player-tokens/emblems';

const covers = (r: { dx: number; dy: number; dw: number; dh: number }, box: number): boolean =>
  r.dx <= 1e-9 && r.dy <= 1e-9 && r.dx + r.dw >= box - 1e-9 && r.dy + r.dh >= box - 1e-9;

describe('design serialisation', () => {
  it('round-trips a design through JSON', () => {
    const d = defaultDesign();
    d.shape = 'hex';
    d.bg = '#112233';
    d.mode = 'portrait';
    d.emblem = 'wolf';
    d.crop = { zoom: 2.5, ox: -0.25, oy: 0.5 };
    const back = parseDesign(JSON.parse(serializeDesign(d)), EMBLEM_IDS);
    expect(back).toEqual(d);
  });

  it('is deterministic and small enough for the server limit', () => {
    const text = serializeDesign(defaultDesign());
    expect(serializeDesign(defaultDesign())).toBe(text);
    expect(text.length).toBeLessThan(600);
  });

  it('falls back on defaults for anything invalid', () => {
    const d = parseDesign(
      {
        shape: 'blob',
        bg: 'red',
        ringWidth: 9,
        emblem: 'nope',
        crop: { zoom: 99, ox: -7, oy: 'x' },
      },
      EMBLEM_IDS,
    );
    const base = defaultDesign();
    expect(d.shape).toBe(base.shape);
    expect(d.bg).toBe(base.bg);
    expect(d.ringWidth).toBe(0.25);
    expect(d.emblem).toBe(base.emblem);
    expect(d.crop).toEqual({ zoom: ZOOM_MAX, ox: -1, oy: 0 });
    expect(parseDesign(null, EMBLEM_IDS)).toEqual(base);
    expect(parseDesign('x', EMBLEM_IDS)).toEqual(base);
  });
});

describe('portrait crop geometry', () => {
  const sizes: [number, number][] = [
    [800, 600],
    [600, 800],
    [512, 512],
    [4000, 300],
  ];

  it('always covers the box, whatever the image, zoom and offset', () => {
    for (const [w, h] of sizes) {
      for (const zoom of [1, 1.7, 4]) {
        for (const o of [-1, -0.3, 0, 0.8, 1]) {
          const r = cropRect(w, h, { zoom, ox: o, oy: -o }, 100);
          expect(covers(r, 100)).toBe(true);
        }
      }
    }
  });

  it('centres a square image at zoom 1 exactly on the box', () => {
    expect(cropRect(512, 512, { zoom: 1, ox: 0, oy: 0 }, 100)).toEqual({
      dx: 0,
      dy: 0,
      dw: 100,
      dh: 100,
    });
  });

  it('pans by pointer pixels, stays clamped, and cannot move a non-overflowing axis', () => {
    const crop: PortraitCrop = { zoom: 2, ox: 0, oy: 0 };
    const moved = panCrop(800, 600, crop, 100, 25, 0);
    expect(moved.ox).toBeGreaterThan(0);
    expect(moved.oy).toBe(0);
    expect(covers(cropRect(800, 600, moved, 100), 100)).toBe(true);
    const huge = panCrop(800, 600, crop, 100, 1e6, -1e6);
    expect(huge.ox).toBe(1);
    expect(huge.oy).toBe(-1);
    // Square image at zoom 1: nothing to move.
    expect(panCrop(500, 500, { zoom: 1, ox: 0, oy: 0 }, 100, 40, 40)).toEqual({
      zoom: 1,
      ox: 0,
      oy: 0,
    });
  });

  it('the image follows the pointer: a drag to the right moves the picture right', () => {
    const before = cropRect(800, 600, { zoom: 2, ox: 0, oy: 0 }, 100);
    const after = cropRect(800, 600, panCrop(800, 600, { zoom: 2, ox: 0, oy: 0 }, 100, 10, 0), 100);
    expect(after.dx - before.dx).toBeCloseTo(10, 6);
  });

  it('zooming keeps the picture covering the box and keeps the centre point', () => {
    const start: PortraitCrop = { zoom: 1.5, ox: 0.4, oy: -0.2 };
    const z = zoomCrop(800, 600, start, 100, 3);
    expect(z.zoom).toBe(3);
    expect(covers(cropRect(800, 600, z, 100), 100)).toBe(true);
    expect(zoomCrop(800, 600, start, 100, 50).zoom).toBe(ZOOM_MAX);
    expect(zoomCrop(800, 600, start, 100, 0.1).zoom).toBe(1);
  });

  it('downsizes the stored source without upscaling', () => {
    expect(sourceSize(4000, 2000)).toEqual({ w: 1024, h: 512 });
    expect(sourceSize(300, 200)).toEqual({ w: 300, h: 200 });
  });
});
