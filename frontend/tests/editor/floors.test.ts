import { describe, expect, it } from 'vitest';
import type { FloorInfo, MapOp, TileCell } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import {
  floorAddCommand,
  floorRemoveCommand,
  floorUpdateCommand,
  nextFreeLevel,
} from '../../src/editor/model/floor-commands';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { fogChunkWire } from '../../src/editor/model/fog-wire';
import { MapOpError } from '../../src/editor/model/ops';
import { createFogBitmap } from '../../src/formats/fog-codec';
import { grid, palette } from './helpers';
import { light, placed, wall } from './scene-helpers';

const floors: FloorInfo[] = [
  { id: '10', uid: 'ground', level: 0, name: 'RdC', sort_order: 0 },
  { id: '11', uid: 'upper', level: 1, name: 'Étage', sort_order: 1 },
];

function twoFloors(): MapDocument {
  const doc = new MapDocument({
    grid: grid(64, 64),
    palette: palette(6),
    floor: 'ground',
    floors,
  });
  doc.markFloorLoaded('upper');
  doc.flush();
  return doc;
}

function fogBits(): Uint8Array {
  const bits = createFogBitmap();
  bits[3] = 0xff;
  return bits;
}

const tiles = (floor: string, cells: TileCell[]): MapOp => ({
  type: 'tiles.set',
  floor,
  layer: 'ground',
  cells,
});

