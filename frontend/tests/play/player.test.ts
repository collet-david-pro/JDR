import { describe, expect, it, vi } from 'vitest';
import type {
  CameraState,
  MapObject,
  MapPointerEvent,
  VisibleScene,
} from '../../src/editor/contracts';
import { CameraFollow, type CameraHost } from '../../src/lib/sessions/play/camera';
import { PlayerExplorer } from '../../src/lib/sessions/play/exploration';
import { PlayerInput, type PlayerInputHost } from '../../src/lib/sessions/play/player-input';
import { SessionScene } from '../../src/lib/sessions/scene';
import { createSessionState } from '../../src/lib/sessions/state';
import type { SessionAction } from '../../src/lib/sessions/types';
import { createVisionCore } from '../../src/vision';
import { snapshot, mapDetail, placed, door, wall } from '../sessions/fixtures';
import { door as vdoor, inside, wall as vwall } from '../vision/helpers';

const mods = { shift: false, alt: false, ctrlOrMeta: false };
const ev = (type: MapPointerEvent['type'], x: number, y: number): MapPointerEvent => ({
  type,
  cell: { x: Math.floor(x), y: Math.floor(y) },
  world: { x, y },
  button: type === 'move' ? -1 : 0,
  mods,
});

function playerScene() {
  const state = createSessionState(snapshot('player'), '7');
  return { state, scene: new SessionScene(state, '35') };
}

function inputSetup(canMove = true) {
  const { scene, state } = playerScene();
  const moves: [string, number, number][] = [];
  const host: PlayerInputHost = {
    scene: () => scene,
    cellsPerPixel: () => 1 / 70,
    canMove: () => canMove,
    isOwn: (uid) => uid === 't1',
    moveToken: (uid, x, y) => moves.push([uid, x, y]),
  };
  return { scene, state, moves, input: new PlayerInput(host) };
}

describe('PlayerInput', () => {
  it('drags an own token past the threshold and sends the final position', () => {
    const { scene, moves, input } = inputSetup();
    // t1 is at (3, 4).
    input.handle(ev('down', 3, 4));
    input.handle(ev('move', 3.01, 4)); // below DRAG_PX
    expect(moves).toEqual([]);
    input.handle(ev('move', 5, 4));
    expect(scene.token('t1')).toMatchObject({ x: 5, y: 4 });
    input.handle(ev('move', 6.1, 4.2));
    input.handle(ev('up', 6.1, 4.2));
    expect(moves.at(-1)).toEqual(['t1', 6, 4]);
    expect(input.dragging).toBe(false);
  });

  it('does not move a token of someone else, nor without permission', () => {
    const a = inputSetup();
    a.input.handle(ev('down', 8, 8)); // t2 (not own)
    a.input.handle(ev('move', 10, 8));
    a.input.handle(ev('up', 10, 8));
    expect(a.moves).toEqual([]);
    expect(a.scene.token('t2')).toMatchObject({ x: 8, y: 8 });
    const b = inputSetup(false);
    b.input.handle(ev('down', 3, 4));
    b.input.handle(ev('move', 6, 4));
    expect(b.moves).toEqual([]);
  });

  it('a click without move sends nothing', () => {
    const { moves, input } = inputSetup();
    input.handle(ev('down', 3, 4));
    input.handle(ev('up', 3, 4));
    expect(moves).toEqual([]);
  });

  it('shows the token back at the server position after a refusal (revert)', () => {
    const { scene, input } = inputSetup();
    input.handle(ev('down', 3, 4));
    input.handle(ev('move', 7, 4));
    input.handle(ev('up', 7, 4));
    expect(scene.token('t1')).toMatchObject({ x: 7, y: 4 });
    scene.revert('t1');
    expect(scene.token('t1')).toMatchObject({ x: 3, y: 4 });
  });

  it('a blocked state update brings the token back (D8)', () => {
    const { scene, state, input } = inputSetup();
    input.handle(ev('down', 3, 4));
    input.handle(ev('move', 7, 4));
    input.handle(ev('up', 7, 4));
    const tok = state.tokens['t1']!;
    scene.sync({ ...state, tokens: { ...state.tokens, t1: { ...tok, x: 4, y: 4 } } });
    expect(scene.token('t1')).toMatchObject({ x: 4, y: 4 });
  });
});

