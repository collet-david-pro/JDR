import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/procgen/canonical';
import { CAVE_PRESETS, caveGenerator } from '../../src/procgen/cave';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';

beforeAll(() => registerGenerator(caveGenerator));
afterAll(() => unregisterGenerator('cave'));

/** Golden fingerprints (D10): 20 seeds with the default parameters, then 2 presets. */
const FILE = join(__dirname, 'golden', 'cave.v1.json');
const SEEDS = Array.from({ length: 20 }, (_, i) => `or-${String(i + 1).padStart(2, '0')}`);
const PRESETS = ['ice_cavern', 'lava_tubes'];

async function compute(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const seed of SEEDS) out[seed] = await fingerprint(runGenerator('cave', 1, seed, {}));
  for (const name of PRESETS) {
    out[`${name}/or-01`] = await fingerprint(runGenerator('cave', 1, 'or-01', CAVE_PRESETS[name]));
  }
  return out;
}

describe('cave golden fingerprints (D10)', () => {
  it('match the stored v1 fingerprints (UPDATE_GOLDEN=1 rewrites them)', async () => {
    const actual = await compute();
    if (process.env['UPDATE_GOLDEN'] === '1') {
      writeFileSync(FILE, JSON.stringify(actual, null, 2) + '\n');
    }
    expect(actual).toEqual(JSON.parse(readFileSync(FILE, 'utf8')));
  });
});
