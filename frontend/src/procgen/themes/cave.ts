/** Cave themes (D5): data only. Every key must be a PACK_KEYS entry (checked by the tests). */
import type { WallKind } from '../../editor/contracts';
import type { PackKey } from '../types';

export type CaveThemeId = 'rock' | 'ice' | 'lava';

export interface CaveTheme {
  /** French display name. */
  label: string;
  /** Ground of the cave. */
  floor: PackKey;
  /** Alternative ground (some regions use it). */
  floor_alt: PackKey;
  wall_kind: WallKind;
  /** Name of the population rules file (rules/cave/<rules>.json). */
  rules: string;
  /** Lava terrain of the theme (blocking for the connectivity checks), or null. */
  lava: PackKey | null;
}

export const CAVE_THEME_IDS: readonly CaveThemeId[] = ['rock', 'ice', 'lava'];

export const CAVE_THEMES: Readonly<Record<CaveThemeId, CaveTheme>> = {
  rock: {
    label: 'Roche',
    floor: 'floor.cave',
    floor_alt: 'floor.dirt',
    wall_kind: 'natural',
    rules: 'rock',
    lava: null,
  },
  ice: {
    label: 'Glace',
    floor: 'floor.ice',
    floor_alt: 'floor.snow',
    wall_kind: 'natural',
    rules: 'ice',
    lava: null,
  },
  lava: {
    label: 'Lave',
    floor: 'floor.cave',
    floor_alt: 'floor.stone',
    wall_kind: 'natural',
    rules: 'lava',
    lava: 'terrain.lava',
  },
};
