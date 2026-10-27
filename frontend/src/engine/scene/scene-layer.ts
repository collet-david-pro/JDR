/**
 * P5 scene layer of the engine (projet.md 14.1 items 5-9, 14.2): objects, placed tokens,
 * lightmap + ambient, cast shadows, fog and the player mask, fed by a SceneView and the
 * VisionService. Plain TypeScript (never in a Svelte $state).
 *
 * Updates are incremental (planSceneChange): objects / tokens are redrawn by uid, fog by
 * chunk key; light and vision polygons are recomputed asynchronously only when their inputs
 * changed (door opened, light or viewer moved…). `stats.visionMs` = time from the scene
 * change to the end of the first frame drawn with the new polygons.
 */

import type {
  CameraState,
  GridSpec,
  LayerDef,
  MapObject,
  PlacedToken,
  Polygon,
  SceneChangedEvent,
  SceneView,
  ViewOptions,
  VisibleScene,
} from '../../editor/contracts';
import {
  FOG_EXPLORED_ALPHA,
  FOG_GM_ALPHA,
  FOG_GM_COLOR,
  LIGHTMAP_SCALE,
  LIGHTMAP_SCALE_PERF,
  MAX_SHADOW_LIGHTS,
} from '../../scene/style';
import type { VisionService, VisionSource } from '../../vision';
import type { Viewport } from '../camera';
import { Container, type Renderer } from '../pixi';
import { AmbientAnimator, viewAmbient } from './ambient-state';
import { FogRenderer } from './fog-renderer';
import { LightingRenderer } from './lighting-renderer';
import { collectLights, nearestLights, needsFlickerFrames, type LightSource } from './lights';
import { ObjectsRenderer } from './objects-renderer';
import { planSceneChange } from './scene-diff';
import { shadowQuads, shadowSegments, type ShadowSegment } from './shadows';
import { TokensRenderer } from './tokens-renderer';
import {
  DEFAULT_VIEW,
  isPlayerLike,
  mergeView,
  needsVisibility,
  tokensDrawn,
  viewerKind,
  viewsEqual,
} from './view-rules';
import { EmitThrottle, lightLimited, pointVisible } from './visibility';
import { ViewerSet } from './viewers';

export interface SceneLayerStats {
  readonly objects: number;
  readonly tokens: number;
  readonly lights: number;
  readonly lightsDrawn: number;
  readonly shadowLights: number;
  readonly fogChunks: number;
  /** Scene change → first frame with the new light / vision polygons, ms (last one). */
  readonly visionMs: number | null;
  /** Duration of the last VisionService computation, ms. */
  readonly visionComputeMs: number | null;
  readonly visionUpdates: number;
  /** Number of visionMs measurements taken so far. */
  readonly visionSamples: number;
  readonly animating: boolean;
  readonly lightmapScale: number;
}

export interface SceneFrame {
  readonly now: number;
  readonly camera: CameraState;
  readonly viewport: Viewport;
  readonly dpr: number;
  readonly cameraChanged: boolean;
}

export interface SceneLayerHooks {
  requestRender(): void;
  readonly reducedMotion: boolean;
}

const EXPLORED_GREY = Math.round((1 - FOG_EXPLORED_ALPHA) * 255) * 0x010101;

export class SceneLayer {
  readonly objects = new ObjectsRenderer();
  readonly tokens: TokensRenderer;
  readonly lighting: LightingRenderer;
  /** GM veil (world space). */
  readonly fogWorld = new Container();
  private readonly fog = new FogRenderer();

  private scene: SceneView | null = null;
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  private grid: GridSpec | null = null;
  private layers: readonly LayerDef[] = [];
  private viewOptions: ViewOptions = DEFAULT_VIEW;
  private perf = false;
  private readonly objectCache = new Map<string, MapObject>();
  private readonly tokenCache = new Map<string, PlacedToken>();
  private followed = new Set<string>();

  private lights: LightSource[] = [];
  private lightPolys: ReadonlyMap<string, Polygon> = new Map();
  private readonly viewers = new ViewerSet();
  private segments: ShadowSegment[] = [];
  private shadowKey = '';
  private occluderRevision = 0;
  private dirty = { visionScene: true, lights: true, vision: true, segments: true };
  private computing = false;
  private computeAgain = false;
  private pendingStamp: number | null = null;
  private renderStamp: number | null = null;
  private visible: VisibleScene | null = null;
  private readonly ambient = new AmbientAnimator();
  private readonly throttle = new EmitThrottle();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(scene: VisibleScene) => void>();
  private gizmosDirty = true;
  private animating = false;
  private visionMs: number | null = null;
  private visionComputeMs: number | null = null;
  private visionUpdates = 0;
  private visionSamples = 0;
  private destroyed = false;

