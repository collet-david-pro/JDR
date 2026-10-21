/**
 * Scene engine (projet.md 13.3, 14.1): Pixi renderer (WebGPU, else WebGL2), camera, grid,
 * chunked tilemap, edit overlay, pointer translation. Plain TypeScript: never put this object
 * or anything it returns (other than plain values) in a Svelte $state (projet.md 13.2).
 *
 * Load it with a dynamic import (see ./load.ts): Pixi must stay out of the initial bundle.
 *
 * Rendering is on demand: a frame is only requested when something changed (camera, chunks,
 * overlay, textures, size) or work remains (inertia, progressive chunk builds). No idle loop:
 * Pixi's system ticker (used by its GC scheduler) is stopped and pumped from our frames and
 * from a slow housekeeping timer.
 */

import type {
  CameraState,
  ChunksChangedEvent,
  GridSpec,
  GridTheme,
  LayerDef,
  MapPointerEvent,
  MapView,
  Overlay,
  PointerModifiers,
  SceneEngineApi,
} from '../editor/contracts';
import {
  camerasEqual,
  clampZoom,
  cellAt,
  fitCamera,
  inertiaStep,
  isMoving,
  normalizeCamera,
  panByScreen,
  screenToWorld,
  worldTransform,
  zoomAround,
  type Velocity,
  type Viewport,
} from './camera';
import { EngineUnsupportedError } from './errors';
import { FpsMeter, PerformanceModeDetector, effectiveDpr, type FpsSample } from './frame-stats';
import { GridRenderer } from './grid-renderer';
import { InputController, type ToolPointerType } from './input';
import { OverlayRenderer } from './overlay-renderer';
import { autoDetectRenderer, Container, Ticker, type Renderer } from './pixi';
import { hasWebGL2 } from './support';
import { PaletteTextures } from './textures';
import { TileMapRenderer, type TileMapStats } from './tilemap';

export interface SceneEngineOptions {
  /** Preferred API (default 'webgpu'); the other one is the fallback. */
  readonly preference?: 'webgpu' | 'webgl';
  /** Device pixel ratio cap (default 2, projet.md 14.1). */
  readonly maxDpr?: number;
  /** Disables pan inertia (default: prefers-reduced-motion). */
  readonly reducedMotion?: boolean;
  /** Time budget per frame for chunk builds / cache renders, ms (default 6). */
  readonly buildBudgetMs?: number;
}

export interface SceneEngineStats extends TileMapStats {
  readonly renderer: 'webgpu' | 'webgl';
  readonly dpr: number;
  readonly performanceMode: boolean;
  readonly frames: number;
  /** Cumulative main-thread time spent in frames (update + render submit), ms. */
  readonly cpuMs: number;
}

/** Zoom considered settled after this long without change (cache level switch). */
const ZOOM_SETTLE_MS = 200;
const HOUSEKEEPING_MS = 5000;

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(value: T): void {
    for (const l of [...this.listeners]) {
      try {
        l(value);
      } catch (error) {
        console.error(error);
      }
    }
  }
  clear(): void {
    this.listeners.clear();
  }
}

async function createRenderer(
  host: HTMLElement,
  preference: 'webgpu' | 'webgl',
  dpr: number,
  background: number,
): Promise<Renderer> {
  const hasGpuApi = 'gpu' in navigator;
  const webgl2 = hasWebGL2();
  if (!webgl2 && !hasGpuApi) throw new EngineUnsupportedError('no-gpu');
  const order: ('webgpu' | 'webgl')[] =
    preference === 'webgpu' ? ['webgpu', 'webgl'] : ['webgl', 'webgpu'];
  const attempt = (pref: ('webgpu' | 'webgl')[]): Promise<Renderer> =>
    autoDetectRenderer({
      preference: pref,
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      resolution: dpr,
      autoDensity: true,
      antialias: false,
      background,
      powerPreference: 'high-performance',
      // We handle DOM input ourselves: skip Pixi's events/accessibility/DOM extensions.
      manageImports: false,
      webgl: { preferWebGLVersion: 2 },
    });
  let renderer: Renderer;
  try {
    renderer = await attempt(order);
  } catch (error) {
    // WebGPU announced but failing (adapter/device): retry WebGL2 only.
    if (!webgl2) throw new EngineUnsupportedError('no-gpu', { cause: error });
    try {
      renderer = await attempt(['webgl']);
    } catch (error2) {
      throw new EngineUnsupportedError('init-failed', { cause: error2 });
    }
  }
  if (renderer.name === 'webgl') {
    const version = (renderer as Renderer & { context?: { webGLVersion?: number } }).context
      ?.webGLVersion;
    if (version !== 2) {
      renderer.destroy();
      throw new EngineUnsupportedError('no-gpu');
    }
  } else if (renderer.name !== 'webgpu') {
    renderer.destroy();
    throw new EngineUnsupportedError('no-gpu');
  }
  return renderer;
}

