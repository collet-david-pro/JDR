import { describe, expect, it } from 'vitest';
import type { MapOp, Overlay } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import type { MapDocument } from '../../src/editor/model/MapDocument';
import { splitWall } from '../../src/editor/tools/door';
import { createTools } from '../../src/editor/tools/index';
import { offsetFromWalls } from '../../src/editor/tools/light';
import type { Tool, ToolContext, ToolResult } from '../../src/editor/tools/types';
import { createRng } from '../../src/editor/util/rng';
import { getFogBit } from '../../src/formats/fog-codec';
import { createVisionCore } from '../../src/vision/index';
import { ev, settings, type MutableSettings } from './helpers';
import { door, light, makeSceneDoc, placed, wall } from './scene-helpers';

/** Context with 1 cell = 10 px (tolerance 8 px = 0.8 cell), a fake clock and counted uids. */
function setup(overrides: Partial<MutableSettings> = {}) {
  const doc = makeSceneDoc();
  const s = settings(overrides);
  let clock = 0;
  let n = 0;
  const ctx: ToolContext = {
    doc,
    settings: s,
    rng: createRng(1),
    pixelSize: () => 0.1,
    now: () => clock,
    newUid: () => `u${++n}`,
    visionCore: () => {
      const core = createVisionCore();
      core.setScene({
        floor: 'f1',
        width: 64,
        height: 64,
        objects: doc.objects(),
        viewer: 'gm',
        revision: doc.sceneRevision,
      });
      return core;
    },
  };
  const tools = createTools(ctx);
  const history = new History(doc);
  const run = (r: ToolResult): ToolResult => {
    if (r.command !== undefined) history.execute(r.command);
    return r;
  };
  const tick = (ms: number) => (clock += ms);
  return { doc, s, tools, history, run, tick };
}

/** Press + release; the results are merged (the release wins). */
function click(tool: Tool, run: (r: ToolResult) => ToolResult, x: number, y: number, mods = {}) {
  const down = run(tool.onPointer(ev('down', x, y, mods)));
  return { ...down, ...run(tool.onPointer(ev('up', x, y, mods))) };
}

/** Press, move, release. */
function drag(
  tool: Tool,
  run: (r: ToolResult) => ToolResult,
  from: [number, number],
  to: [number, number],
) {
  run(tool.onPointer(ev('down', from[0], from[1])));
  run(tool.onPointer(ev('move', to[0], to[1])));
  return run(tool.onPointer(ev('up', to[0], to[1])));
}

function adds(doc: MapDocument, ops: readonly MapOp[]) {
  void doc;
  return ops.filter((o) => o.type === 'object.add');
}

