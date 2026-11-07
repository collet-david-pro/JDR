/**
 * P14 image objects (map backgrounds, free pictures): one Sprite per object, in two world-space
 * containers: `below` (placement `background`: right after the theme background, under the tiles)
 * and `above` (placement `above`: on the objects, under the tokens). Inside each container the
 * sprites follow the object layer order (MapView.layers), then sort_order; their layer gives
 * visibility and opacity like the other objects (gm layer: faded for the GM, never drawn for a
 * player). Fog and lighting are drawn above them by the pipeline, so a hidden area hides its
 * images too.
 *
 * Textures: loaded from the signed URL given by SceneView.imageAsset; an image larger than the
 * GPU texture limit is decoded at a reduced size. Until it is loaded (or when the asset is
 * unknown / deleted) a faint placeholder is drawn.
 *
 * Animated images (GIF / WebP, asset.animated): the first frame is shown at once, then every
 * frame is decoded in the background (image-animation.ts, WebCodecs; first frame kept where it is
 * not available). animate() picks the frame of each visible, on-screen image and asks for a
 * render only when the next frame is due (one timer, no continuous loop). Frozen (performance
 * mode or prefers-reduced-motion): first frame only.
 */
import type { LayerDef, MapObject, ObjectLayerId, ViewMode } from '../../editor/contracts';
import type { ImageAssetView, ImageObject } from '../../editor/contracts-images';
import { imageBBox, imageCenter } from '../../editor/model/image-values';
import { Assets, Container, Graphics, Sprite, Texture } from '../pixi';
import {
  decodeAnimation,
  frameAt,
  releaseAnimation,
  type DecodedAnimation,
} from './image-animation';
import { objectAlpha, objectLayerOrder, objectLayerState, objectShown } from './view-rules';

const PLACEHOLDER_COLOR = 0x8a8f98;
/** z-index span of one object layer (sort_order is within ±1 000 000). */
const LAYER_SPAN = 2_000_002;

type TextureState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly texture: Texture; readonly owned: boolean }
  | { readonly status: 'error' };

interface Entry {
  obj: ImageObject;
  readonly sprite: Sprite;
  readonly placeholder: Graphics;
  /** Frame shown (animated images). */
  frame: number;
}

/** Visible world rectangle, cells. */
export interface CellRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Scale that brings (w, h) within `max` px on both sides (1 = unchanged). */
export function textureScale(width: number, height: number, max: number): number {
  const side = Math.max(width, height);
  return side > max && max > 0 ? max / side : 1;
}

export class ImagesRenderer {
  readonly below = new Container({ sortableChildren: true });
  readonly above = new Container({ sortableChildren: true });

  private readonly entries = new Map<string, Entry>();
  private readonly dirty = new Set<string>();
  private readonly textures = new Map<string, TextureState>();
  /** Decoded animations per URL (null: being decoded, or not animatable here). */
  private readonly animations = new Map<string, DecodedAnimation | null>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = Infinity;
  private lookup: (assetId: string) => ImageAssetView | null = () => null;
  private layers: readonly LayerDef[] = [];
  private order: ObjectLayerId[] = objectLayerOrder([]);
  private mode: ViewMode = 'gm';
  private cellPx = 70;
  private destroyed = false;

  constructor(
    private readonly changed: () => void,
    private readonly maxTextureSize: () => number = () => 4096,
  ) {
    this.below.label = 'images:below';
    this.above.label = 'images:above';
  }

  get count(): number {
    return this.entries.size;
  }

  setAssets(lookup: ((assetId: string) => ImageAssetView | null) | null): void {
    this.lookup = lookup ?? (() => null);
    this.markAll();
  }

  /** The known assets changed: re-resolve every image. */
  assetsChanged(): void {
    this.markAll();
  }

  setCellPx(cellPx: number): void {
    if (cellPx === this.cellPx) return;
    this.cellPx = cellPx;
    this.markAll();
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.markAll();
  }

  setLayers(layers: readonly LayerDef[]): void {
    this.layers = layers;
    this.order = objectLayerOrder(layers);
    this.markAll();
  }

