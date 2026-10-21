/**
 * Palette textures: palette index ⇒ Pixi texture (+ variant frames), loaded with Pixi Assets
 * from PaletteEntry.url. A "missing" checkerboard tinted with the deterministic fallback
 * colour of the index stands in while loading, when the url is null, when loading failed or
 * when the index is not in the palette.
 */

import type { PaletteEntry } from '../editor/contracts';
import { variantFrame, variantFrameCount } from './cell-transform';
import { fallbackColor } from './fallback-color';
import { Assets, CanvasSource, Rectangle, Texture } from './pixi';

export interface ResolvedTile {
  readonly texture: Texture;
  /** 0xRRGGBB multiplied with the texture. */
  readonly tint: number;
}

type EntryState =
  | { readonly status: 'none' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'error'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly frames: readonly Texture[] };

/** 2 × 2 checkerboard (light/dark grey), nearest filtering, tinted per index. */
function createMissingTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = '#b4b4b4';
    ctx.fillRect(1, 0, 1, 1);
    ctx.fillRect(0, 1, 1, 1);
  }
  const source = new CanvasSource({ resource: canvas, scaleMode: 'nearest' });
  return new Texture({ source });
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

export class PaletteTextures {
  private entries: EntryState[] = [];
  private readonly missing: Texture = createMissingTexture();
  private readonly loaded = new Set<string>();
  private readonly fallbackCache = new Map<number, ResolvedTile>();
  private destroyed = false;

  /** `onReady(indices)` is called when textures of these palette indices changed. */
  constructor(private readonly onChange: (indices: readonly number[]) => void) {}

  /** Source shared by all fallback tiles (one draw batch for all of them). */
  get missingTexture(): Texture {
    return this.missing;
  }

  setPalette(palette: readonly (PaletteEntry | null)[]): void {
    const changed: number[] = [];
    const next: EntryState[] = [];
    for (let i = 0; i < palette.length; i++) {
      const entry = i === 0 ? null : (palette[i] ?? null);
      const prev = this.entries[i];
      const url = entry?.url ? absoluteUrl(entry.url) : null;
      if (url === null) {
        next.push({ status: 'none' });
        if (prev !== undefined && prev.status !== 'none') changed.push(i);
        continue;
      }
      if (prev !== undefined && prev.status !== 'none' && prev.url === url) {
        next.push(prev);
        continue;
      }
      next.push({ status: 'loading', url });
      if (prev !== undefined && prev.status === 'ready') changed.push(i);
      void this.load(i, url);
    }
    for (let i = palette.length; i < this.entries.length; i++) changed.push(i);
    this.entries = next;
    if (changed.length > 0) this.onChange(changed);
  }

  /** Texture and tint for a cell value. */
  resolve(index: number, variant: number): ResolvedTile {
    const state = this.entries[index];
    if (state?.status === 'ready') {
      const frame = state.frames[variantFrame(variant, state.frames.length)] ?? state.frames[0];
      if (frame !== undefined) return { texture: frame, tint: 0xffffff };
    }
    const key = index * 256 + (variant & 3);
    let fallback = this.fallbackCache.get(key);
    if (fallback === undefined) {
      fallback = { texture: this.missing, tint: fallbackColor(index, variant) };
      this.fallbackCache.set(key, fallback);
    }
    return fallback;
  }

  /** Number of entries still loading (for the demo / diagnostics). */
  get pending(): number {
    return this.entries.filter((e) => e.status === 'loading').length;
  }

  destroy(): void {
    this.destroyed = true;
    for (const state of this.entries) {
      // Variant frames are our own Texture views on the loaded source (Assets owns the rest).
      if (state.status === 'ready' && state.frames.length > 1) {
        for (const t of state.frames) t.destroy(false);
      }
    }
    this.entries = [];
    for (const url of this.loaded) void Assets.unload(url).catch(() => undefined);
    this.loaded.clear();
    this.missing.destroy(true);
  }

  private async load(index: number, url: string): Promise<void> {
    let texture: Texture;
    try {
      texture = await Assets.load<Texture>({
        src: url,
        // Signed asset URLs have no file extension: force the image parser.
        parser: 'texture',
        data: { autoGenerateMipmaps: true, scaleMode: 'linear' },
      });
      this.loaded.add(url);
    } catch {
      if (this.destroyed) return;
      const current = this.entries[index];
      if (current?.status === 'loading' && current.url === url) {
        this.entries[index] = { status: 'error', url };
      }
      return;
    }
    if (this.destroyed) return;
    const current = this.entries[index];
    if (current?.status !== 'loading' || current.url !== url) return;
    this.entries[index] = { status: 'ready', url, frames: this.framesOf(texture) };
    this.onChange([index]);
  }

  private framesOf(texture: Texture): Texture[] {
    const w = texture.frame.width;
    const h = texture.frame.height;
    const count = variantFrameCount(w, h);
    if (count <= 1) return [texture];
    const frames: Texture[] = [];
    for (let f = 0; f < count; f++) {
      frames.push(
        new Texture({
          source: texture.source,
          frame: new Rectangle(texture.frame.x + f * h, texture.frame.y, h, h),
        }),
      );
    }
    return frames;
  }
}
