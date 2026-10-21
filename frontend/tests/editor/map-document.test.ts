import { describe, expect, it, vi } from 'vitest';
import type { ChunksChangedEvent, MapOp } from '../../src/editor/contracts';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { DEFAULT_LAYERS, MapOpError, compactOps } from '../../src/editor/model/ops';
import { grid, makeDoc, palette, snapshot } from './helpers';

const set = (
  layer: 'ground' | 'terrain' | 'decor',
  cells: [number, number, number, number, number][],
): MapOp => ({
  type: 'tiles.set',
  floor: 'f1',
  layer,
  cells,
});

describe('MapDocument', () => {
  it('starts empty with the default layers and a null palette slot', () => {
    const doc = new MapDocument({ grid: grid(10, 10) });
    expect(doc.layers.map((l) => l.id)).toEqual(DEFAULT_LAYERS.map((l) => l.id));
    expect(doc.palette).toEqual([null]);
    expect(doc.getCell('ground', 3, 3)).toEqual({ index: 0, variant: 0, flags: 0 });
    expect(doc.chunkKeys('ground')).toEqual([]);
    expect(() => new MapDocument({ grid: grid(401, 10) })).toThrow(RangeError);
  });

  it('stores cells sparsely per 32×32 chunk and returns previous values', () => {
    const doc = makeDoc(100, 100);
    const prev = doc.setCells('terrain', [
      [0, 0, 1, 2, 3],
      [33, 65, 4, 0, 1],
      [33, 65, 5, 0, 0], // same cell twice: last value wins, original value reported once
      [500, 0, 1, 0, 0], // outside: ignored
    ]);
    expect(prev).toEqual([
      [0, 0, 0, 0, 0],
      [33, 65, 0, 0, 0],
    ]);
    expect(doc.getCell('terrain', 33, 65)).toEqual({ index: 5, variant: 0, flags: 0 });
    expect([...doc.chunkKeys('terrain')].sort()).toEqual(['0:0', '1:2']);
    const cells = doc.chunkCells('terrain', '1:2')!;
    expect([...cells.subarray((1 * 32 + 1) * 4, (1 * 32 + 1) * 4 + 4)]).toEqual([5, 0, 0, 0]);
    expect(doc.chunkKeys('ground')).toEqual([]);
    // Erasing the last cell removes the chunk.
    doc.setCells('terrain', [[0, 0, 0, 9, 9]]);
    expect(doc.chunkKeys('terrain')).toEqual(['1:2']);
    expect(doc.chunkCells('terrain', '0:0')).toBeNull();
  });

  it('rejects invalid values before writing anything', () => {
    const doc = makeDoc(10, 10, 3);
    expect(() =>
      doc.setCells('ground', [
        [0, 0, 1, 0, 0],
        [1, 0, 3, 0, 0],
      ]),
    ).toThrow(MapOpError);
    expect(() => doc.setCells('ground', [[0, 0, 1, 256, 0]])).toThrow(MapOpError);
    expect(doc.getCell('ground', 0, 0).index).toBe(0);
  });

  it('batches change events per microtask', async () => {
    const doc = makeDoc(100, 100);
    const chunks = vi.fn<(e: ChunksChangedEvent) => void>();
    const meta = vi.fn();
    doc.onChunksChanged(chunks);
    const off = doc.onMetaChanged(meta);
    doc.setCells('ground', [[0, 0, 1, 0, 0]]);
    doc.setCells('ground', [[40, 0, 1, 0, 0]]);
    doc.setCells('decor', [[1, 1, 2, 0, 0]]);
    doc.applyOps([{ type: 'map.meta', theme: 'slate' }]);
    expect(chunks).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(meta).toHaveBeenCalledTimes(1);
    expect(chunks).toHaveBeenCalledTimes(2);
    expect(chunks.mock.calls[0]![0]).toEqual({ layer: 'ground', keys: ['0:0', '1:0'] });
    expect(chunks.mock.calls[1]![0]).toEqual({ layer: 'decor', keys: ['0:0'] });
    off();
    doc.applyOps([{ type: 'map.meta', theme: 'dark' }]);
    doc.flush();
    expect(meta).toHaveBeenCalledTimes(1);
  });

  it('applies palette.add (index 0 reserved, idempotent, conflicts rejected)', () => {
    const doc = new MapDocument({
      grid: grid(10, 10),
      resolveAsset: (id) => ({ url: `/files/${id}`, name: `n-${id}` }),
    });
    expect(doc.paletteIndexFor('x')).toEqual({
      index: 1,
      op: { type: 'palette.add', index: 1, asset_id: 'x' },
    });
    expect(doc.applyOps([{ type: 'palette.add', index: 1, asset_id: 'x' }])).toEqual([]);
    expect(doc.palette[1]).toEqual({ assetId: 'x', url: '/files/x', name: 'n-x' });
    expect(doc.paletteIndexFor('x')).toEqual({ index: 1, op: null });
    doc.applyOps([{ type: 'palette.add', index: 1, asset_id: 'x' }]);
    expect(doc.palette.length).toBe(2);
    expect(() => doc.applyOps([{ type: 'palette.add', index: 1, asset_id: 'y' }])).toThrow(
      MapOpError,
    );
    expect(() => doc.applyOps([{ type: 'palette.add', index: 0, asset_id: 'y' }])).toThrow(
      MapOpError,
    );
    doc.updatePaletteAsset('x', { url: '/signed', name: 'Dalle' });
    expect(doc.palette[1]).toEqual({ assetId: 'x', url: '/signed', name: 'Dalle' });
  });

  it('applyOps returns inverse ops and is atomic', () => {
    const doc = makeDoc(40, 40, 4);
    doc.setCells('ground', [[1, 1, 2, 0, 0]]);
    const before = snapshot(doc);
    const ops: MapOp[] = [
      set('ground', [
        [1, 1, 3, 1, 0],
        [2, 2, 1, 0, 0],
      ]),
      {
        type: 'map.meta',
        theme: 'blueprint',
        layers: doc.layers.map((l) => ({ ...l, locked: l.id === 'decor' })),
      },
    ];
    const inverse = doc.applyOps(ops);
    expect(doc.layer('decor')?.locked).toBe(true);
    expect(inverse[0]).toMatchObject({ type: 'map.meta', theme: 'parchment' });
    doc.applyOps(inverse);
    expect(snapshot(doc)).toEqual(before);

    // Third op fails: the first two are rolled back.
    expect(() =>
      doc.applyOps([
        set('ground', [[5, 5, 1, 0, 0]]),
        { type: 'map.meta', theme: 'dark' },
        set('ground', [[6, 6, 99, 0, 0]]),
      ]),
    ).toThrow(MapOpError);
    expect(snapshot(doc)).toEqual(before);
    expect(() =>
      doc.applyOps([{ ...set('ground', [[0, 0, 1, 0, 0]]), floor: 'f2' } as MapOp]),
    ).toThrow(MapOpError);
    expect(() => doc.applyOps([{ type: 'map.meta', layers: [] }])).toThrow(MapOpError);
  });

  it('compactOps merges adjacent tiles.set (last write wins)', () => {
    const ops: MapOp[] = [
      set('ground', [
        [0, 0, 1, 0, 0],
        [1, 0, 1, 0, 0],
      ]),
      set('ground', [[0, 0, 2, 0, 0]]),
      set('decor', [[0, 0, 3, 0, 0]]),
    ];
    const out = compactOps(ops);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(
      set('ground', [
        [0, 0, 2, 0, 0],
        [1, 0, 1, 0, 0],
      ]),
    );
    const a = makeDoc(4, 4);
    const b = makeDoc(4, 4);
    a.applyOps(ops);
    b.applyOps(out);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('serialises chunks through the codec and loads them back', async () => {
    const doc = new MapDocument({ grid: grid(70, 40), palette: palette(300) });
    doc.setCells('ground', [
      [0, 0, 299, 3, 5],
      [69, 39, 1, 0, 0],
    ]);
    doc.setCells('decor', [[40, 10, 7, 0, 8]]);
    const exported = await doc.exportChunks();
    expect(exported.map((c) => `${c.layer}/${c.key}`).sort()).toEqual([
      'decor/1:0',
      'ground/0:0',
      'ground/2:1',
    ]);
    const copy = new MapDocument({ grid: grid(70, 40), palette: palette(300) });
    for (const c of exported) await copy.importChunk(c.layer, c.key, c.data, { forceJs: true });
    expect(snapshot(copy)).toEqual(snapshot(doc));
    const small = new MapDocument({ grid: grid(70, 40), palette: palette(10) });
    await expect(
      small.importChunk('ground', '0:0', exported.find((c) => c.key === '0:0')!.data),
    ).rejects.toMatchObject({
      code: 'bad_palette_index',
    });
    await expect(copy.importChunk('ground', '9:9', exported[0]!.data)).rejects.toBeInstanceOf(
      MapOpError,
    );
  });
});