  /** Replaces every image (objects of other types are ignored). */
  sync(objects: readonly MapObject[]): void {
    const seen = new Set<string>();
    for (const o of objects) {
      if (o.type !== 'image') continue;
      seen.add(o.uid);
      this.upsert(o);
    }
    for (const uid of [...this.entries.keys()]) if (!seen.has(uid)) this.remove(uid);
  }

  /** Adds / updates an object (an object that is no longer an image is removed). */
  upsert(obj: MapObject): void {
    if (obj.type !== 'image') {
      this.remove(obj.uid);
      return;
    }
    const entry = this.entries.get(obj.uid);
    if (entry === undefined) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5);
      sprite.label = obj.uid;
      const placeholder = new Graphics();
      this.entries.set(obj.uid, { obj, sprite, placeholder, frame: 0 });
      this.dirty.add(obj.uid);
      return;
    }
    if (entry.obj === obj) return;
    entry.obj = obj;
    this.dirty.add(obj.uid);
  }

  remove(uid: string): void {
    const entry = this.entries.get(uid);
    if (entry === undefined) return;
    entry.sprite.destroy();
    entry.placeholder.destroy();
    this.entries.delete(uid);
    this.dirty.delete(uid);
  }

  clear(): void {
    for (const uid of [...this.entries.keys()]) this.remove(uid);
  }

  /** Redraws what changed; returns the number of images drawn. */
  update(): number {
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

  /**
   * Per frame, after update(): frame of each animated image that is shown and on screen (`view`,
   * cells); schedules the render of the next frame change. Frozen: first frame, no timer.
   */
  animate(now: number, view: CellRect, frozen: boolean): void {
    let next = Infinity;
    for (const entry of this.entries.values()) {
      const anim = this.animationOf(entry.obj.props.asset_id);
      if (anim === null || !entry.sprite.visible) continue;
      let index = 0;
      if (!frozen && onScreen(entry.obj, view)) {
        const at = frameAt(anim, now);
        index = at.index;
        next = Math.min(next, at.nextInMs);
      }
      if (index === entry.frame) continue;
      entry.frame = index;
      const texture = anim.frames[index];
      if (texture !== undefined) entry.sprite.texture = texture;
    }
    this.schedule(next);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const anim of this.animations.values()) if (anim !== null) releaseAnimation(anim);
    this.animations.clear();
    this.clear();
    for (const [url, state] of this.textures) {
      if (state.status === 'ready') {
        if (state.owned) state.texture.destroy(true);
        else void Assets.unload(url).catch(() => undefined);
      }
    }
    this.textures.clear();
    this.below.destroy({ children: true });
    this.above.destroy({ children: true });
  }

  private markAll(): void {
    for (const uid of this.entries.keys()) this.dirty.add(uid);
    this.changed();
  }

  private draw(entry: Entry): void {
    const { obj, sprite, placeholder } = entry;
    const parent = obj.props.placement === 'background' ? this.below : this.above;
    if (sprite.parent !== parent) {
      parent.addChild(placeholder, sprite);
    }
    const layer = objectLayerState(this.layers, obj.layer, this.mode);
    const shown = layer.visible && objectShown(obj, this.mode);
    const z = Math.max(0, this.order.indexOf(obj.layer)) * LAYER_SPAN + obj.sort_order + 1_000_001;
    sprite.zIndex = z;
    placeholder.zIndex = z;
    const g = obj.geometry;
    const k = this.cellPx;
    const [cx, cy] = imageCenter(g);
    const alpha = obj.props.opacity * layer.alpha * objectAlpha(obj, this.mode);
    const anim = this.animationOf(obj.props.asset_id);
    const texture =
      anim?.frames[entry.frame] ?? anim?.frames[0] ?? this.texture(obj.props.asset_id);
    sprite.visible = shown && texture !== null;
    placeholder.visible = shown && texture === null;
    if (texture !== null) {
      sprite.texture = texture;
      sprite.position.set(cx * k, cy * k);
      sprite.rotation = (g.rotation * Math.PI) / 180;
      const sx = (g.w * k) / Math.max(1, texture.width);
      const sy = (g.h * k) / Math.max(1, texture.height);
      sprite.scale.set(obj.props.flip_h ? -sx : sx, obj.props.flip_v ? -sy : sy);
      sprite.alpha = alpha;
      placeholder.clear();
      return;
    }
    placeholder.clear();
    placeholder.position.set(cx * k, cy * k);
    placeholder.rotation = (g.rotation * Math.PI) / 180;
    placeholder
      .rect((-g.w * k) / 2, (-g.h * k) / 2, g.w * k, g.h * k)
      .fill({ color: PLACEHOLDER_COLOR, alpha: 0.15 })
      .stroke({ width: Math.max(1, k / 35), color: PLACEHOLDER_COLOR, alpha: 0.6 });
    placeholder.alpha = Math.max(0.3, alpha);
  }

  /** Decoded animation of an asset, or null (static, not decoded yet, unavailable). */
  private animationOf(assetId: string): DecodedAnimation | null {
    const url = this.lookup(assetId)?.url;
    return url === null || url === undefined ? null : (this.animations.get(url) ?? null);
  }

  /** Render when the next frame is due (earliest of the pending ones). */
  private schedule(inMs: number): void {
    if (!Number.isFinite(inMs)) return;
    const at = performance.now() + Math.max(16, inMs);
    if (this.timer !== null && this.timerAt <= at) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.timerAt = Infinity;
        if (!this.destroyed) this.changed();
      },
      Math.max(16, inMs),
    );
  }

  private async loadAnimation(url: string, asset: ImageAssetView): Promise<void> {
    this.animations.set(url, null);
    let anim: DecodedAnimation | null;
    try {
      anim = await decodeAnimation(
        url,
        asset,
        this.maxTextureSize(),
        () => !this.destroyed,
        (b) => Texture.from(b),
      );
    } catch {
      anim = null;
    }
    if (anim === null) return;
    if (this.destroyed) {
      releaseAnimation(anim);
      return;
    }
    this.animations.set(url, anim);
    for (const [uid, e] of this.entries) {
      if (this.lookup(e.obj.props.asset_id)?.url === url) {
        e.frame = 0;
        this.dirty.add(uid);
      }
    }
    this.changed();
  }

  /** Texture of an asset, or null while loading / when unknown; starts the load. */
  private texture(assetId: string): Texture | null {
    const asset = this.lookup(assetId);
    if (asset === null || asset.url === null) return null;
    const url = asset.url;
    const state = this.textures.get(url);
    if (state === undefined) {
      this.textures.set(url, { status: 'loading' });
      void this.load(url, asset);
      if (asset.animated === true) void this.loadAnimation(url, asset);
      return null;
    }
    return state.status === 'ready' ? state.texture : null;
  }

  private async load(url: string, asset: ImageAssetView): Promise<void> {
    let next: TextureState;
    try {
      const scale = textureScale(asset.width, asset.height, this.maxTextureSize());
      if (scale < 1) {
        // Larger than the GPU allows: decoded at a reduced size.
        const blob = await (await fetch(url, { credentials: 'same-origin' })).blob();
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: Math.max(1, Math.floor(asset.width * scale)),
          resizeHeight: Math.max(1, Math.floor(asset.height * scale)),
          resizeQuality: 'high',
        });
        next = { status: 'ready', texture: Texture.from(bitmap), owned: true };
      } else {
        const texture = await Assets.load<Texture>({
          src: url,
          // Signed asset URLs have no file extension: force the image parser.
          parser: 'texture',
          data: { autoGenerateMipmaps: true, scaleMode: 'linear' },
        });
        next = { status: 'ready', texture, owned: false };
      }
    } catch {
      next = { status: 'error' };
    }
    if (this.destroyed) {
      if (next.status === 'ready' && next.owned) next.texture.destroy(true);
      return;
    }
    this.textures.set(url, next);
    for (const [uid, e] of this.entries) {
      if (this.lookup(e.obj.props.asset_id)?.url === url) this.dirty.add(uid);
    }
    this.changed();
  }
}

/** Bounding box of the image intersects the view (cells). */
function onScreen(obj: ImageObject, view: CellRect): boolean {
  const [x0, y0, x1, y1] = imageBBox(obj.geometry);
  return x1 >= view.x0 && x0 <= view.x1 && y1 >= view.y0 && y0 <= view.y1;
}
