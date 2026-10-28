/** Builds the base pack (D3): one 256x256 placeholder per PACK_KEYS entry, from our own generators. */
import { PngEncoder } from '../../formats/png-encoder';
import { PACK_KEYS } from '../pack-keys';
import type { PackKey } from '../types';
import { renderSprite } from '../sprites';
import { renderTexture, type TextureRequest } from './index';

export const BASE_PACK_VERSION = 1;
export const BASE_PACK_SIZE = 256;

export interface BasePackEntry {
  key: PackKey;
  file: string;
  name: string;
  category: string;
  kind: 'tile';
  tags: string[];
  rgba_sha256: string;
}
export interface BasePackManifest {
  version: number;
  entries: BasePackEntry[];
}

type Spec = Omit<TextureRequest, 'size'>;
const t = (material: Spec['material'], palette: string, key: string): Spec => ({
  material,
  palette,
  seed: 'pack:' + key,
});

/** Texture recipe of every floor.* / terrain.* key (fixed seed per key). */
export const PACK_TEXTURES: Readonly<Record<PackKey, Spec>> = Object.freeze({
  'floor.stone': t('stone', 'stone_grey', 'floor.stone'),
  'floor.flagstone': t('flagstone', 'flag_grey', 'floor.flagstone'),
  'floor.cobble': t('cobble', 'cobble_grey', 'floor.cobble'),
  'floor.wood': t('wood', 'oak', 'floor.wood'),
  'floor.grass': t('grass', 'meadow', 'floor.grass'),
  'floor.dirt': t('dirt', 'earth', 'floor.dirt'),
  'floor.sand': t('sand', 'dune', 'floor.sand'),
  'floor.snow': t('sand', 'snow', 'floor.snow'),
  'floor.ice': t('ice', 'ice_blue', 'floor.ice'),
  'floor.cave': t('stone', 'cave', 'floor.cave'),
  'terrain.water': t('water', 'water_blue', 'terrain.water'),
  'terrain.deep_water': t('water', 'deep_water', 'terrain.deep_water'),
  'terrain.lava': t('lava', 'lava', 'terrain.lava'),
  'terrain.mud': t('dirt', 'mud', 'terrain.mud'),
});

const TAGS: Readonly<Record<string, string[]>> = {
  'floor.stone': ['donjon', 'pierre'],
  'floor.flagstone': ['donjon', 'dalles'],
  'floor.cobble': ['ville', 'pavés'],
  'floor.wood': ['intérieur', 'taverne'],
  'floor.grass': ['extérieur', 'nature'],
  'floor.dirt': ['extérieur', 'chemin'],
  'floor.sand': ['désert', 'extérieur'],
  'floor.snow': ['neige', 'extérieur'],
  'floor.ice': ['glace', 'froid'],
  'floor.cave': ['caverne', 'souterrain'],
  'terrain.water': ['eau'],
  'terrain.deep_water': ['eau', 'profond'],
  'terrain.lava': ['feu', 'danger'],
  'terrain.mud': ['marais', 'boue'],
  'decor.altar': ['donjon', 'temple'],
  'decor.sarcophagus': ['donjon', 'crypte'],
  'decor.stalagmite': ['caverne'],
  'decor.tree': ['extérieur', 'forêt'],
  'decor.stall': ['ville', 'marché'],
  'decor.web': ['donjon', 'araignée'],
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes); // plain ArrayBuffer-backed, as BufferSource wants
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copy));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function encodePng(rgba: Uint8ClampedArray, size: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const enc = new PngEncoder({ width: size, height: size, alpha: true }, (b) => {
    parts.push(b.slice());
  });
  await enc.begin();
  await enc.writeRows(rgba, size);
  await enc.end();
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface BasePackFile {
  file: string;
  png: Uint8Array;
  rgbaSha256: string;
}

export async function buildBasePack(): Promise<{
  manifest: BasePackManifest;
  files: BasePackFile[];
}> {
  const entries: BasePackEntry[] = [];
  const files: BasePackFile[] = [];
  for (const info of PACK_KEYS) {
    const spec = PACK_TEXTURES[info.key];
    const rgba = spec
      ? renderTexture({ ...spec, size: BASE_PACK_SIZE })
      : renderSprite(info.key, BASE_PACK_SIZE);
    const file = info.key + '.png';
    const rgbaSha256 = await sha256Hex(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length));
    files.push({ file, png: await encodePng(rgba, BASE_PACK_SIZE), rgbaSha256 });
    entries.push({
      key: info.key,
      file,
      name: info.name,
      category: info.category,
      kind: 'tile',
      tags: TAGS[info.key] ?? [info.family === 'decor' ? 'décor' : 'sol'],
      rgba_sha256: rgbaSha256,
    });
  }
  return { manifest: { version: BASE_PACK_VERSION, entries }, files };
}

/** Canonical text of pack.json (UTF-8, 2-space indent, sorted by key, final newline). */
export function manifestJson(m: BasePackManifest): string {
  return JSON.stringify(m, null, 2) + '\n';
}
