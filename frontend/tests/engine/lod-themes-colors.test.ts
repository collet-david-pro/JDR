import { describe, expect, it } from 'vitest';
import {
  CACHE_MAX_LEVEL,
  DIRECT_THRESHOLD,
  cacheTextureBytes,
  cacheTextureSize,
  idealRenderMode,
  modesEqual,
  nextRenderMode,
} from '../../src/engine/cache-lod';
import { colorToCss, fallbackColor, hslToRgb } from '../../src/engine/fallback-color';
import {
  DEFAULT_GRID_THEME,
  GRID_THEMES,
  GRID_THEME_IDS,
  gridTheme,
  isGridTheme,
} from '../../src/engine/grid-themes';

describe('chunk cache level', () => {
  it('follows the cell size in device pixels (power of two)', () => {
    expect(idealRenderMode(3)).toEqual({ kind: 'cached', level: 4 });
    expect(idealRenderMode(5)).toEqual({ kind: 'cached', level: 4 });
    expect(idealRenderMode(6)).toEqual({ kind: 'cached', level: 8 });
    expect(idealRenderMode(0.2)).toEqual({ kind: 'cached', level: 1 });
    expect(idealRenderMode(40)).toEqual({ kind: 'cached', level: CACHE_MAX_LEVEL });
    expect(idealRenderMode(DIRECT_THRESHOLD + 1)).toEqual({ kind: 'direct' });
    expect(idealRenderMode(Number.NaN)).toEqual({ kind: 'cached', level: 1 });
  });

  it('keeps the level while zooming unless far off', () => {
    const cur = { kind: 'cached', level: 8 } as const;
    expect(nextRenderMode(cur, 12, false)).toBe(cur);
    expect(nextRenderMode(cur, 12, true)).toEqual({ kind: 'cached', level: 16 });
    expect(nextRenderMode(cur, 32, false)).toEqual({ kind: 'cached', level: 32 });
    expect(nextRenderMode(cur, 200, false)).toEqual({ kind: 'direct' });
    expect(nextRenderMode(null, 12, false)).toEqual({ kind: 'cached', level: 16 });
  });

  it('bounds the cache texture to 1024² (4 MB)', () => {
    expect(cacheTextureSize(CACHE_MAX_LEVEL)).toBe(1024);
    expect(cacheTextureBytes(CACHE_MAX_LEVEL)).toBe(4 * 1024 * 1024);
  });

  it('compares modes', () => {
    expect(modesEqual({ kind: 'direct' }, { kind: 'direct' })).toBe(true);
    expect(modesEqual({ kind: 'cached', level: 2 }, { kind: 'cached', level: 4 })).toBe(false);
    expect(modesEqual(null, null)).toBe(true);
  });
});

describe('grid themes', () => {
  it('has the five themes of projet.md 15.2', () => {
    expect([...GRID_THEME_IDS].sort()).toEqual([
      'blueprint',
      'dark',
      'light',
      'parchment',
      'slate',
    ]);
    expect(Object.keys(GRID_THEMES).sort()).toEqual([...GRID_THEME_IDS].sort());
  });

  it('defines valid colours and opacities', () => {
    for (const id of GRID_THEME_IDS) {
      const t = GRID_THEMES[id];
      for (const c of [t.background, t.outside, t.line, t.border]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
      }
      expect(t.lineAlpha).toBeGreaterThan(0);
      expect(t.lineAlpha).toBeLessThanOrEqual(1);
      expect(t.outside).not.toBe(t.background);
    }
  });

  it('falls back to the default theme', () => {
    expect(isGridTheme('slate')).toBe(true);
    expect(isGridTheme('neon')).toBe(false);
    expect(gridTheme('neon')).toBe(GRID_THEMES[DEFAULT_GRID_THEME]);
  });
});

describe('fallback colours', () => {
  it('converts HSL', () => {
    expect(hslToRgb(0, 1, 0.5)).toBe(0xff0000);
    expect(hslToRgb(120, 1, 0.5)).toBe(0x00ff00);
    expect(hslToRgb(240, 1, 0.5)).toBe(0x0000ff);
    expect(hslToRgb(0, 0, 1)).toBe(0xffffff);
    expect(hslToRgb(-120, 1, 0.5)).toBe(0x0000ff);
  });

  it('is deterministic and distinct for nearby indices', () => {
    expect(fallbackColor(7)).toBe(fallbackColor(7));
    const colors = new Set(Array.from({ length: 64 }, (_, i) => fallbackColor(i + 1)));
    expect(colors.size).toBe(64);
    expect(fallbackColor(5, 1)).not.toBe(fallbackColor(5, 2));
    expect(fallbackColor(5, 4)).toBe(fallbackColor(5, 0));
  });

  it('formats CSS colours', () => {
    expect(colorToCss(0x0a0b0c)).toBe('#0a0b0c');
  });
});
