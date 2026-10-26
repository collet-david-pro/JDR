/**
 * Screen-space render textures of the P5 scene (projet.md 14.1 items 5, 8, 9; 14.2):
 *
 * - Lightmap (LIGHTMAP_SCALE of the screen, ¼ in performance mode): cleared to the ambient
 *   level (1 − darkness), each light added (blend 'add') as a triangle fan of its light
 *   polygon textured with a radial profile (full up to radius, 0 at dim_radius), tinted by
 *   colour × intensity × flicker. Shown over the scene with blend 'multiply' and the ambient
 *   tint: scene × ((1 − darkness) + lightmap) × tint. All textures are opaque so the alpha
 *   channel never matters (WebGPU and WebGL2 'add' differ on alpha).
 * - Shadows: quads drawn opaque into a transparent texture, shown at SHADOW_ALPHA.
 * - Player mask: lit = light polygons ∪ darkvision polygons (white on black); view = viewer
 *   polygons, intersected with lit (blend 'min') unless darkness < 0.3; fog = explored chunk
 *   masks in grey (1 − FOG_EXPLORED_ALPHA) on black, united with view (blend 'max'). Shown
 *   with 'multiply': unexplored black, explored darkened, visible untouched. With lighting,
 *   the lightmap is multiplied into the visible part instead of over the whole scene, so
 *   remembered (explored) areas stay readable in the dark.
 */

import type { CameraState, Polygon } from '../../editor/contracts';
import { worldTransform, type Viewport } from '../camera';
import {
  CanvasSource,
  Container,
  Graphics,
  Matrix,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Sprite,
  Texture,
  type Renderer,
} from '../pixi';
import { NEUTRAL_AMBIENT, isNeutral, rgbToHex } from './ambient-state';
import type { EffectiveAmbient } from '../../vision/ambient';
import {
  PROFILE_STEPS,
  circleIntersectsRect,
  fanGeometry,
  lightLevel,
  profileIndex,
  scaledColor,
  type LightSource,
  type WorldRect,
} from './lights';
import { DARKVISION_LEVEL, SHADOW_ALPHA } from '../../scene/style';

const PROFILE_PX = 128;

export interface PlayerMask {
  /** Explored fog masks (FogRenderer root, 'explored' kind), world px. */
  readonly fog: Container;
  /** Viewer polygons were set (setMaskPolygons); false = nothing currently visible. */
  readonly hasViewers: boolean;
  /** Lights / darkvision limit the view (darkness ≥ 0.3), else viewer polygons only. */
  readonly lightLimited: boolean;
}

export interface LightingFrame {
  readonly camera: CameraState;
  readonly viewport: Viewport;
  readonly dpr: number;
  readonly cellPx: number;
  /** Lightmap / mask resolution relative to the screen. */
  readonly scale: number;
  readonly now: number;
  readonly frozen: boolean;
  /** null = lighting off. */
  readonly ambient: EffectiveAmbient | null;
  readonly shadows: boolean;
  readonly mask: PlayerMask | null;
  /** Visible world rectangle, cells (light culling). */
  readonly view: WorldRect;
}

interface LightMesh {
  light: LightSource;
  mesh: Mesh;
  vertices: number;
}

function createProfile(ratio: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = PROFILE_PX;
  canvas.height = PROFILE_PX;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    const c = PROFILE_PX / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, PROFILE_PX, PROFILE_PX);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, '#fff');
    if (ratio > 0) g.addColorStop(Math.min(0.999, ratio), '#fff');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PROFILE_PX, PROFILE_PX);
  }
  return new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'linear' }) });
}

function createTarget(width: number, height: number): RenderTexture {
  return RenderTexture.create({
    width,
    height,
    resolution: 1,
    antialias: false,
    scaleMode: 'linear',
    dynamic: true,
  });
}

function releaseTarget(rt: RenderTexture | null): void {
  if (rt === null) return;
  // As in rt-pool.ts: free the GPU memory without the WebGPU bind-group warnings.
  rt.source.unload();
  rt.destroy(false);
}