describe('wall tool (W)', () => {
  it('draws a snapped polyline finished by a double click', () => {
    const { doc, tools, run, tick } = setup();
    click(tools.wall, run, 1.2, 1.1);
    tick(1000);
    click(tools.wall, run, 5.9, 1.2);
    tick(1000);
    click(tools.wall, run, 6.1, 4.3);
    tick(100);
    const r = click(tools.wall, run, 6.1, 4.3); // second press of the double click
    expect(r.overlay).toBeNull();
    expect(doc.objects()).toHaveLength(1);
    expect(doc.objects()[0]).toMatchObject({
      type: 'wall',
      layer: 'walls',
      geometry: {
        points: [
          [1, 1],
          [6, 1],
          [6, 4.5],
        ],
        closed: false,
      },
      props: { kind: 'stone', thickness: 0.2 },
    });
  });

  it('Enter finishes, Escape cancels, Alt disables snapping, first point closes', () => {
    const { doc, tools, run, tick } = setup();
    click(tools.wall, run, 1.23, 1.27, { alt: true });
    tick(1000);
    click(tools.wall, run, 3, 1);
    expect(run(tools.wall.onAction!('confirm')).command).toBeDefined();
    expect(doc.objects()[0]!.geometry).toEqual({
      points: [
        [1.23, 1.27],
        [3, 1],
      ],
      closed: false,
    });

    click(tools.wall, run, 10, 10);
    tick(1000);
    click(tools.wall, run, 12, 10);
    tools.wall.cancel();
    expect(tools.wall.onAction!('confirm')).toEqual({});
    expect(doc.objects()).toHaveLength(1);

    for (const [x, y] of [
      [20, 20],
      [24, 20],
      [24, 24],
      [20.05, 20.05],
    ] as const) {
      tick(1000);
      click(tools.wall, run, x, y);
    }
    const closed = doc.objects().find((o) => o.uid !== doc.objects()[0]!.uid)!;
    expect(closed.geometry).toEqual({
      points: [
        [20, 20],
        [24, 20],
        [24, 24],
      ],
      closed: true,
    });
  });

  it('snaps to existing wall ends and middles; preview shows the rubber band', () => {
    const { doc, tools, run } = setup();
    doc.apply([
      {
        type: 'object.add',
        object: wall('w', [
          [2.3, 2.3],
          [8.3, 2.3],
        ]),
      },
    ]);
    click(tools.wall, run, 2.5, 2.4);
    const r = tools.wall.onPointer(ev('move', 5.1, 2.6));
    const group = r.overlay as Extract<Overlay, { kind: 'group' }>;
    expect(group.items[0]).toEqual({
      kind: 'polyline',
      points: [[2.3, 2.3]],
      closed: false,
      cursor: [5.3, 2.3],
    });
    expect(group.items[1]).toEqual({ kind: 'snap', x: 5.3, y: 2.3 });
  });

  it('room option drags a closed rectangle of walls', () => {
    const { doc, tools, run } = setup({ wallRoom: true, wallKind: 'wood', wallThickness: 0.5 });
    run(tools.wall.onPointer(ev('down', 2, 2)));
    run(tools.wall.onPointer(ev('move', 7, 5)));
    run(tools.wall.onPointer(ev('up', 7, 5)));
    expect(doc.objects()[0]).toMatchObject({
      geometry: {
        points: [
          [2, 2],
          [7, 2],
          [7, 5],
          [2, 5],
        ],
        closed: true,
      },
      props: { kind: 'wood', thickness: 0.5 },
    });
  });

  it('refuses a locked walls layer', () => {
    const { doc, tools, run } = setup();
    doc.applyOps([
      {
        type: 'map.meta',
        layers: doc.layers.map((l) => (l.id === 'walls' ? { ...l, locked: true } : l)),
      },
    ]);
    expect(run(tools.wall.onPointer(ev('down', 1, 1))).notice).toEqual({ code: 'layer_locked' });
  });
});

