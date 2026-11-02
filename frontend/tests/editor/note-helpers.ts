import type { MapObject, Point } from '../../src/editor/contracts';
import type {
  PinObject,
  SecretObject,
  TrapObject,
  ZoneObject,
} from '../../src/editor/contracts-notes';

const base = { floor: 'f1', locked: false, sort_order: 0, rev: 1 } as const;

export function pin(uid: string, x: number, y: number, note: string | null = null): PinObject {
  return {
    ...base,
    uid,
    type: 'pin',
    layer: 'props',
    visibility: 'gm',
    geometry: { x, y },
    props: { icon: 'place', color: '#d9534f', note },
  };
}

export function zone(uid: string, pts: Point[], note: string | null = null): ZoneObject {
  return {
    ...base,
    uid,
    type: 'zone',
    layer: 'gm',
    visibility: 'gm',
    geometry: { polygon: pts.map(([x, y]) => ({ x, y })) },
    props: { kind: 'description', note, show_on_enter: false },
  };
}

export function trap(uid: string, x: number, y: number, note: string | null = null): TrapObject {
  return {
    ...base,
    uid,
    type: 'trap',
    layer: 'props',
    visibility: 'hidden_until_revealed',
    geometry: { x, y },
    props: { note, reveal_effect: 'pulse' },
  };
}

export function passage(uid: string, a: Point, b: Point): SecretObject {
  return {
    ...base,
    uid,
    type: 'secret',
    layer: 'walls',
    visibility: 'hidden_until_revealed',
    geometry: { a: [a[0], a[1]], b: [b[0], b[1]] },
    props: { kind: 'passage', note: null },
  };
}

export function secretRoom(uid: string, pts: Point[]): SecretObject {
  return {
    ...base,
    uid,
    type: 'secret',
    layer: 'props',
    visibility: 'hidden_until_revealed',
    geometry: { polygon: pts.map(([x, y]) => ({ x, y })) },
    props: { kind: 'room', note: null },
  };
}

export const asObjects = (...o: MapObject[]): MapObject[] => o;
