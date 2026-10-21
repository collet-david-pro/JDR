import { describe, expect, it } from 'vitest';
import {
  clampOffset,
  firstFreeCell,
  GRID_MAX_RADIUS,
  GRID_MIN_RADIUS,
  gridCells,
  gridRadius,
  moveCell,
  nudgeToken,
  parseOffset,
  placeToken,
  prunePlacements,
  removeToken,
  tokensAt,
  validateEncounter,
} from '../src/lib/games/encounter-grid';
import type { EncounterToken } from '../src/lib/types';

const p = (token_id: string, dx: number, dy: number): EncounterToken => ({ token_id, dx, dy });

describe('encounter grid geometry', () => {
  it('grows the grid to show every placement, within limits', () => {
    expect(gridRadius([])).toBe(GRID_MIN_RADIUS);
    expect(gridRadius([p('a', -5, 2)])).toBe(5);
    expect(gridRadius([p('a', 0, 4.6)])).toBe(5);
    expect(gridRadius([p('a', 500, 0)])).toBe(GRID_MAX_RADIUS);
  });

  it('lists the cells row by row around the origin', () => {
    const rows = gridCells(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([
      { dx: -1, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: -1 },
    ]);
    expect(rows[1]?.[1]).toEqual({ dx: 0, dy: 0 });
  });

  it('finds the tokens of a cell (offsets rounded to the nearest cell)', () => {
    const list = [p('a', 0, 0), p('b', 0.4, -0.2), p('c', 1, 0)];
    expect(tokensAt(list, { dx: 0, dy: 0 })).toEqual(['a', 'b']);
    expect(tokensAt(list, { dx: 1, dy: 0 })).toEqual(['c']);
    expect(tokensAt(list, { dx: -1, dy: 0 })).toEqual([]);
  });
});

describe('encounter composition', () => {
  it('places a token once (moving it when already placed)', () => {
    let list = placeToken([], 'a', 1, 2);
    list = placeToken(list, 'b', 0, 0);
    list = placeToken(list, 'a', -1, 0);
    expect(list).toEqual([p('a', -1, 0), p('b', 0, 0)]);
  });

  it('removes, nudges and prunes placements', () => {
    const list = [p('a', 0, 0), p('b', 2, 2)];
    expect(removeToken(list, 'a')).toEqual([p('b', 2, 2)]);
    expect(nudgeToken(list, 'b', -1, 1)).toEqual([p('a', 0, 0), p('b', 1, 3)]);
    expect(nudgeToken(list, 'zz', 1, 1)).toEqual(list);
    expect(prunePlacements(list, new Set(['b']))).toEqual([p('b', 2, 2)]);
  });

  it('chooses the first free cell from the origin outwards', () => {
    expect(firstFreeCell([])).toEqual({ dx: 0, dy: 0 });
    expect(firstFreeCell([p('a', 0, 0)])).toEqual({ dx: -1, dy: -1 });
    expect(firstFreeCell([p('a', 0, 0), p('b', -1, -1)])).toEqual({ dx: 0, dy: -1 });
  });

  it('parses and clamps numeric offsets (DECIMAL(7,3))', () => {
    expect(parseOffset('-1,5')).toBe(-1.5);
    expect(parseOffset('0.12345')).toBe(0.123);
    expect(parseOffset('9999.999')).toBe(9999.999);
    expect(parseOffset('10000')).toBeNull();
    expect(parseOffset('abc')).toBeNull();
    expect(clampOffset(123456)).toBe(9999.999);
    expect(clampOffset(-0.0004)).toBe(0);
    expect(Object.is(clampOffset(-0.0004), -0)).toBe(false);
  });

  it('validates the encounter form', () => {
    expect(validateEncounter('  ', '', [])).toEqual({ ok: false, errors: { name: 'required' } });
    expect(validateEncounter('x'.repeat(121), 'n'.repeat(10001), [])).toEqual({
      ok: false,
      errors: { name: 'too_long', notes: 'too_long' },
    });
    const many = Array.from({ length: 101 }, (_, i) => p(String(i), 0, 0));
    expect(validateEncounter('E', '', many)).toMatchObject({ errors: { tokens: 'too_large' } });
    expect(validateEncounter(' Embuscade ', ' notes ', [p('a', 1, -1)])).toEqual({
      ok: true,
      input: { name: 'Embuscade', notes: 'notes', tokens: [p('a', 1, -1)] },
    });
  });
});

describe('encounter grid keyboard', () => {
  it('moves the focus with the arrow keys, clamped to the grid', () => {
    expect(moveCell({ dx: 0, dy: 0 }, 'ArrowRight', 3)).toEqual({ dx: 1, dy: 0 });
    expect(moveCell({ dx: 0, dy: 0 }, 'ArrowUp', 3)).toEqual({ dx: 0, dy: -1 });
    expect(moveCell({ dx: 3, dy: 0 }, 'ArrowRight', 3)).toEqual({ dx: 3, dy: 0 });
    expect(moveCell({ dx: 0, dy: -3 }, 'ArrowUp', 3)).toEqual({ dx: 0, dy: -3 });
  });

  it('jumps to row ends and corners', () => {
    expect(moveCell({ dx: 1, dy: 2 }, 'Home', 3)).toEqual({ dx: -3, dy: 2 });
    expect(moveCell({ dx: 1, dy: 2 }, 'End', 3)).toEqual({ dx: 3, dy: 2 });
    expect(moveCell({ dx: 1, dy: 2 }, 'Home', 3, true)).toEqual({ dx: -3, dy: -3 });
    expect(moveCell({ dx: 1, dy: 2 }, 'End', 3, true)).toEqual({ dx: 3, dy: 3 });
    expect(moveCell({ dx: 0, dy: 0 }, 'Enter', 3)).toBeNull();
  });
});
