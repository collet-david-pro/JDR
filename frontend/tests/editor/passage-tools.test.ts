import { describe, expect, it } from 'vitest';
import type { FloorInfo, MapObject } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { createPortalTool } from '../../src/editor/tools/portal';
import { createStairsTool, stairsRect, stairsTarget } from '../../src/editor/tools/stairs';
import type { ToolResult } from '../../src/editor/tools/types';
import { ev, grid, palette, settings, type MutableSettings } from './helpers';

const floors: FloorInfo[] = [
  { id: '10', uid: 'ground', level: 0, name: 'RdC', sort_order: 0 },
  { id: '11', uid: 'upper', level: 1, name: 'Étage', sort_order: 1 },
];

function setup(withUpper = true, s: MutableSettings = settings()) {
  const doc = new MapDocument({
    grid: grid(20, 20),
    palette: palette(4),
    floor: 'ground',
    ...(withUpper ? { floors } : {}),
  });
  const ctx = { doc, settings: s, rng: () => 0.5, newUid: () => 'new1' } as never;
  return { doc, s, ctx };
}

const added = (r: ToolResult): MapObject => {
  const op = r.command?.ops[0];
  if (op?.type !== 'object.add') throw new Error('no object.add');
  return op.object;
};

describe('stairs tool', () => {
  it('draws a rectangle of whole cells and adds a stairs towards the first other floor', () => {
    const { ctx } = setup();
    const tool = createStairsTool(ctx);
    tool.onPointer(ev('down', 3.2, 4.7));
    const mid = tool.onPointer(ev('move', 6.1, 5.2));
    expect(mid.overlay).toEqual({ kind: 'rect', x: 3, y: 4, w: 4, h: 2 });
    const stairs = added(tool.onPointer(ev('up', 6.1, 5.2)));
    expect(stairs).toMatchObject({
      type: 'stairs',
      floor: 'ground',
      layer: 'props',
      visibility: 'all',
      geometry: { x: 3, y: 4, w: 4, h: 2 },
      props: { direction: 'up', to_floor: 'upper' },
    });
    expect((stairs.props as { link?: unknown }).link).toBeUndefined();
  });

  it('a click is one cell; direction, target and link come from the options', () => {
    const link = { map_id: '7', floor: null, x: 2, y: 3 };
    const { ctx, s } = setup(
      true,
      settings({ stairsDirection: 'down', stairsTarget: 'upper', stairsLink: link }),
    );
    expect(s.stairsDirection).toBe('down');
    const tool = createStairsTool(ctx);
    tool.onPointer(ev('down', 1.5, 1.5));
    const stairs = added(tool.onPointer(ev('up', 1.5, 1.5)));
    expect(stairs.geometry).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(stairs.props).toMatchObject({ direction: 'down', link });
  });

  it('refuses without another floor (and without a link), and says so', () => {
    const { ctx } = setup(false);
    const tool = createStairsTool(ctx);
    expect(tool.onPointer(ev('down', 1, 1)).notice?.code).toBe('stairs_no_target');
    expect(stairsTarget(ctx)).toBeNull();
  });

  it('is applied to the document as one undoable command', () => {
    const { ctx, doc } = setup();
    const history = new History(doc);
    const tool = createStairsTool(ctx);
    tool.onPointer(ev('down', 2, 2));
    history.execute(tool.onPointer(ev('up', 2, 2)).command!);
    expect(doc.objects().map((o) => o.type)).toEqual(['stairs']);
    history.undo();
    expect(doc.objects()).toEqual([]);
  });

  it('clamps the rectangle to 10 cells and to the map', () => {
    expect(stairsRect({ x: 2, y: 2 }, { x: 15, y: 2 }, 20, 20)).toEqual({
      x: 2,
      y: 2,
      w: 10,
      h: 1,
    });
    expect(stairsRect({ x: 15, y: 2 }, { x: 2, y: 2 }, 20, 20)).toEqual({
      x: 6,
      y: 2,
      w: 10,
      h: 1,
    });
    expect(stairsRect({ x: 18, y: 18 }, { x: 25, y: 25 }, 20, 20)).toEqual({
      x: 18,
      y: 18,
      w: 2,
      h: 2,
    });
  });
});

describe('portal tool', () => {
  it('needs a link', () => {
    const { ctx } = setup();
    const tool = createPortalTool(ctx);
    expect(tool.onPointer(ev('down', 3, 3)).notice?.code).toBe('link_required');
  });

  it('adds a portal with icon, colour, label and link at the snapped point', () => {
    const link = { map_id: '9', floor: 'cave', x: 4, y: 5 };
    const { ctx } = setup(
      true,
      settings({
        portalLink: link,
        portalIcon: 'ladder',
        portalColor: '#112233',
        portalLabel: ' Vers la cave ',
      }),
    );
    const tool = createPortalTool(ctx);
    const portal = added(tool.onPointer(ev('down', 3.3, 4.8)));
    expect(portal).toMatchObject({
      type: 'portal',
      layer: 'props',
      geometry: { x: 3.5, y: 5 },
      props: { icon: 'ladder', color: '#112233', label: 'Vers la cave', link },
    });
  });

  it('passes the document normalisation (link kept on a portal, a stairs, a door)', () => {
    const link = { map_id: '9', floor: 'cave', x: 4, y: 5 };
    const { ctx, doc } = setup(true, settings({ portalLink: link }));
    const tool = createPortalTool(ctx);
    doc.applyOps([tool.onPointer(ev('down', 3, 3)).command!.ops[0]!]);
    const stored = doc.objects()[0]!;
    expect((stored.props as { link: unknown }).link).toEqual({ ...link, map_id: '9' });
  });
});