function polygonPoints(p: Polygon, k: number): number[] {
  const out = new Array<number>(p.length);
  for (let i = 0; i < p.length; i++) out[i] = p[i]! * k;
  return out;
}

/** Destroys a light mesh and its own geometry (read before: destroy() clears it). */
function destroyMesh(mesh: Mesh): void {
  const geometry = mesh.geometry;
  mesh.destroy({ children: false });
  geometry.destroy();
}

export class LightingRenderer {
  readonly shadowSprite = new Sprite();
  readonly lightSprite = new Sprite();
  readonly fogSprite = new Sprite();

  private readonly lightRoot = new Container();
  private readonly meshes = new Map<string, LightMesh>();
  private readonly profiles = new Map<number, Texture>();
  private readonly shadowGfx = new Graphics();
  private readonly litGfx = new Graphics();
  private readonly viewGfx = new Graphics();
  /** Darkvision polygons, added to the lightmap in player views. */
  private readonly darkGfx = new Graphics();
  private readonly litSprite = new Sprite();
  private readonly viewSprite = new Sprite();
  /** Lightmap multiplied into the visible area of the player mask. */
  private readonly lightInMask = new Sprite();
  /**
   * Pixi ignores the blend mode of the root container of a render() call: each blended
   * sprite is rendered through a parent container.
   */
  private readonly litPass = new Container();
  private readonly viewPass = new Container();
  private readonly lightPass = new Container();
  private readonly matrix = new Matrix();
  private readonly identity = new Matrix();
  private rtLight: RenderTexture | null = null;
  private rtShadow: RenderTexture | null = null;
  private rtLit: RenderTexture | null = null;
  private rtView: RenderTexture | null = null;
  private rtFog: RenderTexture | null = null;
  private hasShadows = false;
  private lightsDrawn = 0;

  constructor(private readonly renderer: Renderer) {
    this.lightSprite.blendMode = 'multiply';
    this.fogSprite.blendMode = 'multiply';
    this.shadowSprite.alpha = SHADOW_ALPHA;
    this.litSprite.blendMode = 'min';
    this.viewSprite.blendMode = 'max';
    this.lightInMask.blendMode = 'multiply';
    this.litPass.addChild(this.litSprite);
    this.viewPass.addChild(this.viewSprite);
    this.lightPass.addChild(this.lightInMask);
    this.darkGfx.blendMode = 'add';
    this.darkGfx.visible = false;
    this.lightRoot.addChild(this.darkGfx);
    for (const s of [this.lightSprite, this.fogSprite, this.shadowSprite]) s.visible = false;
  }

  /** Lights drawn in the last lightmap (in view, with a polygon). */
  get drawnLights(): number {
    return this.lightsDrawn;
  }

  /** Light sources and their polygons (cells, clipped to dim_radius). */
  setLights(
    lights: readonly LightSource[],
    polygons: ReadonlyMap<string, Polygon>,
    cellPx: number,
  ): void {
    const seen = new Set<string>();
    for (const light of lights) {
      seen.add(light.id);
      const polygon = polygons.get(light.id);
      const fan =
        polygon === undefined ? null : fanGeometry(polygon, light.x, light.y, light.dim, cellPx);
      let entry = this.meshes.get(light.id);
      if (fan === null) {
        if (entry !== undefined) entry.mesh.visible = false;
        if (entry !== undefined) entry.light = light;
        continue;
      }
      const texture = this.profile(profileIndex(light.radius, light.dim));
      const vertices = fan.positions.length / 2;
      if (entry === undefined || entry.vertices !== vertices) {
        const geometry = new MeshGeometry({
          positions: fan.positions,
          uvs: fan.uvs,
          indices: fan.indices,
        });
        const mesh = new Mesh({ geometry, texture });
        mesh.blendMode = 'add';
        if (entry !== undefined) destroyMesh(entry.mesh);
        entry = { light, mesh, vertices };
        this.meshes.set(light.id, entry);
        this.lightRoot.addChild(mesh);
      } else {
        entry.mesh.geometry.positions = fan.positions;
        entry.mesh.geometry.uvs = fan.uvs;
        entry.mesh.texture = texture;
        entry.light = light;
      }
      entry.mesh.visible = true;
    }
    for (const [id, entry] of [...this.meshes]) {
      if (seen.has(id)) continue;
      destroyMesh(entry.mesh);
      this.meshes.delete(id);
    }
  }

