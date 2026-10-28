/** Declarative population rules (D8): JSON validated on load into a RuleSet. */
import type { LightPresetId } from '../editor/tools/types';
import { isPackKey } from './pack-keys';
import type { PackKey } from './types';

export type RulePlace = 'wall' | 'corner' | 'center' | 'any';
export type RuleRotate = 'wall' | 'random' | 'none';
export type RuleLayer = 'decor' | 'terrain';

export interface RuleItem {
  key: PackKey;
  /** Expected items per floor cell of the region (multiplied by the population density). */
  density: number | null;
  /** Count drawn in [min, max] (multiplied by the population density); wins over `density`. */
  count: [number, number] | null;
  place: RulePlace;
  /** Minimum BFS distance (in cells) to the cells in front of an opening. */
  min_door_distance: number;
  rotate: RuleRotate;
  layer: RuleLayer;
}

export interface TorchRule {
  /** Minimum distance between two lights, in cells. */
  spacing: number;
  place: 'wall';
  /** Light preset; null = the caller's choice (default torch). */
  preset: LightPresetId | null;
}

export interface RuleSet {
  name: string;
  torches: TorchRule | null;
  /** Weighted region kinds to draw from (generator-specific; may be empty). */
  room_kinds: { kind: string; weight: number }[];
  /** Items by region kind (lookup only). */
  kinds: ReadonlyMap<string, readonly RuleItem[]>;
}

export class RulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulesError';
  }
}

const PLACES: readonly RulePlace[] = ['wall', 'corner', 'center', 'any'];
const ROTATES: readonly RuleRotate[] = ['wall', 'random', 'none'];
const LAYERS: readonly RuleLayer[] = ['decor', 'terrain'];
const PRESETS: readonly LightPresetId[] = ['torch', 'lantern', 'candle', 'campfire', 'magic'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(path: string, msg: string): never {
  throw new RulesError(`${path}: ${msg}`);
}

function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a number');
  if (v < min || v > max) fail(path, `expected a number in [${min}, ${max}]`);
  return v;
}

function oneOf<T extends string>(v: unknown, list: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) {
    fail(path, `expected one of ${list.join('|')}`);
  }
  return v as T;
}

function parseItem(raw: unknown, path: string): RuleItem {
  if (!isObject(raw)) fail(path, 'expected an object');
  const key = raw['key'];
  if (typeof key !== 'string' || !isPackKey(key)) fail(path + '.key', 'unknown pack key');
  const family = key.slice(0, key.indexOf('.'));
  const layer =
    raw['layer'] === undefined
      ? family === 'terrain'
        ? 'terrain'
        : 'decor'
      : oneOf(raw['layer'], LAYERS, path + '.layer');
  if (family !== layer) fail(path + '.layer', `key ${key} does not belong to layer ${layer}`);
  const density =
    raw['density'] === undefined ? null : num(raw['density'], path + '.density', 0, 1);
  let count: [number, number] | null = null;
  if (raw['count'] !== undefined) {
    const c = raw['count'];
    if (!Array.isArray(c) || c.length !== 2) fail(path + '.count', 'expected [min, max]');
    const lo = num(c[0], path + '.count[0]', 0, 1000);
    const hi = num(c[1], path + '.count[1]', 0, 1000);
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) {
      fail(path + '.count', 'expected integers with min <= max');
    }
    count = [lo, hi];
  }
  if (density === null && count === null) fail(path, 'needs density or count');
  const mdd =
    raw['min_door_distance'] === undefined
      ? 1
      : num(raw['min_door_distance'], path + '.min_door_distance', 0, 100);
  return {
    key,
    density,
    count,
    place: oneOf(raw['place'], PLACES, path + '.place'),
    min_door_distance: Math.floor(mdd),
    rotate: raw['rotate'] === undefined ? 'none' : oneOf(raw['rotate'], ROTATES, path + '.rotate'),
    layer,
  };
}

function parseTorches(raw: unknown, path: string): TorchRule | null {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) fail(path, 'expected an object');
  return {
    spacing: num(raw['spacing'], path + '.spacing', 1, 1000),
    place: oneOf(raw['place'] ?? 'wall', ['wall'] as const, path + '.place'),
    preset: raw['preset'] === undefined ? null : oneOf(raw['preset'], PRESETS, path + '.preset'),
  };
}

/** Validates population rules; throws RulesError with the path of the first problem. */
export function parseRules(json: unknown, name = 'rules'): RuleSet {
  if (!isObject(json)) fail(name, 'expected an object');
  const roomKinds: { kind: string; weight: number }[] = [];
  const rk = json['room_kinds'];
  if (rk !== undefined) {
    if (!isObject(rk)) fail(name + '.room_kinds', 'expected an object');
    for (const [kind, w] of Object.entries(rk)) {
      roomKinds.push({ kind, weight: num(w, `${name}.room_kinds.${kind}`, 0, 1000) });
    }
    const common = roomKinds.find((k) => k.kind === 'common');
    if (common === undefined || common.weight <= 0) {
      fail(name + '.room_kinds', 'must give "common" a positive weight');
    }
  }
  const kinds = new Map<string, RuleItem[]>();
  const rawKinds = json['kinds'];
  if (!isObject(rawKinds)) fail(name + '.kinds', 'expected an object');
  for (const [kind, list] of Object.entries(rawKinds)) {
    const path = `${name}.kinds.${kind}`;
    if (!Array.isArray(list)) fail(path, 'expected an array');
    kinds.set(
      kind,
      list.map((it, i) => parseItem(it, `${path}[${i}]`)),
    );
  }
  return {
    name: typeof json['name'] === 'string' ? json['name'] : name,
    torches: parseTorches(json['torches'], name + '.torches'),
    room_kinds: roomKinds,
    kinds,
  };
}

/** Items of a region kind (none when the kind has no rule). */
export function rulesFor(set: RuleSet, kind: string): readonly RuleItem[] {
  return set.kinds.get(kind) ?? [];
}
