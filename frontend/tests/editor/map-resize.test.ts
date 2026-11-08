import { describe, expect, it } from 'vitest';
import {
  anchorShift,
  lostByResize,
  objectFits,
  type ResizeSource,
} from '../../src/editor/map-resize';
import type { MapObject, PlacedToken } from '../../src/editor/contracts';

const from = { width: 10, height: 10 };

describe('resize anchor', () => {
  it('shifts nothing for the top-left corner', () => {
    expect(anchorShift('tl', from, { width: 20, height: 15 })).toEqual({ dx: 0, dy: 0 });
  });

  it('centres the old map in the new one (rounded down)', () => {
    expect(anchorShift('c', from, { width: 20, height: 15 })).toEqual({ dx: 5, dy: 2 });
  });

  it('pushes the content right and down for the bottom-right corner', () => {
    expect(anchorShift('br', from, { width: 20, height: 15 })).toEqual({ dx: 10, dy: 5 });
    expect(anchorShift('t', from, { width: 20, height: 15 })).toEqual({ dx: 5, dy: 0 });
    expect(anchorShift('l', from, { width: 20, height: 15 })).toEqual({ dx: 0, dy: 2 });
  });

  it('crops from the opposite side when the map shrinks', () => {
    expect(anchorShift('br', from, { width: 6, height: 7 })).toEqual({ dx: -4, dy: -3 });
    expect(anchorShift('c', from, { width: 6, height: 7 })).toEqual({ dx: -2, dy: -2 });
  });
});

const wall = (points: [number, number][]): MapObject =>
  ({ uid: 'w', type: 'wall', geometry: { points, closed: false } }) as unknown as MapObject;

describe('what leaves the map', () => {
  it('keeps a whole object, deletes one that sticks out', () => {
    const w = wall([
      [2, 2],
      [8, 2],
    ]);
    expect(objectFits(w, { dx: 0, dy: 0 }, 10, 10)).toBe(true);
    expect(objectFits(w, { dx: -3, dy: 0 }, 7, 10)).toBe(false);
    expect(objectFits(w, { dx: 5, dy: 2 }, 20, 15)).toBe(true);
  });

  it('counts objects, tokens and tiles of every floor', () => {
    const cells = new Uint16Array(32 * 32 * 4);
    cells[0] = 1; // (0, 0)
    cells[(9 * 32 + 9) * 4] = 2; // (9, 9)
    const source: ResizeSource = {
      floors: () => [{ uid: 'f' }],
      objectsOf: () => [
        wall([
          [2, 2],
          [8, 2],
        ]),
      ],
      tokensOf: () => [
        { uid: 't', x: 1, y: 1 } as PlacedToken,
        { uid: 'u', x: 9, y: 9 } as PlacedToken,
      ],
      chunkKeysOf: (_f, layer) => (layer === 'ground' ? ['0:0'] : []),
      chunkCellsOf: () => cells,
    };
    // Crop 3 on the top-left side: new map 7 x 7, everything moves by -3.
    expect(lostByResize(source, { dx: -3, dy: -3 }, 7, 7)).toEqual({
      objects: 1,
      tokens: 1,
      tiles: 1,
    });
    expect(lostByResize(source, { dx: 0, dy: 0 }, 20, 20)).toEqual({
      objects: 0,
      tokens: 0,
      tiles: 0,
    });
  });
});