export class SceneEngine implements SceneEngineApi {
  /**
   * Creates the engine inside `host` (the canvas fills it; give it a size and
   * `position: relative` or similar). Throws EngineUnsupportedError when neither WebGPU nor
   * WebGL2 works.
   */
  static async create(host: HTMLElement, options: SceneEngineOptions = {}): Promise<SceneEngine> {
    const maxDpr = options.maxDpr ?? 2;
    const dpr = effectiveDpr(window.devicePixelRatio, false, maxDpr);
    const grid = new GridRenderer();
    const renderer = await createRenderer(
      host,
      options.preference ?? 'webgpu',
      dpr,
      grid.theme.outside,
    );
    return new SceneEngine(host, renderer, grid, dpr, options);
  }

  readonly camera: SceneEngineApi['camera'];

  private readonly stage = new Container();
  private readonly world = new Container({ isRenderGroup: true });
  private readonly textures: PaletteTextures;
  private readonly tilemap: TileMapRenderer;
  private readonly overlayRenderer = new OverlayRenderer();
  private readonly input: InputController;
  private readonly canvas: HTMLCanvasElement;

  private view: MapView | null = null;
  private grid: GridSpec | null = null;
  private layersSnapshot = '';
  private currentTheme: GridTheme | null = null;
  private viewSubscriptions: (() => void)[] = [];

  private cam: CameraState = { x: 0, y: 0, zoom: 1 };
  private viewport: Viewport;
  private velocity: Velocity = { vx: 0, vy: 0 };
  private lastInertiaAt = 0;
  private lastZoomAt = -Infinity;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  private rafId = 0;
  private cameraChanged = true;
  private screenDirty = true;
  private destroyed = false;
  private frames = 0;
  private cpuMs = 0;

  private readonly fpsMeter = new FpsMeter();
  private readonly perfDetector = new PerformanceModeDetector();
  private perfOverride: boolean | null = null;
  private dprValue: number;

  private readonly pointerEvents = new Emitter<MapPointerEvent>();
  private readonly cameraEvents = new Emitter<CameraState>();
  private readonly fpsEvents = new Emitter<number>();

  private readonly resizeObserver: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;
  private readonly onDprChange = (): void => this.watchDpr();
  private readonly housekeeping: ReturnType<typeof setInterval>;
  private readonly tickerWasStarted: boolean;
  private readonly tickerAutoStart: boolean;
  private readonly reducedMotion: boolean;
  private readonly budgetMs: number;
  private readonly maxDpr: number;

