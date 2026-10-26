import { describe, expect, it, vi } from 'vitest';
import type { CameraState, MapPointerEvent, MapView, Overlay } from '../../src/editor/contracts';
import { createRng } from '../../src/editor/util/rng';
import { DEFAULT_MAP_SIZE, gridFromSettings, parseMapSide } from '../../src/editor/ui/map-setup';
import { PaletteCatalog, type TileAsset } from '../../src/editor/ui/palette';
import { EditorSession, type EditorKeyEvent, type EngineLike } from '../../src/editor/ui/session';
import { SoloView } from '../../src/editor/ui/solo-view';
import { ev, grid, makeDoc } from './helpers';

class FakeEngine implements EngineLike {
  view: MapView | null = null;
  overlay: Overlay | null = null;
  panMode = false;
  gridVisible = true;
  cam: CameraState = { x: 0, y: 0, zoom: 0.5 };
  fits = 0;
  performanceMode = false;
  readonly renderer = 'webgl' as const;
  private pointer = new Set<(e: MapPointerEvent) => void>();
  private cameraL = new Set<(c: CameraState) => void>();
  private fpsL = new Set<(f: number) => void>();
  readonly camera = {
    get: () => this.cam,
    set: (s: Partial<CameraState>) => {
      this.cam = { ...this.cam, ...s };
      for (const l of this.cameraL) l(this.cam);
    },
    fit: () => {
      this.fits++;
    },
    zoomBy: (f: number) => this.camera.set({ zoom: this.cam.zoom * f }),
  };
  setMap(view: MapView): void {
    this.view = view;
  }
  setGridTheme(): void {}
  setGridVisible(v: boolean): void {
    this.gridVisible = v;
  }
  setOverlay(o: Overlay | null): void {
    this.overlay = o;
  }
  setPanMode(on: boolean): void {
    this.panMode = on;
  }
  onPointer(l: (e: MapPointerEvent) => void): () => void {
    this.pointer.add(l);
    return () => this.pointer.delete(l);
  }
  onCamera(l: (c: CameraState) => void): () => void {
    this.cameraL.add(l);
    return () => this.cameraL.delete(l);
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
  destroy(): void {}
  setScene(): void {}
  setView(): void {}
  onVisibility(): () => void {
    return () => undefined;
  }
  setPerformanceMode(): void {}
}

const tile = (id: string, width = 64, height = 64): TileAsset => ({
  id,
  name: `Tuile ${id}`,
  width,
  height,
  urls: { full: `/api/v1/files/${id}?t=full`, thumb: `/api/v1/files/${id}?t=thumb` },
});

function key(k: string, opts: Partial<EditorKeyEvent> = {}): EditorKeyEvent {
  return {
    key: k,
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    target: null,
    ...opts,
  };
}

function setup(): { session: EditorSession; engine: FakeEngine } {
  const session = new EditorSession({ grid: grid(60, 40), rng: createRng(1) });
  const engine = new FakeEngine();
  session.attach(engine);
  return { session, engine };
}

describe('map setup', () => {
  it('builds the grid from the game settings and validates the size', () => {
    expect(DEFAULT_MAP_SIZE).toEqual({ width: 60, height: 40 });
    expect(
      gridFromSettings(
        { default_cell_px: 100, unit_label: 'm', unit_per_cell: 1.5 },
        { width: 10, height: 20 },
      ),
    ).toEqual({ width: 10, height: 20, cellPx: 100, unitLabel: 'm', unitPerCell: 1.5 });
    expect(parseMapSide('60')).toBe(60);
    expect(parseMapSide(400)).toBe(400);
    for (const bad of ['0', '401', '2.5', 'abc', '']) expect(parseMapSide(bad)).toBeNull();
  });
});

describe('palette catalog', () => {
  it('keeps thumbnails and variant frames of the assets', () => {
    const c = new PaletteCatalog();
    c.remember(tile('a'));
    c.remember(tile('strip', 256, 64));
    expect(c.resolve('a')).toEqual({ url: '/api/v1/files/a?t=full', name: 'Tuile a' });
    expect(c.resolve('zzz')).toBeNull();
    expect(c.frames('strip')).toBe(4);
    expect(c.frames('a')).toBe(1);
    expect(
      c.items([
        null,
        { assetId: 'a', url: 'u', name: 'A' },
        null,
        { assetId: 'x', url: 'ux', name: 'X' },
      ]),
    ).toEqual([
      { index: 1, assetId: 'a', name: 'A', thumb: '/api/v1/files/a?t=thumb', frames: 1 },
      { index: 3, assetId: 'x', name: 'X', thumb: 'ux', frames: 1 },
    ]);
  });
});

describe('SoloView', () => {
  it('shows only the solo layer without changing the document', () => {
    const doc = makeDoc();
    const view = new SoloView(doc);
    const meta = vi.fn();
    view.onMetaChanged(meta);
    expect(view.layers).toBe(doc.layers);
    view.setSolo('terrain');
    expect(meta).toHaveBeenCalledTimes(1);
    expect(view.layers.filter((l) => l.visible).map((l) => l.id)).toEqual(['terrain']);
    expect(view.layers).toBe(view.layers); // cached
    expect(doc.layers.every((l) => l.visible)).toBe(true);
    view.setSolo(null);
    expect(view.layers).toBe(doc.layers);
    expect(view.theme).toBe(doc.theme);
  });
});

describe('EditorSession', () => {
  it('connects the engine and reflects pointer, camera and fps', () => {
    const { session, engine } = setup();
    expect(engine.view).toBe(session.view);
    expect(session.ui.renderer).toBe('webgl');
    expect(session.ui.zoom).toBe(0.5);
    engine.emit(ev('move', 3.5, 4.5, {}, -1));
    expect(session.ui.cursor).toEqual({ x: 3, y: 4 });
    engine.emit(ev('move', 99, 4, {}, -1));
    expect(session.ui.cursor).toBeNull();
    engine.camera.set({ zoom: 2 });
    expect(session.ui.zoom).toBe(2);
    engine.performanceMode = true;
    engine.fps(42);
    expect(session.ui.fps).toBe(42);
    expect(session.ui.performanceMode).toBe(true);
    session.detach();
    engine.fps(10);
    expect(session.ui.fps).toBe(42);
  });

  it('adds a tile from the library and paints with it (undo/redo labels)', async () => {
    const { session, engine } = setup();
    session.ui.tool = 'eraser';
    expect(session.addTileAsset(tile('t1'))).toBe(1);
    expect(session.addTileAsset(tile('t2', 128, 64))).toBe(2);
    expect(session.addTileAsset(tile('t1'))).toBe(1); // already in the palette
    expect(session.doc.palette[2]).toEqual({
      assetId: 't2',
      url: '/api/v1/files/t2?t=full',
      name: 'Tuile t2',
    });
    expect(session.ui.palette.map((p) => p.frames)).toEqual([1, 2]);
    expect(session.ui.tile).toEqual({ index: 1, variant: 0, flags: 0 });
    expect(session.ui.tool).toBe('brush'); // picking a tile selects the brush
    session.selectTile(2);
    session.ui.randomVariant = true;
    expect(session.ui.variantCount).toBe(2);

    engine.emit(ev('down', 2, 2));
    engine.emit(ev('move', 5, 2));
    engine.emit(ev('up', 5, 2));
    expect(session.doc.getCell('ground', 4, 2).index).toBe(2);
    expect(session.ui.history).toMatchObject({ undoSize: 1, undoLabel: 'editor.command.paint' });
    expect(engine.overlay).toMatchObject({ kind: 'cells' });
    session.undo();
    expect(session.doc.getCell('ground', 4, 2).index).toBe(0);
    expect(session.ui.history).toMatchObject({ canRedo: true, redoLabel: 'editor.command.paint' });
    session.redo();
    expect(session.doc.getCell('ground', 4, 2).index).toBe(2);
  });

  it('manages layers: visibility, lock, opacity, order, solo, active layer', async () => {
    const { session, engine } = setup();
    session.toggleLayerVisible('terrain');
    session.toggleLayerLocked('ground');
    session.patchLayer('decor', { opacity: 0.5 });
    session.moveLayer('decor', -1);
    await Promise.resolve();
    expect(session.ui.layers.find((l) => l.id === 'terrain')?.visible).toBe(false);
    expect(session.ui.layers.find((l) => l.id === 'ground')?.locked).toBe(true);
    expect(session.ui.layers.map((l) => l.id).slice(0, 3)).toEqual(['ground', 'decor', 'terrain']);
    expect(session.history.state.undoSize).toBe(4);

    // Painting on the locked layer is refused with an announced notice.
    session.addTileAsset(tile('t1'));
    engine.emit(ev('down', 1, 1));
    expect(session.ui.notice?.text).toBe('layer_locked');
    const firstNotice = session.ui.notice?.id ?? 0;
    engine.emit(ev('up', 1, 1));
    engine.emit(ev('down', 1, 1));
    expect(session.ui.notice?.id).toBe(firstNotice + 1); // same text announced again

    session.toggleSolo('decor');
    expect(session.ui.solo).toBe('decor');
    expect(engine.view?.layers.filter((l) => l.visible).map((l) => l.id)).toEqual(['decor']);
    session.toggleSolo('decor');
    expect(session.ui.solo).toBeNull();

    session.setActiveLayer('walls'); // object layer: ignored in P4a
    expect(session.ui.layer).toBe('ground');
    session.setActiveLayer('decor');
    expect(session.ui.layer).toBe('decor');

    session.setTheme('blueprint');
    await Promise.resolve();
    expect(session.ui.theme).toBe('blueprint');
    expect(session.view.theme).toBe('blueprint');
    session.setGridVisible(false);
    expect(engine.gridVisible).toBe(false);
  });

  it('handles keyboard shortcuts with the focus rules', () => {
    const session = new EditorSession({
      grid: grid(60, 40),
      rng: createRng(1),
      isViewportTarget: (target) => target === 'viewport',
    });
    const engine = new FakeEngine();
    session.attach(engine);
    expect(session.handleKeyDown(key('g'))).toBe(true);
    expect(session.ui.tool).toBe('fill');
    // Typing in a field: no shortcut.
    expect(session.handleKeyDown(key('b', { target: { tagName: 'INPUT' } }))).toBe(false);
    expect(session.ui.tool).toBe('fill');
    // Inside a dialog: the dialog handles its keys.
    const inDialog = {
      tagName: 'BUTTON',
      closest: (s: string) => (s.includes('dialog') ? {} : null),
    };
    expect(session.handleKeyDown(key('Escape', { target: inDialog }))).toBe(false);
    // Repeated tool keys are ignored, repeated brush keys are not.
    expect(session.handleKeyDown(key(']'))).toBe(true);
    expect(session.handleKeyDown(key(']', { repeat: true }))).toBe(true);
    expect(session.ui.brushSize).toBe(3);
    // Space and Tab only when the map (or the page) has the focus.
    expect(session.handleKeyDown(key(' ', { target: 'button' }))).toBe(false);
    expect(session.handleKeyDown(key(' ', { target: 'viewport' }))).toBe(true);
    expect(engine.panMode).toBe(true);
    expect(session.handleKeyDown(key(' ', { target: 'viewport', repeat: true }))).toBe(true);
    session.handleKeyUp({ key: ' ' });
    expect(engine.panMode).toBe(false);
    session.handleKeyDown(key(' ', { target: 'viewport' }));
    session.releaseKeys();
    expect(engine.panMode).toBe(false);
    expect(session.handleKeyDown(key('Tab', { target: 'button' }))).toBe(false);
    expect(session.handleKeyDown(key('Tab', { target: 'viewport' }))).toBe(true);
    expect(session.ui.panelsOpen).toBe(false);
    // Help, zoom.
    session.handleKeyDown(key('?', { shiftKey: true }));
    expect(session.ui.helpOpen).toBe(true);
    session.handleKeyDown(key('0', { code: 'Digit0', ctrlKey: true }));
    expect(engine.cam.zoom).toBe(1);
    session.handleKeyDown(key('1', { code: 'Digit1', ctrlKey: true }));
    expect(engine.fits).toBe(1);
    // Layers 1-9 (bottom = 1).
    session.handleKeyDown(key('3', { code: 'Digit3' }));
    expect(session.ui.layer).toBe('decor');
    // Hand tool ⇒ pan mode; Escape cancels.
    session.handleKeyDown(key('h'));
    expect(engine.panMode).toBe(true);
    expect(session.handleKeyDown(key('Escape'))).toBe(true);
    session.dispose();
  });
});
