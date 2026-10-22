import { describe, expect, it } from 'vitest';
import { cellSprite } from '../../src/engine/cell-transform';
import { fallbackColor } from '../../src/engine/fallback-color';
import { computeGridLines } from '../../src/engine/grid-lines';
import { GRID_THEMES } from '../../src/engine/grid-themes';
import {
  cellDraw,
  fallbackTilePixels,
  frameRect,
  gridLinePlan,
  mapImagePoint,
} from '../../src/export/cell-render';
import type { TileImages, TileSource } from '../../src/export/images';
import { ExportScene } from '../../src/export/renderer';
import type { MapSnapshot } from '../../src/export/scene';
import { FakeContext, fakeImage, type FakeImage } from './fake-canvas';

/** Engine placement of image point (u, v) for a cell (Pixi particle: anchor 0.5, scale, rotation). */
function enginePoint(
  lx: number,
  ly: number,
  cellPx: number,
  fw: number,
  fh: number,
  flags: number,
  u: number,
  v: number,
): { x: number; y: number } {
  const s = cellSprite(lx, ly, cellPx, fw, fh, flags);
  const px = (u - 0.5) * fw * s.scaleX;
  const py = (v - 0.5) * fh * s.scaleY;
  const c = Math.cos(s.rotation);
  const n = Math.sin(s.rotation);
  return { x: s.x + c * px - n * py, y: s.y + n * px + c * py };
}

describe('cellDraw vs engine cellSprite', () => {
  it('maps the image corners like the engine for every flag combination', () => {
    for (let flags = 0; flags < 16; flags++) {
      for (const [lx, ly] of [
        [0, 0],
        [3, 5],
      ] as const) {
        const draw = cellDraw(lx, ly, 70, flags);
        for (const [u, v] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
          [0.25, 0.75],
        ] as const) {
          const mine = mapImagePoint(draw, u, v);
          const engine = enginePoint(lx, ly, 70, 32, 48, flags, u, v);
          expect(mine.x).toBeCloseTo(engine.x, 9);
          expect(mine.y).toBeCloseTo(engine.y, 9);
        }
      }
    }
  });

  it('snaps edges to whole pixels without gaps at fractional scales', () => {
    const ppc = 27.03;
    let x = 0;
    for (let c = 0; c < 40; c++) {
      const d = cellDraw(c, 0, ppc, 1);
      expect(d.x).toBe(x);
      expect(Number.isInteger(d.w)).toBe(true);
      x = d.x + d.w;
      // Odd quarter turn: the drawn size is swapped so the rotated image covers the cell.
      expect([d.dw, d.dh]).toEqual([d.h, d.w]);
    }
    expect(x).toBe(Math.round(40 * ppc));
  });

  it('variant frames: strips of square frames, other images ignore the variant', () => {
    expect(frameRect(96, 32, 4)).toEqual({ sx: 32, sy: 0, sw: 32, sh: 32 });
    expect(frameRect(64, 48, 3)).toEqual({ sx: 0, sy: 0, sw: 64, sh: 48 });
  });

  it('fallback tile = engine checkerboard tinted with fallbackColor', () => {
    const px = fallbackTilePixels(5, 2);
    const tint = fallbackColor(5, 2);
    expect([...px.subarray(0, 4)]).toEqual([
      (tint >> 16) & 255,
      (tint >> 8) & 255,
      tint & 255,
      255,
    ]);
    expect(px[4]).toBe(Math.round((((tint >> 16) & 255) * 0xb4) / 255));
    expect([...px.subarray(12, 16)]).toEqual([...px.subarray(0, 4)]);
  });
});

describe('gridLinePlan vs engine computeGridLines', () => {
  const grid = { width: 40, height: 30, cellPx: 70, unitLabel: '', unitPerCell: 1 };
  const theme = GRID_THEMES.parchment;
  for (const ppc of [70, 140, 280, 35, 10]) {
    it(`same lines as the preview at ${ppc} px per cell`, () => {
      const extent = { x: 3, y: 2, w: 20, h: 10 };
      const plan = gridLinePlan(extent, grid, ppc, theme);
      const L = Math.max(1, Math.round(ppc / 70));
      const camera = { x: extent.x + extent.w / 2, y: extent.y + extent.h / 2, zoom: ppc / 70 / L };
      const viewport = { width: (extent.w * ppc) / L, height: (extent.h * ppc) / L };
      const engine = computeGridLines(camera, viewport, grid, L);
      if (engine.fade === 0) {
        expect(plan).toBeNull();
        return;
      }
      const half = Math.round(L / 2);
      expect(plan!.thickness).toBe(L);
      expect(plan!.alpha).toBeCloseTo(theme.lineAlpha * engine.fade, 9);
      expect(plan!.xs).toEqual(engine.xs.map((x) => Math.round(x * L) - half));
      expect(plan!.ys).toEqual(engine.ys.map((y) => Math.round(y * L) - half));
    });
  }
});

/* ---- Renderer ------------------------------------------------------------------------------- */

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const WHITE = [255, 255, 255, 255];

/** 2×2 image: TL red, TR green, BL blue, BR white. */
const quad = fakeImage(2, 2, (x, y) =>
  y === 0 ? (x === 0 ? RED : GREEN) : x === 0 ? BLUE : WHITE,
);

