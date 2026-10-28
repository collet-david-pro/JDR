/** Generator registry and the single entry point that runs one (validation, RNG, sorting). */
import { createRng } from './prng';
import type { GenCell, GenFloor, GenResult, Generator, GeneratorId } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGenerator = Generator<any>;

const registry = new Map<GeneratorId, Map<number, AnyGenerator>>();

export class GenCancelled extends Error {
  constructor() {
    super('Generation cancelled');
    this.name = 'GenCancelled';
  }
}

export function registerGenerator<P>(g: Generator<P>): void {
  let versions = registry.get(g.id);
  if (versions === undefined) {
    versions = new Map();
    registry.set(g.id, versions);
  }
  if (versions.has(g.version))
    throw new Error(`Generator ${g.id} v${g.version} already registered`);
  versions.set(g.version, g);
}

/** Removes a generator (tests only). */
export function unregisterGenerator(id: GeneratorId, version?: number): void {
  const versions = registry.get(id);
  if (versions === undefined) return;
  if (version === undefined) registry.delete(id);
  else versions.delete(version);
}

/** Registered version (the current, i.e. highest, by default); old versions stay callable. */
export function getGenerator(id: GeneratorId, version?: number): AnyGenerator {
  const versions = registry.get(id);
  if (versions === undefined || versions.size === 0) throw new Error(`Unknown generator: ${id}`);
  const v = version ?? Math.max(...versions.keys());
  const g = versions.get(v);
  if (g === undefined) throw new Error(`Unknown generator version: ${id} v${v}`);
  return g;
}

export function listGenerators(): { id: GeneratorId; versions: number[] }[] {
  return [...registry.entries()]
    .map(([id, vs]) => ({ id, versions: [...vs.keys()].sort((a, b) => a - b) }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface RunOptions {
  progress?: (phase: string, done: number, total: number) => void;
  zone?: { width: number; height: number; openings: [number, number][] };
  isCancelled?: () => boolean;
}

function sortCells(cells: GenCell[], layer: string): void {
  cells.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 1; i < cells.length; i++) {
    const p = cells[i - 1]!;
    const c = cells[i]!;
    if (p.x === c.x && p.y === c.y) {
      throw new Error(`Duplicate cell (${c.x}, ${c.y}) in layer ${layer}`);
    }
  }
}

/** Sorts the cells of every layer by y then x and rejects duplicates. */
export function normalizeFloor(f: GenFloor): void {
  sortCells(f.ground, 'ground');
  sortCells(f.terrain, 'terrain');
  sortCells(f.decor, 'decor');
}

export function runGenerator(
  id: GeneratorId,
  version: number,
  seed: string,
  rawParams: unknown,
  opts: RunOptions = {},
): GenResult {
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 64) {
    throw new Error('Seed must be a string of 1 to 64 characters');
  }
  const g = getGenerator(id, version);
  const params = g.validate(rawParams);
  const rng = createRng(seed, id, g.version);
  const progress = (phase: string, done: number, total: number): void => {
    if (opts.isCancelled?.() === true) throw new GenCancelled();
    opts.progress?.(phase, done, total);
  };
  const result: GenResult = g.generate(
    params,
    opts.zone === undefined ? { seed, rng, progress } : { seed, rng, progress, zone: opts.zone },
  );
  if (result.generator !== id || result.gen_version !== g.version || result.seed !== seed) {
    throw new Error('GenResult header does not match the run');
  }
  for (const f of result.floors) normalizeFloor(f);
  return result;
}
