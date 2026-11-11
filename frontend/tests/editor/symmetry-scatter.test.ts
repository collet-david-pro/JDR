import { describe, expect, it } from 'vitest';
import { History } from '../../src/editor/history/History';
import { scatterAlong, type ScatterOptions } from '../../src/editor/tools/scatter-math';
import { NO_SYMMETRY, mirrorCoord, symmetricCells } from '../../src/editor/tools/symmetry';
import { createTools } from '../../src/editor/tools';
import { createRng } from '../../src/editor/util/rng';
import { context, ev, makeDoc, settings } from './helpers';

const sorted = (cells: readonly (readonly [number, number])[]): string[] =>
  cells.map(([x, y]) => `${x},${y}`).sort();

describe('symmetricCells', () => {
  it('is the identity (clipped) without options', () => {
    expect(
      symmetricCells(
        [
          [1, 1],
          [20, 1],
        ],
        NO_SYMMETRY,
        10,
        10,
      ),
    ).toEqual([[1, 1]]);
  });
  it('mirrors around the map centre and a chosen axis', () => {
    const v = { ...NO_SYMMETRY, axes: 'vertical' as const };
    expect(sorted(symmetricCells([[1, 2]], v, 10, 10))).toEqual(['1,2', '8,2']);
    const both = { ...NO_SYMMETRY, axes: 'both' as const };
    expect(sorted(symmetricCells([[1, 2]], both, 10, 10))).toEqual(['1,2', '1,7', '8,2', '8,7']);
    // Axis through the centre of cell 4 (position 4.5): cell 3 <-> cell 5.
    expect(mirrorCoord(3, 4.5)).toBe(5);
    expect(sorted(symmetricCells([[3, 0]], { ...v, axisX: 4.5 }, 10, 10))).toEqual(['3,0', '5,0']);
  });
  it('repeats with a step and drops copies outside the map', () => {
    const r = { ...NO_SYMMETRY, repeatStepX: 3, repeatStepY: 0, repeatCount: 3 };
    expect(sorted(symmetricCells([[1, 1]], r, 8, 8))).toEqual(['1,1', '4,1', '7,1']);
  });
});

describe('brush with symmetry', () => {
  it('paints mirrored cells in one undo step', () => {
    const doc = makeDoc(10, 10);
    const history = new History(doc);
    const s = settings({ symmetry: { ...NO_SYMMETRY, axes: 'vertical' } });
    const tools = createTools(context(doc, s));
    const r = tools.brush.onPointer(ev('down', 2, 3));
    history.execute(r.command!);
    tools.brush.onPointer(ev('up', 2, 3));
    expect(doc.getCell('ground', 2, 3).index).toBe(1);
    expect(doc.getCell('ground', 7, 3).index).toBe(1);
    expect(history.state.undoSize).toBe(1);
    history.undo();
    expect(doc.getCell('ground', 7, 3).index).toBe(0);
  });
});

describe('scatterAlong', () => {
  const opts: ScatterOptions = {
    density: 1,
    spacing: 0,
    radius: 2,
    randomRotation: true,
    scaleVariation: 0.3,
  };
  it('is deterministic for a seed and respects ranges', () => {
    const a = scatterAlong([2, 2], [8, 2], opts, [], createRng(5), 3);
    const b = scatterAlong([2, 2], [8, 2], opts, [], createRng(5), 3);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(5);
    for (const it of a) {
      expect(it.rotation).toBeGreaterThanOrEqual(0);
      expect(it.rotation).toBeLessThan(360);
      expect(it.scale).toBeGreaterThanOrEqual(0.7);
      expect(it.scale).toBeLessThanOrEqual(1.3);
      expect(it.asset).toBeLessThan(3);
    }
  });
  it('keeps the minimal spacing and the budget', () => {
    const placed: [number, number][] = [];
    const items = scatterAlong([2, 2], [10, 2], { ...opts, spacing: 1 }, placed, createRng(2), 1);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        expect(
          Math.hypot(items[i]!.x - items[j]!.x, items[i]!.y - items[j]!.y),
        ).toBeGreaterThanOrEqual(1);
      }
    }
    expect(scatterAlong([2, 2], [10, 2], opts, [], createRng(2), 1, 3)).toHaveLength(3);
    expect(scatterAlong([2, 2], [10, 2], opts, [], createRng(2), 0)).toEqual([]);
  });
});

describe('object brush tool', () => {
  it('adds image objects, one merged undo step per stroke', () => {
    const doc = makeDoc(30, 30);
    const history = new History(doc);
    doc.setImageAssets([{ assetId: '11', name: 'x', url: null, width: 70, height: 70 }]);
    const s = settings({
      scatterAssetIds: ['11'],
      scatter: { density: 1, spacing: 0, radius: 2, randomRotation: false, scaleVariation: 0 },
    });
    const tools = createTools(context(doc, s));
    const r1 = tools.scatter.onPointer(ev('down', 5, 5));
    expect(r1.command?.mergeKey).toMatch(/^scatter:/);
    if (r1.command) history.execute(r1.command);
    const r2 = tools.scatter.onPointer(ev('move', 15, 5));
    expect(r2.command?.ops.every((o) => o.type === 'object.add')).toBe(true);
    history.execute(r2.command!);
    tools.scatter.onPointer(ev('up', 15, 5));
    expect(doc.objects().length).toBeGreaterThan(5);
    expect(history.state.undoSize).toBe(1);
    history.undo();
    expect(doc.objects()).toHaveLength(0);
  });
  it('needs an image', () => {
    const doc = makeDoc(30, 30);
    const tools = createTools(context(doc, settings()));
    expect(tools.scatter.onPointer(ev('down', 5, 5)).notice?.code).toBe('no_image');
  });
});