function images(map: Record<number, FakeImage>): TileImages {
  return {
    failed: [],
    close: () => undefined,
    tile(index): TileSource {
      const img = map[index] ?? quad;
      return {
        image: img as unknown as CanvasImageSource,
        sx: 0,
        sy: 0,
        sw: img.width,
        sh: img.height,
        smooth: false,
      };
    },
  };
}

function snapshotOf(
  cells: [number, number, number, number, number][],
  opacity = 1,
  cellPx = 4,
): MapSnapshot {
  const chunk = new Uint16Array(32 * 32 * 4);
  for (const [x, y, index, variant, flags] of cells)
    chunk.set([index, variant, flags, 0], (y * 32 + x) * 4);
  return {
    grid: { width: 4, height: 3, cellPx },
    theme: 'light',
    layers: [{ id: 'ground', opacity, chunks: [['0:0', chunk]] }],
    palette: [],
  };
}

function pixel(ctx: FakeContext, x: number, y: number): number[] {
  return [
    ...ctx
      .getImageData(ctx.width, ctx.height)
      .subarray((y * ctx.width + x) * 4, (y * ctx.width + x) * 4 + 4),
  ];
}

describe('ExportScene', () => {
  const extent = { x: 0, y: 0, w: 4, h: 3 };

  it('draws tiles with rotation / mirrors like the engine (quarter turn clockwise)', () => {
    // Cell 0: no flag; cell 1: rotated 90° clockwise; cell 2: mirror H.
    const scene = new ExportScene(
      snapshotOf([
        [0, 0, 1, 0, 0],
        [1, 0, 1, 0, 1],
        [2, 0, 1, 0, 4],
      ]),
      extent,
      4,
      { grid: false, transparent: true },
      images({}),
    );
    const ctx = new FakeContext(16, 12);
    scene.draw(ctx, 0, 0, 16, 12);
    expect(pixel(ctx, 0, 0)).toEqual(RED);
    expect(pixel(ctx, 3, 3)).toEqual(WHITE);
    // 90° clockwise: top-left of the cell shows the image's bottom-left (blue).
    expect(pixel(ctx, 4, 0)).toEqual(BLUE);
    expect(pixel(ctx, 7, 0)).toEqual(RED);
    // Mirror H: top-left shows green.
    expect(pixel(ctx, 8, 0)).toEqual(GREEN);
    // Empty cell, transparent background.
    expect(pixel(ctx, 12, 0)).toEqual([0, 0, 0, 0]);
  });

  it('applies layer opacity over the theme background, then the grid', () => {
    const scene = new ExportScene(
      snapshotOf([[0, 0, 1, 0, 0]], 0.5),
      extent,
      4,
      { grid: true, transparent: false },
      images({ 1: fakeImage(1, 1, () => RED) }),
    );
    const ctx = new FakeContext(16, 12);
    scene.draw(ctx, 0, 0, 16, 12);
    const bg = GRID_THEMES.light.background;
    const r = (bg >> 16) & 255;
    expect(pixel(ctx, 1, 1)).toEqual([
      Math.round((255 + r) / 2),
      Math.round(((bg >> 8) & 255) / 2),
      Math.round((bg & 255) / 2),
      255,
    ]);
    // Grid line at x = 4 → pixel column 3 (engine: 1 px rect starting half a line before).
    const plan = gridLinePlan(
      extent,
      { width: 4, height: 3, cellPx: 4, unitLabel: '', unitPerCell: 1 },
      4,
      GRID_THEMES.light,
    );
    expect(plan).toBeNull(); // 4 px cells: lines faded out like the preview at that size
    const big = new ExportScene(
      snapshotOf([], 1, 16),
      extent,
      16,
      { grid: true, transparent: false },
      images({}),
    );
    const ctx2 = new FakeContext(64, 48);
    big.draw(ctx2, 0, 0, 64, 48);
    // ×1 at 16 px: 1 px line in column 15 (the engine's rect starts one pixel before x = 16).
    expect(pixel(ctx2, 15, 5)).not.toEqual(pixel(ctx2, 14, 5));
    expect(pixel(ctx2, 14, 5)).toEqual(pixel(ctx2, 16, 5));
    expect(pixel(ctx2, 15, 5)).toEqual(pixel(ctx2, 31, 7));
  });

  it('band by band (with offsets) equals one full render', () => {
    const snap = snapshotOf([
      [0, 0, 1, 0, 3],
      [1, 1, 1, 0, 6],
      [3, 2, 1, 0, 9],
    ]);
    const scene = new ExportScene(snap, extent, 7, { grid: true, transparent: false }, images({}));
    const full = new FakeContext(28, 21);
    scene.draw(full, 0, 0, 28, 21);
    const whole = full.getImageData(28, 21);
    const pieces = new FakeContext(28, 21);
    for (const [x, y, w, h] of [
      [0, 0, 13, 5],
      [13, 0, 15, 5],
      [0, 5, 28, 9],
      [0, 14, 28, 7],
    ] as const) {
      const band = new FakeContext(w, h);
      scene.draw(band, x, y, w, h);
      const px = band.getImageData(w, h);
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          for (let k = 0; k < 4; k++)
            pieces.data[((y + r) * 28 + x + c) * 4 + k] = px[(r * w + c) * 4 + k]! / 255;
        }
      }
    }
    expect(pieces.getImageData(28, 21)).toEqual(whole);
  });
});
