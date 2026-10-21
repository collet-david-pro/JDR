/**
 * Performance budgets of the editor core (projet.md 22). Generous thresholds so that CI machines
 * pass; measured values are printed for the phase report.
 */
import { describe, expect, it } from 'vitest';
import type { TileCell } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import { createTools } from '../../src/editor/tools/index';
import { createRng } from '../../src/editor/util/rng';
import { TILE_LAYERS } from '../../src/formats/chunk-codec';
import { context, ev, makeDoc, settings } from './helpers';

function time(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('editor core performance', () => {
  it('fills 200×200 cells on 3 layers', () => {
    const doc = makeDoc(200, 200);
    const history = new History(doc);
    const s = settings({ variantCount: 4 });
    const tools = createTools(context(doc, s));
    // Warm-up on another document (JIT).
    createTools(context(makeDoc(200, 200), settings())).fill.onPointer(ev('down', 0, 0));
    const ms = time(() => {
      for (const layer of TILE_LAYERS) {
        s.layer = layer;
        const r = tools.fill.onPointer(ev('down', 10, 10));
        history.execute(r.command!);
      }
    });
    const undoMs = time(() => {
      for (let i = 0; i < 3; i++) history.undo();
    });
    console.info(
      `[perf] fill 200×200 ×3 layers: ${ms.toFixed(1)} ms; undo ×3: ${undoMs.toFixed(1)} ms`,
    );
    expect(doc.chunkKeys('ground')).toEqual([]);
    expect(ms).toBeLessThan(400);
  });

  it('applies 10 000 random cells', () => {
    const doc = makeDoc(400, 400, 100);
    const rng = createRng(3);
    const cells: TileCell[] = [];
    for (let i = 0; i < 10_000; i++)
      cells.push([rng.int(400), rng.int(400), 1 + rng.int(99), rng.int(4), rng.int(16)]);
    const op = { type: 'tiles.set', floor: 'f1', layer: 'decor', cells } as const;
    doc.applyOps([op]); // warm-up
    const fresh = makeDoc(400, 400, 100);
    const history = new History(fresh);
    const ms = time(() => history.execute({ label: 'x', ops: [op], inverseOps: [] }));
    const undoMs = time(() => history.undo());
    console.info(`[perf] 10 000 cells: apply ${ms.toFixed(1)} ms; undo ${undoMs.toFixed(1)} ms`);
    expect(ms).toBeLessThan(100);
  });

  it('brush stroke of 2 000 moves at size 16 stays interactive', () => {
    const doc = makeDoc(400, 400);
    const history = new History(doc);
    const tools = createTools(context(doc, settings({ brushSize: 16, brushShape: 'round' })));
    let worst = 0;
    const moves: number[] = [];
    const total = time(() => {
      history.execute(tools.brush.onPointer(ev('down', 20, 20)).command!);
      for (let i = 1; i <= 2000; i++) {
        const x = 20 + ((i * 3) % 360);
        const y = 20 + Math.floor(i / 6);
        const t = time(() => {
          const r = tools.brush.onPointer(ev('move', x, y));
          if (r.command) history.execute(r.command);
        });
        worst = Math.max(worst, t);
        moves.push(t);
      }
      tools.brush.onPointer(ev('up', 0, 0));
    });
    const undoMs = time(() => history.undo());
    const p95 = [...moves].sort((a, b) => a - b)[Math.floor(moves.length * 0.95)] ?? 0;
    console.info(
      `[perf] stroke 2 000 moves size 16: total ${total.toFixed(1)} ms, worst move ${worst.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, undo ${undoMs.toFixed(1)} ms`,
    );
    expect(history.state.undoSize).toBe(0);
    expect(doc.chunkKeys('ground')).toEqual([]);
    // p95 (a single move may hit a GC pause when the suite runs in parallel).
    expect(p95).toBeLessThan(16);
    expect(worst).toBeLessThan(250);
  });
});
