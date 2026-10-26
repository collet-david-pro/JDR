import { describe, expect, it } from 'vitest';
import type { Command, MapOp, Overlay } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import { layerPatchCommand } from '../../src/editor/model/commands';
import type { MapDocument } from '../../src/editor/model/MapDocument';
import {
  FILL_LIMIT,
  brushFootprint,
  createTools,
  ellipseCells,
  lineCells,
  shapeCells,
  unionRects,
  type ToolResult,
} from '../../src/editor/tools/index';
import { context, ev, makeDoc, settings } from './helpers';

const cellsOf = (cmd: Command | undefined): (readonly number[])[] => {
  const op = cmd?.ops[0] as (MapOp & { type: 'tiles.set' }) | undefined;
  return op === undefined ? [] : op.cells.map((c) => [...c]);
};
const xy = (cmd: Command | undefined): string[] =>
  cellsOf(cmd)
    .map((c) => `${c[0]},${c[1]}`)
    .sort();
const overlayCells = (r: ToolResult): number => {
  const o = r.overlay as (Overlay & { kind: 'cells' }) | null | undefined;
  return o?.cells.length ?? -1;
};

function lock(doc: MapDocument, layer: 'ground'): void {
  doc.applyOps(layerPatchCommand(doc, layer, { locked: true })!.ops);
}

describe('raster helpers', () => {
  it('draws Bresenham lines, footprints and ellipses', () => {
    expect(lineCells(0, 0, 3, 1)).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
    expect(lineCells(2, 2, 2, 2)).toEqual([[2, 2]]);
    expect(brushFootprint(1, 'round')).toEqual([[0, 0]]);
    expect(brushFootprint(3, 'square')).toHaveLength(9);
    expect(brushFootprint(3, 'round')).toHaveLength(5);
    expect(brushFootprint(16, 'square')).toHaveLength(256);
    expect(brushFootprint(16, 'round').length).toBeLessThan(256);
    const filled = ellipseCells({ x: 0, y: 0, w: 9, h: 5 }, true);
    const outline = ellipseCells({ x: 0, y: 0, w: 9, h: 5 }, false);
    expect(outline.length).toBeLessThan(filled.length);
    expect(filled).toContainEqual([4, 2]);
    expect(outline).not.toContainEqual([4, 2]);
    expect(shapeCells('rect', false, [0, 0], [3, 2], false)).toHaveLength(10);
    expect(shapeCells('rect', true, [0, 0], [3, 1], true)).toHaveLength(16); // Shift: square
    expect(shapeCells('line', false, [0, 0], [5, 1], true).every(([, y]) => y === 0)).toBe(true);
    expect(unionRects([{ x: 0, y: 0, w: 4, h: 4 }], { x: 1, y: 1, w: 2, h: 2 })).toHaveLength(1);
    expect(unionRects([{ x: 1, y: 1, w: 2, h: 2 }], { x: 0, y: 0, w: 4, h: 4 })).toEqual([
      { x: 0, y: 0, w: 4, h: 4 },
    ]);
  });
});

