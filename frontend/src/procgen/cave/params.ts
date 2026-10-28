/** Parameters of the cave generator: defaults, bounds (validate) and presets. */
import { round3 } from '../geometry';
import { CAVE_THEME_IDS, type CaveThemeId } from '../themes/cave';

export type CaveConnect = 'tunnel' | 'fill';

export interface CaveParams {
  width: number;
  height: number;
  fill: number;
  iterations: number;
  smooth: number;
  connect: CaveConnect;
  theme: CaveThemeId;
  decor: number;
}

export const CAVE_DEFAULTS: Readonly<CaveParams> = Object.freeze({
  width: 60,
  height: 60,
  fill: 0.45,
  iterations: 5,
  smooth: 1,
  connect: 'tunnel',
  theme: 'rock',
  decor: 0.5,
});

export const CAVE_PRESETS: Readonly<Record<string, Partial<CaveParams>>> = Object.freeze({
  small_cave: { width: 40, height: 40 },
  ice_cavern: { width: 80, height: 60, theme: 'ice' },
  lava_tubes: { width: 70, height: 70, theme: 'lava', fill: 0.5 },
  great_cavern: { width: 150, height: 150 },
});

/** French labels of the presets (UI). */
export const CAVE_PRESET_LABELS: Readonly<Record<string, string>> = Object.freeze({
  small_cave: 'Petite grotte',
  ice_cavern: 'Caverne glacée',
  lava_tubes: 'Tunnels de lave',
  great_cavern: 'Grande caverne',
});

/** Safety: width x height <= 160 000 cells. */
export const MAX_CELLS = 160_000;

function num(v: unknown, def: number, min: number, max: number, int: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  const x = int ? Math.round(v) : round3(v);
  return Math.min(max, Math.max(min, x));
}

/** Out of bounds => clamped, wrong type => default. */
export function validateCave(p: unknown): CaveParams {
  const o: Record<string, unknown> =
    typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  const d = CAVE_DEFAULTS;
  const width = num(o['width'], d.width, 20, 400, true);
  let height = num(o['height'], d.height, 20, 400, true);
  if (width * height > MAX_CELLS) height = Math.max(20, Math.floor(MAX_CELLS / width));
  return {
    width,
    height,
    fill: num(o['fill'], d.fill, 0.35, 0.6, false),
    iterations: num(o['iterations'], d.iterations, 1, 10, true),
    smooth: num(o['smooth'], d.smooth, 0, 3, true),
    connect: o['connect'] === 'tunnel' || o['connect'] === 'fill' ? o['connect'] : d.connect,
    theme:
      typeof o['theme'] === 'string' && (CAVE_THEME_IDS as readonly string[]).includes(o['theme'])
        ? (o['theme'] as CaveThemeId)
        : d.theme,
    decor: num(o['decor'], d.decor, 0, 1, false),
  };
}