  private constructor(
    private readonly host: HTMLElement,
    private readonly pixi: Renderer,
    private readonly gridRenderer: GridRenderer,
    dpr: number,
    options: SceneEngineOptions,
  ) {
    this.dprValue = dpr;
    this.maxDpr = options.maxDpr ?? 2;
    this.budgetMs = options.buildBudgetMs ?? 6;
    this.reducedMotion =
      options.reducedMotion ??
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ??
      false;
    this.viewport = {
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
    };

    // No idle render loop: stop Pixi's system ticker (GC scheduler), pumped by our frames.
    const ticker = Ticker.system;
    this.tickerWasStarted = ticker.started;
    this.tickerAutoStart = ticker.autoStart;
    ticker.autoStart = false;
    ticker.stop();

    this.textures = new PaletteTextures((indices) => {
      this.tilemap.texturesChanged(indices);
      this.requestRender();
    });
    this.tilemap = new TileMapRenderer(pixi, this.textures);

    this.world.addChild(gridRenderer.background, this.tilemap.root);
    this.stage.addChild(
      this.world,
      gridRenderer.lines,
      gridRenderer.border,
      this.overlayRenderer.root,
    );

    this.canvas = pixi.canvas as HTMLCanvasElement;
    this.canvas.style.display = 'block';
    this.canvas.style.outline = 'none';
    host.appendChild(this.canvas);

    this.input = new InputController(this.canvas, {
      panStart: () => {
        this.velocity = { vx: 0, vy: 0 };
      },
      pan: (dx, dy) => {
        this.setCamera(panByScreen(this.cam, this.cellPx, dx, dy));
      },
      panEnd: (v) => {
        if (this.reducedMotion || !isMoving(v)) return;
        this.velocity = v;
        this.lastInertiaAt = performance.now();
        this.requestRender();
      },
      zoom: (factor, sx, sy) => {
        this.velocity = { vx: 0, vy: 0 };
        this.setCamera(zoomAround(this.cam, this.viewport, this.cellPx, factor, sx, sy));
      },
      pointer: (type, sx, sy, button, mods) => this.emitPointer(type, sx, sy, button, mods),
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.watchDpr();
    this.housekeeping = setInterval(() => this.runHousekeeping(), HOUSEKEEPING_MS);

    this.camera = {
      get: () => this.cam,
      set: (state) => this.setCamera({ ...this.cam, ...state }),
      fit: () => this.fit(),
      zoomBy: (factor, around) => {
        const p = around ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 };
        this.setCamera(zoomAround(this.cam, this.viewport, this.cellPx, factor, p.x, p.y));
      },
    };
    this.requestRender();
  }

  // ------------------------------------------------------------------------------------------
  // SceneEngineApi

  get renderer(): 'webgpu' | 'webgl' {
    return this.pixi.name === 'webgpu' ? 'webgpu' : 'webgl';
  }

  /** True when the resolution is lowered to DPR 1 (automatic < 30 fps for 3 s, or forced). */
  get performanceMode(): boolean {
    return this.perfOverride ?? this.perfDetector.active;
  }

  /** 'auto' (default) or a forced value. */
  setPerformanceMode(mode: 'auto' | boolean): void {
    this.perfOverride = mode === 'auto' ? null : mode;
    if (mode === 'auto') this.perfDetector.reset();
    this.resize(true);
  }

  /** Current DPR used by the renderer. */
  get dpr(): number {
    return this.dprValue;
  }

  get stats(): SceneEngineStats {
    return {
      ...this.tilemap.stats,
      renderer: this.renderer,
      dpr: this.dprValue,
      performanceMode: this.performanceMode,
      frames: this.frames,
      cpuMs: this.cpuMs,
    };
  }

  setMap(view: MapView): void {
    for (const unsubscribe of this.viewSubscriptions) unsubscribe();
    this.view = view;
    this.grid = { ...view.grid };
    this.layersSnapshot = layersKey(view.layers);
    this.textures.setPalette(view.palette);
    this.tilemap.setMap(view);
    this.applyTheme(view.theme);
    this.gridRenderer.drawBackground(this.grid);
    this.viewSubscriptions = [
      view.onChunksChanged((event: ChunksChangedEvent) => {
        this.tilemap.chunksChanged(event);
        this.requestRender();
      }),
      view.onMetaChanged(() => this.metaChanged()),
    ];
    this.fit();
  }

  setGridTheme(theme: GridTheme): void {
    this.applyTheme(theme);
    this.gridRenderer.drawBackground(this.grid);
    this.screenDirty = true;
    this.requestRender();
  }

  private applyTheme(theme: GridTheme): void {
    this.currentTheme = theme;
    this.gridRenderer.setTheme(theme);
    this.pixi.background.color = this.gridRenderer.theme.outside;
  }

  setGridVisible(visible: boolean): void {
    this.gridRenderer.setVisible(visible);
    this.screenDirty = true;
    this.requestRender();
  }

  setOverlay(overlay: Overlay | null): void {
    this.overlayRenderer.set(overlay);
    this.screenDirty = true;
    this.requestRender();
  }

  setPanMode(enabled: boolean): void {
    this.input.panMode = enabled;
  }

  onPointer(listener: (event: MapPointerEvent) => void): () => void {
    return this.pointerEvents.on(listener);
  }

  onCamera(listener: (state: CameraState) => void): () => void {
    return this.cameraEvents.on(listener);
  }

  onFps(listener: (fps: number) => void): () => void {
    return this.fpsEvents.on(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    clearInterval(this.housekeeping);
    this.resizeObserver.disconnect();
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.input.destroy();
    for (const unsubscribe of this.viewSubscriptions) unsubscribe();
    this.viewSubscriptions = [];
    this.pointerEvents.clear();
    this.cameraEvents.clear();
    this.fpsEvents.clear();
    this.tilemap.destroy();
    this.overlayRenderer.destroy();
    this.gridRenderer.destroy();
    this.stage.destroy({ children: true });
    this.textures.destroy();
    this.pixi.destroy({ removeView: true, releaseGlobalResources: true });
    const ticker = Ticker.system;
    ticker.autoStart = this.tickerAutoStart;
    if (this.tickerWasStarted) ticker.start();
    this.view = null;
  }

  // ------------------------------------------------------------------------------------------
  // Internals

  private get cellPx(): number {
    return this.grid?.cellPx ?? 70;
  }

  private fit(): void {
    if (this.grid === null) return;
    this.setCamera(fitCamera(this.grid, this.viewport));
  }

  private setCamera(next: CameraState): void {
    const cam =
      this.grid === null
        ? { ...next, zoom: clampZoom(next.zoom) }
        : normalizeCamera(next, this.grid);
    if (camerasEqual(cam, this.cam)) return;
    if (cam.zoom !== this.cam.zoom) this.noteZoomChange();
    this.cam = cam;
    this.cameraChanged = true;
    this.requestRender();
  }

  private noteZoomChange(): void {
    this.lastZoomAt = performance.now();
    // One more frame once the zoom has settled, to switch the chunk cache level.
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.requestRender();
    }, ZOOM_SETTLE_MS + 20);
  }

