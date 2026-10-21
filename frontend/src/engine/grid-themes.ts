/**
 * Grid themes (projet.md 15.2: parchment, slate, blueprint, dark, light). Independent of the
 * interface style (etapes/00-plan.md, Q8). Colours are 0xRRGGBB numbers.
 */

import type { GridTheme } from '../editor/contracts';

export interface GridThemeDef {
  /** Map area background (under the tiles). */
  readonly background: number;
  /** Canvas colour outside the map. */
  readonly outside: number;
  readonly line: number;
  /** Line opacity at full strength (faded further at low zoom). */
  readonly lineAlpha: number;
  /** Map border. */
  readonly border: number;
  readonly borderAlpha: number;
}

export const GRID_THEME_IDS: readonly GridTheme[] = [
  'parchment',
  'slate',
  'blueprint',
  'dark',
  'light',
];

export const DEFAULT_GRID_THEME: GridTheme = 'parchment';

export const GRID_THEMES: Readonly<Record<GridTheme, GridThemeDef>> = Object.freeze({
  parchment: {
    background: 0xf2e6c9,
    outside: 0xcbbd9c,
    line: 0x6b4f2f,
    lineAlpha: 0.32,
    border: 0x4a3520,
    borderAlpha: 0.9,
  },
  slate: {
    background: 0x36424c,
    outside: 0x222a31,
    line: 0xd5dee5,
    lineAlpha: 0.22,
    border: 0x9fb0bd,
    borderAlpha: 0.9,
  },
  blueprint: {
    background: 0x1f4f8a,
    outside: 0x163a66,
    line: 0xe6f1ff,
    lineAlpha: 0.3,
    border: 0xffffff,
    borderAlpha: 0.95,
  },
  dark: {
    background: 0x1d1e22,
    outside: 0x0f1012,
    line: 0xffffff,
    lineAlpha: 0.14,
    border: 0x9a9ba3,
    borderAlpha: 0.9,
  },
  light: {
    background: 0xfbfbfa,
    outside: 0xdcdde0,
    line: 0x1f2328,
    lineAlpha: 0.16,
    border: 0x4b5059,
    borderAlpha: 0.9,
  },
});

export function isGridTheme(value: unknown): value is GridTheme {
  return typeof value === 'string' && (GRID_THEME_IDS as readonly string[]).includes(value);
}

/** Theme definition; unknown ids fall back to the default theme. */
export function gridTheme(theme: string): GridThemeDef {
  return isGridTheme(theme) ? GRID_THEMES[theme] : GRID_THEMES[DEFAULT_GRID_THEME];
}
