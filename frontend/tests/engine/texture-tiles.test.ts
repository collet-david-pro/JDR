import { describe, expect, it } from 'vitest';
import {
  MAX_TEXTURE_REPEAT,
  clampRepeat,
  defaultRepeat,
  repeatSlot,
  textureCellRect,
} from '../../src/engine/texture-tiles';

describe('texture-tiles', () => {
  it('clamps the repeat to 1..max', () => {
    expect(clampRepeat(0)).toBe(1);
    expect(clampRepeat(2.6)).toBe(3);
    expect(clampRepeat(9999)).toBe(MAX_TEXTURE_REPEAT);
    expect(clampRepeat(Number.NaN)).toBe(1);
  });

  it('defaults to native width over cellPx, at least 1', () => {
    expect(defaultRepeat(512, 64)).toBe(8);
    expect(defaultRepeat(30, 64)).toBe(1);
    expect(defaultRepeat(0, 64)).toBe(1);
  });

  it('wraps world cells, negatives included', () => {
    expect(repeatSlot(0, 4)).toBe(0);
    expect(repeatSlot(5, 4)).toBe(1);
    expect(repeatSlot(-1, 4)).toBe(3);
    expect(repeatSlot(7, 1)).toBe(0);
  });

  it('cuts the portion of each cell and tiles exactly', () => {
    expect(textureCellRect(256, 256, 4, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 64, sh: 64 });
    expect(textureCellRect(256, 256, 4, 5, 2)).toEqual({ sx: 64, sy: 128, sw: 64, sh: 64 });
    expect(textureCellRect(100, 100, 3, 3, 3)).toEqual(textureCellRect(100, 100, 3, 0, 0));
    // Uneven split: portions of one row cover the whole width without gap.
    const widths = [0, 1, 2].map((x) => textureCellRect(100, 100, 3, x, 0));
    expect(widths[0]!.sx + widths[0]!.sw).toBe(widths[1]!.sx);
    expect(widths[1]!.sx + widths[1]!.sw).toBe(widths[2]!.sx);
    expect(widths[2]!.sx + widths[2]!.sw).toBe(100);
    // repeat 1: the whole image on every cell.
    expect(textureCellRect(64, 32, 1, 9, 4)).toEqual({ sx: 0, sy: 0, sw: 64, sh: 32 });
  });
});
