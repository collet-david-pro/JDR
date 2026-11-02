import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { noteAddCommand } from '../../src/editor/model/note-commands';
import { objectBox } from '../../src/editor/tools/geometry';
import { handleAt, hitTest } from '../../src/editor/tools/hit';
import { createPinTool } from '../../src/editor/tools/pin';
import { createPolygonDraw } from '../../src/editor/tools/polygon-draw';
import { createSecretTool } from '../../src/editor/tools/secret';
import { clampDelta, handlePatch, moveOps, shapeOverlay } from '../../src/editor/tools/select-edit';
import { createTrapTool } from '../../src/editor/tools/trap';
import type { ToolResult } from '../../src/editor/tools/types';
import { createZoneTool } from '../../src/editor/tools/zone';
import { ev, grid, palette, settings, type MutableSettings } from './helpers';
import { passage, pin, secretRoom, trap, zone } from './note-helpers';

function setup(s: MutableSettings = settings()) {
  const doc = new MapDocument({ grid: grid(30, 30), palette: palette(3) });
  let n = 0;
  const ctx = { doc, settings: s, rng: () => 0.5, newUid: () => `u${++n}` } as never;
  return { doc, s, ctx };
}

const added = (r: ToolResult): MapObject => {
  const op = r.command?.ops[0];
  if (op?.type !== 'object.add') throw new Error('no object.add');
  return op.object;
};

/** Clicks the points, then finishes with a double-click on the last one. */
function drawPolygon(
  tool: { onPointer: (e: ReturnType<typeof ev>) => ToolResult },
  pts: [number, number][],
): ToolResult {
  let last: ToolResult = {};
  for (const [x, y] of pts) {
    tool.onPointer(ev('move', x, y));
    last = tool.onPointer(ev('down', x, y));
    tool.onPointer(ev('up', x, y));
  }
  return last;
}

describe('pin tool', () => {
  it('a click adds a pin with the options, layer props and visibility gm', () => {
    const { ctx, doc } = setup(settings({ pinIcon: 'treasure', pinColor: '#112233' }));
    new History(doc).execute(noteAddCommand({ uid: 'n9', title: 't', body: '' }));
    (ctx as { settings: MutableSettings }).settings.pinNote = 'n9';
    const tool = createPinTool(ctx);
    const pinObj = added(tool.onPointer(ev('down', 3.2, 4.6)));
    expect(pinObj).toMatchObject({
      type: 'pin',
      layer: 'props',
      visibility: 'gm',
      geometry: { x: 3, y: 4.5 },
      props: { icon: 'treasure', color: '#112233', note: 'n9' },
    });
  });

  it('drops a link to a note that no longer exists, and respects a locked layer', () => {
    const { ctx } = setup(settings({ pinNote: 'ghost' }));
    const obj = added(createPinTool(ctx).onPointer(ev('down', 2, 2)));
    expect((obj.props as { note: unknown }).note).toBeNull();
    const locked = setup();
    locked.doc.applyOps([
      {
        type: 'map.meta',
        layers: locked.doc.layers.map((l) => (l.id === 'props' ? { ...l, locked: true } : l)),
      },
    ]);
    const r = createPinTool(locked.ctx).onPointer(ev('down', 2, 2));
    expect(r.command).toBeUndefined();
    expect(r.notice?.code).toBe('layer_locked');
  });
});

