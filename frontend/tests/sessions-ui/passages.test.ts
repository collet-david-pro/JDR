import { describe, expect, it } from 'vitest';
import type { StairsObject, PortalObject, DoorObject } from '../../src/editor/contracts';
import {
  carriableTokens,
  defaultPosition,
  passagesOf,
  shownFloor,
  travelBody,
} from '../../src/lib/sessions/console/passages';
import { createSessionState } from '../../src/lib/sessions/state';
import type { MapLinks } from '../../src/lib/types';
import { door, mapDetail, placed, snapshot } from '../sessions/fixtures';

const base = { layer: 'props', visibility: 'all', locked: false, sort_order: 0, rev: 1 } as const;
const stairs = (uid: string, over: Partial<StairsObject['props']> = {}): StairsObject => ({
  ...base,
  uid,
  floor: '35',
  type: 'stairs',
  geometry: { x: 4, y: 6, w: 2, h: 4 },
  props: { direction: 'up', to_floor: 'f2', ...over },
});
const portal = (uid: string, link: PortalObject['props']['link']): PortalObject => ({
  ...base,
  uid,
  floor: '35',
  type: 'portal',
  geometry: { x: 10, y: 11 },
  props: { icon: 'portal', color: '#7c4dff', link },
});
const linkedDoor = (uid: string, link: NonNullable<DoorObject['props']['link']>): DoorObject => {
  const d = door(uid) as DoorObject;
  return { ...d, props: { ...d.props, link } };
};

function state() {
  const snap = snapshot('gm', {
    map: mapDetail({
      floors: [
        { id: '35', uid: 'f1', level: 0, name: 'RdC', sort_order: 0 },
        { id: '36', uid: 'f2', level: 1, name: 'Étage', sort_order: 1 },
      ],
      objects: [
        stairs('s1'),
        stairs('s2', { to_floor: 'gone' }),
        portal('p1', { map_id: '99', floor: 'cave', x: 3, y: 4 }),
        portal('p2', { map_id: null, floor: null, x: null, y: null, broken: true }),
        linkedDoor('d1', { map_id: '34', floor: 'f2', x: 1, y: 2 }),
        door('d2'),
        { ...stairs('s9'), floor: '36' },
      ],
      tokens_placed: [placed('t1', '21', 3, 4), placed('t2', '22', 8, 8)],
    }),
  });
  return createSessionState(snap, '1');
}

const links: MapLinks = {
  outgoing: [
    {
      object_uid: 'p1',
      floor: 'f1',
      to: { map_id: '99', map_name: 'Cave', floor: 'cave', floor_name: 'Fond', x: 3, y: 4 },
      broken: false,
    },
  ],
  incoming: [],
};

describe('passagesOf', () => {
  it('lists the stairs, portals and linked doors of the shown floor, stairs first', () => {
    const s = state();
    expect(shownFloor(s)).toBe('35');
    const list = passagesOf(s, '35', links);
    expect(list.map((p) => p.uid)).toEqual(['s1', 's2', 'p1', 'p2', 'd1']);
  });

  it('gives the destination of each kind and flags broken links', () => {
    const list = passagesOf(state(), '35', links);
    const by = Object.fromEntries(list.map((p) => [p.uid, p]));
    // Stairs without a link: another floor of the same map.
    expect(by['s1']).toMatchObject({
      destination: { mapId: '34', floor: 'f2', x: null, y: null },
      floorName: 'Étage',
      sameMap: true,
    });
    expect(by['s2']?.destination).toBeNull(); // its floor is gone
    expect(by['p1']).toMatchObject({
      destination: { mapId: '99', floor: 'cave', x: 3, y: 4 },
      mapName: 'Cave',
      floorName: 'Fond',
      sameMap: false,
    });
    expect(by['p2']?.destination).toBeNull();
    expect(by['d1']).toMatchObject({ sameMap: true, destination: { floor: 'f2' } });
  });

  it('trusts the links answer for a link it flags as broken', () => {
    const broken: MapLinks = {
      outgoing: [{ ...links.outgoing[0]!, broken: true }],
      incoming: [],
    };
    expect(passagesOf(state(), '35', broken).find((p) => p.uid === 'p1')?.destination).toBeNull();
  });

  it('does not list the passages of other floors', () => {
    expect(passagesOf(state(), '36', null).map((p) => p.uid)).toEqual(['s9']);
  });
});

describe('arrival position and request', () => {
  const grid = { width: 40, height: 30 };
  it('prefers the position of the link, then the centre of the source stairs, then the centre of the map', () => {
    const list = passagesOf(state(), '35', links);
    const get = (uid: string) => list.find((p) => p.uid === uid)!;
    expect(defaultPosition(get('p1'), grid)).toEqual({ x: 3, y: 4 });
    expect(defaultPosition(get('s1'), grid)).toEqual({ x: 5, y: 8 });
    expect(defaultPosition(get('d1'), { width: 40, height: 30 })).toEqual({ x: 1, y: 2 });
    const noPos = { ...get('p1'), destination: { mapId: '99', floor: null, x: null, y: null } };
    expect(defaultPosition(noPos, grid)).toEqual({ x: 20, y: 15 });
    expect(defaultPosition(get('s1'), { width: 3, height: 3 })).toEqual({ x: 3, y: 3 });
  });

  it('lists the tokens of the floor, the players first', () => {
    const choices = carriableTokens(state(), '35');
    expect(choices.map((c) => [c.token.uid, c.player])).toEqual([
      ['t1', true],
      ['t2', false],
    ]);
  });

  it('builds the change-map body: floor, focus, tokens only when picked', () => {
    const d = { mapId: '99', floor: 'cave', x: 3, y: 4 };
    expect(travelBody(d, { x: 3, y: 4 }, [])).toEqual({
      map_id: '99',
      floor_id: 'cave',
      focus: { x: 3, y: 4 },
    });
    expect(travelBody({ ...d, floor: null }, { x: 1, y: 2 }, ['t1', 't2'])).toEqual({
      map_id: '99',
      focus: { x: 1, y: 2 },
      move_tokens: ['t1', 't2'],
    });
  });
});
