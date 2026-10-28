/** Village themes (D5): data only. Every key must be a PACK_KEYS entry (checked by the tests). */
import type { WallKind } from '../../editor/contracts';
import type { PackKey } from '../types';

export type VillageThemeId = 'rural' | 'town';
export type BuildingType = 'tavern' | 'forge' | 'house' | 'farm' | 'storehouse' | 'temple' | 'shop';

export interface VillageTheme {
  /** French display name. */
  label: string;
  /** Ground of the open land. */
  base: PackKey;
  /** Second ground mixed into the land (patches), or null. */
  base_alt: PackKey | null;
  /** Ground of the roads (never used for the open land: tests rely on it). */
  road: PackKey;
  road_width: number;
  /** Paved central square, or null. */
  plaza: PackKey | null;
  /** Interior grounds of the buildings (one drawn per building). */
  interiors: readonly PackKey[];
  /** Exterior wall kinds of the buildings (one drawn per building). */
  wall_kinds: readonly WallKind[];
  /** Weights of the building types. */
  type_weights: Readonly<Record<BuildingType, number>>;
  /** Probability that a building plot is fenced (rural), 0 = never. */
  fence_p: number;
  stalls: boolean;
  lanterns: boolean;
  /** Probability that a tree-or-bush spot is a tree. */
  tree_p: number;
  /** Name of the furnishing rules file (rules/village/<rules>.json). */
  rules: string;
}

export const VILLAGE_THEME_IDS: readonly VillageThemeId[] = ['rural', 'town'];

export const VILLAGE_THEMES: Readonly<Record<VillageThemeId, VillageTheme>> = {
  rural: {
    label: 'Rural',
    base: 'floor.grass',
    base_alt: null,
    road: 'floor.dirt',
    road_width: 2,
    plaza: null,
    interiors: ['floor.wood'],
    wall_kinds: ['wood'],
    type_weights: {
      house: 5,
      farm: 3,
      storehouse: 2,
      forge: 1,
      tavern: 1,
      shop: 0.5,
      temple: 0.5,
    },
    fence_p: 0.4,
    stalls: false,
    lanterns: false,
    tree_p: 0.7,
    rules: 'rural',
  },
  town: {
    label: 'Bourg',
    base: 'floor.grass',
    base_alt: 'floor.dirt',
    road: 'floor.cobble',
    road_width: 3,
    plaza: 'floor.cobble',
    interiors: ['floor.flagstone', 'floor.wood'],
    wall_kinds: ['brick', 'stone'],
    type_weights: {
      house: 4,
      shop: 4,
      tavern: 2,
      forge: 1.5,
      storehouse: 2,
      temple: 1,
      farm: 0.3,
    },
    fence_p: 0,
    stalls: true,
    lanterns: true,
    tree_p: 0.5,
    rules: 'town',
  },
};