describe('PlayerExplorer', () => {
  const visible = (scene: SessionScene): VisibleScene => ({
    floor: scene.floor,
    sceneRevision: 1,
    darkness: 0,
    lights: [],
    viewers: [
      {
        uid: 't1',
        x: 3,
        y: 4,
        polygon: new Float32Array([1, 2, 5, 2, 5, 6, 1, 6]),
        dark: 0,
      },
    ],
  });

  function clock() {
    let fn: (() => void) | null = null;
    return {
      setTimeout: (f: () => void) => ((fn = f), 1),
      clearTimeout: () => (fn = null),
      fire: () => fn?.(),
    };
  }

  it('applies locally and sends one fog.reveal after the interval', () => {
    const { scene } = playerScene();
    const sent: SessionAction[][] = [];
    const c = clock();
    const ex = new PlayerExplorer({
      scene,
      active: () => true,
      send: (a) => sent.push(a),
      clock: c,
    });
    ex.push(visible(scene));
    ex.push(visible(scene));
    expect(sent).toEqual([]);
    c.fire();
    expect(sent).toHaveLength(1);
    const action = sent[0]![0]!;
    expect(action.type === 'fog.reveal' && action.floor).toBe('35');
    expect(action.type === 'fog.reveal' && action.chunks.length).toBeGreaterThan(0);
    // The local document already shows the explored area: nothing more to send.
    ex.push(visible(scene));
    c.fire();
    expect(sent).toHaveLength(1);
  });

  it('does nothing when the session is not running', () => {
    const { scene } = playerScene();
    const sent: SessionAction[][] = [];
    const c = clock();
    const ex = new PlayerExplorer({
      scene,
      active: () => false,
      send: (a) => sent.push(a),
      clock: c,
    });
    ex.push(visible(scene));
    c.fire();
    expect(sent).toEqual([]);
    ex.dispose();
  });
});

describe('CameraFollow', () => {
  function cam(): CameraHost & { state: CameraState; fits: number } {
    const h = {
      state: { x: 0, y: 0, zoom: 1 },
      fits: 0,
      get: () => h.state,
      set: (s: Partial<CameraState>) => (h.state = { ...h.state, ...s }),
      fit: () => void h.fits++,
    };
    return h;
  }
  const gm = { x: 10, y: 12, zoom: 2, floor_id: '35', follow: true };

  it('applies the GM camera while following, and stops when the user moves', () => {
    const host = cam();
    const changes: boolean[] = [];
    const f = new CameraFollow(host, true, (on) => changes.push(on));
    f.apply(gm, '35');
    expect(host.state).toEqual({ x: 10, y: 12, zoom: 2 });
    f.moved({ x: 10, y: 12, zoom: 2 }); // echo of our own move
    expect(f.enabled).toBe(true);
    f.moved({ x: 14, y: 12, zoom: 2 }); // user pan
    expect(f.enabled).toBe(false);
    expect(changes).toEqual([false]);
    host.set({ x: 0, y: 0 });
    f.apply(gm, '35');
    expect(host.state.x).toBe(0);
  });

  it('ignores a camera of another floor and does not follow when off', () => {
    const host = cam();
    new CameraFollow(host, true).apply({ ...gm, floor_id: '99' }, '35');
    expect(host.state.x).toBe(0);
    new CameraFollow(host, false).apply(gm, '35');
    expect(host.state.x).toBe(0);
  });

  it('centres on a point, or fits the map without one', () => {
    const host = cam();
    const f = new CameraFollow(host, true);
    f.center({ x: 3, y: 4 });
    expect(host.state).toEqual({ x: 3, y: 4, zoom: 1 });
    f.moved({ x: 3, y: 4, zoom: 1 });
    expect(f.enabled).toBe(true);
    f.center(null);
    expect(host.fits).toBe(1);
  });
});

describe('secret door seen by a player', () => {
  it('a revealed secret door that is open lets the vision through', () => {
    const w = vwall([
      [5, 0],
      [5, 10],
    ]);
    const secret = vdoor([5, 4], [5, 6], { state: 'open', secret: true });
    const onFloor = <T extends object>(o: T): T => ({ ...o, floor: '35' });
    const state = createSessionState(
      snapshot('player', {
        map: mapDetail({
          objects: [onFloor(w), onFloor(secret)] as never,
          tokens_placed: [placed('t1')],
        }),
      }),
      '7',
    );
    const scene = new SessionScene(state, '35');
    expect(scene.doc.object(secret.uid)).toMatchObject({ props: { secret: false, state: 'open' } });
    const core = createVisionCore();
    let revision = 0;
    const look = (objects: readonly MapObject[]) => {
      core.setScene({
        floor: '35',
        width: 20,
        height: 20,
        objects,
        viewer: 'player',
        revision: ++revision,
      });
      const poly = core.compute('vision', [{ id: 'v', x: 2, y: 5, radius: 12 }]).get('v')!;
      return inside(poly as ArrayLike<number>, 8, 5);
    };
    expect(look(scene.doc.objects())).toBe(true);
    // Raw (secret kept): the editor's player preview keeps it as a wall.
    expect(look([onFloor(w), onFloor(secret)] as never)).toBe(false);
  });

  it('a GM scene keeps the door as received', () => {
    const state = createSessionState(snapshot('gm'), '1');
    const scene = new SessionScene(state, '35');
    expect(scene.doc.object('d1')).toMatchObject({ props: { secret: false } });
    void door;
    void wall;
    void vi;
  });
});
