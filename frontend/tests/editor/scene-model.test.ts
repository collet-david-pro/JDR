import { describe, expect, it } from 'vitest';
import type { MapOp } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import { decodeFogData, encodeFogData, fogOps } from '../../src/editor/model/fog-wire';
import { MapOpError } from '../../src/editor/model/ops';
import { createFogBitmap, getFogBit, setFogBit } from '../../src/formats/fog-codec';
import { fogRasterizers } from '../../src/vision/index';
import { door, light, makeSceneDoc, placed, sceneSnapshot, wall } from './scene-helpers';

function seeded() {
  const doc = makeSceneDoc();
  doc.apply([
    {
      type: 'object.add',
      object: wall('w1', [
        [1, 1],
        [10, 1],
      ]),
    },
    { type: 'object.add', object: light('l1', 5, 5) },
    { type: 'maptoken.add', token: placed('k1', 2.5, 2.5) },
  ]);
  doc.flush();
  return doc;
}

const fogReveal = (x: number, y: number, w: number, h: number): MapOp =>
  fogOps('fog.reveal', 'f1', fogRasterizers.rect(x, y, w, h, 64, 64))[0]!;

describe('MapDocument scene: undo(do(s)) = s for every P5 op', () => {
  const cases: [string, MapOp[]][] = [
    ['object.add', [{ type: 'object.add', object: door('d1', [3, 1], [4, 1]) }]],
    [
      'object.update',
      [{ type: 'object.update', uid: 'w1', rev: 1, patch: { locked: true, sort_order: 4 } }],
    ],
    ['object.remove', [{ type: 'object.remove', uid: 'l1' }]],
    ['maptoken.add', [{ type: 'maptoken.add', token: placed('k2', 7.5, 7.5, 't2') }]],
    [
      'maptoken.update',
      [{ type: 'maptoken.update', uid: 'k1', rev: 1, patch: { x: 9, hidden: true } }],
    ],
    ['maptoken.remove', [{ type: 'maptoken.remove', uid: 'k1' }]],
    ['fog.reveal', [fogReveal(0, 0, 5, 5)]],
    ['map.meta ambient', [{ type: 'map.meta', ambient: { darkness: 0.7, tint: '#203040' } }]],
  ];
  for (const [name, ops] of cases) {
    it(name, () => {
      const doc = seeded();
      const before = sceneSnapshot(doc);
      const { inverse } = doc.apply(ops);
      expect(sceneSnapshot(doc)).not.toEqual(before);
      doc.apply(inverse);
      expect(sceneSnapshot(doc)).toEqual(before);
    });
  }

  it('fog.hide undo restores only the bits it cleared', () => {
    const doc = seeded();
    doc.apply([fogReveal(0, 0, 4, 4)]);
    const before = sceneSnapshot(doc);
    const hide = fogOps('fog.hide', 'f1', fogRasterizers.rect(2, 2, 6, 6, 64, 64))[0]!;
    const { inverse } = doc.apply([hide]);
    // Inverse = reveal of the cleared bits only (not of the whole hidden rectangle).
    expect(inverse[0]!.type).toBe('fog.reveal');
    doc.apply(inverse);
    expect(sceneSnapshot(doc)).toEqual(before);
    expect(getFogBit(doc.fogChunk('0:0')!, 30, 30)).toBe(false);
  });

  it('a fog.reveal inverse only hides the newly set bits', () => {
    const doc = seeded();
    doc.apply([fogReveal(0, 0, 2, 2)]);
    const { inverse } = doc.apply([fogReveal(0, 0, 4, 4)]);
    doc.apply(inverse);
    expect(getFogBit(doc.fogChunk('0:0')!, 1, 1)).toBe(true); // explored before: kept
    expect(getFogBit(doc.fogChunk('0:0')!, 12, 12)).toBe(false);
  });

  it('an all-cleared chunk is dropped; invalid fog data leaves the fog untouched', () => {
    const doc = seeded();
    doc.apply([fogReveal(0, 0, 2, 2)]);
    doc.apply([fogOps('fog.hide', 'f1', fogRasterizers.rect(0, 0, 2, 2, 64, 64))[0]!]);
    expect(doc.fogKeys()).toEqual([]);
    expect(() =>
      doc.apply([{ type: 'fog.reveal', floor: 'f1', chunks: [[0, 0, 'AAAA']] }]),
    ).toThrow(MapOpError);
    expect(() =>
      doc.apply([
        { type: 'fog.reveal', floor: 'f1', chunks: [[5, 0, encodeFogData(createFogBitmap())]] },
      ]),
    ).toThrow(MapOpError);
  });
});

