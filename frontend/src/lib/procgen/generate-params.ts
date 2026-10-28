/** Pure helpers of the "Générer" panel: parameter values, presets, stored parameters, pack keys. */
import { GENERATOR_INFO, type ParamSpec } from '../../procgen/generators';
import { fallbackKey } from '../../procgen/pack-keys';
import type { GenResult, GeneratorId, PackKey } from '../../procgen/types';
import type { Pack } from './pack';

export type ParamValue = number | string | boolean;
export type ParamValues = Record<string, ParamValue>;

/** Parameter values as the panel keeps them: defaults without size. */
export function defaultParams(generator: GeneratorId): ParamValues {
  const { width: _w, height: _h, ...rest } = GENERATOR_INFO[generator].defaults;
  void _w;
  void _h;
  return { ...rest };
}

/** Defaults overridden by a preset (size excluded: the target decides). */
export function presetParams(generator: GeneratorId, preset: string): ParamValues {
  const { width: _w, height: _h, ...rest } = GENERATOR_INFO[generator].presets[preset] ?? {};
  void _w;
  void _h;
  return { ...defaultParams(generator), ...rest };
}

function accepts(spec: ParamSpec, value: unknown): value is ParamValue {
  switch (spec.kind) {
    case 'int':
    case 'float':
      return typeof value === 'number' && Number.isFinite(value);
    case 'enum':
      return typeof value === 'string' && (spec.options?.includes(value) ?? false);
    case 'bool':
      return typeof value === 'boolean';
  }
}

/** Stored params (any order, maybe stale keys) merged onto the defaults of a generator. */
export function paramsFromStored(generator: GeneratorId, stored: unknown): ParamValues {
  const out = defaultParams(generator);
  if (typeof stored !== 'object' || stored === null) return out;
  for (const spec of GENERATOR_INFO[generator].params) {
    const value = (stored as Record<string, unknown>)[spec.key];
    if (accepts(spec, value)) out[spec.key] = value;
  }
  return out;
}

/** Pack keys used by the result that have no asset, even after the family fallback. */
export function missingPackKeys(result: GenResult, pack: Pick<Pack, 'assets'>): PackKey[] {
  const used: Record<PackKey, true> = {};
  const f = result.floors[0];
  if (f !== undefined)
    for (const layer of [f.ground, f.terrain, f.decor]) {
      for (const c of layer) used[c.key] = true;
    }
  const missing: PackKey[] = [];
  for (const key of Object.keys(used)) {
    const fb = fallbackKey(key);
    const asset = pack.assets[key] ?? (fb === null ? undefined : pack.assets[fb]);
    if (asset === undefined || asset.url === null) missing.push(key);
  }
  return missing.sort();
}
