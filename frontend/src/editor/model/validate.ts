import type { LayerDef, LayerId } from '../contracts';
import { MapOpError } from './ops';

const TILE_IDS: readonly LayerId[] = ['ground', 'terrain', 'decor'];
const OBJECT_IDS: readonly LayerId[] = ['walls', 'props', 'lighting', 'labels', 'gm'];

/** Validates a layer list (known ids, unique, right kind, opacity 0..1, all tile layers present). */
export function validateLayers(layers: readonly LayerDef[]): readonly LayerDef[] {
  const seen = new Set<string>();
  for (const l of layers) {
    const kind = TILE_IDS.includes(l.id) ? 'tiles' : OBJECT_IDS.includes(l.id) ? 'objects' : null;
    if (kind === null || l.kind !== kind || seen.has(l.id)) {
      throw new MapOpError('bad_layers', `Invalid layer ${String(l.id)}`);
    }
    if (!(l.opacity >= 0 && l.opacity <= 1)) {
      throw new MapOpError('bad_layers', `Invalid opacity for layer ${l.id}`);
    }
    seen.add(l.id);
  }
  for (const id of TILE_IDS) {
    if (!seen.has(id)) throw new MapOpError('bad_layers', `Missing tile layer ${id}`);
  }
  return Object.freeze(layers.map((l) => Object.freeze({ ...l })));
}