  /** Shadow quads (cells). */
  setShadows(quads: readonly Float32Array[], cellPx: number): void {
    const g = this.shadowGfx;
    g.clear();
    for (const q of quads) g.poly(polygonPoints(q, cellPx), true);
    if (quads.length > 0) g.fill({ color: 0x000000, alpha: 1 });
    this.hasShadows = quads.length > 0;
  }

  /** Viewer and lit polygons of the player mask (cells). */
  setMaskPolygons(
    viewers: readonly Polygon[],
    lit: readonly Polygon[],
    dark: readonly Polygon[],
    cellPx: number,
  ): void {
    const level = Math.round(DARKVISION_LEVEL * 255);
    this.darkGfx.clear();
    for (const p of dark) if (p.length >= 6) this.darkGfx.poly(polygonPoints(p, cellPx), true);
    if (dark.length > 0) this.darkGfx.fill({ color: level * 0x010101, alpha: 1 });
    this.viewGfx.clear();
    for (const p of viewers) if (p.length >= 6) this.viewGfx.poly(polygonPoints(p, cellPx), true);
    if (viewers.length > 0) this.viewGfx.fill({ color: 0xffffff, alpha: 1 });
    this.litGfx.clear();
    for (const p of lit) if (p.length >= 6) this.litGfx.poly(polygonPoints(p, cellPx), true);
    if (lit.length > 0) this.litGfx.fill({ color: 0xffffff, alpha: 1 });
  }

  render(f: LightingFrame): void {
    const w = Math.max(1, Math.ceil(f.viewport.width * f.dpr * f.scale));
    const h = Math.max(1, Math.ceil(f.viewport.height * f.dpr * f.scale));
    const k = w / Math.max(1, f.viewport.width);
    const t = worldTransform(f.camera, f.viewport, f.cellPx);
    this.matrix.set(t.scale * k, 0, 0, t.scale * k, t.tx * k, t.ty * k);

    const ambient = f.ambient ?? NEUTRAL_AMBIENT;
    const lighting = f.ambient !== null && !isNeutral(ambient);
    // Player views: the lightmap only applies to what is visible now (folded into the mask);
    // explored areas keep their remembered look (darkened, not lit).
    const lightInMask = lighting && f.mask !== null && f.mask.hasViewers;
    this.darkGfx.visible = lightInMask;
    this.lightSprite.visible = lighting && !lightInMask;
    this.lightsDrawn = 0;
    if (lighting) {
      this.rtLight = this.ensure(this.rtLight, w, h);
      for (const { light, mesh } of this.meshes.values()) {
        const inView = mesh.visible && circleIntersectsRect(light.x, light.y, light.dim, f.view);
        mesh.renderable = inView;
        if (!inView) continue;
        mesh.tint = scaledColor(light.color, lightLevel(light, f.now, f.frozen));
        this.lightsDrawn++;
      }
      const a = 1 - ambient.darkness;
      this.renderer.render({
        container: this.lightRoot,
        target: this.rtLight,
        clear: true,
        clearColor: [a, a, a, 1],
        transform: this.matrix,
      });
      this.show(this.lightSprite, this.rtLight, f.viewport);
      this.lightSprite.tint = rgbToHex(ambient.tint);
    }

    this.shadowSprite.visible = f.shadows && this.hasShadows;
    if (this.shadowSprite.visible) {
      this.rtShadow = this.ensure(this.rtShadow, w, h);
      this.renderer.render({
        container: this.shadowGfx,
        target: this.rtShadow,
        clear: true,
        clearColor: [0, 0, 0, 0],
        transform: this.matrix,
      });
      this.show(this.shadowSprite, this.rtShadow, f.viewport);
    }

    this.fogSprite.visible = f.mask !== null;
    if (f.mask !== null) {
      this.renderMask(f.mask, w, h, f.viewport, lightInMask);
      this.fogSprite.tint = lightInMask ? rgbToHex(ambient.tint) : 0xffffff;
    }
  }