describe('brush and eraser', () => {
  it('paints a continuous stroke with interpolation, one merged undo step', () => {
    const doc = makeDoc(40, 40);
    const history = new History(doc);
    const tools = createTools(context(doc, settings({ brushSize: 1 })));
    const r1 = tools.brush.onPointer(ev('down', 2, 2));
    expect(xy(r1.command)).toEqual(['2,2']);
    expect(r1.command?.mergeKey).toMatch(/^brush:/);
    history.execute(r1.command!);
    const r2 = tools.brush.onPointer(ev('move', 6.5, 2.5));
    expect(xy(r2.command)).toEqual(['3,2', '4,2', '5,2', '6,2']);
    expect(cellsOf(r2.command)[0]).toEqual([3, 2, 1, 0, 0]);
    history.execute(r2.command!);
    expect(tools.brush.onPointer(ev('move', 6.2, 2.9)).command).toBeUndefined();
    tools.brush.onPointer(ev('up', 6, 2));
    expect(history.state.undoSize).toBe(1);
    // Hover preview after the stroke: footprint only, no command.
    const hover = tools.brush.onPointer(ev('move', 10, 10));
    expect(hover.command).toBeUndefined();
    expect(overlayCells(hover)).toBe(1);
    history.undo();
    expect(doc.chunkKeys('ground')).toEqual([]);
  });

  it('applies size, shape and map bounds', () => {
    const doc = makeDoc(10, 10);
    const s = settings({ brushSize: 3, brushShape: 'round' });
    const tools = createTools(context(doc, s));
    expect(xy(tools.brush.onPointer(ev('down', 5, 5)).command)).toEqual([
      '4,5',
      '5,4',
      '5,5',
      '5,6',
      '6,5',
    ]);
    tools.brush.onPointer(ev('up', 5, 5));
    s.brushSize = 4;
    s.brushShape = 'square';
    expect(cellsOf(tools.brush.onPointer(ev('down', 0, 0)).command)).toHaveLength(9); // 4×4 clipped to 3×3
    tools.brush.onPointer(ev('up', 0, 0));
    s.brushSize = 99; // clamped to 16
    expect(cellsOf(tools.brush.onPointer(ev('down', 0.5, 0.5)).command).length).toBeLessThanOrEqual(
      100,
    );
  });

  it('randomises variant and rotation with the seeded PRNG (deterministic)', () => {
    const run = (seed: number): string => {
      const doc = makeDoc(20, 20);
      const s = settings({
        brushSize: 8,
        variantCount: 4,
        randomRotation: true,
        tile: { index: 2, variant: 0, flags: 0b0100 },
      });
      const cmd = createTools(context(doc, s, seed)).brush.onPointer(ev('down', 8, 8)).command!;
      const cells = cellsOf(cmd);
      expect(cells.every((c) => c[2] === 2 && c[3]! < 4 && (c[4]! & 0b1100) === 0b0100)).toBe(true);
      expect(new Set(cells.map((c) => c[3])).size).toBeGreaterThan(1);
      expect(new Set(cells.map((c) => c[4]! & 3)).size).toBeGreaterThan(1);
      return JSON.stringify(cells);
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });

  it('erases, and does nothing on a locked layer or without a tile', () => {
    const doc = makeDoc(20, 20);
    doc.setCells('ground', [[3, 3, 1, 2, 3]]);
    const s = settings({ brushSize: 2 });
    const tools = createTools(context(doc, s));
    const erase = tools.eraser.onPointer(ev('down', 3, 3));
    expect(cellsOf(erase.command)).toEqual([[3, 3, 0, 0, 0]]); // only changed cells
    expect((erase.overlay as { erase?: boolean }).erase).toBe(true);
    tools.eraser.onPointer(ev('up', 3, 3));
    s.tile = null;
    expect(tools.brush.onPointer(ev('down', 1, 1))).toMatchObject({ notice: { code: 'no_tile' } });
    s.tile = { index: 1, variant: 0, flags: 0 };
    lock(doc, 'ground');
    for (const tool of [tools.brush, tools.eraser, tools.fill, tools.shape]) {
      const r = tool.onPointer(ev('down', 1, 1));
      expect(r.command).toBeUndefined();
      expect(r.notice?.code).toBe('layer_locked');
      tool.onPointer(ev('up', 1, 1));
    }
  });
});

describe('fill', () => {
  it('fills the 4-connected region of the same tile', () => {
    const doc = makeDoc(10, 10);
    // Vertical wall of tile 2 at x = 4 (diagonal gaps do not leak with 4-neighbours).
    for (let y = 0; y < 10; y++) doc.setCells('ground', [[4 + (y % 2), y, 2, 0, 0]]);
    const tools = createTools(context(doc, settings({ tile: { index: 3, variant: 0, flags: 0 } })));
    const r = tools.fill.onPointer(ev('down', 0, 0));
    const cells = cellsOf(r.command);
    expect(cells.length).toBe(45);
    expect(cells.every((c) => c[0]! <= 4 && c[2] === 3)).toBe(true);
    // Filling the wall replaces only the wall tiles connected to the seed.
    const wall = tools.fill.onPointer(ev('down', 4, 0));
    expect(cellsOf(wall.command)).toEqual([[4, 0, 3, 0, 0]]);
    // Same tile: nothing to do.
    doc.applyOps(r.command!.ops);
    expect(tools.fill.onPointer(ev('down', 0, 0)).notice?.code).toBe('fill_nothing');
    expect(tools.fill.onPointer(ev('move', 0, 0))).toEqual({});
  });

  it('refuses regions larger than 50 000 cells', () => {
    const doc = makeDoc(250, 250);
    const tools = createTools(context(doc));
    expect(tools.fill.onPointer(ev('down', 0, 0))).toEqual({
      notice: { code: 'fill_limit', params: { limit: FILL_LIMIT } },
    });
    // Split the map: the left side (224×250 = 56 000 cells) is still too much…
    const wall = Array.from({ length: 250 }, (_, y) => [224, y, 2, 0, 0] as const);
    doc.setCells('ground', wall);
    expect(tools.fill.onPointer(ev('down', 0, 0)).notice?.code).toBe('fill_limit');
    // …the right side (25×250 = 6 250) is accepted.
    expect(cellsOf(tools.fill.onPointer(ev('down', 240, 0)).command)).toHaveLength(6250);
  });
});

describe('shapes', () => {
  it('previews while dragging and applies on release', () => {
    const doc = makeDoc(20, 20);
    const s = settings({ shapeKind: 'rect', shapeFilled: false });
    const tools = createTools(context(doc, s));
    expect(overlayCells(tools.shape.onPointer(ev('down', 2, 2)))).toBe(1);
    expect(overlayCells(tools.shape.onPointer(ev('move', 5, 4)))).toBe(10);
    const up = tools.shape.onPointer(ev('up', 5, 4));
    expect(up.overlay).toBeNull();
    expect(cellsOf(up.command)).toHaveLength(10);
    s.shapeKind = 'ellipse';
    s.shapeFilled = true;
    tools.shape.onPointer(ev('down', 0, 0));
    expect(cellsOf(tools.shape.onPointer(ev('up', 30, 30)).command).length).toBeGreaterThan(200); // clipped
    s.shapeKind = 'line';
    tools.shape.onPointer(ev('down', 0, 19));
    expect(xy(tools.shape.onPointer(ev('up', 3, 19)).command)).toEqual([
      '0,19',
      '1,19',
      '2,19',
      '3,19',
    ]);
    tools.shape.onPointer(ev('down', 0, 0));
    expect(tools.shape.cancel().overlay).toBeNull();
    expect(tools.shape.onPointer(ev('up', 4, 4)).command).toBeUndefined();
  });
});

describe('selection, pipette, ruler, hand', () => {
  it('selects rectangles, Shift adds (union), Escape clears', () => {
    const doc = makeDoc(20, 20);
    const { select } = createTools(context(doc));
    select.onPointer(ev('down', 1, 1));
    expect(select.onPointer(ev('move', 3, 2)).overlay).toEqual({
      kind: 'selection',
      rects: [{ x: 1, y: 1, w: 3, h: 2 }],
    });
    expect(select.onPointer(ev('up', 3, 2)).selection).toEqual([{ x: 1, y: 1, w: 3, h: 2 }]);
    select.onPointer(ev('down', 10, 10, { shift: true }));
    // While dragging with Shift, the preview shows the current selection plus the new rectangle.
    expect(select.onPointer(ev('move', 12, 12, { shift: true })).overlay).toEqual({
      kind: 'selection',
      rects: [
        { x: 1, y: 1, w: 3, h: 2 },
        { x: 10, y: 10, w: 3, h: 3 },
      ],
    });
    const added = select.onPointer(ev('up', 30, 11, { shift: true }));
    expect(added.selection).toEqual([
      { x: 1, y: 1, w: 3, h: 2 },
      { x: 10, y: 10, w: 10, h: 2 },
    ]);
    expect(added.overlay).toEqual({ kind: 'selection', rects: added.selection });
    select.onPointer(ev('down', 0, 0));
    expect(select.onPointer(ev('up', 0, 0)).selection).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);
    expect(select.cancel()).toEqual({
      selection: [],
      objectSelection: { objects: [], tokens: [] },
      overlay: null,
    });
  });

  it('pipette returns the tile under the cursor', () => {
    const doc = makeDoc(10, 10);
    doc.setCells('ground', [[1, 1, 2, 1, 4]]);
    doc.setCells('decor', [[1, 1, 5, 0, 0]]);
    const s = settings({ layer: 'ground' });
    const { pipette } = createTools(context(doc, s));
    expect(pipette.onPointer(ev('down', 1, 1))).toEqual({
      picked: { index: 2, variant: 1, flags: 4 },
      pickedLayer: 'ground',
    });
    s.layer = 'terrain';
    expect(pipette.onPointer(ev('down', 1, 1)).picked?.index).toBe(5); // topmost visible layer
    expect(pipette.onPointer(ev('down', 7, 7))).toEqual({});
  });

  it('ruler measures Euclidean distance in map units', () => {
    const doc = makeDoc(20, 20);
    const ctx = {
      ...context(doc),
      formatDistance: (d: number, g: { unitPerCell: number; unitLabel: string }) =>
        `${(d * g.unitPerCell).toFixed(1)} ${g.unitLabel}`,
    };
    const { ruler } = createTools(ctx);
    ruler.onPointer(ev('down', 0.2, 0.7));
    const r = ruler.onPointer(ev('move', 3.9, 4.1));
    expect(r.overlay).toEqual({
      kind: 'ruler',
      from: [0.5, 0.5],
      to: [3.5, 4.5],
      label: '25.0 ft',
    });
    expect((ruler.onPointer(ev('up', 3.9, 4.1)).overlay as { label: string }).label).toBe(
      '25.0 ft',
    );
    expect(ruler.onPointer(ev('move', 9, 9))).toEqual({}); // measure stays displayed
    ruler.onPointer(ev('down', 0, 0, { alt: true }));
    expect(
      (ruler.onPointer(ev('move', 1, 0, { alt: true })).overlay as { label: string }).label,
    ).toBe('5.0 ft');
    expect(ruler.cancel()).toEqual({ overlay: null });
    const def = createTools(context(doc)).ruler;
    def.onPointer(ev('down', 0, 0));
    expect((def.onPointer(ev('move', 2, 0)).overlay as { label: string }).label).toMatch(/^10 ft$/);
  });

  it('hand does nothing and every tool has its shortcut', () => {
    const tools = createTools(context(makeDoc()));
    expect(tools.hand.onPointer(ev('down', 1, 1))).toEqual({});
    expect(Object.values(tools).map((t) => `${t.id}:${t.shortcut}`)).toEqual([
      'select:V',
      'hand:H',
      'brush:B',
      'eraser:E',
      'fill:G',
      'shape:U',
      'wall:W',
      'door:D',
      'light:L',
      'token:K',
      'fog:F',
      'pipette:I',
      'ruler:M',
    ]);
  });
});
