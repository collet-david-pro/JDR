import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/procgen/canonical';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';
import { VILLAGE_PRESETS, villageGenerator } from '../../src/procgen/village';

beforeAll(() => registerGenerator(villageGenerator));
afterAll(() => unregisterGenerator('village'));

/** Golden fingerprints (D10): 20 seeds with the default parameters, then the 4 presets. */
const FILE = join(__dirname, 'golden', 'village.v1.json');
const SEEDS = Array.from({ length: 20 }, (_, i) => `or-${String(i + 1).padStart(2, '0')}`);
const PRESETS = ['hamlet', 'village', 'town_square', 'farmstead'];

async function compute(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const seed of SEEDS) out[seed] = await fingerprint(runGenerator('village', 1, seed, {}));
  for (const name of PRESETS) {
    const r = runGenerator('village', 1, 'or-01', VILLAGE_PRESETS[name]);
    out[`${name}/or-01`] = await fingerprint(r);
  }
  return out;
}

describe('village golden fingerprints (D10)', () => {
  it('match the stored v1 fingerprints (UPDATE_GOLDEN=1 rewrites them)', async () => {
    const actual = await compute();
    if (process.env['UPDATE_GOLDEN'] === '1') {
      writeFileSync(FILE, JSON.stringify(actual, null, 2) + '\n');
    }
    const stored = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>;
    expect(actual).toEqual(stored);
  });
});
