import { describe, expect, it } from 'vitest';
import { countColumns, gridNavigate } from '../src/lib/assets/grid-nav';

describe('gridNavigate', () => {
  it('moves by item and by row, clamped to the grid', () => {
    expect(gridNavigate(0, 'ArrowRight', 10, 4)).toBe(1);
    expect(gridNavigate(0, 'ArrowLeft', 10, 4)).toBe(0);
    expect(gridNavigate(9, 'ArrowRight', 10, 4)).toBe(9);
    expect(gridNavigate(1, 'ArrowDown', 10, 4)).toBe(5);
    expect(gridNavigate(7, 'ArrowDown', 10, 4)).toBe(7); // no item below
    expect(gridNavigate(5, 'ArrowUp', 10, 4)).toBe(1);
    expect(gridNavigate(2, 'ArrowUp', 10, 4)).toBe(2);
  });

  it('handles Home, End, PageUp, PageDown and ignores other keys', () => {
    expect(gridNavigate(5, 'Home', 10, 4)).toBe(0);
    expect(gridNavigate(5, 'End', 10, 4)).toBe(9);
    expect(gridNavigate(0, 'PageDown', 30, 4)).toBe(12);
    expect(gridNavigate(20, 'PageUp', 30, 4)).toBe(8);
    expect(gridNavigate(0, 'a', 10, 4)).toBeNull();
    expect(gridNavigate(0, 'ArrowRight', 0, 4)).toBeNull();
  });

  it('counts the columns of a rendered grid', () => {
    expect(countColumns([10, 10, 10, 50, 50])).toBe(3);
    expect(countColumns([])).toBe(1);
    expect(countColumns([10])).toBe(1);
  });
});
