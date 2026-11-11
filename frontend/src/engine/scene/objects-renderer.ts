/**
 * Objects layer (projet.md 14.1 item 6): walls (colour by kind, thickness with a minimal
 * on-screen width, invisible ones dashed and GM only), doors (closed / open / sliding, lock
 * mark, secret outline in GM view, plain wall for players), windows (glass / bars / opening).
 * One Graphics per object (incremental rebuild by uid) inside one container per object layer
 * (MapView.layers order, visibility, opacity), sorted by sort_order. Light gizmos (GM view
 * only) are drawn in screen space above the lighting.
 */

import type { ImageAssetView } from '../../editor/contracts-images';
import type {
  CameraState,
  DoorObject,
  LayerDef,
  MapObject,
  ObjectLayerId,
  PlacedToken,
  ViewMode,
  WallObject,
  WindowObject,
} from '../../editor/contracts';
import {
  DOOR_COLOR,
  DOOR_LOCKED_MARK,
  DOOR_THICKNESS,
  INVISIBLE_WALL_ALPHA,
  LIGHT_GIZMO_COLOR,
  LIGHT_GIZMO_PX,
  SECRET_DOOR_OUTLINE,
  WALL_COLORS,
  WALL_OUTLINE,
  WINDOW_COLOR,
  WINDOW_THICKNESS,
} from '../../scene/style';
import { worldToScreen, type Viewport } from '../camera';
import { dashSegments } from '../overlay-geometry';
import { Assets, Container, Graphics, Sprite, TilingSprite } from '../pixi';
import type { Texture } from '../pixi';
import {
  doorShape,
  lightPosition,
  polylineSegments,
  segmentMiddle,
  strokeWidthPx,
  zoomBucket,
  type Seg,
} from './object-geometry';
import { drawPin, drawSecret, drawTrap, drawZone } from './note-shapes';
import { drawPortal, drawStairs } from './passage-shapes';
import {
  OBJECT_LAYER_IDS,
  doorDrawnAsWall,
  secretDrawnAsWall,
  objectAlpha,
  objectLayerOrder,
  objectLayerState,
  objectShown,
} from './view-rules';

/** Wall drawn for a secret door in player views (same as the server PlayerFilter). */
const SECRET_AS_WALL = { kind: 'stone', thickness: 0.15 } as const;

interface Entry {
  obj: MapObject;
  readonly gfx: Graphics;
  layer: ObjectLayerId;
  /** Textured wall strips / door images drawn over the plain shape (rebuilt by draw). */
  skins: (Sprite | TilingSprite)[];
}

type SkinState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; texture: Texture };

/** Renders walls, doors, windows and other scene objects. */
export class ObjectsRenderer {
  /** World space (unit: pixel at zoom 1). */
  readonly root = new Container();
  /** Screen space (GM light gizmos). */
  readonly gizmos = new Graphics();

  private readonly layerRoots = new Map<ObjectLayerId, Container>();
  private readonly entries = new Map<string, Entry>();
  private readonly dirty = new Set<string>();
  private mode: ViewMode = 'gm';
  private cellPx = 70;
  private bucket = 1;
  private lookup: (assetId: string) => ImageAssetView | null = () => null;
  private changed: () => void = () => undefined;
  private readonly skinTextures = new Map<string, SkinState>();
  private destroyed = false;

  constructor() {
    for (const id of OBJECT_LAYER_IDS) {
      const c = new Container({ sortableChildren: true });
      c.label = `objects:${id}`;
      this.layerRoots.set(id, c);
      this.root.addChild(c);
    }
  }

  get count(): number {
    return this.entries.size;
  }

  /**
   * Where the assets of wall textures and door images come from (SceneView.imageAsset) and what to
   * call when a texture finished loading (a redraw is needed).
   */
  setAssets(
    lookup: ((assetId: string) => ImageAssetView | null) | null,
    changed?: () => void,
  ): void {
    this.lookup = lookup ?? (() => null);
    if (changed !== undefined) this.changed = changed;
    this.assetsChanged();
  }

  /** The known assets changed: redraw the walls and doors that carry one. */
  assetsChanged(): void {
    for (const [uid, e] of this.entries) if (hasSkin(e.obj)) this.dirty.add(uid);
  }

