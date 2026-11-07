import { describe, expect, it } from 'vitest';
import {
  calibratedGeometry,
  calibrationMap,
  coverGeometry,
  geometryFits,
  imageCellPx,
  mapFromImageSize,
  mapSizeFromImage,
  type Calibration,
} from '../../src/editor/images/calibration';

const mapCal = (axis: 'width' | 'height', cells: number): Calibration => ({
  mode: 'map_cells',
  cellPx: 70,
  cellsWide: 10,
  offsetX: 3,
  offsetY: 4,
  mapAxis: axis,
  mapCells: cells,
});

describe('background: size of the map wanted', () => {
  it('derives the other side from the image proportions, rounded to the nearest cell', () => {
    expect(mapSizeFromImage({ width: 2000, height: 1000 }, 'width', 30)).toEqual({
      width: 30,
      height: 15,
    });
    expect(mapSizeFromImage({ width: 2000, height: 1000 }, 'height', 15)).toEqual({
      width: 30,
      height: 15,
    });
    // 1000 x 700 at 25 cells wide: 17.5 -> 18; at 24: 16.8 -> 17; at 26: 18.2 -> 18.
    expect(mapSizeFromImage({ width: 1000, height: 700 }, 'width', 25)?.height).toBe(18);
    expect(mapSizeFromImage({ width: 1000, height: 700 }, 'width', 24)?.height).toBe(17);
    expect(mapSizeFromImage({ width: 1000, height: 700 }, 'width', 26)?.height).toBe(18);
    // The given side is rounded to a whole cell too.
    expect(mapSizeFromImage({ width: 1000, height: 1000 }, 'width', 12.4)).toEqual({
      width: 12,
      height: 12,
    });
  });

  it('bounds both sides to 1-400 cells and refuses unusable input', () => {
    expect(mapSizeFromImage({ width: 10000, height: 100 }, 'width', 50)).toEqual({
      width: 50,
      height: 1,
    });
    expect(mapSizeFromImage({ width: 100, height: 10000 }, 'width', 50)).toEqual({
      width: 50,
      height: 400,
    });
    expect(mapSizeFromImage({ width: 100, height: 100 }, 'width', 999)?.width).toBe(400);
    expect(mapSizeFromImage({ width: 100, height: 100 }, 'width', 0)).toBeNull();
    expect(mapSizeFromImage({ width: 100, height: 100 }, 'width', NaN)).toBeNull();
    expect(mapSizeFromImage({ width: 0, height: 100 }, 'width', 10)).toBeNull();
  });

  it('covers the whole map without distortion, centred', () => {
    // Exact proportions: the image is the map.
    expect(coverGeometry({ width: 2000, height: 1000 }, { width: 30, height: 15 })).toEqual({
      x: 0,
      y: 0,
      w: 30,
      h: 15,
      rotation: 0,
    });
    // 1000 x 700 on 25 x 18: scaled by height (18 / 700), 25.714 wide, centred.
    const g = coverGeometry({ width: 1000, height: 700 }, { width: 25, height: 18 })!;
    expect(g.h).toBe(18);
    expect(g.w).toBeCloseTo(25.714, 3);
    expect(g.x).toBeCloseTo(-0.357, 3);
    expect(g.y).toBe(0);
    expect(g.w / g.h).toBeCloseTo(1000 / 700, 3);
    // 1000 x 700 on 24 x 17: scaled by width, 16.8 -> covers 17 by scaling up to 17.
    const k = coverGeometry({ width: 1000, height: 700 }, { width: 24, height: 17 })!;
    expect(k.w).toBeGreaterThanOrEqual(24);
    expect(k.h).toBeGreaterThanOrEqual(17);
    expect(k.w / k.h).toBeCloseTo(1000 / 700, 3);
  });

  it('calibrates in map_cells mode: target map, geometry, image cell size', () => {
    const image = { width: 2000, height: 1000 };
    const c = mapCal('width', 40);
    expect(calibrationMap(c, image)).toEqual({ width: 40, height: 20 });
    // The offsets and the current map are ignored: the image covers the target map.
    expect(calibratedGeometry(c, image, { width: 10, height: 10 })).toEqual({
      x: 0,
      y: 0,
      w: 40,
      h: 20,
      rotation: 0,
    });
    expect(imageCellPx(c, image)).toBe(50);
    expect(calibrationMap({ ...c, mode: 'cell_px' }, image)).toBeNull();
  });

  it('tells whether the image can be sent before the resize (twice the current map at most)', () => {
    const g = coverGeometry({ width: 2000, height: 1000 }, { width: 40, height: 20 })!;
    expect(geometryFits(g, { width: 20, height: 10 })).toBe(true);
    expect(geometryFits(g, { width: 19, height: 10 })).toBe(false);
    expect(geometryFits(g, { width: 60, height: 60 })).toBe(true);
  });

  it('builds a new map from an image and the map size', () => {
    expect(mapFromImageSize({ width: 2100, height: 1400 }, 'width', 30)).toEqual({
      width: 30,
      height: 20,
      cellPx: 70,
      geometry: { x: 0, y: 0, w: 30, h: 20, rotation: 0 },
    });
    expect(mapFromImageSize({ width: 300, height: 300 }, 'height', 100)?.cellPx).toBe(16);
    expect(mapFromImageSize({ width: 300, height: 300 }, 'height', 0)).toBeNull();
  });
});