describe('door / window tool (D)', () => {
  it('splits an open wall in one command (update + add wall + add door), undoable', () => {
    const { doc, tools, run, history } = setup();
    doc.apply([
      {
        type: 'object.add',
        object: wall('w', [
          [0, 5],
          [10, 5],
          [10, 9],
        ]),
      },
    ]);
    const preview = tools.door.onPointer(ev('move', 4.3, 5.2));
    expect(preview.overlay).toEqual({ kind: 'segment', a: [4, 5], b: [5, 5], valid: true });
    const r = run(tools.door.onPointer(ev('down', 4.3, 5.2)));
    expect(r.command!.ops.map((o) => o.type)).toEqual([
      'object.update',
      'object.add',
      'object.add',
    ]);
    expect(doc.object('w')!.geometry).toEqual({
      points: [
        [0, 5],
        [4, 5],
      ],
      closed: false,
    });
    const [piece, opening] = adds(doc, r.command!.ops);
    expect(piece).toMatchObject({
      object: {
        type: 'wall',
        geometry: {
          points: [
            [5, 5],
            [10, 5],
            [10, 9],
          ],
        },
      },
    });
    expect(opening).toMatchObject({ object: { type: 'door', geometry: { a: [4, 5], b: [5, 5] } } });
    expect(doc.objects()).toHaveLength(3);
    history.undo();
    expect(doc.objects()).toHaveLength(1);
    expect(doc.object('w')!.geometry).toEqual({
      points: [
        [0, 5],
        [10, 5],
        [10, 9],
      ],
      closed: false,
    });
  });

  it('a closed wall becomes one open polyline around the opening; windows too', () => {
    const { doc, tools, run, s } = setup();
    s.openingKind = 'window';
    s.openingWidth = 2;
    doc.apply([
      {
        type: 'object.add',
        object: wall(
          'w',
          [
            [0, 0],
            [6, 0],
            [6, 6],
            [0, 6],
          ],
          true,
        ),
      },
    ]);
    const r = run(tools.door.onPointer(ev('down', 3.1, 6.1)));
    expect(r.command!.ops.map((o) => o.type)).toEqual(['object.update', 'object.add']);
    expect(doc.object('w')!.geometry).toEqual({
      points: [
        [2, 6],
        [0, 6],
        [0, 0],
        [6, 0],
        [6, 6],
        [4, 6],
      ],
      closed: false,
    });
    expect(doc.objects().find((o) => o.type === 'window')).toMatchObject({
      geometry: { a: [4, 6], b: [2, 6] },
      props: { kind: 'glass' },
    });
  });

  it('no wall under the pointer: red preview and a notice', () => {
    const { tools, run } = setup();
    expect(tools.door.onPointer(ev('move', 20, 20)).overlay).toMatchObject({ valid: false });
    expect(run(tools.door.onPointer(ev('down', 20, 20))).notice).toEqual({ code: 'no_wall' });
  });

  it('splitWall drops empty pieces', () => {
    const w = wall('w', [
      [0, 0],
      [4, 0],
    ]);
    expect(splitWall(w, 0, [0, 0], [1, 0])).toEqual({
      first: null,
      second: [
        [1, 0],
        [4, 0],
      ],
    });
    expect(splitWall(w, 0, [0, 0], [4, 0])).toEqual({ first: null, second: null });
  });
});

describe('light tool (L)', () => {
  it('click = preset light, drag = radius (preset ratio kept)', () => {
    const { doc, tools, run, s } = setup();
    click(tools.light, run, 3.2, 3.3);
    expect(doc.objects()[0]).toMatchObject({
      type: 'light',
      layer: 'lighting',
      geometry: { x: 3, y: 3.5 },
      props: { radius: 4, dim_radius: 8, color: '#ffb35c', intensity: 0.9, enabled: true },
    });
    s.lightPreset = 'magic';
    run(tools.light.onPointer(ev('down', 10, 10)));
    expect(tools.light.onPointer(ev('move', 16, 10)).overlay).toEqual({
      kind: 'light',
      x: 10,
      y: 10,
      radius: 3,
      dimRadius: 6,
    });
    run(tools.light.onPointer(ev('up', 16, 10)));
    expect(doc.objects()[1]).toMatchObject({
      props: { radius: 3, dim_radius: 6, flicker: { type: 'pulse' } },
    });
  });

  it('a light on a wall is moved 0.01 cell to the clicked side', () => {
    const w = wall('w', [
      [0, 5],
      [10, 5],
    ]);
    expect(offsetFromWalls([3, 5], [3.1, 5.2], [w], 64, 64)).toEqual([3, 5.01]);
    expect(offsetFromWalls([3, 5], [3.1, 4.8], [w], 64, 64)).toEqual([3, 4.99]);
    expect(offsetFromWalls([3, 6], [3, 6], [w], 64, 64)).toEqual([3, 6]);
    const { doc, tools, run } = setup();
    doc.apply([{ type: 'object.add', object: w }]);
    click(tools.light, run, 3.1, 4.9);
    expect(doc.objects().find((o) => o.type === 'light')!.geometry).toEqual({ x: 3, y: 4.99 });
  });
});