describe('rev rule', () => {
  it('stamps the rev current at execution and increments it locally', () => {
    const doc = seeded();
    const first = doc.apply([
      { type: 'object.update', uid: 'w1', rev: 99, patch: { locked: true } },
    ]);
    expect(first.ops[0]).toMatchObject({ type: 'object.update', rev: 1 });
    expect(doc.object('w1')!.rev).toBe(2);
    const second = doc.apply([
      { type: 'object.update', uid: 'w1', rev: 1, patch: { locked: false } },
    ]);
    expect(second.ops[0]).toMatchObject({ rev: 2 });
    expect(doc.object('w1')!.rev).toBe(3);
  });

  it('undo / redo through the history send the current rev', () => {
    const doc = seeded();
    const history = new History(doc);
    const sent: MapOp[][] = [];
    history.onOps((ops) => sent.push([...ops]));
    history.execute({
      label: 'x',
      ops: [{ type: 'maptoken.update', uid: 'k1', rev: 1, patch: { x: 6 } }],
      inverseOps: [],
    });
    history.undo();
    history.redo();
    expect(sent.map((ops) => (ops[0] as { rev: number }).rev)).toEqual([1, 2, 3]);
    expect(doc.token('k1')).toMatchObject({ x: 6, rev: 4 });
  });

  it('adds start at rev 1 and values are rounded to 3 decimals', () => {
    const doc = makeSceneDoc();
    const { ops } = doc.apply([
      { type: 'object.add', object: { ...light('l9', 1.23456, 2.0004), rev: 7 } },
    ]);
    expect(doc.object('l9')).toMatchObject({ rev: 1, geometry: { x: 1.235, y: 2 } });
    expect(ops[0]).toMatchObject({ object: { rev: 1, geometry: { x: 1.235, y: 2 } } });
  });

  it('refuses invalid objects atomically and duplicate uids', () => {
    const doc = seeded();
    const before = sceneSnapshot(doc, true);
    expect(() =>
      doc.apply([
        { type: 'object.update', uid: 'w1', rev: 1, patch: { locked: true } },
        {
          type: 'object.add',
          object: {
            ...light('bad', 1, 1),
            props: { ...light('x', 1, 1).props, radius: 9, dim_radius: 2 },
          },
        },
      ]),
    ).toThrow(MapOpError);
    expect(sceneSnapshot(doc, true)).toEqual(before);
    expect(() =>
      doc.apply([
        {
          type: 'object.add',
          object: wall('w1', [
            [0, 0],
            [1, 1],
          ]),
        },
      ]),
    ).toThrow(/exists/);
  });

  it('update / remove of an unknown uid change nothing (removal wins)', () => {
    const doc = seeded();
    const r = doc.apply([
      { type: 'object.update', uid: 'nope', rev: 1, patch: { locked: true } },
      { type: 'maptoken.remove', uid: 'nope' },
    ]);
    expect(r.inverse).toEqual([]);
    expect(r.ops).toHaveLength(2);
  });
});

describe('conflicts and foreign changes', () => {
  it('replaceObject / replaceToken apply the server state outside the history', () => {
    const doc = seeded();
    const history = new History(doc);
    history.execute({
      label: 'x',
      ops: [{ type: 'object.update', uid: 'w1', rev: 1, patch: { locked: true } }],
      inverseOps: [],
    });
    // The server refused it (stale): its state replaces ours.
    doc.replaceObject('w1', {
      ...wall('w1', [
        [2, 2],
        [3, 3],
      ]),
      rev: 5,
    });
    expect(doc.object('w1')).toMatchObject({ rev: 5, locked: false });
    // Undo leaves the object alone (changed by someone else) and reports it.
    history.undo();
    expect(history.lastUndoSkipped).toBe(1);
    expect(doc.object('w1')).toMatchObject({
      rev: 5,
      geometry: {
        points: [
          [2, 2],
          [3, 3],
        ],
      },
    });
    doc.replaceToken('k1', null);
    expect(doc.token('k1')).toBeUndefined();
  });

  it('emits batched scene events', async () => {
    const doc = makeSceneDoc();
    const events: unknown[] = [];
    doc.onSceneChanged((e) => events.push(e));
    doc.apply([
      {
        type: 'object.add',
        object: wall('w1', [
          [0, 0],
          [2, 0],
        ]),
      },
    ]);
    doc.apply([{ type: 'maptoken.add', token: placed('k1', 1.5, 1.5) }]);
    await Promise.resolve();
    expect(events).toEqual([
      { objects: ['w1'], tokens: ['k1'], fog: [], ambient: false, tokenDefs: false },
    ]);
    expect(doc.sceneRevision).toBe(2);
  });

  it('loadScene keeps the floor objects and sorts them by sort_order then uid', () => {
    const doc = makeSceneDoc();
    const { skipped } = doc.loadScene(
      [
        {
          ...wall('b', [
            [0, 0],
            [1, 0],
          ]),
          sort_order: 1,
        },
        {
          ...wall('a', [
            [0, 0],
            [1, 0],
          ]),
          sort_order: 1,
        },
        {
          ...wall('c', [
            [0, 0],
            [1, 0],
          ]),
          sort_order: -1,
        },
        {
          ...wall('z', [
            [0, 0],
            [1, 0],
          ]),
          floor: 'other',
        },
        { ...wall('bad', [[0, 0]]) },
      ],
      [placed('k1', 1, 1)],
    );
    expect(skipped).toBe(1);
    expect(doc.objects().map((o) => o.uid)).toEqual(['c', 'a', 'b']);
    expect(doc.tokens()).toHaveLength(1);
  });
});

describe('fog wire', () => {
  it('round-trips a bitmap and splits ops at 200 chunks', () => {
    const bits = createFogBitmap();
    setFogBit(bits, 3, 4);
    expect(decodeFogData(encodeFogData(bits))).toEqual(bits);
    const many = new Map<`${number}:${number}`, Uint8Array>();
    for (let i = 0; i < 250; i++) many.set(`${i % 13}:${Math.floor(i / 13)}`, bits);
    const ops = fogOps('fog.reveal', 'f1', many);
    expect(ops.map((o) => (o.type === 'fog.reveal' ? o.chunks.length : 0))).toEqual([200, 50]);
  });
});
