/**
 * Registry of the four generators (P8e2a) and the description of their parameters for the
 * "Générer" panel. UI labels live in i18n (keys `procgen.params.<key>`,
 * `procgen.presets.<gen>.<preset>`, `procgen.themes.<gen>.<theme>`), never here.
 */
import { caveGenerator } from './cave';
import { CAVE_DEFAULTS, CAVE_PRESETS } from './cave/params';
import { dungeonGenerator } from './dungeon';
import { DUNGEON_DEFAULTS, DUNGEON_PRESETS } from './dungeon/params';
import { outdoorGenerator } from './outdoor';
import { OUTDOOR_DEFAULTS, OUTDOOR_PRESETS } from './outdoor/params';
import { listGenerators, registerGenerator } from './registry';
import { CAVE_THEME_IDS } from './themes/cave';
import { DUNGEON_THEME_IDS } from './themes/dungeon';
import { OUTDOOR_THEME_IDS } from './themes/outdoor';
import { VILLAGE_THEME_IDS } from './themes/village';
import type { GeneratorId } from './types';
import { villageGenerator } from './village';
import { VILLAGE_DEFAULTS, VILLAGE_PRESETS } from './village/params';

/** One slider / select / switch of the panel. Bounds mirror the generator's `validate`. */
export interface ParamSpec {
  key: string;
  kind: 'int' | 'float' | 'enum' | 'bool';
  min?: number;
  max?: number;
  step?: number;
  /** enum: allowed values, in display order. */
  options?: readonly string[];
}

export interface GeneratorInfo {
  /** Current version (the one a new generation uses). */
  version: number;
  /** Defaults incl. width / height (size of the target) but without `floors` (never exposed). */
  defaults: Readonly<Record<string, number | string | boolean>>;
  /** Partial overrides (may include width / height). */
  presets: Readonly<Record<string, Readonly<Record<string, number | string | boolean>>>>;
  /** True when the generator can fill a selection (dungeon, cave). */
  zone: boolean;
  /** Controls of the panel; width / height / floors excluded. */
  params: readonly ParamSpec[];
  /** Min / max of width and height (managed by the target, not by `params`). */
  size: { min: number; max: number };
}

const int = (key: string, min: number, max: number): ParamSpec => ({
  key,
  kind: 'int',
  min,
  max,
  step: 1,
});
const float = (key: string, min: number, max: number, step = 0.05): ParamSpec => ({
  key,
  kind: 'float',
  min,
  max,
  step,
});
const enumOf = (key: string, options: readonly string[]): ParamSpec => ({
  key,
  kind: 'enum',
  options,
});

function withoutFloors<T extends object>(o: T): Record<string, number | string | boolean> {
  const { floors: _floors, ...rest } = o as T & { floors?: unknown };
  void _floors;
  return rest as Record<string, number | string | boolean>;
}

export const GENERATOR_INFO: Readonly<Record<GeneratorId, GeneratorInfo>> = {
  dungeon: {
    version: dungeonGenerator.version,
    defaults: withoutFloors(DUNGEON_DEFAULTS),
    presets: DUNGEON_PRESETS as GeneratorInfo['presets'],
    zone: true,
    size: { min: 20, max: 400 },
    params: [
      int('rooms', 3, 200),
      int('room_min', 3, 20),
      int('room_max', 4, 40),
      int('corridor', 1, 3),
      float('loops', 0, 0.5),
      float('door_p', 0, 1),
      float('secret_p', 0, 0.5),
      enumOf('theme', DUNGEON_THEME_IDS),
      float('decor', 0, 1),
    ],
  },
  cave: {
    version: caveGenerator.version,
    defaults: withoutFloors(CAVE_DEFAULTS),
    presets: CAVE_PRESETS as GeneratorInfo['presets'],
    zone: true,
    size: { min: 20, max: 400 },
    params: [
      float('fill', 0.35, 0.6, 0.01),
      int('iterations', 1, 10),
      int('smooth', 0, 3),
      enumOf('connect', ['tunnel', 'fill']),
      enumOf('theme', CAVE_THEME_IDS),
      float('decor', 0, 1),
    ],
  },
  outdoor: {
    version: outdoorGenerator.version,
    defaults: withoutFloors(OUTDOOR_DEFAULTS),
    presets: OUTDOOR_PRESETS as GeneratorInfo['presets'],
    zone: false,
    size: { min: 30, max: 400 },
    params: [
      float('scale', 0.5, 4, 0.1),
      float('water', 0, 1),
      int('rivers', 0, 6),
      int('roads', 0, 6),
      float('forest', 0, 1),
      enumOf('theme', OUTDOOR_THEME_IDS),
    ],
  },
  village: {
    version: villageGenerator.version,
    defaults: withoutFloors(VILLAGE_DEFAULTS),
    presets: VILLAGE_PRESETS as GeneratorInfo['presets'],
    zone: false,
    size: { min: 30, max: 200 },
    params: [
      int('buildings', 2, 40),
      float('l_shape_p', 0, 1),
      { key: 'interiors', kind: 'bool' },
      enumOf('theme', VILLAGE_THEME_IDS),
      float('decor', 0, 1),
    ],
  },
};

export const GENERATOR_IDS: readonly GeneratorId[] = ['dungeon', 'cave', 'outdoor', 'village'];

export function isGeneratorId(value: unknown): value is GeneratorId {
  return typeof value === 'string' && (GENERATOR_IDS as readonly string[]).includes(value);
}

/** Idempotent: registers the four generators once per realm (page or worker). */
export function registerAllGenerators(): void {
  const known = new Set(listGenerators().map((g) => g.id));
  if (!known.has('dungeon')) registerGenerator(dungeonGenerator);
  if (!known.has('cave')) registerGenerator(caveGenerator);
  if (!known.has('outdoor')) registerGenerator(outdoorGenerator);
  if (!known.has('village')) registerGenerator(villageGenerator);
}