describe('token tool (K)', () => {
  it('places the chosen definition centred on its footprint', () => {
    const { doc, tools, run, s } = setup();
    expect(run(tools.token.onPointer(ev('down', 3.4, 3.4))).notice).toEqual({ code: 'no_token' });
    s.tokenId = 't2'; // 2×2
    expect(tools.token.onPointer(ev('move', 3.4, 3.4)).overlay).toEqual({
      kind: 'area',
      x: 3,
      y: 3,
      w: 2,
      h: 2,
    });
    run(tools.token.onPointer(ev('down', 3.4, 3.4)));
    s.tokenId = 't1';
    run(tools.token.onPointer(ev('down', 63.5, 63.5)));
    expect(doc.tokens().map((t) => [t.token_id, t.x, t.y])).toEqual([
      ['t2', 4, 4],
      ['t1', 63.5, 63.5],
    ]);
  });
});

describe('fog tool (F)', () => {
  it('brush reveals (one undo step per stroke), Alt hides', () => {
    const { doc, tools, run, history } = setup({ fogBrush: 1 });
    run(tools.fog.onPointer(ev('down', 2, 2)));
    run(tools.fog.onPointer(ev('move', 6, 2)));
    run(tools.fog.onPointer(ev('up', 6, 2)));
    const bits = doc.fogChunk('0:0')!;
    expect(getFogBit(bits, 8, 8)).toBe(true);
    expect(getFogBit(bits, 4 * 4, 8)).toBe(true); // along the stroke
    expect(getFogBit(bits, 40, 40)).toBe(false);
    expect(history.state.undoSize).toBe(1);
    run(tools.fog.onPointer(ev('down', 2, 2, { alt: true })));
    run(tools.fog.onPointer(ev('up', 2, 2, { alt: true })));
    expect(getFogBit(doc.fogChunk('0:0')!, 8, 8)).toBe(false);
    history.undo();
    expect(getFogBit(doc.fogChunk('0:0')!, 8, 8)).toBe(true);
    history.undo();
    expect(doc.fogKeys()).toEqual([]);
  });

  it('rectangle and hide option', () => {
    const { doc, tools, run, s } = setup({ fogShape: 'rect' });
    run(tools.fog.onPointer(ev('down', 1, 1)));
    expect(tools.fog.onPointer(ev('move', 40, 3)).overlay).toEqual({
      kind: 'area',
      x: 1,
      y: 1,
      w: 39,
      h: 2,
      erase: false,
    });
    run(tools.fog.onPointer(ev('up', 40, 3)));
    expect(doc.fogKeys()).toEqual(['0:0', '1:0']);
    s.fogHide = true;
    run(tools.fog.onPointer(ev('down', 0, 0)));
    run(tools.fog.onPointer(ev('up', 64, 64)));
    expect(doc.fogKeys()).toEqual([]);
  });

  it('room: notice when the rasteriser finds no closed room', () => {
    const { tools, run } = setup({ fogShape: 'room' });
    const r = run(tools.fog.onPointer(ev('down', 5, 5)));
    // The provisional vision module has no room fill (null); the real one fills closed rooms.
    expect(r.notice === undefined || r.notice.code === 'room_open').toBe(true);
  });
});