  constructor(
    renderer: Renderer,
    private readonly vision: VisionService,
    private readonly ownsVision: boolean,
    private readonly hooks: SceneLayerHooks,
  ) {
    this.tokens = new TokensRenderer(() => hooks.requestRender());
    this.lighting = new LightingRenderer(renderer);
    this.fogWorld.addChild(this.fog.root);
    this.fogWorld.alpha = FOG_GM_ALPHA;
  }

  get view(): ViewOptions {
    return this.viewOptions;
  }

  get stats(): SceneLayerStats {
    return {
      objects: this.objects.count,
      tokens: this.tokens.count,
      lights: this.lights.length,
      lightsDrawn: this.lighting.drawnLights,
      shadowLights: this.shadowKey === '' ? 0 : this.shadowKey.split('|').length,
      fogChunks: this.fog.chunkCount,
      visionMs: this.visionMs,
      visionComputeMs: this.visionComputeMs,
      visionUpdates: this.visionUpdates,
      visionSamples: this.visionSamples,
      animating: this.animating,
      lightmapScale: this.perf ? LIGHTMAP_SCALE_PERF : LIGHTMAP_SCALE,
    };
  }

  /** Current visibility (null in GM view without viewers). */
  get visibleScene(): VisibleScene | null {
    return this.visible;
  }

  setGrid(grid: GridSpec | null, layers: readonly LayerDef[]): void {
    const sizeChanged =
      grid?.width !== this.grid?.width ||
      grid?.height !== this.grid?.height ||
      grid?.cellPx !== this.grid?.cellPx;
    this.grid = grid === null ? null : { ...grid };
    this.setLayers(layers);
    if (!sizeChanged || grid === null) return;
    this.objects.setCellPx(grid.cellPx);
    this.tokens.setCellPx(grid.cellPx);
    this.resetFog();
    this.invalidateAll();
  }

  setLayers(layers: readonly LayerDef[]): void {
    this.layers = layers;
    this.objects.setLayers(layers);
    this.hooks.requestRender();
  }

