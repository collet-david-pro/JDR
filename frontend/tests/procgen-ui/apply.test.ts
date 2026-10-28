import { describe, expect, it } from 'vitest';
import type { MapOp } from '../../src/editor/contracts';
import { EditorSession } from '../../src/editor/ui/session';
import { applyGeneration, isMapEmpty } from '../../src/lib/procgen/apply';
import type { GenFloor, GenResult } from '../../src/procgen/types';
import { grid, snapshot } from '../editor/helpers';
import { sceneSnapshot, wall } from '../editor/scene-helpers';

const PACK = {
  assets: {
    'floor.stone': { asset_id: '11', url: 'u/stone', name: 'Pierre' },
    'decor.barrel': { asset_id: '12', url: 'u/barrel', name: 'Tonneau' },
  },
};

function floor(): GenFloor {
  return {
    ground: [
      { x: 0, y: 0, key: 'floor.stone' },
      { x: 1, y: 0, key: 'floor.stone' },
      { x: 0, y: 1, key: 'floor.dirt' }, // missing: falls back to floor.stone
    ],
    terrain: [],
    decor: [
      { x: 1, y: 1, key: 'decor.barrel' },
      { x: 2, y: 1, key: 'decor.crate' }, // missing, no fallback
    ],
    walls: [
      {
        points: [
          [0, 0],
          [3, 0],
        ],
        closed: false,
        kind: 'stone',
      },
    ],
    doors: [{ a: [1, 0], b: [2, 0], secret: false, locked: false, swing: 'a' }],
    windows: [],
    lights: [{ x: 1.5, y: 1.5, preset: 'torch' }],
    rooms: [],
    entrance: null,
    exit: null,
  };
}
const result = (): GenResult => ({
  generator: 'dungeon',
  gen_version: 1,
  seed: 's',
  width: 3,
  height: 2,
  floors: [floor()],
  stats: {},
});
function uids(): () => string {
  let n = 0;
  return () => `g${++n}`;
}
function session(): EditorSession {
  return new EditorSession({ grid: grid(10, 10), newUid: uids() });
}

describe('applyGeneration', () => {
  it('map target: one history entry, palette usable, missing keys reported', () => {
    const s = session();
    const sent: [string, MapOp[]][] = [];
    s.history.onOps((ops, origin) => sent.push([origin, [...ops]]));
    expect(isMapEmpty(s.doc, 'f1')).toBe(true);
    const report = applyGeneration(s, { result: result(), pack: PACK, target: 'map' }, uids());
    expect(report).toEqual({ missing: ['decor.crate'], cells: 5, objects: 3 });
    expect(isMapEmpty(s.doc, 'f1')).toBe(false);
    expect(s.history.state.undoSize).toBe(1);
    expect(s.history.state.undoLabel).toBe('editor.command.generate');
    // palette entries are drawable: url and name known, in the catalog.
    const entries = s.doc.palette.filter((p) => p !== null);
    expect(entries.map((p) => [p!.assetId, p!.url, p!.name]).sort()).toEqual([
      ['11', 'u/stone', 'Pierre'],
      ['12', 'u/barrel', 'Tonneau'],
    ]);
    expect(s.catalog.resolve('11')).toMatchObject({ name: 'Pierre' });
    // ops are on the sync path like a tool's.
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toBe('do');
    expect(sent[0]![1].map((o) => o.type)).toEqual(
      expect.arrayContaining(['palette.add', 'tiles.set', 'object.add']),
    );
    // dirt took the stone palette entry.
    const idx = s.doc.palette.findIndex((p) => p?.assetId === '11');
    expect(s.doc.getCell('ground', 0, 1).index).toBe(idx);
    expect(s.doc.getCell('decor', 2, 1).index).toBe(0);
  });

  it('undo restores cells and objects exactly (one step)', () => {
    const s = session();
    s.doc.apply([
      { type: 'tiles.set', floor: 'f1', layer: 'ground', cells: [[5, 5, 0, 0, 0]] },
      {
        type: 'object.add',
        object: wall('old', [
          [6, 6],
          [8, 6],
        ]),
      },
    ]);
    s.doc.flush();
    const beforeTiles = JSON.stringify(snapshot(s.doc));
    const beforeScene = JSON.stringify(sceneSnapshot(s.doc));
    const sent: string[] = [];
    s.history.onOps((_ops, origin) => sent.push(origin));
    applyGeneration(s, { result: result(), pack: PACK, target: 'map' }, uids());
    expect(s.doc.object('old')).toBeUndefined();
    s.undo();
    expect(sent).toEqual(['do', 'undo']);
    expect(JSON.stringify(sceneSnapshot(s.doc))).toBe(beforeScene);
    // Tiles are back (the added palette entries are harmless and stay).
    const after = snapshot(s.doc) as { chunks: unknown };
    expect(JSON.stringify(after.chunks)).toBe(
      JSON.stringify((JSON.parse(beforeTiles) as { chunks: unknown }).chunks),
    );
    expect(s.history.state.undoSize).toBe(0);
    s.redo();
    expect(s.doc.getCell('ground', 1, 0).index).not.toBe(0);
  });

  it('selection target: offset, only the rectangle and the objects inside are replaced', () => {
    const s = session();
    s.doc.apply([
      { type: 'tiles.set', floor: 'f1', layer: 'ground', cells: [[0, 0, 0, 0, 0]] },
      {
        type: 'object.add',
        object: wall('in', [
          [4, 4],
          [6, 4],
        ]),
      },
      {
        type: 'object.add',
        object: wall('out', [
          [0, 8],
          [2, 8],
        ]),
      },
    ]);
    s.doc.flush();
    applyGeneration(
      s,
      { result: result(), pack: PACK, target: 'selection', rect: { x: 3, y: 3, w: 4, h: 3 } },
      uids(),
    );
    expect(s.doc.getCell('ground', 3, 3).index).not.toBe(0); // (0,0) + offset
    expect(s.doc.getCell('ground', 5, 3).index).toBe(0);
    expect(s.doc.object('in')).toBeUndefined();
    expect(s.doc.object('out')).toBeDefined();
    const added = s.doc.objects().filter((o) => o.uid.startsWith('g'));
    expect(added).toHaveLength(3);
    const w = added.find((o) => o.type === 'wall')!;
    expect(w.type === 'wall' && w.geometry.points).toEqual([
      [3, 3],
      [6, 3],
    ]);
    expect(() =>
      applyGeneration(s, { result: result(), pack: PACK, target: 'selection' }, uids()),
    ).toThrow(/rect/);
  });

  it('reuses an existing palette entry for the same asset', () => {
    const s = session();
    applyGeneration(s, { result: result(), pack: PACK, target: 'map' }, uids());
    const size = s.doc.palette.length;
    applyGeneration(s, { result: result(), pack: PACK, target: 'map' }, uids());
    expect(s.doc.palette.length).toBe(size);
  });
});