describe('floors of the document', () => {
  it('lists the floors by level and shows the first one named', () => {
    const doc = twoFloors();
    expect(doc.floors().map((f) => f.uid)).toEqual(['ground', 'upper']);
    expect(doc.floor).toBe('ground');
    expect(doc.floors()[1]).toMatchObject({ id: '11', loaded: true });
  });

  it('only loads the shown floor at first', () => {
    const doc = new MapDocument({ grid: grid(8, 8), floor: 'ground', floors });
    expect(doc.floors().map((f) => f.loaded)).toEqual([true, false]);
  });

  it('applies tiles.set to any floor, by uid or by server id, and shows only the current one', () => {
    const doc = twoFloors();
    doc.applyOps([tiles('upper', [[2, 2, 1, 0, 0]]), tiles('11', [[3, 3, 2, 0, 0]])]);
    expect(doc.getCell('ground', 2, 2).index).toBe(0);
    expect(doc.getCell('ground', 2, 2, 'upper').index).toBe(1);
    expect(doc.getCell('ground', 3, 3, 'upper').index).toBe(2);
    doc.setCurrentFloor('upper');
    expect(doc.getCell('ground', 2, 2).index).toBe(1);
    expect(doc.chunkKeys('ground')).toEqual(['0:0']);
  });

  it('tells the engine everything changed when the floor is switched', () => {
    const doc = twoFloors();
    doc.applyOps([
      tiles('upper', [[1, 1, 1, 0, 0]]),
      { type: 'object.add', object: { ...light('l1', 3, 3), floor: 'upper' } },
    ]);
    doc.flush();
    const chunks: string[] = [];
    const scenes: string[][] = [];
    doc.onChunksChanged((e) => chunks.push(...e.keys));
    doc.onSceneChanged((e) => scenes.push([...e.objects]));
    doc.setCurrentFloor('upper');
    doc.flush();
    expect(chunks).toContain('0:0');
    expect(scenes.flat()).toContain('l1');
    expect(doc.objects().map((o) => o.uid)).toEqual(['l1']);
    doc.setCurrentFloor('ground');
    expect(doc.objects()).toEqual([]);
  });

  it('keeps objects and tokens by floor, whichever way the floor is designated', () => {
    const doc = twoFloors();
    doc.loadScene(
      [
        {
          ...wall('w1', [
            [0, 0],
            [4, 0],
          ]),
          floor: '11',
        },
      ],
      [{ ...placed('p1', 2, 2), floor: '10' }],
    );
    expect(doc.objects()).toEqual([]);
    expect(doc.tokens().map((t) => t.uid)).toEqual(['p1']);
    expect(doc.tokens()[0]?.floor).toBe('ground');
    expect(doc.objectsOf('upper').map((o) => o.uid)).toEqual(['w1']);
    expect(doc.object('w1')?.floor).toBe('upper');
  });

  it('floor.add, floor.update and floor.remove with their inverses', () => {
    const doc = twoFloors();
    const add = doc.applyOps([
      { type: 'floor.add', floor: { uid: 'cave', name: 'Cave', level: -1 } },
    ]);
    expect(add).toEqual([{ type: 'floor.remove', uid: 'cave' }]);
    expect(doc.floors().map((f) => f.uid)).toEqual(['cave', 'ground', 'upper']);
    const upd = doc.applyOps([
      { type: 'floor.update', uid: 'cave', patch: { name: 'Crypte', level: 3 } },
    ]);
    expect(upd).toEqual([
      { type: 'floor.update', uid: 'cave', patch: { name: 'Cave', level: -1 } },
    ]);
    expect(doc.floors().map((f) => f.uid)).toEqual(['ground', 'upper', 'cave']);
    doc.applyOps(add.length === 0 ? [] : [{ type: 'floor.remove', uid: 'cave' }]);
    expect(doc.floors().map((f) => f.uid)).toEqual(['ground', 'upper']);
  });

  it('refuses invalid floor ops atomically', () => {
    const doc = twoFloors();
    const code = (ops: MapOp[]): string | undefined => {
      try {
        doc.applyOps(ops);
      } catch (e) {
        return e instanceof MapOpError ? e.code : 'other';
      }
      return undefined;
    };
    expect(code([{ type: 'floor.add', floor: { uid: 'ground', name: 'X', level: 5 } }])).toBe(
      'floor_taken',
    );
    expect(code([{ type: 'floor.add', floor: { uid: '123', name: 'X', level: 5 } }])).toBe(
      'bad_floor',
    );
    expect(code([{ type: 'floor.add', floor: { uid: 'x', name: 'X', level: 1 } }])).toBe(
      'floor_taken',
    );
    expect(code([{ type: 'floor.add', floor: { uid: 'x', name: 'X', level: 10 } }])).toBe(
      'bad_floor',
    );
    expect(code([{ type: 'floor.add', floor: { uid: 'x', name: ' ', level: 5 } }])).toBe(
      'bad_floor',
    );
    expect(code([{ type: 'floor.update', uid: 'upper', patch: { level: 0 } }])).toBe('floor_taken');
    expect(code([{ type: 'floor.update', uid: 'nope', patch: { name: 'a' } }])).toBe(
      'unknown_floor',
    );
    // Atomic: the valid first op is rolled back.
    expect(
      code([
        { type: 'floor.add', floor: { uid: 'ok', name: 'Ok', level: 5 } },
        { type: 'floor.remove', uid: 'nope' },
      ]),
    ).toBe('unknown_floor');
    expect(doc.floors()).toHaveLength(2);
  });

  it('allows ten floors and refuses the eleventh; never removes the last floor', () => {
    const doc = twoFloors();
    for (let i = 0; i < 8; i++) {
      doc.applyOps([{ type: 'floor.add', floor: { uid: `f${i}`, name: `F${i}`, level: i + 2 } }]);
    }
    expect(doc.floors()).toHaveLength(10);
    expect(() =>
      doc.applyOps([{ type: 'floor.add', floor: { uid: 'more', name: 'M', level: -1 } }]),
    ).toThrow(MapOpError);
    const single = new MapDocument({ grid: grid(8, 8), floor: 'only' });
    expect(() => single.applyOps([{ type: 'floor.remove', uid: 'only' }])).toThrow(/last floor/);
  });

  it('refuses to remove a floor whose content is not in memory', () => {
    const doc = new MapDocument({ grid: grid(8, 8), floor: 'ground', floors });
    expect(() => doc.applyOps([{ type: 'floor.remove', uid: 'upper' }])).toThrow(/not loaded/);
  });

  it('removing the shown floor shows the first remaining one', () => {
    const doc = twoFloors();
    doc.setCurrentFloor('upper');
    doc.applyOps([{ type: 'floor.remove', uid: 'upper' }]);
    expect(doc.floor).toBe('ground');
  });
});

