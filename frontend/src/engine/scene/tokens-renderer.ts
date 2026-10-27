/**
 * Placed tokens (projet.md 14.1 item 7): image (TokenDefView.imageUrl, loaded with Pixi
 * Assets) or a coloured disc with initials, ring (definition colour or the default of its
 * kind), size sizeW × sizeH × scale centred on (x, y), rotation. Hidden tokens are faded in
 * the GM view and absent for players; in player views a token is only drawn when the player
 * currently sees it (filter set by the scene layer).
 */

import type { PlacedToken, TokenDefView, ViewMode } from '../../editor/contracts';
import {
  TOKEN_FONT_FAMILY,
  TOKEN_INITIALS_COLOR,
  TOKEN_INITIALS_SIZE,
  TOKEN_OUTLINE_COLOR,
  TOKEN_RING_WIDTH,
} from '../../scene/style';
import { Assets, CanvasSource, Container, Graphics, Sprite, Texture } from '../pixi';
import { initials, tokenBox, tokenRingColor } from './object-geometry';
import { tokenAlpha, tokenShown } from './view-rules';

const LABEL_FONT_PX = 64;

interface Entry {
  token: PlacedToken;
  def: TokenDefView | null;
  readonly root: Container;
  readonly body: Graphics;
  readonly ring: Graphics;
  sprite: Sprite | null;
  /** Initials (shared canvas texture per text). */
  text: Sprite | null;
  url: string | null;
}

type ImageState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly texture: Texture };

