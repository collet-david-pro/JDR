/** Catalogue of the pack keys the generators may use (D3, placeholders). */
import type { PackKey } from './types';

export interface PackKeyInfo {
  key: PackKey;
  family: 'floor' | 'terrain' | 'decor';
  category: 'Sols' | 'Eau' | 'Nature' | 'Mobilier' | 'Lumières' | 'Textures' | 'Murs';
  /** French display name. */
  name: string;
  /** Decor that blocks movement (used by population rules). */
  blocking: boolean;
  layer: 'ground' | 'terrain' | 'decor';
}

type Cat = PackKeyInfo['category'];
const floor = (id: string, name: string): PackKeyInfo => ({
  key: 'floor.' + id,
  family: 'floor',
  category: 'Sols',
  name,
  blocking: false,
  layer: 'ground',
});
const terrain = (id: string, name: string, category: Cat = 'Eau'): PackKeyInfo => ({
  key: 'terrain.' + id,
  family: 'terrain',
  category,
  name,
  blocking: false,
  layer: 'terrain',
});
const decor = (id: string, name: string, category: Cat, blocking = false): PackKeyInfo => ({
  key: 'decor.' + id,
  family: 'decor',
  category,
  name,
  blocking,
  layer: 'decor',
});

export const PACK_KEYS: readonly PackKeyInfo[] = Object.freeze(
  [
    floor('stone', 'Pierre'),
    floor('flagstone', 'Dalles'),
    floor('cobble', 'Pavés'),
    floor('wood', 'Parquet'),
    floor('grass', 'Herbe'),
    floor('dirt', 'Terre'),
    floor('sand', 'Sable'),
    floor('snow', 'Neige'),
    floor('ice', 'Glace'),
    floor('cave', 'Sol de caverne'),
    terrain('water', 'Eau'),
    terrain('deep_water', 'Eau profonde'),
    terrain('lava', 'Lave'),
    terrain('mud', 'Boue', 'Sols'),
    decor('rock', 'Rocher', 'Nature', true),
    decor('stalagmite', 'Stalagmite', 'Nature', true),
    decor('puddle', 'Flaque', 'Eau'),
    decor('mushroom', 'Champignon', 'Nature'),
    decor('tree', 'Arbre', 'Nature', true),
    decor('bush', 'Buisson', 'Nature'),
    decor('barrel', 'Tonneau', 'Mobilier', true),
    decor('crate', 'Caisse', 'Mobilier', true),
    decor('table', 'Table', 'Mobilier', true),
    decor('chair', 'Chaise', 'Mobilier'),
    decor('bed', 'Lit', 'Mobilier', true),
    decor('chest', 'Coffre', 'Mobilier', true),
    decor('altar', 'Autel', 'Mobilier', true),
    decor('sarcophagus', 'Sarcophage', 'Mobilier', true),
    decor('anvil', 'Enclume', 'Mobilier', true),
    decor('well', 'Puits', 'Mobilier', true),
    decor('stall', 'Étal', 'Mobilier', true),
    decor('fence', 'Clôture', 'Mobilier', true),
    decor('lantern', 'Lanterne', 'Lumières'),
    decor('stairs_up', 'Escalier montant', 'Mobilier'),
    decor('stairs_down', 'Escalier descendant', 'Mobilier'),
    decor('bridge', 'Pont', 'Mobilier'),
    decor('rubble', 'Gravats', 'Nature'),
    decor('web', 'Toile d’araignée', 'Nature'),
    decor('rug', 'Tapis', 'Mobilier'),
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
);

const BY_KEY: ReadonlyMap<PackKey, PackKeyInfo> = new Map(PACK_KEYS.map((p) => [p.key, p]));

export function isPackKey(key: string): boolean {
  return BY_KEY.has(key);
}

/** Catalogue entry of a key; throws when unknown. */
export function packKey(key: PackKey): PackKeyInfo {
  const info = BY_KEY.get(key);
  if (info === undefined) throw new Error(`Unknown pack key: ${key}`);
  return info;
}

/** Default key of each family, used to replace a missing key (D4); decor has none (left empty). */
const FAMILY_FALLBACK: Readonly<Record<PackKeyInfo['family'], PackKey | null>> = {
  floor: 'floor.stone',
  terrain: 'terrain.water',
  decor: null,
};

/** Substitute of a missing key (D4): the default key of its family, or null (decor, or the default itself). */
export function fallbackKey(key: PackKey): PackKey | null {
  const fallback = FAMILY_FALLBACK[packKey(key).family];
  return fallback === key ? null : fallback;
}
