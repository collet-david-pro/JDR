import { describe, expect, it, vi } from 'vitest';
import type { Command, MapOp, TileCell, TileLayerId } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import {
  layerPatchCommand,
  layerOrderCommand,
  themeCommand,
} from '../../src/editor/model/commands';
import type { MapDocument } from '../../src/editor/model/MapDocument';
import { createRng, type Rng } from '../../src/editor/util/rng';
import { TILE_LAYERS } from '../../src/formats/chunk-codec';
import { makeDoc, snapshot } from './helpers';

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1000;
  return { now: () => t, advance: (ms) => (t += ms) };
}

function paint(layer: TileLayerId, cells: TileCell[], mergeKey?: string): Command {
  return {
    label: 'editor.command.paint',
    ops: [{ type: 'tiles.set', floor: 'f1', layer, cells }],
    inverseOps: [],
    ...(mergeKey !== undefined ? { mergeKey } : {}),
  };
}

/** Random command against the current document state. */
function randomCommand(rng: Rng, doc: MapDocument): Command | null {
  const r = rng.int(10);
  if (r === 0)
    return themeCommand(
      doc.theme,
      (['parchment', 'slate', 'blueprint', 'dark', 'light'] as const)[rng.int(5)]!,
    );
  if (r === 1) {
    const layer = doc.layers[rng.int(doc.layers.length)]!;
    return layerPatchCommand(doc, layer.id, { locked: !layer.locked, opacity: rng.int(11) / 10 });
  }
  if (r === 2) return layerOrderCommand(doc, doc.layers[rng.int(8)]!.id, rng.int(8));
  const layer = TILE_LAYERS[rng.int(3)]!;
  const cells: TileCell[] = [];
  const n = 1 + rng.int(r === 3 ? 400 : 20);
  for (let i = 0; i < n; i++) {
    const index = rng.int(4) === 0 ? 0 : 1 + rng.int(7);
    cells.push([
      rng.int(70),
      rng.int(70),
      index,
      index === 0 ? 0 : rng.int(4),
      index === 0 ? 0 : rng.int(16),
    ]);
  }
  return paint(layer, cells, rng.int(3) === 0 ? 'stroke' : undefined);
}

