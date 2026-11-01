import { describe, expect, it, vi } from 'vitest';
import { LinkTargets, linkBroken } from '../../src/editor/ui/link-targets';
import { toWireOp } from '../../src/editor/sync/wire';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { grid } from './helpers';

describe('LinkTargets', () => {
  it('caches the maps and the floors of another map; the current map is live', async () => {
    const listMaps = vi.fn(() => Promise.resolve([{ id: '1', name: 'A' }]));
    const floorsOf = vi.fn(() => Promise.resolve([{ uid: 'f', name: 'F', level: 0 }]));
    let current = [{ uid: 'a', name: 'A', level: 0 }];
    const targets = new LinkTargets({
      currentMapId: '1',
      currentFloors: () => current,
      listMaps,
      floorsOf,
    });
    await targets.maps();
    await targets.maps();
    expect(listMaps).toHaveBeenCalledTimes(1);
    await targets.floors('2');
    await targets.floors('2');
    expect(floorsOf).toHaveBeenCalledTimes(1);
    current = [...current, { uid: 'b', name: 'B', level: 1 }];
    expect(await targets.floors('1')).toHaveLength(2);
  });

  it('does not cache a failure', async () => {
    const listMaps = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue([]);
    const targets = new LinkTargets({
      currentMapId: '1',
      currentFloors: () => [],
      listMaps,
      floorsOf: () => Promise.resolve([]),
    });
    await expect(targets.maps()).rejects.toThrow();
    await expect(targets.maps()).resolves.toEqual([]);
  });
});

describe('linkBroken', () => {
  const maps = [{ id: '1', name: 'A' }];
  const floors = [{ uid: 'f', name: 'F', level: 0 }];
  it('detects a missing map, a missing floor, and the server flag', () => {
    expect(linkBroken(null, maps, floors)).toBe(false);
    expect(linkBroken({ map_id: '1', floor: 'f' }, maps, floors)).toBe(false);
    expect(linkBroken({ map_id: '1', floor: null }, null, null)).toBe(false);
    expect(linkBroken({ map_id: '2', floor: null }, maps, null)).toBe(true);
    expect(linkBroken({ map_id: '1', floor: 'zz' }, maps, floors)).toBe(true);
    expect(linkBroken({ map_id: null, floor: null }, maps, floors)).toBe(true);
    expect(linkBroken({ map_id: '1', floor: null, broken: true }, maps, floors)).toBe(true);
  });
});

describe('links on the wire and in the document', () => {
  const portal = {
    uid: 'p',
    floor: 'f1',
    type: 'portal' as const,
    layer: 'props' as const,
    geometry: { x: 2, y: 2 },
    props: {
      icon: 'door' as const,
      color: '#AABBCC',
      link: { map_id: '7', floor: null, x: 1, y: 1, broken: true as const, map_name: 'Old' },
    },
    visibility: 'all' as const,
    locked: false,
    sort_order: 0,
    rev: 1,
  };

  it('drops the read-side hints of a link before sending', () => {
    const wire = toWireOp({ type: 'object.add', object: portal });
    if (wire.type !== 'object.add') throw new Error('type');
    expect((wire.object.props as { link: object }).link).toEqual({
      map_id: '7',
      floor: null,
      x: 1,
      y: 1,
    });
  });

  it('keeps the link of a door and the normalised colour of a portal', () => {
    const doc = new MapDocument({ grid: grid(10, 10) });
    doc.applyOps([
      { type: 'object.add', object: portal },
      {
        type: 'object.add',
        object: {
          uid: 'd',
          floor: 'f1',
          type: 'door',
          layer: 'walls',
          geometry: { a: [1, 1], b: [2, 1] },
          props: {
            state: 'closed',
            locked: false,
            secret: false,
            asset_open: null,
            asset_closed: null,
            swing: 'a',
            link: { map_id: '3', floor: 'x', x: null, y: null },
          },
          visibility: 'all',
          locked: false,
          sort_order: 0,
          rev: 1,
        },
      },
    ]);
    expect(doc.object('p')?.props).toMatchObject({
      color: '#aabbcc',
      link: { map_id: '7', broken: true },
    });
    expect((doc.object('d')?.props as { link: unknown }).link).toEqual({
      map_id: '3',
      floor: 'x',
      x: null,
      y: null,
    });
  });
});