  private metaChanged(): void {
    const view = this.view;
    if (view === null) return;
    const g = view.grid;
    const prev = this.grid;
    const gridChanged =
      prev === null ||
      prev.width !== g.width ||
      prev.height !== g.height ||
      prev.cellPx !== g.cellPx;
    this.grid = { ...g };
    this.textures.setPalette(view.palette);
    if (view.theme !== this.currentTheme) {
      this.applyTheme(view.theme);
      if (!gridChanged) this.gridRenderer.drawBackground(this.grid);
    }
    if (gridChanged) {
      this.tilemap.setMap(view);
      this.gridRenderer.drawBackground(this.grid);
      this.setCamera(this.cam);
    } else {
      const key = layersKey(view.layers);
      if (key !== this.layersSnapshot) this.tilemap.setLayers(view.layers);
    }
    this.layersSnapshot = layersKey(view.layers);
    this.screenDirty = true;
    this.requestRender();
  }

  private emitPointer(
    type: ToolPointerType,
    sx: number,
    sy: number,
    button: number,
    mods: PointerModifiers,
  ): void {
    const world = screenToWorld(this.cam, this.viewport, this.cellPx, sx, sy);
    const event: MapPointerEvent = { type, cell: cellAt(world), world, button, mods };
    this.pointerEvents.emit(event);
  }

  private requestRender(): void {
    if (this.destroyed || this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.rafId = 0;
    if (this.destroyed) return;
    const started = performance.now();
    let again = false;

    if (isMoving(this.velocity)) {
      const step = inertiaStep(this.velocity, now - this.lastInertiaAt);
      this.lastInertiaAt = now;
      this.velocity = step.velocity;
      this.setCamera(panByScreen(this.cam, this.cellPx, step.dx, step.dy));
      again = isMoving(this.velocity);
    }

    const t = worldTransform(this.cam, this.viewport, this.cellPx);
    this.world.scale.set(t.scale);
    this.world.position.set(t.tx, t.ty);

    const settled = now - this.lastZoomAt >= ZOOM_SETTLE_MS;
    if (this.tilemap.update(now, this.cam, this.viewport, this.dprValue, settled, this.budgetMs)) {
      again = true;
    }

    if (this.cameraChanged || this.screenDirty) {
      this.gridRenderer.drawScreen(this.cam, this.viewport, this.grid, this.dprValue);
      this.overlayRenderer.draw(this.cam, this.viewport, this.grid, this.dprValue);
      this.screenDirty = false;
    }

    this.pixi.render({ container: this.stage });
    this.frames++;
    Ticker.system.update(now);
    this.cpuMs += performance.now() - started;

    if (this.cameraChanged) {
      this.cameraChanged = false;
      this.cameraEvents.emit(this.cam);
    }
    const sample = this.fpsMeter.frame(now);
    if (sample !== null) this.reportFps(sample);
    if (again) this.requestRender();
  };

  private reportFps(sample: FpsSample): void {
    this.fpsEvents.emit(Math.round(sample.fps * 10) / 10);
    if (this.perfOverride === null && this.perfDetector.sample(sample)) this.resize(true);
  }

  private resize(force = false): void {
    if (this.destroyed) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const dpr = effectiveDpr(window.devicePixelRatio, this.performanceMode, this.maxDpr);
    if (
      !force &&
      width === this.viewport.width &&
      height === this.viewport.height &&
      dpr === this.dprValue
    ) {
      return;
    }
    const hadSize = this.viewport.width > 1 && this.viewport.height > 1;
    this.viewport = { width, height };
    this.dprValue = dpr;
    this.pixi.resize(width, height, dpr);
    this.screenDirty = true;
    this.cameraChanged = true;
    if (!hadSize) this.fit();
    this.requestRender();
  }

  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`) ?? null;
    this.dprQuery?.addEventListener('change', this.onDprChange, { once: true });
    if (this.dprQuery !== null) this.resize();
  }

  private runHousekeeping(): void {
    if (this.destroyed) return;
    const now = performance.now();
    this.tilemap.releaseExpired(now);
    Ticker.system.update(now);
  }
}

function layersKey(layers: readonly LayerDef[]): string {
  return layers.map((l) => `${l.id}:${l.visible ? 1 : 0}:${l.opacity}`).join('|');
}