  setScene(scene: SceneView | null): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.generation++;
    this.scene = scene;
    this.objectCache.clear();
    this.tokenCache.clear();
    this.visible = null;
    this.lightPolys = new Map();
    this.viewers.clear();
    if (scene === null) {
      this.objects.clear();
      this.tokens.clear();
      this.lights = [];
      this.lighting.setLights([], new Map(), this.cellPx);
      this.lighting.setShadows([], this.cellPx);
      this.lighting.setMaskPolygons([], [], [], this.cellPx);
      this.fog.clear();
      this.hooks.requestRender();
      return;
    }
    const objects = scene.objects();
    for (const o of objects) this.objectCache.set(o.uid, o);
    for (const t of scene.tokens()) this.tokenCache.set(t.uid, t);
    this.objects.sync(objects);
    this.tokens.sync(scene.tokens(), (id) => scene.tokenDef(id));
    this.ambient.set(scene.ambient, performance.now(), false);
    this.resetFog();
    this.unsubscribe = scene.onSceneChanged((event) => this.sceneChanged(event));
    this.invalidateAll();
  }

  setView(patch: Partial<ViewOptions>): void {
    const prev = this.viewOptions;
    const next = mergeView(prev, patch);
    if (viewsEqual(prev, next)) return;
    this.viewOptions = next;
    if (prev.mode !== next.mode) {
      this.objects.setMode(next.mode);
      this.objects.setLayers(this.layers);
      this.tokens.setMode(next.mode);
      if (viewerKind(prev.mode) !== viewerKind(next.mode)) {
        this.dirty.visionScene = true;
        this.dirty.segments = true;
      }
      this.dirty.lights = true;
      this.gizmosDirty = true;
    }
    this.tokens.setEnabled(tokensDrawn(next));
    if (prev.mode !== next.mode || prev.fog !== next.fog) this.resetFog();
    const viewersChanged =
      prev.viewers.length !== next.viewers.length ||
      prev.viewers.some((v, i) => next.viewers[i] !== v);
    if (viewersChanged || prev.mode !== next.mode) {
      this.dirty.vision = true;
      this.viewers.clear();
      if (isPlayerLike(next.mode)) this.fog.setTint(this.exploredTint());
      // Player views: hide what the new viewers may not see until the polygons arrive.
      this.rebuildVisibility();
    }
    if (prev.shadows !== next.shadows) this.shadowKey = '';
    this.markChange();
  }

  setPerformance(perf: boolean): void {
    if (perf === this.perf) return;
    this.perf = perf;
    this.shadowKey = '';
    this.hooks.requestRender();
  }

  onVisibility(listener: (scene: VisibleScene) => void): () => void {
    this.listeners.add(listener);
    if (this.visible !== null) listener(this.visible);
    return () => this.listeners.delete(listener);
  }

  /** Per frame, before rendering. Returns true when another frame is needed (animation). */
  prepare(f: SceneFrame): boolean {
    const grid = this.grid;
    if (grid === null || this.scene === null) {
      this.lighting.lightSprite.visible = false;
      this.lighting.shadowSprite.visible = false;
      this.lighting.fogSprite.visible = false;
      this.fogWorld.visible = false;
      this.animating = false;
      return false;
    }
    this.objects.update(f.camera.zoom);
    if (f.cameraChanged || this.gizmosDirty) {
      this.objects.drawGizmos(f.camera, f.viewport, (uid) => this.scene?.token(uid));
      this.gizmosDirty = false;
    }
    const view = viewRect(f.camera, f.viewport, grid.cellPx);
    const shadows = this.viewOptions.shadows && !this.perf;
    if (shadows) this.updateShadows(f.camera);
    const frozen = this.perf || this.hooks.reducedMotion;
    const player = isPlayerLike(this.viewOptions.mode);
    const fogOn = this.viewOptions.fog;
    this.fogWorld.visible = fogOn && !player;
    const mask =
      fogOn && player
        ? {
            fog: this.fog.root,
            hasViewers: (this.visible?.viewers.length ?? 0) > 0,
            lightLimited: lightLimited(this.ambient.target.darkness),
          }
        : null;
    const ambient = viewAmbient(
      this.ambient.at(f.now),
      this.viewOptions.mode,
      this.viewOptions.lighting,
    );
    this.lighting.render({
      camera: f.camera,
      viewport: f.viewport,
      dpr: f.dpr,
      cellPx: grid.cellPx,
      scale: this.perf ? LIGHTMAP_SCALE_PERF : LIGHTMAP_SCALE,
      now: f.now,
      frozen,
      ambient: this.viewOptions.lighting ? ambient : null,
      shadows,
      mask,
      view,
    });
    this.animating =
      (this.viewOptions.lighting && this.ambient.active(f.now)) ||
      needsFlickerFrames(this.lights, view, { lighting: this.viewOptions.lighting, frozen });
    return this.animating;
  }

  /** After the frame was submitted: closes the scene change → frame measurement. */
  rendered(now: number): void {
    if (this.renderStamp === null) return;
    this.visionMs = Math.round((now - this.renderStamp) * 10) / 10;
    this.visionSamples++;
    this.renderStamp = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe?.();
    if (this.emitTimer !== null) clearTimeout(this.emitTimer);
    this.listeners.clear();
    this.objects.destroy();
    this.tokens.destroy();
    this.lighting.destroy();
    this.fog.destroy();
    this.fogWorld.destroy({ children: true });
    if (this.ownsVision) this.vision.destroy();
    this.scene = null;
  }

  // ------------------------------------------------------------------------------------------

  private get cellPx(): number {
    return this.grid?.cellPx ?? 70;
  }

  /** Display view without viewers shows the explored areas untouched (14.2). */
  private exploredTint(): number {
    const v = this.viewOptions;
    return v.mode === 'display' && v.viewers.length === 0 ? 0xffffff : EXPLORED_GREY;
  }

  private invalidateAll(): void {
    this.occluderRevision++;
    this.dirty = { visionScene: true, lights: true, vision: true, segments: true };
    this.shadowKey = '';
    this.gizmosDirty = true;
    this.markChange();
  }

  private resetFog(): void {
    const scene = this.scene;
    const grid = this.grid;
    if (scene === null || grid === null || !this.viewOptions.fog) {
      this.fog.clear();
      return;
    }
    const player = isPlayerLike(this.viewOptions.mode);
    this.fog.reset(
      player ? 'explored' : 'unexplored',
      grid,
      (key) => scene.fogChunk(key),
      () => scene.fogKeys(),
    );
    this.fog.setTint(player ? this.exploredTint() : FOG_GM_COLOR);
    if (player) this.fogWorld.removeChild(this.fog.root);
    else if (this.fog.root.parent !== this.fogWorld) this.fogWorld.addChild(this.fog.root);
  }

  private sceneChanged(event: SceneChangedEvent): void {
    const scene = this.scene;
    if (scene === null || this.destroyed) return;
    const plan = planSceneChange(event, {
      prevObject: (uid) => this.objectCache.get(uid),
      nextObject: (uid) => scene.object(uid),
      prevToken: (uid) => this.tokenCache.get(uid),
      nextToken: (uid) => scene.token(uid),
      tokenDef: (id) => scene.tokenDef(id),
      viewers: new Set(this.viewOptions.viewers),
      followed: this.followed,
    });
    for (const uid of plan.removeObjects) {
      this.objects.remove(uid);
      this.objectCache.delete(uid);
    }
    for (const uid of plan.redrawObjects) {
      const obj = scene.object(uid);
      if (obj === undefined) continue;
      this.objects.upsert(obj);
      this.objectCache.set(uid, obj);
    }
    if (plan.redrawObjects.length + plan.removeObjects.length > 0) this.gizmosDirty = true;
    for (const uid of plan.removeTokens) {
      this.tokens.remove(uid);
      this.tokenCache.delete(uid);
    }
    if (plan.allTokens) {
      this.tokenCache.clear();
      for (const t of scene.tokens()) this.tokenCache.set(t.uid, t);
      this.tokens.sync(scene.tokens(), (id) => scene.tokenDef(id));
    } else {
      for (const uid of plan.redrawTokens) {
        const t = scene.token(uid);
        if (t === undefined) continue;
        this.tokens.upsert(t, scene.tokenDef(t.token_id));
        this.tokenCache.set(uid, t);
      }
    }
    if (this.followed.size > 0 && plan.redrawTokens.some((u) => this.followed.has(u))) {
      this.gizmosDirty = true;
    }
    for (const key of plan.fog) this.fog.update(key);
    if (plan.ambient) {
      this.ambient.set(scene.ambient, performance.now(), !this.hooks.reducedMotion);
    }
    if (plan.occluders) {
      this.occluderRevision++;
      this.dirty.visionScene = true;
      this.dirty.segments = true;
    }
    if (plan.lights) this.dirty.lights = true;
    if (plan.vision) this.dirty.vision = true;
    if (plan.occluders || plan.lights || plan.vision) {
      this.markChange();
    } else if (plan.tokenVisibility) {
      this.rebuildVisibility();
    }
    this.hooks.requestRender();
  }

  /** Records a change needing new polygons and starts (or chains) a computation. */
  private markChange(): void {
    this.pendingStamp ??= performance.now();
    this.shadowKey = '';
    void this.compute();
    this.hooks.requestRender();
  }

  private async compute(): Promise<void> {
    if (this.computing) {
      this.computeAgain = true;
      return;
    }
    this.computing = true;
    try {
      do {
        this.computeAgain = false;
        await this.computeOnce();
      } while (this.computeAgain && !this.destroyed);
    } catch (error) {
      console.error(error);
    } finally {
      this.computing = false;
    }
  }

  private async computeOnce(): Promise<void> {
    const scene = this.scene;
    const grid = this.grid;
    const stamp = this.pendingStamp;
    this.pendingStamp = null;
    if (scene === null || grid === null) return;
    const generation = this.generation;
    const view = this.viewOptions;
    const dirty = this.dirty;
    this.dirty = { visionScene: false, lights: false, vision: false, segments: dirty.segments };
    if (dirty.visionScene) {
      this.vision.setScene({
        floor: scene.floor,
        width: grid.width,
        height: grid.height,
        objects: scene.objects(),
        viewer: viewerKind(view.mode),
        revision: this.occluderRevision,
      });
    }
    const lightsChanged = dirty.lights || dirty.visionScene;
    if (dirty.lights) {
      const objects = scene.objects();
      this.followed = new Set(
        objects.flatMap((o) =>
          o.type === 'light' && o.props.follows_token !== null ? [o.props.follows_token] : [],
        ),
      );
      this.lights = collectLights(
        objects,
        scene.tokens(),
        (uid) => scene.token(uid),
        (id) => scene.tokenDef(id),
        view.mode,
      );
    }
    const visionChanged = (dirty.vision || dirty.visionScene) && needsVisibility(view);
    const viewerInfos = visionChanged
      ? this.viewers.collect(
          view.viewers,
          (uid) => scene.token(uid),
          (id) => scene.tokenDef(id),
        )
      : [];
    const started = performance.now();
    const lightSources: VisionSource[] = this.lights.map((l) => ({
      id: l.id,
      x: l.x,
      y: l.y,
      radius: l.dim,
      cone: l.cone,
    }));
    const [lightPolys, visionPolys] = await Promise.all([
      lightsChanged ? this.vision.compute('light', lightSources) : Promise.resolve(null),
      visionChanged
        ? this.vision.compute('vision', ViewerSet.sources(viewerInfos))
        : Promise.resolve(null),
    ]);
    if (this.destroyed || generation !== this.generation) return;
    this.visionComputeMs = Math.round((performance.now() - started) * 10) / 10;
    this.visionUpdates++;
    if (lightPolys !== null) {
      this.lightPolys = lightPolys;
      this.lighting.setLights(this.lights, lightPolys, grid.cellPx);
    }
    if (visionPolys !== null) this.viewers.update(viewerInfos, visionPolys);
    if (!needsVisibility(view)) this.viewers.clear();
    this.rebuildVisibility();
    if (stamp !== null) this.renderStamp = Math.min(this.renderStamp ?? stamp, stamp);
    this.hooks.requestRender();
  }

  /** VisibleScene, player mask polygons, token filter, emission. */
  private rebuildVisibility(): void {
    const scene = this.scene;
    const view = this.viewOptions;
    if (scene === null || !needsVisibility(view)) {
      this.visible = null;
      this.tokens.setFilter(null);
      this.lighting.setMaskPolygons([], [], [], this.cellPx);
      return;
    }
    const lights = this.lights.flatMap((l) => {
      const polygon = this.lightPolys.get(l.id);
      return polygon === undefined ? [] : [{ x: l.x, y: l.y, polygon, dimRadius: l.dim }];
    });
    const visible: VisibleScene = {
      floor: scene.floor,
      sceneRevision: scene.sceneRevision,
      darkness: this.ambient.target.darkness,
      viewers: this.viewers.visible(),
      lights,
    };
    this.visible = visible;
    const dark = this.viewers.darkPolygons();
    this.lighting.setMaskPolygons(
      visible.viewers.map((v) => v.polygon),
      [...lights.map((l) => l.polygon), ...dark],
      dark,
      this.cellPx,
    );
    if (isPlayerLike(view.mode)) {
      const viewerSet = new Set(view.viewers);
      this.tokens.setFilter((t) => viewerSet.has(t.uid) || pointVisible(visible, t.x, t.y));
    } else {
      this.tokens.setFilter(null);
    }
    this.emitVisibility();
  }

  private emitVisibility(): void {
    if (this.listeners.size === 0 || this.emitTimer !== null) return;
    const delay = this.throttle.delay(performance.now());
    const emit = (): void => {
      this.emitTimer = null;
      const v = this.visible;
      if (v === null || this.destroyed) return;
      this.throttle.mark(performance.now());
      for (const l of [...this.listeners]) {
        try {
          l(v);
        } catch (error) {
          console.error(error);
        }
      }
    };
    if (delay <= 0) emit();
    else this.emitTimer = setTimeout(emit, delay);
  }

  private updateShadows(camera: CameraState): void {
    const scene = this.scene;
    if (scene === null) return;
    if (this.dirty.segments) {
      this.segments = shadowSegments(scene.objects(), this.viewOptions.mode);
      this.dirty.segments = false;
      this.shadowKey = '';
    }
    const casters = nearestLights(this.lights, camera.x, camera.y, MAX_SHADOW_LIGHTS);
    const key = casters.map((l) => `${l.id}@${l.x},${l.y},${l.dim}`).join('|');
    if (key === this.shadowKey) return;
    this.shadowKey = key;
    this.lighting.setShadows(
      casters.flatMap((l) => shadowQuads(l, this.segments)),
      this.cellPx,
    );
  }
}

/** Visible world rectangle in cells. */
function viewRect(
  camera: CameraState,
  viewport: Viewport,
  cellPx: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const s = cellPx * camera.zoom;
  const hw = viewport.width / 2 / s;
  const hh = viewport.height / 2 / s;
  return { x0: camera.x - hw, y0: camera.y - hh, x1: camera.x + hw, y1: camera.y + hh };
}
