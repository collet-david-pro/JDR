import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/procgen/canonical';
import { OUTDOOR_PRESETS, outdoorGenerator } from '../../src/procgen/outdoor';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';

beforeAll(() => registerGenerator(outdoorGenerator));
afterAll(() => unregisterGenerator('outdoor'));

/** Golden fingerprints (D10): 20 seeds with the default parameters, then 2 presets. */
const FILE = join(__dirname, 'golden', 'outdoor.v1.json');
const SEEDS = Array.from({ length: 20 }, (_, i) => `or-${String(i + 1).padStart(2, '0')}`);
const PRESETS = ['winter_lake', 'forest_river'];

async function compute(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const seed of SEEDS) out[seed] = await fingerprint(runGenerator('outdoor', 1, seed, {}));
  for (const name of PRESETS) {
    out[`${name}/or-01`] = await fingerprint(
      runGenerator('outdoor', 1, 'or-01', OUTDOOR_PRESETS[name]),
    );
  }
  return out;
}

describe('outdoor golden fingerprints (D10)', () => {
  it('match the stored v1 fingerprints (UPDATE_GOLDEN=1 rewrites them)', async () => {
    const actual = await compute();
    if (process.env['UPDATE_GOLDEN'] === '1') {
      writeFileSync(FILE, JSON.stringify(actual, null, 2) + '\n');
    }
    expect(actual).toEqual(JSON.parse(readFileSync(FILE, 'utf8')));
  });
});
