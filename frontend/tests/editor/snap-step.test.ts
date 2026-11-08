import { describe, expect, it } from 'vitest';
import type { Overlay } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import { snapPoint } from '../../src/editor/tools/geometry';
import { command } from '../../src/editor/tools/object-common';
import { createTools } from '../../src/editor/tools/index';
import type { ToolContext, ToolResult } from '../../src/editor/tools/types';
import { createRng } from '../../src/editor/util/rng';
import { ev, settings } from './helpers';
import { makeSceneDoc, wall } from './scene-helpers';

const bounds = { width: 64, height: 64 };

describe('snapPoint step', () => {
  it('snaps to the given step, half a cell by default', () => {
    expect(snapPoint([3.3, 4.1], [], 0.8, bounds, false).point).toEqual([3.5, 4]);
    expect(snapPoint([3.3, 4.1], [], 0.8, bounds, false, undefined, 1).point).toEqual([3, 4]);
    expect(snapPoint([3.3, 4.1], [], 0.8, bounds, false, undefined, 0.25).point).toEqual([
      3.25, 4.0,
    ]);
    expect(snapPoint([3.3, 4.07], [], 0.8, bounds, false, undefined, 0.125).point).toEqual([
      3.25, 4.125,
    ]);
  });

  it('Alt disables snapping at any step', () => {
    const s = snapPoint([3.3333, 4.1], [], 0.8, bounds, true, undefined, 0.125);
    expect(s.kind).toBe('none');
    expect(s.point).toEqual([3.333, 4.1]);
  });

  it('wall ends keep priority, with a tolerance never larger than the step', () => {
    const objs = [
      wall('w', [
        [2.3, 2.3],
        [8.3, 2.3],
      ]),
    ];
    const near = snapPoint([2.35, 2.33], objs, 0.8, bounds, false, undefined, 0.25);
    expect(near).toEqual({ point: [2.3, 2.3], kind: 'wall_end' });
    // 0.4 cell away: farther than the 0.25 step, so the grid wins over the end.
    const far = snapPoint([2.7, 2.3], objs, 0.8, bounds, false, undefined, 0.25);
    expect(far.kind).toBe('grid');
  });
});

describe('map step in the wall tool', () => {
  const setup = (step?: number) => {
    const doc = makeSceneDoc();
    if (step !== undefined) doc.apply([{ type: 'map.meta', ambient: { snap_step: step } }]);
    const ctx: ToolContext = {
      doc,
      settings: settings({}),
      rng: createRng(1),
      pixelSize: () => 0.1,
      newUid: (() => {
        let n = 0;
        return () => `u${++n}`;
      })(),
    };
    return { doc, tools: createTools(ctx) };
  };

  it('defaults to half a cell', () => {
    const { doc } = setup();
    expect(doc.snapStep).toBe(0.5);
  });

  it('draws on the 1/4 grid, with grid marks while tracing only', () => {
    const { doc, tools } = setup(0.25);
    expect(doc.snapStep).toBe(0.25);
    const idle = tools.wall.onPointer(ev('move', 3.3, 4.1)).overlay as Overlay;
    expect(idle).toEqual({ kind: 'snap', x: 3.25, y: 4 });
    tools.wall.onPointer(ev('down', 3.3, 4.1));
    tools.wall.onPointer(ev('up', 3.3, 4.1));
    const r = tools.wall.onPointer(ev('move', 6.6, 4.1));
    const group = r.overlay as Extract<Overlay, { kind: 'group' }>;
    expect(group.items[1]).toEqual({ kind: 'snap', x: 6.5, y: 4, step: 0.25 });
  });

  it('records wall coordinates on the 1/8 grid and undoes the step change', () => {
    const { doc, tools } = setup(0.125);
    const history = new History(doc);
    const run = (r: ToolResult) => {
      if (r.command !== undefined) history.execute(r.command);
      return r;
    };
    for (const [x, y] of [
      [3.1, 4.13],
      [6.9, 4.13],
    ] as const) {
      run(tools.wall.onPointer(ev('down', x, y)));
      run(tools.wall.onPointer(ev('up', x, y)));
    }
    run(tools.wall.onAction!('confirm'));
    const walls = doc.objects().filter((o) => o.type === 'wall');
    expect(walls).toHaveLength(1);
    const w = walls[0]!;
    if (w.type === 'wall')
      expect(w.geometry.points).toEqual([
        [3.125, 4.125],
        [6.875, 4.125],
      ]);
  });

  it('undoing a step change goes back to the default', () => {
    const { doc } = setup();
    const history = new History(doc);
    history.execute(
      command('editor.command.ambient', [{ type: 'map.meta', ambient: { snap_step: 0.125 } }]),
    );
    expect(doc.snapStep).toBe(0.125);
    history.undo();
    expect(doc.snapStep).toBe(0.5);
  });
});