  destroy(): void {
    for (const entry of this.meshes.values()) destroyMesh(entry.mesh);
    this.meshes.clear();
    this.lightRoot.destroy({ children: true });
    for (const tex of this.profiles.values()) {
      // GPU memory freed without destroying the source (WebGPU bind-group warnings).
      tex.source.unload();
      tex.destroy(false);
    }
    this.profiles.clear();
    for (const g of [this.shadowGfx, this.litGfx, this.viewGfx]) g.destroy();
    // darkGfx is destroyed with lightRoot.
    for (const c of [this.litPass, this.viewPass, this.lightPass]) c.destroy({ children: true });
    for (const s of [this.lightSprite, this.fogSprite, this.shadowSprite]) {
      if (!s.destroyed) s.destroy();
    }
    for (const rt of [this.rtLight, this.rtShadow, this.rtLit, this.rtView, this.rtFog]) {
      releaseTarget(rt);
    }
    this.rtLight = this.rtShadow = this.rtLit = this.rtView = this.rtFog = null;
  }

  private renderMask(
    mask: PlayerMask,
    w: number,
    h: number,
    viewport: Viewport,
    withLight: boolean,
  ): void {
    const hasView = mask.hasViewers;
    if (hasView) {
      if (mask.lightLimited) {
        this.rtLit = this.ensure(this.rtLit, w, h);
        this.renderer.render({
          container: this.litGfx,
          target: this.rtLit,
          clear: true,
          clearColor: [0, 0, 0, 1],
          transform: this.matrix,
        });
      }
      this.rtView = this.ensure(this.rtView, w, h);
      this.renderer.render({
        container: this.viewGfx,
        target: this.rtView,
        clear: true,
        clearColor: [0, 0, 0, 1],
        transform: this.matrix,
      });
      if (mask.lightLimited && this.rtLit !== null) {
        this.litSprite.texture = this.rtLit;
        this.litSprite.setSize(w, h);
        this.renderer.render({
          container: this.litPass,
          target: this.rtView,
          clear: false,
          transform: this.identity,
        });
      }
      if (withLight && this.rtLight !== null) {
        this.lightInMask.texture = this.rtLight;
        this.lightInMask.setSize(w, h);
        this.renderer.render({
          container: this.lightPass,
          target: this.rtView,
          clear: false,
          transform: this.identity,
        });
      }
    }
    this.rtFog = this.ensure(this.rtFog, w, h);
    this.renderer.render({
      container: mask.fog,
      target: this.rtFog,
      clear: true,
      clearColor: [0, 0, 0, 1],
      transform: this.matrix,
    });
    if (hasView && this.rtView !== null) {
      this.viewSprite.texture = this.rtView;
      this.viewSprite.setSize(w, h);
      this.renderer.render({
        container: this.viewPass,
        target: this.rtFog,
        clear: false,
        transform: this.identity,
      });
    }
    this.show(this.fogSprite, this.rtFog, viewport);
  }

  private ensure(rt: RenderTexture | null, w: number, h: number): RenderTexture {
    if (rt === null) return createTarget(w, h);
    if (rt.width !== w || rt.height !== h) rt.resize(w, h);
    return rt;
  }

  private show(sprite: Sprite, rt: RenderTexture, viewport: Viewport): void {
    if (sprite.texture !== rt) sprite.texture = rt;
    sprite.position.set(0, 0);
    sprite.setSize(viewport.width, viewport.height);
  }

  private profile(index: number): Texture {
    let tex = this.profiles.get(index);
    if (tex === undefined) {
      tex = createProfile(index / PROFILE_STEPS);
      this.profiles.set(index, tex);
    }
    return tex;
  }
}
