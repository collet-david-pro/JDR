import { describe, expect, it } from 'vitest';
import type { MapOp } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { bindResult, type BindTarget, type PackAsset } from '../../src/procgen/bind';
import { fallbackKey } from '../../src/procgen/pack-keys';
import type { GenFloor, GenResult } from '../../src/procgen/types';
import { grid, snapshot } from '../editor/helpers';
import { light, sceneSnapshot, wall } from '../editor/scene-helpers';

const asset = (id: string): PackAsset => ({ asset_id: id, url: null, name: id });
const PACK = {
  'floor.stone': asset('A1'),
  'floor.dirt': asset('A2'),
  'decor.barrel': asset('A3'),
  'terrain.water': asset('A4'),
};

function floor(over: Partial<GenFloor> = {}): GenFloor {
  return {
    ground: [],
    terrain: [],
    decor: [],
    walls: [],
    doors: [],
    windows: [],
    lights: [],
    rooms: [],
    entrance: null,
    exit: null,
    ...over,
  };
}
function result(f: GenFloor): GenResult {
  return {
    generator: 'dungeon',
    gen_version: 1,
    seed: 's',
    width: 10,
    height: 10,
    floors: [f],
    stats: {},
  };
}
function uids(): () => string {
  let n = 0;
  return () => `u${++n}`;
}
function target(doc: MapDocument, over: Partial<BindTarget> = {}): BindTarget {
  return {
    floor: 'f1',
    offset: { x: 0, y: 0 },
    view: doc,
    scene: doc,
    pack: PACK,
    replace: { tiles: { x: 0, y: 0, w: 20, h: 20 }, objects: 'all' },
    ...over,
  };
}
const newDoc = (): MapDocument => new MapDocument({ grid: grid(20, 20) });
// The palette is append-only (palette.add has no inverse): compared separately.
const full = (doc: MapDocument): unknown => [
  { ...(snapshot(doc) as object), palette: null },
  sceneSnapshot(doc),
];
const types = (ops: readonly MapOp[]): string[] => ops.map((o) => o.type);

