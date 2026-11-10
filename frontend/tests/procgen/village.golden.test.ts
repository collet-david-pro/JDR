import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/procgen/canonical';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';
import {
  VILLAGE_PRESETS,
  VILLAGE_VERSION,
  villageGenerator,
  villageGeneratorV1,
} from '../../src/procgen/village';

beforeAll(() => {
  registerGenerator(villageGeneratorV1);
  registerGenerator(villageGenerator);
});
afterAll(() => unregisterGenerator('village'));

/** Golden fingerprints (D10): 20 seeds with the default parameters, then the 4 presets. */
const SEEDS = Array.from({ length: 20 }, (_, i) => `or-${String(i + 1).padStart(2, '0')}`);
const PRESETS = ['hamlet', 'village', 'town_square', 'farmstead'];

async function compute(version: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const seed of SEEDS)
    out[seed] = await fingerprint(runGenerator('village', version, seed, {}));
  for (const name of PRESETS) {
    const r = runGenerator('village', version, 'or-01', VILLAGE_PRESETS[name]);
    out[`${name}/or-01`] = await fingerprint(r);
  }
  return out;
}

describe('village golden fingerprints (D10)', () => {
  // v1 is frozen (maps generated with it regenerate identically); the current version is new.
  for (const version of [1, VILLAGE_VERSION]) {
    it(`match the stored v${version} fingerprints (UPDATE_GOLDEN=1 rewrites them)`, async () => {
      const file = join(__dirname, 'golden', `village.v${version}.json`);
      const actual = await compute(version);
      if (process.env['UPDATE_GOLDEN'] === '1') {
        writeFileSync(file, JSON.stringify(actual, null, 2) + '\n');
      }
      const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      expect(actual).toEqual(stored);
    });
  }
});
