import { describe, expect, it } from 'vitest';
import type {
  CameraState,
  MapPointerEvent,
  MapView,
  Overlay,
  SceneView,
  ViewOptions,
  VisibleScene,
} from '../../src/editor/contracts';
import { EXPLORE_FLUSH_MS } from '../../src/editor/ui/exploration';
import { EditorSession, type EngineLike } from '../../src/editor/ui/session';
import { createRng } from '../../src/editor/util/rng';
import { getFogBit } from '../../src/formats/fog-codec';
import { ev, grid } from './helpers';
import { door, placed, tokenDef, wall } from './scene-helpers';

class FakeSceneEngine implements EngineLike {
  view: MapView | null = null;
  scene: SceneView | null = null;
  overlay: Overlay | null = null;
  views: ViewOptions[] = [];
  perf: ('auto' | boolean)[] = [];
  cam: CameraState = { x: 0, y: 0, zoom: 1 };
  readonly renderer = 'webgl' as const;
  readonly performanceMode = false;
  readonly stats = { visionMs: 12 };
  private pointer = new Set<(e: MapPointerEvent) => void>();
  private fpsL = new Set<(f: number) => void>();
  private visibility = new Set<(s: VisibleScene) => void>();
  readonly camera = {
    get: () => this.cam,
    set: (s: Partial<CameraState>) => (this.cam = { ...this.cam, ...s }),
    fit: () => undefined,
    zoomBy: () => undefined,
  };
  setMap(view: MapView): void {
    this.view = view;
  }
  setScene(scene: SceneView | null): void {
    this.scene = scene;
  }
  setView(options: Partial<ViewOptions>): void {
    this.views.push(options as ViewOptions);
  }
  setPerformanceMode(mode: 'auto' | boolean): void {
    this.perf.push(mode);
  }
  onVisibility(l: (s: VisibleScene) => void): () => void {
    this.visibility.add(l);
    return () => this.visibility.delete(l);
  }
  setGridTheme(): void {}
  setGridVisible(): void {}
  setOverlay(o: Overlay | null): void {
    this.overlay = o;
  }
  setPanMode(): void {}
  onPointer(l: (e: MapPointerEvent) => void): () => void {
    this.pointer.add(l);
    return () => this.pointer.delete(l);
  }
  onCamera(): () => void {
    return () => undefined;
  }
  onFps(l: (f: number) => void): () => void {
    this.fpsL.add(l);
    return () => this.fpsL.delete(l);
  }
  emit(e: MapPointerEvent): void {
    for (const l of this.pointer) l(e);
  }
  fps(v: number): void {
    for (const l of this.fpsL) l(v);
  }
  see(scene: VisibleScene): void {
    for (const l of this.visibility) l(scene);
  }
  destroy(): void {}
  get lastView(): ViewOptions {
    return this.views.at(-1)!;
  }
}

/** Manual timers for the exploration. */
function manualClock() {
  const timers: (() => void)[] = [];
  return {
    clock: {
      setTimeout: (fn: () => void) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: () => undefined,
    },
    run: () => {
      while (timers.length > 0) timers.shift()!();
    },
  };
}

function setup() {
  const timers = manualClock();
  let n = 0;
  const session = new EditorSession({
    grid: grid(64, 64),
    rng: createRng(1),
    newUid: () => `u${++n}`,
    exploreClock: timers.clock,
  });
  session.scene.setTokenDefs([tokenDef('pc1'), tokenDef('mob', 'monster')]);
  session.doc.apply([
    { type: 'maptoken.add', token: placed('hero', 5.5, 5.5, 'pc1') },
    { type: 'maptoken.add', token: placed('orc', 9.5, 5.5, 'mob') },
  ]);
  session.doc.flush();
  const engine = new FakeSceneEngine();
  session.attach(engine);
  return { session, engine, timers };
}

function disc(x: number, y: number, r: number): Float32Array {
  const out = new Float32Array(32 * 2);
  for (let i = 0; i < 32; i++) {
    out[i * 2] = x + Math.cos((i / 32) * Math.PI * 2) * r;
    out[i * 2 + 1] = y + Math.sin((i / 32) * Math.PI * 2) * r;
  }
  return out;
}

