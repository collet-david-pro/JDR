/** Dungeon themes (D5): data only. Every key must be a PACK_KEYS entry (checked by the tests). */
import type { WallKind } from '../../editor/contracts';
import type { LightPresetId } from '../../editor/tools/types';
import type { PackKey } from '../types';

export type DungeonThemeId = 'stone' | 'crypt' | 'sewer' | 'wood';

export interface DungeonTheme {
  /** French display name. */
  label: string;
  /** Ground of the rooms. */
  floor: PackKey;
  /** Alternative room ground (some rooms use it). */
  floor_alt: PackKey;
  /** Ground of the corridors. */
  corridor: PackKey;
  /** Water terrain of the theme (rules may use it), or null. */
  water: PackKey | null;
  wall_kind: WallKind;
  /** Doors slide (grates) instead of swinging. */
  door_swing_slide: boolean;
  /** Light preset of the wall torches. */
  torch: LightPresetId;
  /** Name of the population rules file (rules/dungeon/<rules>.json). */
  rules: string;
}

export const DUNGEON_THEME_IDS: readonly DungeonThemeId[] = ['stone', 'crypt', 'sewer', 'wood'];

export const DUNGEON_THEMES: Readonly<Record<DungeonThemeId, DungeonTheme>> = {
  stone: {
    label: 'Pierre',
    floor: 'floor.flagstone',
    floor_alt: 'floor.stone',
    corridor: 'floor.stone',
    water: null,
    wall_kind: 'stone',
    door_swing_slide: false,
    torch: 'torch',
    rules: 'stone',
  },
  crypt: {
    label: 'Crypte',
    floor: 'floor.stone',
    floor_alt: 'floor.flagstone',
    corridor: 'floor.stone',
    water: null,
    wall_kind: 'stone',
    door_swing_slide: false,
    torch: 'candle',
    rules: 'crypt',
  },
  sewer: {
    label: 'Égouts',
    floor: 'floor.cobble',
    floor_alt: 'floor.stone',
    corridor: 'floor.cobble',
    water: 'terrain.water',
    wall_kind: 'brick',
    door_swing_slide: true,
    torch: 'lantern',
    rules: 'sewer',
  },
  wood: {
    label: 'Bois',
    floor: 'floor.wood',
    floor_alt: 'floor.flagstone',
    corridor: 'floor.wood',
    water: null,
    wall_kind: 'wood',
    door_swing_slide: false,
    torch: 'lantern',
    rules: 'wood',
  },
};
