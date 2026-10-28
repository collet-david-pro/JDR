import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PACK_KEYS } from '../../../src/procgen/pack-keys';
import {
  BASE_PACK_VERSION,
  buildBasePack,
  manifestJson,
  type BasePackManifest,
} from '../../../src/procgen/textures/base-pack';

const dir = resolve(process.cwd(), '../app/Seed/base-pack');

describe('base pack', () => {
  it('matches (or regenerates with UPDATE_BASE_PACK=1) the versioned pack', async () => {
    const built = await buildBasePack();
    expect(built.manifest.version).toBe(BASE_PACK_VERSION);
    expect(built.manifest.entries.map((e) => e.key)).toEqual(PACK_KEYS.map((p) => p.key));
    expect(built.manifest.entries).toHaveLength(39);

    if (process.env['UPDATE_BASE_PACK'] === '1') {
      mkdirSync(dir, { recursive: true });
      const keep = new Set(built.files.map((f) => f.file));
      for (const f of readdirSync(dir))
        if (f.endsWith('.png') && !keep.has(f)) rmSync(join(dir, f));
      for (const f of built.files) writeFileSync(join(dir, f.file), f.png);
      writeFileSync(join(dir, 'pack.json'), manifestJson(built.manifest));
      return;
    }

    const disk = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as BasePackManifest;
    expect(disk.version).toBe(BASE_PACK_VERSION);
    expect(disk.entries.map((e) => e.key)).toEqual(PACK_KEYS.map((p) => p.key));
    for (const e of built.manifest.entries) {
      const d = disk.entries.find((x) => x.key === e.key)!;
      expect(d.rgba_sha256, e.key).toBe(e.rgba_sha256);
      expect(existsSync(join(dir, d.file)), d.file).toBe(true);
    }
    expect(readFileSync(join(dir, 'pack.json'), 'utf8')).toBe(manifestJson(built.manifest));
  }, 60000);

  it('lists unique files and short French tags', async () => {
    const { manifest } = await buildBasePack();
    expect(new Set(manifest.entries.map((e) => e.file)).size).toBe(39);
    for (const e of manifest.entries) expect(e.tags.length).toBeLessThanOrEqual(3);
  }, 60000);
});