  setCellPx(cellPx: number): void {
    if (cellPx === this.cellPx) return;
    this.cellPx = cellPx;
    for (const uid of this.entries.keys()) this.dirty.add(uid);
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const uid of this.entries.keys()) this.dirty.add(uid);
  }

  /** Object layer order, visibility and opacity (MapView.layers). */
  setLayers(layers: readonly LayerDef[]): void {
    const order = objectLayerOrder(layers);
    order.forEach((id, i) => {
      const c = this.layerRoots.get(id);
      if (c === undefined) return;
      const state = objectLayerState(layers, id, this.mode);
      c.visible = state.visible;
      c.alpha = state.alpha;
      if (this.root.getChildIndex(c) !== i) this.root.setChildIndex(c, i);
    });
  }

  /** Replaces every object. */
  sync(objects: readonly MapObject[]): void {
    const seen = new Set<string>();
    for (const obj of objects) {
      seen.add(obj.uid);
      this.upsert(obj);
    }
    for (const uid of [...this.entries.keys()]) if (!seen.has(uid)) this.remove(uid);
  }

  upsert(obj: MapObject): void {
    const entry = this.entries.get(obj.uid);
    if (entry === undefined) {
      const gfx = new Graphics();
      gfx.label = obj.uid;
      this.entries.set(obj.uid, { obj, gfx, layer: obj.layer, skins: [] });
      this.layerRoots.get(obj.layer)?.addChild(gfx);
      this.dirty.add(obj.uid);
      return;
    }
    if (entry.obj === obj) return;
    entry.obj = obj;
    if (entry.layer !== obj.layer) {
      entry.layer = obj.layer;
      this.layerRoots.get(obj.layer)?.addChild(entry.gfx);
    }
    this.dirty.add(obj.uid);
  }

  remove(uid: string): void {
    const entry = this.entries.get(uid);
    if (entry === undefined) return;
    this.dropSkins(entry);
    entry.gfx.destroy();
    this.entries.delete(uid);
    this.dirty.delete(uid);
  }

  clear(): void {
    for (const uid of [...this.entries.keys()]) this.remove(uid);
  }

  /** Redraws what changed (zoom bucket changes redraw the zoom-dependent widths). */
  update(zoom: number): number {
    const bucket = zoomBucket(zoom);
    if (bucket !== this.bucket) {
      this.bucket = bucket;
      for (const [uid, e] of this.entries) if (e.obj.type !== 'light') this.dirty.add(uid);
    }
    let drawn = 0;
    for (const uid of this.dirty) {
      const entry = this.entries.get(uid);
      if (entry === undefined) continue;
      this.draw(entry);
      drawn++;
    }
    this.dirty.clear();
    return drawn;
  }

  /** GM light gizmos, screen space; empty in player views. */
  drawGizmos(
    camera: CameraState,
    viewport: Viewport,
    token: (uid: string) => PlacedToken | undefined,
  ): void {
    const g = this.gizmos;
    g.clear();
    if (this.mode !== 'gm') return;
    const r = LIGHT_GIZMO_PX;
    for (const { obj } of this.entries.values()) {
      if (obj.type !== 'light') continue;
      const [x, y] = lightPosition(obj, token);
      const p = worldToScreen(camera, viewport, this.cellPx, x, y);
      if (p.x < -2 * r || p.y < -2 * r || p.x > viewport.width + 2 * r) continue;
      if (p.y > viewport.height + 2 * r) continue;
      const on = obj.props.enabled;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.moveTo(p.x + Math.cos(a) * (r + 2), p.y + Math.sin(a) * (r + 2));
        g.lineTo(p.x + Math.cos(a) * (r + 5), p.y + Math.sin(a) * (r + 5));
      }
      g.stroke({ width: 1.5, color: on ? LIGHT_GIZMO_COLOR : 0x9aa0a6, alpha: 0.95 });
      g.circle(p.x, p.y, r);
      if (on) g.fill({ color: LIGHT_GIZMO_COLOR, alpha: 0.95 });
      g.stroke({ width: 1.5, color: WALL_OUTLINE, alpha: 0.9 });
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
    this.gizmos.destroy();
    this.root.destroy({ children: true });
  }

  private draw(entry: Entry): void {
    const { obj, gfx } = entry;
    gfx.clear();
    this.dropSkins(entry);
    gfx.zIndex = obj.sort_order;
    gfx.visible = objectShown(obj, this.mode);
    gfx.alpha = objectAlpha(obj, this.mode);
    if (!gfx.visible) return;
    switch (obj.type) {
      case 'wall':
        this.drawWall(entry, obj);
        break;
      case 'door':
        this.drawDoor(entry, obj);
        break;
      case 'window':
        this.drawWindow(gfx, obj);
        break;
      case 'stairs':
        drawStairs(gfx, obj, this.cellPx, this.bucket);
        break;
      case 'portal':
        drawPortal(gfx, obj, this.cellPx, this.bucket);
        break;
      case 'pin':
        drawPin(gfx, obj, this.cellPx, this.bucket);
        break;
      case 'zone':
        drawZone(gfx, obj, this.cellPx, this.bucket);
        break;
      case 'trap':
        drawTrap(gfx, obj, this.cellPx, this.bucket);
        break;
      case 'secret':
        if (secretDrawnAsWall(obj, this.mode) && 'a' in obj.geometry) {
          const { a, b } = obj.geometry;
          const seg = this.px([a[0], a[1], b[0], b[1]]);
          this.solid(
            gfx,
            [seg],
            this.width(SECRET_AS_WALL.thickness),
            WALL_COLORS[SECRET_AS_WALL.kind],
          );
        } else drawSecret(gfx, obj, this.cellPx, this.bucket);
        break;
      case 'light':
      case 'image':
        // Images: ImagesRenderer (own containers under the tiles / above the objects).
        break;
    }
  }

  private width(thickness: number): number {
    return strokeWidthPx(thickness, this.cellPx, this.bucket);
  }

  private px(s: Seg): Seg {
    const k = this.cellPx;
    return [s[0] * k, s[1] * k, s[2] * k, s[3] * k];
  }

  private solid(g: Graphics, segs: readonly Seg[], width: number, color: number): void {
    if (segs.length === 0) return;
    const outline = width + 2 / this.bucket;
    for (const s of segs) g.moveTo(s[0], s[1]).lineTo(s[2], s[3]);
    g.stroke({ width: outline, color: WALL_OUTLINE, alpha: 1, cap: 'round', join: 'round' });
    for (const s of segs) g.moveTo(s[0], s[1]).lineTo(s[2], s[3]);
    g.stroke({ width, color, alpha: 1, cap: 'round', join: 'round' });
  }

  private dashed(
    g: Graphics,
    segs: readonly Seg[],
    width: number,
    color: number,
    alpha: number,
  ): void {
    const dash = Math.max(0.25 * this.cellPx, 6 / this.bucket);
    const gap = dash * 0.7;
    let any = false;
    for (const s of segs) {
      for (const d of dashSegments(s[0], s[1], s[2], s[3], dash, gap)) {
        g.moveTo(d[0], d[1]).lineTo(d[2], d[3]);
        any = true;
      }
    }
    if (any) g.stroke({ width, color, alpha, cap: 'butt' });
  }

  private dropSkins(entry: Entry): void {
    for (const s of entry.skins) s.destroy();
    entry.skins = [];
  }

  /** Texture of an asset, or null while loading / unknown / failed (the plain shape is drawn). */
  private skinTexture(assetId: string | null): Texture | null {
    if (assetId === null || assetId === '') return null;
    const url = this.lookup(assetId)?.url ?? null;
    if (url === null) return null;
    const state = this.skinTextures.get(url);
    if (state === undefined) {
      this.skinTextures.set(url, { status: 'loading' });
      void this.loadSkin(url);
      return null;
    }
    return state.status === 'ready' ? state.texture : null;
  }

  private async loadSkin(url: string): Promise<void> {
    let next: SkinState;
    try {
      const texture = await Assets.load<Texture>({
        src: url,
        // Signed asset URLs have no file extension: force the image parser.
        parser: 'texture',
        data: { autoGenerateMipmaps: true, scaleMode: 'linear' },
      });
      next = { status: 'ready', texture };
    } catch {
      next = { status: 'error' };
    }
    if (this.destroyed) return;
    this.skinTextures.set(url, next);
    this.assetsChanged();
    this.changed();
  }

  private drawWall(entry: Entry, wall: WallObject): void {
    const g = entry.gfx;
    const segs = polylineSegments(wall.geometry.points, wall.geometry.closed).map((s) =>
      this.px(s),
    );
    const width = this.width(wall.props.thickness);
    if (wall.props.kind === 'invisible') {
      this.dashed(g, segs, width, WALL_COLORS.invisible, INVISIBLE_WALL_ALPHA);
      return;
    }
    this.solid(g, segs, width, WALL_COLORS[wall.props.kind]);
    const texture = this.skinTexture(wall.props.texture_asset);
    if (texture === null || texture.height <= 0) return;
    // Pattern repeated along each segment, as thick as the wall.
    const k = width / texture.height;
    for (const s of segs) {
      const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
      if (len <= 0) continue;
      const strip = new TilingSprite({ texture, width: len, height: width });
      strip.anchor.set(0, 0.5);
      strip.tileScale.set(k, k);
      strip.position.set(s[0], s[1]);
      strip.rotation = Math.atan2(s[3] - s[1], s[2] - s[0]);
      g.addChild(strip);
      entry.skins.push(strip);
    }
  }

  private drawDoor(entry: Entry, door: DoorObject): void {
    const g = entry.gfx;
    const { a, b } = door.geometry;
    if (doorDrawnAsWall(door, this.mode)) {
      const seg = this.px([a[0], a[1], b[0], b[1]]);
      this.solid(g, [seg], this.width(SECRET_AS_WALL.thickness), WALL_COLORS[SECRET_AS_WALL.kind]);
      return;
    }
    const shape = doorShape(door);
    const width = this.width(DOOR_THICKNESS);
    if (shape.gap !== null) {
      this.dashed(g, [this.px(shape.gap)], Math.max(1.5 / this.bucket, width / 3), DOOR_COLOR, 0.6);
    }
    const leaf = this.px(shape.leaf);
    if (door.props.secret) {
      this.dashed(g, [leaf], width + 6 / this.bucket, SECRET_DOOR_OUTLINE, 0.95);
    }
    const image = this.skinTexture(
      door.props.state === 'open' ? door.props.asset_open : door.props.asset_closed,
    );
    // The image replaces the plain leaf.
    const drawn = image !== null && image.width > 0 && this.doorImage(entry, image, leaf, width);
    if (!drawn) this.solid(g, [leaf], width, DOOR_COLOR);
    if (door.props.locked) {
      const [mx, my] = segmentMiddle(this.px([a[0], a[1], b[0], b[1]]));
      const s = Math.max(0.2 * this.cellPx, 6 / this.bucket);
      g.rect(mx - s / 2, my - s / 2, s, s)
        .fill({ color: DOOR_LOCKED_MARK })
        .stroke({ width: 1 / this.bucket, color: WALL_OUTLINE });
    }
  }

  /** Door image stretched along the leaf (aspect kept, at least as thick as the leaf). */
  private doorImage(entry: Entry, texture: Texture, leaf: Seg, width: number): boolean {
    const len = Math.hypot(leaf[2] - leaf[0], leaf[3] - leaf[1]);
    if (len <= 0) return false;
    const thick = Math.min(this.cellPx, Math.max(width, (len * texture.height) / texture.width));
    const sprite = new Sprite(texture);
    sprite.anchor.set(0, 0.5);
    sprite.width = len;
    sprite.height = thick;
    sprite.position.set(leaf[0], leaf[1]);
    sprite.rotation = Math.atan2(leaf[3] - leaf[1], leaf[2] - leaf[0]);
    entry.gfx.addChild(sprite);
    entry.skins.push(sprite);
    return true;
  }

  private drawWindow(g: Graphics, win: WindowObject): void {
    const { a, b } = win.geometry;
    const seg = this.px([a[0], a[1], b[0], b[1]]);
    const width = this.width(WINDOW_THICKNESS);
    if (win.props.kind === 'opening') {
      this.dashed(g, [seg], width, WINDOW_COLOR, 0.7);
      return;
    }
    this.solid(g, [seg], width, WINDOW_COLOR);
    if (win.props.kind === 'bars') {
      const len = Math.hypot(seg[2] - seg[0], seg[3] - seg[1]);
      if (len <= 0) return;
      const ux = (seg[2] - seg[0]) / len;
      const uy = (seg[3] - seg[1]) / len;
      const half = width * 1.6;
      const step = Math.max(0.25 * this.cellPx, 5 / this.bucket);
      for (let t = step / 2; t < len; t += step) {
        const x = seg[0] + ux * t;
        const y = seg[1] + uy * t;
        g.moveTo(x - uy * half, y + ux * half).lineTo(x + uy * half, y - ux * half);
      }
      g.stroke({ width: Math.max(1 / this.bucket, width / 2), color: WALL_OUTLINE, alpha: 0.9 });
    }
  }
}

/** A wall with a texture or a door with an image. */
function hasSkin(obj: MapObject): boolean {
  if (obj.type === 'wall') return obj.props.texture_asset !== null;
  if (obj.type === 'door') return obj.props.asset_open !== null || obj.props.asset_closed !== null;
  return false;
}