describe('floor commands and history', () => {
  it('undoing floor.remove recreates the floor and everything it held, by uid', () => {
    const doc = twoFloors();
    const history = new History(doc);
    const sent: MapOp[][] = [];
    history.onOps((ops) => sent.push([...ops]));
    history.execute({
      label: 'x',
      ops: [
        tiles('upper', [[5, 5, 3, 1, 0]]),
        {
          type: 'object.add',
          object: {
            ...wall('w9', [
              [1, 1],
              [5, 1],
            ]),
            floor: 'upper',
          },
        },
        { type: 'maptoken.add', token: { ...placed('p9', 3, 3), floor: 'upper' } },
        {
          type: 'fog.reveal',
          floor: 'upper',
          chunks: [fogChunkWire('0:0', fogBits())],
        },
      ],
      inverseOps: [],
    });
    sent.length = 0;
    history.execute(floorRemoveCommand('upper'));
    expect(doc.floors().map((f) => f.uid)).toEqual(['ground']);
    expect(sent[0]).toEqual([{ type: 'floor.remove', uid: 'upper' }]);

    sent.length = 0;
    history.undo();
    const replayed = sent[0]!;
    expect(replayed[0]).toEqual({
      type: 'floor.add',
      floor: { uid: 'upper', name: 'Étage', level: 1 },
    });
    expect(replayed.map((o) => o.type)).toEqual([
      'floor.add',
      'tiles.set',
      'object.add',
      'maptoken.add',
      'fog.reveal',
    ]);
    // Every op designates the floor by its uid: the server gives a new id to the re-created floor.
    for (const op of replayed.slice(1)) {
      const floor =
        op.type === 'object.add'
          ? op.object.floor
          : op.type === 'maptoken.add'
            ? op.token.floor
            : (op as { floor: string }).floor;
      expect(floor).toBe('upper');
    }
    expect(doc.floors().map((f) => f.uid)).toEqual(['ground', 'upper']);
    expect(doc.getCell('ground', 5, 5, 'upper')).toEqual({ index: 3, variant: 1, flags: 0 });
    expect(doc.objectsOf('upper').map((o) => o.uid)).toEqual(['w9']);
    expect(doc.tokensOf('upper').map((t) => t.uid)).toEqual(['p9']);
    expect(doc.fogKeysOf('upper')).toEqual(['0:0']);

    history.redo();
    expect(doc.floors().map((f) => f.uid)).toEqual(['ground']);
  });

  it('undoes a floor rename and a level change', () => {
    const doc = twoFloors();
    const history = new History(doc);
    history.execute(floorUpdateCommand('upper', { name: 'Grenier' }));
    history.execute(floorUpdateCommand('upper', { level: 4 }));
    expect(doc.floorMeta('upper')).toMatchObject({ name: 'Grenier', level: 4 });
    history.undo();
    history.undo();
    expect(doc.floorMeta('upper')).toMatchObject({ name: 'Étage', level: 1 });
    expect(history.state.undoSize).toBe(0);
  });

  it('adds a floor as an undoable command', () => {
    const doc = twoFloors();
    const history = new History(doc);
    history.execute(floorAddCommand('cave', 'Cave', -1));
    expect(doc.floors()[0]?.uid).toBe('cave');
    history.undo();
    expect(doc.floors().map((f) => f.uid)).toEqual(['ground', 'upper']);
  });

  it('undoes an edit of another floor than the shown one, and keeps the history across floors', () => {
    const doc = twoFloors();
    const history = new History(doc);
    history.execute({ label: 'p', ops: [tiles('upper', [[7, 7, 2, 0, 0]])], inverseOps: [] });
    doc.setCurrentFloor('upper');
    doc.setCurrentFloor('ground');
    expect(history.state.canUndo).toBe(true);
    history.undo();
    expect(doc.getCell('ground', 7, 7, 'upper').index).toBe(0);
  });

  it('picks the next free level', () => {
    expect(nextFreeLevel([0])).toBe(1);
    expect(nextFreeLevel([0, 1, 2])).toBe(3);
    expect(nextFreeLevel([9, 8])).toBe(-1);
    expect(nextFreeLevel([])).toBe(1);
  });
});
