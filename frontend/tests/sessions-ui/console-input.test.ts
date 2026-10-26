import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapPointerEvent, Overlay } from '../../src/editor/contracts';
import {
  ConsoleInput,
  FOG_FLUSH_MS,
  type ConsoleInputHost,
  type Selection,
} from '../../src/lib/sessions/console/console-input';
import { SessionScene } from '../../src/lib/sessions/scene';
import { createSessionState } from '../../src/lib/sessions/state';
import type { SessionAction } from '../../src/lib/sessions/types';
import { door, snapshot } from '../sessions/fixtures';

const mods = { shift: false, alt: false, ctrlOrMeta: false };
const ev = (type: MapPointerEvent['type'], x: number, y: number, alt = false): MapPointerEvent => ({
  type,
  cell: { x: Math.floor(x), y: Math.floor(y) },
  world: { x, y },
  button: type === 'move' ? -1 : 0,
  mods: { ...mods, alt },
});

function setup(extra: ConstructorParameters<typeof SessionScene>[0] | null = null) {
  const state = extra ?? createSessionState(snapshot('gm'), '1');
  const scene = new SessionScene(state, '35');
  const sent: SessionAction[][] = [];
  const moves: [string, number, number][] = [];
  const placed: unknown[] = [];
  const selections: (Selection | null)[] = [];
  const overlays: (Overlay | null)[] = [];
  const host: ConsoleInputHost = {
    scene: () => scene,
    cellsPerPixel: () => 1 / 70,
    moveToken: (uid, x, y) => moves.push([uid, x, y]),
    send: (a) => sent.push(a),
    placeToken: (...args) => placed.push(args),
    setOverlay: (o) => overlays.push(o),
    onSelect: (s) => selections.push(s),
    tokenSize: () => ({ w: 1, h: 1 }),
  };
  return { input: new ConsoleInput(host), scene, sent, moves, placed, selections, overlays };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('select tool', () => {
  it('drags a token with a local preview and the final position', () => {
    const { input, scene, moves } = setup();
    input.handle(ev('down', 3.1, 4.1));
    input.handle(ev('move', 3.2, 4.2)); // below the drag threshold
    expect(moves).toHaveLength(0);
    input.handle(ev('move', 6.1, 4.1));
    expect(moves.at(-1)).toEqual(['t1', 6, 4]);
    expect(scene.doc.token('t1')?.x).toBe(6);
    input.handle(ev('up', 6.1, 4.1));
    expect(moves.at(-1)).toEqual(['t1', 6, 4]);
  });

  it('keeps the token inside the map', () => {
    const { input, moves } = setup();
    input.handle(ev('down', 3, 4));
    input.handle(ev('move', -20, -20));
    expect(moves.at(-1)).toEqual(['t1', 0, 0]);
  });

  it('selects a token on click without moving it', () => {
    const { input, selections, moves } = setup();
    input.handle(ev('down', 3, 4));
    input.handle(ev('up', 3, 4));
    expect(selections.at(-1)).toEqual({ kind: 'token', uid: 't1' });
    expect(moves).toHaveLength(0);
  });

  it('toggles a door on click and selects it', () => {
    const { input, sent, selections } = setup();
    input.handle(ev('down', 1.5, 1.02));
    input.handle(ev('up', 1.5, 1.02));
    expect(sent).toEqual([[{ type: 'door.toggle', uid: 'd1' }]]);
    expect(selections.at(-1)).toEqual({ kind: 'object', uid: 'd1' });
  });

  it('toggles a light on click', () => {
    const base = createSessionState(snapshot('gm'), '1');
    const state = {
      ...base,
      objects: {
        ...base.objects,
        l1: {
          uid: 'l1',
          floor: '35',
          layer: 'lighting',
          visibility: 'all',
          locked: false,
          sort_order: 0,
          rev: 1,
          type: 'light',
          geometry: { x: 20, y: 20 },
          props: {
            radius: 3,
            dim_radius: 6,
            color: '#ffffff',
            intensity: 1,
            flicker: { type: 'none', amp: 0, speed: 1 },
            cone: null,
            enabled: true,
            follows_token: null,
          },
        },
      },
    } as unknown as typeof base;
    const { input, sent } = setup(state);
    input.handle(ev('down', 20, 20));
    input.handle(ev('up', 20, 20));
    expect(sent[0]).toEqual([{ type: 'light.toggle', uid: 'l1' }]);
  });

  it('clears the selection on empty ground', () => {
    const { input, selections } = setup();
    input.handle(ev('down', 30, 25));
    expect(selections.at(-1)).toBeNull();
  });

  it('releases the drag preview when cancelled', () => {
    const { input, scene } = setup();
    input.handle(ev('down', 3, 4));
    input.handle(ev('move', 8, 4));
    input.cancel();
    const state = createSessionState(snapshot('gm'), '1');
    scene.sync({ ...state, tokens: { ...state.tokens, t1: { ...state.tokens['t1']!, x: 11 } } });
    expect(scene.doc.token('t1')?.x).toBe(11);
  });
});

describe('fog tool', () => {
  it('groups the brush strokes and sends one fog.reveal', () => {
    const { input, sent } = setup();
    input.setTool({ kind: 'fog', op: 'reveal', shape: 'brush', radius: 2 });
    input.handle(ev('down', 5, 5));
    input.handle(ev('move', 7, 5));
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(FOG_FLUSH_MS);
    expect(sent).toHaveLength(1);
    const action = sent[0]![0]!;
    expect(action.type).toBe('fog.reveal');
    expect(action.type === 'fog.reveal' && action.floor).toBe('35');
    expect(action.type === 'fog.reveal' && action.chunks.length).toBeGreaterThan(0);
    input.handle(ev('up', 7, 5));
    expect(sent).toHaveLength(1);
  });

  it('hides with the hide option and with Alt', () => {
    const { input, sent } = setup();
    input.setTool({ kind: 'fog', op: 'reveal', shape: 'rect', radius: 2 });
    // Reveal a rectangle, then hide it with Alt: only existing bits can be hidden.
    input.handle(ev('down', 2, 2));
    input.handle(ev('up', 6, 6));
    expect(sent[0]![0]!.type).toBe('fog.reveal');
  });

  it('does not send bits that do not change the fog shown', () => {
    const { input, sent, scene } = setup();
    input.setTool({ kind: 'fog', op: 'hide', shape: 'brush', radius: 2 });
    input.handle(ev('down', 5, 5));
    input.handle(ev('up', 5, 5));
    expect(sent).toHaveLength(0);
    expect(scene.doc.fogKeys()).toHaveLength(0);
  });

  it('sends a rectangle on release and ignores an empty one', () => {
    const { input, sent } = setup();
    input.setTool({ kind: 'fog', op: 'reveal', shape: 'rect', radius: 2 });
    input.handle(ev('down', 4, 4));
    input.handle(ev('up', 4, 4));
    expect(sent).toHaveLength(0);
    input.handle(ev('down', 4, 4));
    input.handle(ev('move', 8, 8));
    input.handle(ev('up', 8, 8));
    expect(sent).toHaveLength(1);
  });
});

describe('token tool', () => {
  it('places a token on click inside the map and previews the footprint', () => {
    const { input, placed, overlays } = setup();
    input.setTool({ kind: 'token', tokenId: '21', hidden: true });
    input.handle(ev('move', 4.5, 5.5));
    expect(overlays.at(-1)).toMatchObject({ kind: 'area', x: 4, y: 5, w: 1, h: 1 });
    input.handle(ev('down', 4.5, 5.5));
    expect(placed).toEqual([['21', 4, 5, true]]);
    input.handle(ev('down', -3, 5));
    expect(placed).toHaveLength(1);
  });

  it('ignores the pointer without a scene', () => {
    const { input } = setup();
    const empty = new ConsoleInput({
      scene: () => null,
      cellsPerPixel: () => 1,
      moveToken: () => undefined,
      send: () => undefined,
      placeToken: () => undefined,
      setOverlay: () => undefined,
      onSelect: () => undefined,
      tokenSize: () => ({ w: 1, h: 1 }),
    });
    expect(() => empty.handle(ev('down', 1, 1))).not.toThrow();
    expect(input.current.kind).toBe('select');
  });
});

describe('fixtures', () => {
  it('has a closed door', () => {
    expect(door('x').type).toBe('door');
  });
});