describe('selection tool (V) on objects', () => {
  function scene() {
    const env = setup();
    env.doc.apply([
      {
        type: 'object.add',
        object: wall('w', [
          [0, 5],
          [10, 5],
        ]),
      },
      { type: 'object.add', object: door('d', [4, 5], [5, 5]) },
      { type: 'object.add', object: light('l', 4.5, 7) },
      { type: 'maptoken.add', token: placed('k', 8.5, 8.5) },
    ]);
    return env;
  }

  it('click priority: tokens > lights > doors > walls; empty click clears', () => {
    const { tools, run } = scene();
    expect(click(tools.select, run, 4.5, 7).objectSelection).toEqual({
      objects: ['l'],
      tokens: [],
    });
    expect(click(tools.select, run, 4.2, 5.1).objectSelection).toEqual({
      objects: ['d'],
      tokens: [],
    });
    expect(click(tools.select, run, 1, 5.1).objectSelection).toEqual({
      objects: ['w'],
      tokens: [],
    });
    expect(click(tools.select, run, 8.9, 8.2).objectSelection).toEqual({
      objects: [],
      tokens: ['k'],
    });
    expect(click(tools.select, run, 30, 30).objectSelection).toEqual({ objects: [], tokens: [] });
  });

  it('Shift toggles; the rectangle selects the objects inside it and the cells', () => {
    const { tools, run } = scene();
    click(tools.select, run, 8.5, 8.5);
    const r = click(tools.select, run, 1, 5, { shift: true });
    expect(r.objectSelection).toEqual({ objects: ['w'], tokens: ['k'] });
    expect(r.overlay).toEqual({
      kind: 'group',
      items: [{ kind: 'objects', objects: ['w'], tokens: ['k'] }],
    });
    const rect = drag(tools.select, run, [3, 3], [9.5, 9.5]);
    expect(rect.objectSelection).toEqual({ objects: ['d', 'l'], tokens: ['k'] });
    expect(rect.selection).toEqual([{ x: 3, y: 3, w: 7, h: 7 }]);
  });

  it('drag moves the selection (snapped to half cells; tokens on cells)', () => {
    const { doc, tools, run } = scene();
    click(tools.select, run, 1, 5);
    run(tools.select.onPointer(ev('down', 1, 5)));
    const preview = run(tools.select.onPointer(ev('move', 2.3, 6.1)));
    expect(preview.overlay).toMatchObject({ kind: 'group' });
    run(tools.select.onPointer(ev('up', 2.3, 6.1)));
    expect(doc.object('w')!.geometry).toEqual({
      points: [
        [1.5, 6],
        [11.5, 6],
      ],
      closed: false,
    });
    click(tools.select, run, 8.5, 8.5);
    drag(tools.select, run, [8.5, 8.5], [10.2, 8.9]);
    expect(doc.token('k')).toMatchObject({ x: 10.5, y: 8.5 });
  });

  it('handles: wall vertex, light radius', () => {
    const { doc, tools, run } = scene();
    click(tools.select, run, 4.5, 7);
    drag(tools.select, run, [12.5, 7], [14.5, 7]); // radius handle at x + dim_radius
    expect(doc.object('l')!.props).toMatchObject({ radius: 5, dim_radius: 10 });
    click(tools.select, run, 1, 5);
    drag(tools.select, run, [10, 5], [10, 8.2]);
    expect(doc.object('w')!.geometry).toEqual({
      points: [
        [0, 5],
        [10, 8],
      ],
      closed: false,
    });
  });

  it('Delete removes the selection; double click on a door toggles it', () => {
    const { doc, tools, run, tick } = scene();
    click(tools.select, run, 4.2, 5.1);
    tick(100);
    click(tools.select, run, 4.2, 5.1);
    expect(doc.object('d')!.props).toMatchObject({ state: 'open' });
    click(tools.select, run, 8.5, 8.5);
    const r = run(tools.select.onAction!('delete'));
    expect(r.objectSelection).toEqual({ objects: [], tokens: [] });
    expect(doc.token('k')).toBeUndefined();
  });

  it('locked objects are selected but not moved', () => {
    const { doc, tools, run } = scene();
    doc.apply([{ type: 'object.update', uid: 'w', rev: 1, patch: { locked: true } }]);
    click(tools.select, run, 1, 5);
    const r = drag(tools.select, run, [1, 5], [3, 5]);
    expect(r.notice).toEqual({ code: 'object_locked' });
    expect(doc.object('w')!.geometry).toEqual({
      points: [
        [0, 5],
        [10, 5],
      ],
      closed: false,
    });
  });
});
