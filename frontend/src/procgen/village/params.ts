/** Parameters of the village generator: defaults, bounds (validate) and presets. */
import { round3 } from '../geometry';
import { VILLAGE_THEME_IDS, type VillageThemeId } from '../themes/village';

export interface VillageParams {
  width: number;
  height: number;
  buildings: number;
  l_shape_p: number;
  interiors: boolean;
  theme: VillageThemeId;
  decor: number;
}

export const VILLAGE_DEFAULTS: Readonly<VillageParams> = Object.freeze({
  width: 70,
  height: 70,
  buildings: 10,
  l_shape_p: 0.3,
  interiors: true,
  theme: 'rural',
  decor: 0.5,
});

export const VILLAGE_PRESETS: Readonly<Record<string, Partial<VillageParams>>> = Object.freeze({
  hamlet: { width: 50, height: 50, buildings: 5, theme: 'rural' },
  village: { width: 80, height: 80, buildings: 14 },
  town_square: { width: 90, height: 90, buildings: 20, theme: 'town' },
  farmstead: { width: 40, height: 40, buildings: 3, theme: 'rural', l_shape_p: 0.6 },
});

/** French labels of the presets (UI). */
export const VILLAGE_PRESET_LABELS: Readonly<Record<string, string>> = Object.freeze({
  hamlet: 'Hameau',
  village: 'Village',
  town_square: 'Place de bourg',
  farmstead: 'Ferme',
});

function num(v: unknown, def: number, min: number, max: number, int: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  const x = int ? Math.round(v) : round3(v);
  return Math.min(max, Math.max(min, x));
}

/** Bounds and defaults: out of bounds ⇒ clamped, wrong type ⇒ default. */
export function validateVillage(p: unknown): VillageParams {
  const o: Record<string, unknown> =
    typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  const d = VILLAGE_DEFAULTS;
  const theme =
    typeof o['theme'] === 'string' && (VILLAGE_THEME_IDS as readonly string[]).includes(o['theme'])
      ? (o['theme'] as VillageThemeId)
      : d.theme;
  return {
    width: num(o['width'], d.width, 30, 200, true),
    height: num(o['height'], d.height, 30, 200, true),
    buildings: num(o['buildings'], d.buildings, 2, 40, true),
    l_shape_p: num(o['l_shape_p'], d.l_shape_p, 0, 1, false),
    interiors: typeof o['interiors'] === 'boolean' ? o['interiors'] : d.interiors,
    theme,
    decor: num(o['decor'], d.decor, 0, 1, false),
  };
}