describe('polygon draw and zone tool', () => {
  it('clicks make the polygon, a double click finishes it', () => {
    const { ctx } = setup();
    const tool = createZoneTool(ctx);
    const r = drawPolygon(tool, [
      [2, 2],
      [8, 2],
      [8, 6],
      [8, 6],
    ]);
    const z = added(r);
    expect(z).toMatchObject({
      type: 'zone',
      layer: 'gm',
      visibility: 'gm',
      props: { kind: 'description', note: null, show_on_enter: false },
      geometry: {
        polygon: [
          { x: 2, y: 2 },
          { x: 8, y: 2 },
          { x: 8, y: 6 },
        ],
      },
    });
  });

  it('Enter finishes with at least 3 points, Escape cancels, 2 points are not enough', () => {
    const { ctx } = setup();
    const tool = createZoneTool(ctx);
    drawPolygon(tool, [
      [2, 2],
      [8, 2],
    ]);
    expect(tool.onAction?.('confirm').command).toBeUndefined();
    tool.onPointer(ev('down', 8, 7));
    tool.onPointer(ev('up', 8, 7));
    const r = tool.onAction?.('confirm');
    expect(added(r!).type).toBe('zone');
    drawPolygon(tool, [
      [2, 2],
      [8, 2],
      [8, 6],
    ]);
    expect(tool.cancel().overlay).toBeNull();
    expect(tool.onAction?.('confirm').command).toBeUndefined();
  });

  it('clicking the first point closes the polygon', () => {
    const { ctx } = setup();
    const tool = createZoneTool(ctx);
    const r = drawPolygon(tool, [
      [2, 2],
      [8, 2],
      [8, 6],
      [2, 2],
    ]);
    expect((added(r).geometry as { polygon: unknown[] }).polygon).toHaveLength(3);
  });

  it('draws the preview and stops at 200 points', () => {
    const doc = new MapDocument({ grid: grid(120, 10), palette: palette(3) });
    const draw = createPolygonDraw({ doc, settings: settings(), rng: () => 0.5 } as never);
    const first = draw.press(ev('down', 3, 3));
    expect(['polyline', 'group']).toContain((first.result.overlay as { kind: string }).kind);
    for (let i = 1; i < 200; i++) draw.press(ev('down', 3 + i * 0.5, 3 + (i % 2) * 2));
    expect(draw.points).toHaveLength(200);
    const over = draw.press(ev('down', 110, 8));
    expect(over.result.notice?.code).toBe('polygon_limit');
    expect(draw.points).toHaveLength(200);
  });

  it('is blocked on the locked GM layer', () => {
    const { ctx, doc } = setup();
    doc.applyOps([
      {
        type: 'map.meta',
        layers: doc.layers.map((l) => (l.id === 'gm' ? { ...l, locked: true } : l)),
      },
    ]);
    expect(createZoneTool(ctx).onPointer(ev('down', 3, 3)).notice?.code).toBe('layer_locked');
  });
});

describe('trap tool', () => {
  it('a click puts a point trap hidden until revealed', () => {
    const { ctx } = setup(settings({ trapReveal: 'none' }));
    const t = added(createTrapTool(ctx).onPointer(ev('down', 5.1, 5.1)));
    expect(t).toMatchObject({
      type: 'trap',
      layer: 'props',
      visibility: 'hidden_until_revealed',
      geometry: { x: 5, y: 5 },
      props: { note: null, reveal_effect: 'none' },
    });
  });

  it('draws a polygon trap with the polygon option', () => {
    const { ctx } = setup(settings({ trapShape: 'polygon' }));
    const t = added(
      drawPolygon(createTrapTool(ctx), [
        [2, 2],
        [6, 2],
        [6, 5],
        [6, 5],
      ]),
    );
    expect(t.type).toBe('trap');
    expect('polygon' in t.geometry).toBe(true);
  });
});

describe('secret tool', () => {
  it('a passage takes two clicks, layer walls', () => {
    const { ctx } = setup();
    const tool = createSecretTool(ctx);
    expect(tool.onPointer(ev('down', 2, 2)).command).toBeUndefined();
    const o = added(tool.onPointer(ev('down', 6, 2)));
    expect(o).toMatchObject({
      type: 'secret',
      layer: 'walls',
      visibility: 'hidden_until_revealed',
      geometry: { a: [2, 2], b: [6, 2] },
      props: { kind: 'passage', note: null },
    });
  });

  it('refuses a passage that is too short or longer than 20 cells', () => {
    const { ctx } = setup();
    const tool = createSecretTool(ctx);
    tool.onPointer(ev('down', 2, 2));
    expect(tool.onPointer(ev('down', 2.04, 2.04)).notice?.code).toBe('passage_length');
    const big = new MapDocument({ grid: grid(60, 60), palette: palette(3) });
    const tool2 = createSecretTool({ doc: big, settings: settings(), rng: () => 0.5 } as never);
    tool2.onPointer(ev('down', 1, 1));
    expect(tool2.onPointer(ev('down', 30, 1)).notice?.code).toBe('passage_length');
  });

  it('a room is a polygon on the props layer', () => {
    const { ctx } = setup(settings({ secretKind: 'room' }));
    const o = added(
      drawPolygon(createSecretTool(ctx), [
        [2, 2],
        [6, 2],
        [6, 5],
        [6, 5],
      ]),
    );
    expect(o).toMatchObject({ type: 'secret', layer: 'props', props: { kind: 'room' } });
  });

  it('adding the objects is undoable', () => {
    const { ctx, doc } = setup();
    const history = new History(doc);
    const tool = createPinTool(ctx);
    history.execute(tool.onPointer(ev('down', 3, 3)).command!);
    expect(doc.objects()).toHaveLength(1);
    history.undo();
    expect(doc.objects()).toHaveLength(0);
  });
});