describe('History', () => {
  it('undo(do(s)) = s on random command sequences (property, seeded)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createRng(seed);
      const doc = makeDoc(70, 70);
      const c = clock();
      const history = new History(doc, { now: c.now });
      // Random prefix: s is an arbitrary state.
      for (let i = 0; i < 10; i++) {
        const cmd = randomCommand(rng, doc);
        if (cmd !== null) history.execute(cmd);
        c.advance(rng.int(800));
      }
      const states: unknown[] = [snapshot(doc)];
      let done = 0;
      for (let i = 0; i < 30; i++) {
        const cmd = randomCommand(rng, doc);
        c.advance(rng.int(800));
        if (cmd === null) continue;
        const before = history.state.undoSize;
        const merged = history.execute(cmd) && history.state.undoSize === before;
        if (merged) states[states.length - 1] = snapshot(doc);
        else if (history.state.undoSize > before) {
          states.push(snapshot(doc));
          done++;
        } else states[states.length - 1] = snapshot(doc);
        // Single step: undo then redo is the identity.
        if (rng.int(4) === 0) {
          const s = snapshot(doc);
          history.undo();
          history.redo();
          expect(snapshot(doc)).toEqual(s);
        }
      }
      // Unwind everything done in this phase: each undo restores the previous recorded state.
      for (let k = done; k > 0; k--) {
        expect(history.undo()).toBe(true);
        expect(snapshot(doc), `seed ${seed} step ${k}`).toEqual(states[k - 1]);
      }
    }
  });

  it('keeps 200 commands and survives 200 undo/redo cycles', () => {
    const doc = makeDoc(64, 64);
    const history = new History(doc);
    const empty = snapshot(doc);
    for (let i = 0; i < 250; i++)
      history.execute(paint('ground', [[i % 64, Math.floor(i / 64), 1 + (i % 7), 0, 0]]));
    const full = snapshot(doc);
    expect(history.state.undoSize).toBe(200);
    for (let i = 0; i < 200; i++) expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(false);
    // The 50 oldest commands are no longer undoable.
    expect(snapshot(doc)).not.toEqual(empty);
    expect(doc.getCell('ground', 49, 0).index).toBe(1 + (49 % 7));
    expect(doc.getCell('ground', 50, 0).index).toBe(0);
    for (let i = 0; i < 200; i++) expect(history.redo()).toBe(true);
    expect(history.redo()).toBe(false);
    expect(snapshot(doc)).toEqual(full);
  });

  it('merges same mergeKey within 500 ms (sliding window)', () => {
    const doc = makeDoc();
    const c = clock();
    const history = new History(doc, { now: c.now });
    history.execute(paint('ground', [[0, 0, 1, 0, 0]], 'brush:1'));
    for (let i = 1; i < 10; i++) {
      c.advance(400);
      history.execute(
        paint(
          'ground',
          [
            [i, 0, 1, 0, 0],
            [0, 0, 2, 0, 0],
          ],
          'brush:1',
        ),
      );
    }
    expect(history.state.undoSize).toBe(1);
    c.advance(501);
    history.execute(paint('ground', [[0, 1, 1, 0, 0]], 'brush:1'));
    expect(history.state.undoSize).toBe(2);
    history.execute(paint('ground', [[0, 2, 1, 0, 0]], 'brush:2'));
    history.execute(paint('ground', [[0, 3, 1, 0, 0]]));
    history.execute(paint('ground', [[0, 4, 1, 0, 0]]));
    expect(history.state.undoSize).toBe(5);
    history.undo();
    history.undo();
    history.undo();
    history.undo();
    expect(doc.getCell('ground', 0, 0).index).toBe(2);
    history.undo();
    expect(doc.chunkKeys('ground')).toEqual([]);
    history.redo();
    expect(doc.getCell('ground', 9, 0).index).toBe(1);
    expect(doc.getCell('ground', 0, 0).index).toBe(2);
    // No merge across an undo/redo boundary or after breakMerge().
    history.execute(paint('ground', [[5, 5, 1, 0, 0]], 'brush:1'));
    expect(history.state.undoSize).toBe(2);
    history.breakMerge();
    history.execute(paint('ground', [[5, 6, 1, 0, 0]], 'brush:1'));
    expect(history.state.undoSize).toBe(3);
  });

  it('recomputes inverses on the current state and skips cells changed by others', () => {
    const doc = makeDoc();
    const history = new History(doc);
    history.execute(
      paint('ground', [
        [0, 0, 1, 0, 0],
        [1, 0, 1, 0, 0],
      ]),
    );
    // A remote op (not through the history) changes one of our cells.
    doc.applyOps([{ type: 'tiles.set', floor: 'f1', layer: 'ground', cells: [[1, 0, 5, 0, 0]] }]);
    history.undo();
    expect(history.lastUndoSkipped).toBe(1);
    expect(doc.getCell('ground', 0, 0).index).toBe(0);
    expect(doc.getCell('ground', 1, 0).index).toBe(5);
    // Redo recomputes the inverse from the state at redo time.
    doc.applyOps([{ type: 'tiles.set', floor: 'f1', layer: 'ground', cells: [[0, 0, 3, 0, 0]] }]);
    history.redo();
    history.undo();
    expect(doc.getCell('ground', 0, 0).index).toBe(3);
  });

  it('emits state and ops events, ignores no-op commands', () => {
    const doc = makeDoc();
    const history = new History(doc);
    const states = vi.fn();
    const ops = vi.fn<(o: readonly MapOp[], origin: string) => void>();
    history.onChange(states);
    history.onOps(ops);
    expect(history.execute(paint('ground', [[0, 0, 1, 0, 0]]))).toBe(true);
    expect(history.state).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoLabel: 'editor.command.paint',
    });
    expect(history.execute(paint('ground', [[0, 0, 1, 0, 0]]))).toBe(false);
    history.undo();
    expect(history.state).toMatchObject({
      canUndo: false,
      canRedo: true,
      redoLabel: 'editor.command.paint',
    });
    history.applyUntracked([{ type: 'palette.add', index: 8, asset_id: 'z' }]);
    expect(history.state.canRedo).toBe(true);
    expect(ops.mock.calls.map((c) => c[1])).toEqual(['do', 'do', 'undo', 'untracked']);
    expect(states).toHaveBeenCalledTimes(2);
    history.clear();
    expect(history.state).toMatchObject({ canUndo: false, canRedo: false });
  });
});