describe('bindResult', () => {
  it('adds palette entries once and sets tiles', () => {
    const doc = newDoc();
    const f = floor({
      ground: [
        { x: 1, y: 1, key: 'floor.stone', variant: 2 },
        { x: 2, y: 1, key: 'floor.stone' },
        { x: 3, y: 1, key: 'floor.dirt' },
      ],
    });
    const { command, missing } = bindResult(result(f), target(doc), uids());
    expect(missing).toEqual([]);
    expect(command.label).toBe('editor.command.generate');
    expect(types(command.ops)).toEqual(['palette.add', 'palette.add', 'tiles.set']);
    expect(command.ops[0]).toEqual({ type: 'palette.add', index: 1, asset_id: 'A2' });
    new History(doc).execute(command);
    expect(doc.getCell('ground', 1, 1)).toEqual({ index: 2, variant: 2, flags: 0 });
    expect(doc.getCell('ground', 3, 1).index).toBe(1);
    expect(doc.getCell('decor', 1, 1).index).toBe(0);
  });

  it('reuses an existing palette entry', () => {
    const doc = new MapDocument({
      grid: grid(20, 20),
      palette: [null, { assetId: 'A2', url: null, name: 'x' }],
    });
    const f = floor({ ground: [{ x: 0, y: 0, key: 'floor.dirt' }] });
    const { command } = bindResult(result(f), target(doc), uids());
    expect(types(command.ops)).toEqual(['tiles.set']);
    expect((command.ops[0] as Extract<MapOp, { type: 'tiles.set' }>).cells[0]).toEqual([
      0, 0, 1, 0, 0,
    ]);
  });

  it('missing keys use the fallback, else are omitted and reported', () => {
    const doc = newDoc();
    const f = floor({
      ground: [
        { x: 0, y: 0, key: 'floor.sand' },
        { x: 1, y: 0, key: 'floor.snow' },
      ],
      decor: [
        { x: 0, y: 0, key: 'decor.tree' },
        { x: 1, y: 0, key: 'decor.bush' },
      ],
    });
    const fb = (k: string): string | null => (k === 'floor.sand' ? 'floor.stone' : null);
    const { command, missing } = bindResult(result(f), target(doc, { fallback: fb }), uids());
    expect(missing).toEqual(['decor.bush', 'decor.tree', 'floor.snow']);
    new History(doc).execute(command);
    expect(doc.getCell('ground', 0, 0).index).toBe(1);
    expect(doc.getCell('ground', 1, 0).index).toBe(0);
    expect(fallbackKey('floor.sand')).toBe('floor.stone');
  });

  it('splits tile ops by 5000 cells and skips unchanged layers', () => {
    const doc = new MapDocument({ grid: grid(100, 100) });
    const cells = [];
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++) cells.push({ x, y, key: 'floor.stone' });
    const r = result(floor({ ground: cells }));
    const { command } = bindResult(
      r,
      target(doc, { replace: { tiles: { x: 0, y: 0, w: 100, h: 100 }, objects: 'none' } }),
      uids(),
    );
    const sets = command.ops.filter(
      (o): o is Extract<MapOp, { type: 'tiles.set' }> => o.type === 'tiles.set',
    );
    expect(sets.map((o) => o.cells.length)).toEqual([5000, 5000]);
    expect(new Set(sets.map((o) => o.layer))).toEqual(new Set(['ground']));
    const empty = bindResult(
      result(floor()),
      target(doc, { replace: { tiles: { x: 0, y: 0, w: 100, h: 100 }, objects: 'none' } }),
      uids(),
    );
    expect(empty.command.ops).toEqual([]);
  });

  it('rejects several floors and a full palette', () => {
    const doc = newDoc();
    const r = result(floor());
    r.floors.push(floor());
    expect(() => bindResult(r, target(doc), uids())).toThrow();
    const big = new MapDocument({
      grid: grid(20, 20),
      palette: [
        null,
        ...Array.from({ length: 4095 }, (_, i) => ({ assetId: `p${i}`, url: null, name: '' })),
      ],
    });
    expect(big.palette.length).toBe(4096);
    expect(() =>
      bindResult(
        result(floor({ ground: [{ x: 0, y: 0, key: 'floor.stone' }] })),
        target(big),
        uids(),
      ),
    ).toThrow(/Palette/);
  });

  it('adds objects with offset and rounds', () => {
    const doc = newDoc();
    const f = floor({
      walls: [
        {
          points: [
            [0, 0],
            [2.00049, 0],
            [2, 3],
          ],
          closed: false,
          kind: 'brick',
        },
      ],
      doors: [{ a: [2, 3], b: [3, 3], secret: true, locked: false, swing: 'slide' }],
      windows: [{ a: [4, 3], b: [5, 3], kind: 'bars' }],
      lights: [{ x: 1.5, y: 2.5, preset: 'torch' }],
    });
    const { command } = bindResult(
      result(f),
      target(doc, {
        offset: { x: 3, y: 4 },
        replace: { tiles: { x: 3, y: 4, w: 6, h: 6 }, objects: 'none' },
      }),
      uids(),
    );
    new History(doc).execute(command);
    const objs = doc.objects();
    expect(objs.map((o) => o.type).sort()).toEqual(['door', 'light', 'wall', 'window']);
    const w = objs.find((o) => o.type === 'wall')!;
    expect(w.type === 'wall' && w.geometry.points).toEqual([
      [3, 4],
      [5, 4],
      [5, 7],
    ]);
    expect(w.type === 'wall' && w.props.kind).toBe('brick');
    const l = objs.find((o) => o.type === 'light')!;
    expect(l.type === 'light' && l.geometry).toEqual({ x: 4.5, y: 6.5 });
    expect(l.layer).toBe('lighting');
    const d = objs.find((o) => o.type === 'door')!;
    expect(d.type === 'door' && d.props.swing).toBe('slide');
  });

  it('replace modes: all / inside / none, and undo restores everything', () => {
    const make = (): MapDocument => {
      const doc = newDoc();
      doc.applyOps([
        { type: 'palette.add', index: 1, asset_id: 'A9' },
        {
          type: 'tiles.set',
          floor: 'f1',
          layer: 'ground',
          cells: [
            [1, 1, 1, 0, 0],
            [15, 15, 1, 3, 0],
          ],
        },
        { type: 'tiles.set', floor: 'f1', layer: 'decor', cells: [[2, 2, 1, 0, 0]] },
        {
          type: 'object.add',
          object: wall('in', [
            [1, 1],
            [4, 1],
          ]),
        },
        {
          type: 'object.add',
          object: wall('cross', [
            [5, 5],
            [15, 5],
          ]),
        },
        {
          type: 'object.add',
          object: wall('out', [
            [14, 14],
            [18, 14],
          ]),
        },
        { type: 'object.add', object: light('lin', 3, 3) },
      ]);
      return doc;
    };
    const f = floor({
      ground: [{ x: 0, y: 0, key: 'floor.stone' }],
      walls: [
        {
          points: [
            [0, 0],
            [1, 0],
          ],
          closed: false,
          kind: 'stone',
        },
      ],
    });
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    const expected = {
      all: [],
      inside: ['cross', 'out'],
      none: ['cross', 'in', 'lin', 'out'],
    } as const;
    for (const mode of ['all', 'inside', 'none'] as const) {
      const doc = make();
      const before = full(doc);
      const { command } = bindResult(
        result(f),
        target(doc, { replace: { tiles: rect, objects: mode } }),
        uids(),
      );
      const h = new History(doc);
      h.execute(command);
      const old = doc
        .objects()
        .map((o) => o.uid)
        .filter((u) => !u.startsWith('u'))
        .sort();
      expect(old).toEqual([...expected[mode]]);
      expect(doc.objects().length).toBe(expected[mode].length + 1);
      expect(doc.getCell('ground', 1, 1).index).toBe(0);
      expect(doc.getCell('ground', 15, 15).variant).toBe(3);
      expect(doc.getCell('decor', 2, 2).index).toBe(0);
      expect(doc.getCell('ground', 0, 0).index).toBeGreaterThan(0);
      expect(h.undo()).toBe(true);
      expect(full(doc)).toEqual(before);
      expect(doc.palette.length).toBeGreaterThan(2);
    }
  });

  it('works on a new map without scene', () => {
    const doc = newDoc();
    const f = floor({
      ground: [{ x: 0, y: 0, key: 'floor.stone' }],
      lights: [{ x: 1, y: 1, preset: 'candle' }],
    });
    const { command } = bindResult(result(f), target(doc, { scene: null }), uids());
    expect(types(command.ops)).toEqual(['palette.add', 'tiles.set', 'object.add']);
    expect(types(command.inverseOps)).toEqual(['object.remove', 'tiles.set']);
  });
});
