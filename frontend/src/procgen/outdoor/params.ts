/** Parameters of the outdoor generator: defaults, bounds (validate) and presets. */
import { round3 } from '../geometry';
import { OUTDOOR_THEME_IDS, type OutdoorThemeId } from '../themes/outdoor';

export interface OutdoorParams {
  width: number;
  height: number;
  scale: number;
  water: number;
  rivers: number;
  roads: number;
  forest: number;
  theme: OutdoorThemeId;
}

export const OUTDOOR_DEFAULTS: Readonly<OutdoorParams> = Object.freeze({
  width: 80,
  height: 80,
  scale: 1,
  water: 0.3,
  rivers: 2,
  roads: 2,
  forest: 0.5,
  theme: 'temperate',
});

export const OUTDOOR_PRESETS: Readonly<Record<string, Partial<OutdoorParams>>> = Object.freeze({
  forest_river: { forest: 0.8, rivers: 2 },
  crossroads: { roads: 4, forest: 0.3 },
  desert_oasis: { theme: 'desert', water: 0.15 },
  winter_lake: { theme: 'winter', water: 0.5 },
});

/** French labels of the presets (UI). */
export const OUTDOOR_PRESET_LABELS: Readonly<Record<string, string>> = Object.freeze({
  forest_river: 'Forêt et rivière',
  crossroads: 'Croisée des chemins',
  desert_oasis: 'Oasis',
  winter_lake: 'Lac gelé',
});

/** Safety: width x height <= 160 000 cells. */
export const MAX_CELLS = 160_000;

function num(v: unknown, def: number, min: number, max: number, int: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  const x = int ? Math.round(v) : round3(v);
  return Math.min(max, Math.max(min, x));
}

/** Out of bounds => clamped, wrong type => default. */
export function validateOutdoor(p: unknown): OutdoorParams {
  const o: Record<string, unknown> =
    typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  const d = OUTDOOR_DEFAULTS;
  const width = num(o['width'], d.width, 30, 400, true);
  let height = num(o['height'], d.height, 30, 400, true);
  if (width * height > MAX_CELLS) height = Math.max(30, Math.floor(MAX_CELLS / width));
  return {
    width,
    height,
    scale: num(o['scale'], d.scale, 0.5, 4, false),
    water: num(o['water'], d.water, 0, 1, false),
    rivers: num(o['rivers'], d.rivers, 0, 6, true),
    roads: num(o['roads'], d.roads, 0, 6, true),
    forest: num(o['forest'], d.forest, 0, 1, false),
    theme:
      typeof o['theme'] === 'string' &&
      (OUTDOOR_THEME_IDS as readonly string[]).includes(o['theme'])
        ? (o['theme'] as OutdoorThemeId)
        : d.theme,
  };
}