function absoluteUrl(url: string): string {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

export class TokensRenderer {
  /** World space (unit: pixel at zoom 1). */
  readonly root = new Container({ sortableChildren: true });

  private readonly entries = new Map<string, Entry>();
  private readonly images = new Map<string, ImageState>();
  private readonly labels = new Map<string, Texture>();
  private mode: ViewMode = 'gm';
  private cellPx = 70;
  private filter: ((token: PlacedToken) => boolean) | null = null;
  private enabled = true;
  private destroyed = false;

  /** `onChange` is called when an image finished loading (a frame is needed). */
  constructor(private readonly onChange: () => void) {}

  get count(): number {
    return this.entries.size;
  }

  setCellPx(cellPx: number): void {
    if (cellPx === this.cellPx) return;
    this.cellPx = cellPx;
    for (const e of this.entries.values()) this.draw(e);
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.refreshVisibility();
  }

  /** false: no token is drawn (projection screen without tokens). */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.refreshVisibility();
  }

  /** Player views: tokens the player does not see are not drawn (null = all). */
  setFilter(filter: ((token: PlacedToken) => boolean) | null): void {
    this.filter = filter;
    this.refreshVisibility();
  }

  sync(tokens: readonly PlacedToken[], def: (id: string) => TokenDefView | null): void {
    const seen = new Set<string>();
    tokens.forEach((t, i) => {
      seen.add(t.uid);
      this.upsert(t, def(t.token_id), i, true);
    });
    for (const uid of [...this.entries.keys()]) if (!seen.has(uid)) this.remove(uid);
  }

  upsert(token: PlacedToken, def: TokenDefView | null, order?: number, force = false): void {
    let entry = this.entries.get(token.uid);
    if (entry === undefined) {
      const root = new Container();
      root.label = token.uid;
      const body = new Graphics();
      const ring = new Graphics();
      root.addChild(body, ring);
      entry = { token, def, root, body, ring, sprite: null, text: null, url: null };
      this.entries.set(token.uid, entry);
      this.root.addChild(root);
    } else if (!force && entry.token === token && entry.def === def) {
      return;
    }
    entry.token = token;
    entry.def = def;
    if (order !== undefined) entry.root.zIndex = order;
    this.draw(entry);
  }

  remove(uid: string): void {
    const entry = this.entries.get(uid);
    if (entry === undefined) return;
    entry.root.destroy({ children: true });
    this.entries.delete(uid);
  }

  clear(): void {
    for (const uid of [...this.entries.keys()]) this.remove(uid);
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
    for (const [url, state] of this.images) {
      if (state.status === 'ready') void Assets.unload(url).catch(() => undefined);
    }
    this.images.clear();
    this.root.destroy({ children: true });
    for (const tex of this.labels.values()) {
      // GPU memory freed without destroying the source (WebGPU bind-group warnings).
      tex.source.unload();
      tex.destroy(false);
    }
    this.labels.clear();
  }

  private refreshVisibility(): void {
    for (const e of this.entries.values()) this.applyVisibility(e);
  }

  private applyVisibility(e: Entry): void {
    const shown =
      this.enabled && tokenShown(e.token, this.mode) && (this.filter?.(e.token) ?? true);
    e.root.visible = shown;
    e.root.alpha = tokenAlpha(e.token, this.mode);
  }

  private draw(e: Entry): void {
    const { token, def } = e;
    const k = this.cellPx;
    const box = tokenBox(token, def);
    const w = box.w * k;
    const h = box.h * k;
    const color = tokenRingColor(def);
    e.root.position.set(token.x * k, token.y * k);
    e.root.rotation = ((token.rotation % 360) * Math.PI) / 180;
    this.applyVisibility(e);

    const url = def?.imageUrl ? absoluteUrl(def.imageUrl) : null;
    e.url = url;
    const image = url === null ? null : this.image(url);
    const texture = image?.status === 'ready' ? image.texture : null;

    e.body.clear();
    if (texture !== null) {
      if (e.sprite === null) {
        e.sprite = new Sprite({ texture, anchor: 0.5 });
        e.root.addChildAt(e.sprite, 0);
      }
      e.sprite.texture = texture;
      e.sprite.width = w;
      e.sprite.height = h;
      e.sprite.visible = true;
      if (e.text !== null) e.text.visible = false;
    } else {
      if (e.sprite !== null) e.sprite.visible = false;
      e.body.ellipse(0, 0, w / 2, h / 2).fill({ color, alpha: 0.92 });
      this.drawInitials(e, def?.name ?? '?', Math.min(w, h));
    }

    const ringWidth = Math.max(1, TOKEN_RING_WIDTH * (Math.min(w, h) / 2));
    e.ring.clear();
    e.ring
      .ellipse(0, 0, w / 2, h / 2)
      .stroke({ width: ringWidth, color, alpha: 1, alignment: 1 })
      .ellipse(0, 0, w / 2, h / 2)
      .stroke({
        width: Math.max(1, ringWidth / 4),
        color: TOKEN_OUTLINE_COLOR,
        alpha: 0.8,
        alignment: 0,
      });
  }

  private drawInitials(e: Entry, name: string, size: number): void {
    const texture = this.label(initials(name) || '?');
    if (e.text === null) {
      e.text = new Sprite({ texture, anchor: 0.5 });
      e.root.addChild(e.text);
    }
    e.text.texture = texture;
    e.text.visible = true;
    e.text.scale.set((size * TOKEN_INITIALS_SIZE) / LABEL_FONT_PX);
  }

  /** Canvas texture of an initials text (LABEL_FONT_PX high glyphs, centred). */
  private label(text: string): Texture {
    let tex = this.labels.get(text);
    if (tex !== undefined) return tex;
    const canvas = document.createElement('canvas');
    canvas.width = LABEL_FONT_PX * 2;
    canvas.height = Math.round(LABEL_FONT_PX * 1.4);
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      ctx.font = `700 ${LABEL_FONT_PX}px ${TOKEN_FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `#${TOKEN_INITIALS_COLOR.toString(16).padStart(6, '0')}`;
      ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width);
    }
    tex = new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'linear' }) });
    this.labels.set(text, tex);
    return tex;
  }

  private image(url: string): ImageState {
    const known = this.images.get(url);
    if (known !== undefined) return known;
    const state: ImageState = { status: 'loading' };
    this.images.set(url, state);
    void Assets.load<Texture>({
      src: url,
      // Signed asset URLs have no file extension: force the image parser.
      parser: 'texture',
      data: { autoGenerateMipmaps: true, scaleMode: 'linear' },
    }).then(
      (texture) => {
        if (this.destroyed) {
          void Assets.unload(url).catch(() => undefined);
          return;
        }
        this.images.set(url, { status: 'ready', texture });
        for (const e of this.entries.values()) if (e.url === url) this.draw(e);
        this.onChange();
      },
      () => {
        if (!this.destroyed) this.images.set(url, { status: 'error' });
      },
    );
    return state;
  }
}