describe('selection, move and vertices', () => {
  const objs = [
    pin('p', 5, 5),
    zone('z', [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ]),
    passage('s', [1, 1], [4, 1]),
    trap('t', 8, 8),
    secretRoom('r', [
      [22, 22],
      [26, 22],
      [26, 26],
    ]),
  ];

  function docWith() {
    const doc = new MapDocument({ grid: grid(30, 30), palette: palette(3) });
    doc.applyOps(objs.map((object) => ({ type: 'object.add' as const, object })));
    return doc;
  }

  it('hit-tests points, segments and the inside of polygons', () => {
    const doc = docWith();
    const hit = (x: number, y: number) => hitTest(doc, doc.layers, [x, y], 0.2, 0.014);
    expect(hit(5.05, 5.05)).toEqual({ kind: 'object', uid: 'p' });
    expect(hit(15, 15)).toEqual({ kind: 'object', uid: 'z' });
    expect(hit(2.5, 1.05)).toEqual({ kind: 'object', uid: 's' });
    expect(hit(24, 23)).toEqual({ kind: 'object', uid: 'r' });
    expect(hit(28, 28)).toBeNull();
  });

  it('boxes the shapes', () => {
    expect(objectBox(objs[1]!)).toEqual({ x0: 10, y0: 10, x1: 20, y1: 20 });
    expect(objectBox(objs[2]!)).toEqual({ x0: 1, y0: 1, x1: 4, y1: 1 });
  });

  it('moves a block of objects, geometry by geometry, keeping the props', () => {
    const ops = moveOps(objs, [], 2, 1);
    expect(ops).toHaveLength(5);
    const geoms = ops.map((o) => (o.type === 'object.update' ? o.patch.geometry : null));
    expect(geoms[0]).toEqual({ x: 7, y: 6 });
    expect(geoms[1]).toMatchObject({
      polygon: [
        { x: 12, y: 11 },
        { x: 22, y: 11 },
        { x: 22, y: 21 },
        { x: 12, y: 21 },
      ],
    });
    expect(geoms[2]).toEqual({ a: [3, 2], b: [6, 2] });
    ops.forEach((o) => expect(o.type === 'object.update' && o.patch.props).toBeFalsy());
    const [dx, dy] = clampDelta(objs, [], 50, 50, 30, 30);
    expect(dx).toBeLessThanOrEqual(4);
    expect(dy).toBeLessThanOrEqual(4);
  });

  it('outlines shapes for the preview', () => {
    expect(shapeOverlay(objs[1]!)).toMatchObject({ kind: 'polyline', closed: true });
    expect(shapeOverlay(objs[2]!)).toMatchObject({ kind: 'segment' });
  });

  it('drags a vertex of a polygon and an end of a passage', () => {
    const doc = docWith();
    const sel = { objects: ['z', 's'], tokens: [] };
    const v = handleAt(doc, sel, [20.05, 10.05], 0.2);
    expect(v).toEqual({ kind: 'vertex', uid: 'z', index: 1 });
    const patch = handlePatch(objs[1]!, v!, [21, 9]);
    expect(patch?.geometry).toMatchObject({
      polygon: [
        { x: 10, y: 10 },
        { x: 21, y: 9 },
        { x: 20, y: 20 },
        { x: 10, y: 20 },
      ],
    });
    const e = handleAt(doc, sel, [4, 1], 0.2);
    expect(e).toEqual({ kind: 'end', uid: 's', end: 'b' });
    expect(handlePatch(objs[2]!, e!, [9, 1])?.geometry).toEqual({ a: [1, 1], b: [9, 1] });
    expect(handlePatch(objs[2]!, e!, [30, 1])).toBeNull();
  });
});
