import { describe, expect, it } from 'vitest';
import {
  MemoryPendingOpsStore,
  openMapStores,
  packBatch,
  unpackBatch,
  type PendingBatch,
} from '../../src/lib/persistence/map-stores';
import {
  gridOf,
  layersFromWire,
  layersToWire,
  paletteFromWire,
  themeOf,
  toWireOp,
} from '../../src/editor/sync/wire';
import { DEFAULT_LAYERS } from '../../src/editor/model/ops';
import { makeMap } from './fixtures';

const batch: PendingBatch = {
  mapId: 'm',
  seq: 3,
  clientOpId: 'id',
  baseRevision: 2,
  sealed: true,
  ops: [
    { type: 'tiles.set', floor: 'f', layer: 'decor', cells: [[399, 398, 65535, 255, 15]] },
    { type: 'palette.add', index: 2, asset_id: '9' },
    { type: 'map.meta', theme: 'slate' },
  ],
};

describe('pending ops storage', () => {
  it('packs tiles.set cells into a Uint16Array and back', () => {
    const packed = packBatch(batch);
    const op = packed.ops[0] as unknown as { packed: Uint16Array };
    expect(op.packed).toBeInstanceOf(Uint16Array);
    expect([...op.packed]).toEqual([399, 398, 65535, 255, 15]);
    expect(unpackBatch(packed)).toEqual(batch);
  });

  it('memory store: per map, by seq, copies', async () => {
    const store = new MemoryPendingOpsStore();
    await store.put({ ...batch, seq: 9 });
    await store.put(batch);
    await store.put({ ...batch, mapId: 'other' });
    expect((await store.list('m')).map((b) => b.seq)).toEqual([3, 9]);
    await store.delete('m', 3);
    expect((await store.list('m')).map((b) => b.seq)).toEqual([9]);
  });

  it('falls back to memory stores without IndexedDB', async () => {
    const stores = await openMapStores(null);
    expect(stores.pending.durable).toBe(false);
    expect(await openMapStores(null)).toBe(stores);
  });
});

describe('server ⇄ editor conversion', () => {
  it('reads grid, theme, layers and palette', () => {
    const map = makeMap({
      theme: 'blueprint',
      palette: [
        null,
        { asset_id: '5', name: 'Dalle', url: '/f/5', thumb_url: '/t/5', autotile: null },
        null,
      ],
    });
    expect(gridOf(map)).toEqual({
      width: 40,
      height: 30,
      cellPx: 70,
      unitLabel: 'ft',
      unitPerCell: 5,
    });
    expect(themeOf('blueprint')).toBe('blueprint');
    expect(themeOf('unknown')).toBe('parchment');
    expect(paletteFromWire(map.palette)).toEqual([
      null,
      { assetId: '5', url: '/f/5', name: 'Dalle' },
      null,
    ]);
    const layers = layersFromWire(map.layers);
    expect(layers.find((l) => l.id === 'gm')).toMatchObject({ gmOnly: true });
    expect(layersFromWire([{ id: 'bogus', kind: 'tiles' }])).toBe(DEFAULT_LAYERS);
  });

  it('writes map.meta layers with gm_only', () => {
    const op = toWireOp({ type: 'map.meta', layers: DEFAULT_LAYERS, theme: 'dark' });
    expect(op).toMatchObject({ type: 'map.meta', theme: 'dark' });
    const wire = (op as { readonly layers: readonly { id: string; gm_only?: boolean }[] }).layers;
    expect(wire.find((l) => l.id === 'gm')).toMatchObject({ gm_only: true });
    expect(wire.every((l) => !('gmOnly' in l))).toBe(true);
    expect(layersFromWire(layersToWire(DEFAULT_LAYERS))).toEqual(DEFAULT_LAYERS);
  });
});
