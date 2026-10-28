import { describe, expect, it } from 'vitest';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { selectionBounds, zoneFromSelection } from '../../src/lib/procgen/zone-from-map';
import { grid, palette } from '../editor/helpers';
import { wall } from '../editor/scene-helpers';

function doc(w = 20, h = 20): MapDocument {
  return new MapDocument({ grid: grid(w, h), palette: palette(3) });
}
function ground(d: MapDocument, cells: [number, number][]): void {
  d.apply([
    {
      type: 'tiles.set',
      floor: 'f1',
      layer: 'ground',
      cells: cells.map(([x, y]) => [x, y, 1, 0, 0]),
    },
  ]);
}

describe('selectionBounds', () => {
  it('is the envelope of the rectangles, null when empty', () => {
    expect(selectionBounds([])).toBeNull();
    expect(
      selectionBounds([
        { x: 2, y: 3, w: 2, h: 2 },
        { x: 6, y: 1, w: 1, h: 1 },
      ]),
    ).toEqual({ x: 2, y: 1, w: 5, h: 4 });
  });
});

describe('zoneFromSelection', () => {
  it('has no opening on an empty map', () => {
    expect(zoneFromSelection(doc(), 'f1', { x: 5, y: 5, w: 6, h: 4 })).toEqual({
      width: 6,
      height: 4,
      openings: [],
    });
  });

  it('opens where the outer neighbour has ground (local coordinates)', () => {
    const d = doc();
    ground(d, [
      [4, 6], // left of the rect, row 1
      [7, 4], // above, column 2
      [11, 8], // right, row 3
      [8, 9], // below, column 3
      [4, 4], // diagonal: not adjacent
    ]);
    const z = zoneFromSelection(d, 'f1', { x: 5, y: 5, w: 6, h: 4 });
    expect(z.openings).toEqual([
      [2, 0],
      [3, 3],
      [0, 1],
      [5, 3],
    ]);
  });

  it('a wall covering the common edge closes the opening', () => {
    const d = doc();
    ground(d, [
      [4, 6],
      [4, 7],
    ]);
    // Vertical wall on x = 5 covering y 6..7 only (cell row 1 of the rect), row 2 stays open.
    d.apply([
      {
        type: 'object.add',
        object: wall('w', [
          [5, 6],
          [5, 7],
        ]),
      },
    ]);
    const z = zoneFromSelection(d, 'f1', { x: 5, y: 5, w: 6, h: 4 });
    expect(z.openings).toEqual([[0, 2]]);
    // Walls of another floor do not count.
    expect(zoneFromSelection(d, 'f2', { x: 5, y: 5, w: 6, h: 4 }).openings).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });

  it('a closed wall also closes its last segment', () => {
    const d = doc();
    ground(d, [[7, 4]]);
    d.apply([
      {
        type: 'object.add',
        object: wall(
          'w',
          [
            [6, 5],
            [6, 3],
            [8, 3],
            [8, 5],
          ],
          true,
        ),
      },
    ]);
    // Closing segment (8,5)->(6,5) lies on y = 5, covering the cell x = 7.
    expect(zoneFromSelection(d, 'f1', { x: 5, y: 5, w: 6, h: 4 }).openings).toEqual([]);
  });

  it('clips to the grid: no opening towards outside, corner cells counted once', () => {
    const d = doc(10, 10);
    ground(d, [
      [0, 1],
      [1, 0],
    ]);
    const z = zoneFromSelection(d, 'f1', { x: 1, y: 1, w: 30, h: 30 });
    expect(z.width).toBe(9);
    expect(z.height).toBe(9);
    expect(z.openings).toEqual([[0, 0]]);
    const full = zoneFromSelection(d, 'f1', { x: -3, y: -3, w: 30, h: 30 });
    expect(full).toEqual({ width: 10, height: 10, openings: [] });
  });
});
