import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/procgen/canonical';
import { DUNGEON_PRESETS, dungeonGenerator } from '../../src/procgen/dungeon';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';

beforeAll(() => registerGenerator(dungeonGenerator));
afterAll(() => unregisterGenerator('dungeon'));

/** Golden fingerprints (D10): 20 seeds with the default parameters, then 3 presets. */
const FILE = join(__dirname, 'golden', 'dungeon.v1.json');
const SEEDS = Array.from({ length: 20 }, (_, i) => `or-${String(i + 1).padStart(2, '0')}`);
const PRESETS = ['small_crypt', 'sewers', 'manor_cellar'];

async function compute(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const seed of SEEDS) out[seed] = await fingerprint(runGenerator('dungeon', 1, seed, {}));
  for (const name of PRESETS) {
    const r = runGenerator('dungeon', 1, 'or-01', DUNGEON_PRESETS[name]);
    out[`${name}/or-01`] = await fingerprint(r);
  }
  return out;
}

describe('dungeon golden fingerprints (D10)', () => {
  it('match the stored v1 fingerprints (UPDATE_GOLDEN=1 rewrites them)', async () => {
    const actual = await compute();
    if (process.env['UPDATE_GOLDEN'] === '1') {
      writeFileSync(FILE, JSON.stringify(actual, null, 2) + '\n');
    }
    const stored = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>;
    const pick = (keys: string[], src: Record<string, string>) =>
      Object.fromEntries(keys.map((k) => [k, src[k]]));
    expect(pick(SEEDS, actual)).toEqual(pick(SEEDS, stored));
  });

  it('match the stored fingerprints of three presets', async () => {
    const actual = await compute();
    const stored = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>;
    for (const name of PRESETS) expect(actual[`${name}/or-01`]).toBe(stored[`${name}/or-01`]);
  });
});
