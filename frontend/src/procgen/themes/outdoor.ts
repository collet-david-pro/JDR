/** Outdoor themes (D5): data only. Every key must be a PACK_KEYS entry (checked by the tests). */
import type { PackKey } from '../types';

export type OutdoorThemeId = 'temperate' | 'desert' | 'winter';

export interface OutdoorTheme {
  /** French display name. */
  label: string;
  /** Ground of each biome. */
  beach: PackKey;
  plain: PackKey;
  forest: PackKey;
  hill: PackKey;
  mountain: PackKey;
  snow: PackKey;
  /** Green ground around the water (desert oases). */
  oasis: PackKey;
  /** Ground under the shallow water and under the deep water. */
  shallow_ground: PackKey;
  deep_ground: PackKey;
  /** Terrain of the lakes (null: the lake is frozen, its ground is `shallow_ground`). */
  lake: PackKey | null;
  deep: PackKey;
  river: PackKey;
  road: PackKey;
  /** Ground of a ford. */
  ford: PackKey;
  /** Share of the `water` parameter that becomes lakes. */
  water_factor: number;
  /** Peaks are covered with snow. */
  snow_peaks: boolean;
  /** Green and trees only close to the water. */
  oasis_only: boolean;
  /** Name of the population rules file (rules/outdoor/<rules>.json). */
  rules: string;
}

export const OUTDOOR_THEME_IDS: readonly OutdoorThemeId[] = ['temperate', 'desert', 'winter'];

export const OUTDOOR_THEMES: Readonly<Record<OutdoorThemeId, OutdoorTheme>> = {
  temperate: {
    label: 'Tempéré',
    beach: 'floor.sand',
    plain: 'floor.grass',
    forest: 'floor.grass',
    hill: 'floor.dirt',
    mountain: 'floor.stone',
    snow: 'floor.snow',
    oasis: 'floor.grass',
    shallow_ground: 'floor.sand',
    deep_ground: 'floor.sand',
    lake: 'terrain.water',
    deep: 'terrain.deep_water',
    river: 'terrain.water',
    road: 'floor.cobble',
    ford: 'floor.dirt',
    water_factor: 0.6,
    snow_peaks: true,
    oasis_only: false,
    rules: 'temperate',
  },
  desert: {
    label: 'Désert',
    beach: 'floor.sand',
    plain: 'floor.sand',
    forest: 'floor.grass',
    hill: 'floor.dirt',
    mountain: 'floor.stone',
    snow: 'floor.stone',
    oasis: 'floor.grass',
    shallow_ground: 'floor.sand',
    deep_ground: 'floor.sand',
    lake: 'terrain.water',
    deep: 'terrain.deep_water',
    river: 'terrain.water',
    road: 'floor.dirt',
    ford: 'floor.dirt',
    water_factor: 0.3,
    snow_peaks: false,
    oasis_only: true,
    rules: 'desert',
  },
  winter: {
    label: 'Hiver',
    beach: 'floor.snow',
    plain: 'floor.snow',
    forest: 'floor.snow',
    hill: 'floor.dirt',
    mountain: 'floor.stone',
    snow: 'floor.snow',
    oasis: 'floor.snow',
    shallow_ground: 'floor.ice',
    deep_ground: 'floor.snow',
    lake: null,
    deep: 'terrain.deep_water',
    river: 'terrain.water',
    road: 'floor.dirt',
    ford: 'floor.dirt',
    water_factor: 0.6,
    snow_peaks: true,
    oasis_only: false,
    rules: 'winter',
  },
};