describe('EditorSession P5: engine, view, exploration', () => {
  it('gives the document to the engine as scene and starts in GM view without viewers', () => {
    const { session, engine } = setup();
    expect(engine.scene).toBe(session.doc);
    expect(engine.lastView).toMatchObject({ mode: 'gm', viewers: [], lighting: true, fog: true });
    expect(engine.perf).toEqual(['auto']);
    engine.fps(60);
    expect(session.ui.visionMs).toBe(12);
  });

  it('"see as" a token or every PC sends the player view', () => {
    const { session, engine } = setup();
    session.scene.setView({ mode: 'player', viewer: 'all_pcs' });
    expect(engine.lastView).toMatchObject({ mode: 'player', viewers: ['hero'] });
    session.scene.setView({ mode: 'player', viewer: 'orc' });
    expect(engine.lastView.viewers).toEqual(['orc']);
    session.scene.setView({ lighting: false, shadows: true, performance: 'on' });
    expect(engine.lastView).toMatchObject({ lighting: false, shadows: true });
    expect(engine.perf.at(-1)).toBe(true);
    // The viewed token is removed: the view follows.
    session.doc.apply([{ type: 'maptoken.remove', uid: 'orc' }]);
    session.doc.flush();
    expect(engine.lastView.viewers).toEqual([]);
  });

  it('exploration: visibility ⇒ fog.reveal grouped every 500 ms, outside the history', () => {
    const { session, engine, timers } = setup();
    const sent: string[] = [];
    session.history.onOps((ops, origin) => sent.push(`${origin}:${ops.map((o) => o.type).join()}`));
    session.scene.setView({ explore: true });
    expect(engine.lastView.viewers).toEqual(['hero']); // GM view + exploration: all PCs
    const visible: VisibleScene = {
      floor: 'f1',
      sceneRevision: session.doc.sceneRevision,
      darkness: 0,
      viewers: [{ uid: 'hero', x: 5.5, y: 5.5, polygon: disc(5.5, 5.5, 3), dark: 0 }],
      lights: [],
    };
    engine.see(visible);
    engine.see(visible);
    expect(session.doc.fogKeys()).toEqual([]);
    expect(EXPLORE_FLUSH_MS).toBe(500);
    timers.run();
    expect(sent).toEqual(['untracked:fog.reveal']);
    expect(getFogBit(session.doc.fogChunk('0:0')!, 22, 22)).toBe(true);
    expect(session.history.state.undoSize).toBe(0);
    // Already explored: nothing new is sent.
    engine.see(visible);
    timers.run();
    expect(sent).toHaveLength(1);
    // Reset done on the server: local fog cleared.
    session.scene.fogReset();
    expect(session.doc.fogKeys()).toEqual([]);
  });

  it('keeps the object selection in sync with the document (undo removes, list selects)', () => {
    const { session, engine } = setup();
    session.setTool('wall');
    for (const [x, y] of [
      [1, 1],
      [4, 1],
    ] as const)
      engine.emit(ev('down', x, y));
    session.controller.handleAction('confirm');
    session.doc.flush();
    const uid = session.doc.objects()[0]!.uid;
    expect(session.ui.sceneItems.map((i) => i.kind)).toEqual(['token', 'token', 'wall']);
    session.selectObjects({ objects: [uid], tokens: [] });
    expect(session.ui.tool).toBe('select');
    expect(engine.overlay).toEqual({
      kind: 'group',
      items: [{ kind: 'objects', objects: [uid], tokens: [] }],
    });
    session.undo();
    session.doc.flush();
    expect(session.ui.objectSelection).toEqual({ objects: [], tokens: [] });
  });

  it('properties edits are undoable commands; conflicts replace the local state', () => {
    const { session } = setup();
    session.doc.apply([
      {
        type: 'object.add',
        object: wall('w', [
          [0, 2],
          [6, 2],
        ]),
      },
      { type: 'object.add', object: door('d', [2, 2], [3, 2]) },
    ]);
    session.scene.patchObjects(['w', 'd'], (o) =>
      o.type === 'door' ? { props: { ...o.props, state: 'open' } } : { locked: true },
    );
    expect(session.doc.object('d')!.props).toMatchObject({ state: 'open' });
    expect(session.doc.object('w')!.locked).toBe(true);
    expect(session.ui.history.undoLabel).toBe('editor.command.edit_object');
    session.scene.setAmbient({ darkness: 0.5 });
    session.doc.flush();
    expect(session.ui.ambient.darkness).toBe(0.5);
    session.undo();
    session.doc.flush();
    expect(session.ui.ambient.darkness).toBe(0);
    session.resolveConflicts([
      {
        op_index: 0,
        kind: 'object',
        uid: 'w',
        reason: 'stale',
        current: {
          ...wall('w', [
            [0, 0],
            [1, 0],
          ]),
          rev: 7,
        },
      },
      { op_index: 1, kind: 'maptoken', uid: 'orc', reason: 'gone', current: null },
    ]);
    expect(session.doc.object('w')!.rev).toBe(7);
    expect(session.doc.token('orc')).toBeUndefined();
  });
});
