/**
 * Fog chunks (projet.md 12.3, 14.2): one 128 × 128 mask texture per 32 × 32-cell chunk, built
 * from SceneView.fogChunk(), rebuilt per changed key.
 * - 'unexplored' masks (GM veil): drawn in the stage, tinted FOG_GM_COLOR at FOG_GM_ALPHA;
 *   chunks without any bitmap are fully veiled.
 * - 'explored' masks (player / display): rendered by the lighting renderer into the fog
 *   render texture (explored = grey, see LightingRenderer); chunks without bitmap are empty.
 */

import { CHUNK_SIZE, type ChunkKey, type FogBitmap } from '../../editor/contracts';
import { FOG_SIDE, FOG_SUBCELLS } from '../../formats/fog-codec';
import { parseChunkKey } from '../chunk-math';
import { BufferImageSource, Container, Rectangle, Sprite, Texture } from '../pixi';
import { fogFrame, fogPixels, mapChunkKeys, type FogMaskKind } from './fog-pixels';

interface FogChunk {
  readonly source: BufferImageSource;
  readonly texture: Texture;
  readonly sprite: Sprite;
  readonly pixels: Uint8Array;
}

export class FogRenderer {
  /** World space (unit: pixel at zoom 1). */
  readonly root = new Container();

  private readonly chunks = new Map<ChunkKey, FogChunk>();
  private kind: FogMaskKind = 'unexplored';
  private width = 0;
  private height = 0;
  private cellPx = 70;
  private tint = 0xffffff;
  private read: (key: ChunkKey) => FogBitmap | null = () => null;
  private keys: () => readonly ChunkKey[] = () => [];

  get chunkCount(): number {
    return this.chunks.size;
  }

  get maskKind(): FogMaskKind {
    return this.kind;
  }

  /** Full rebuild (scene, map size or mask kind changed). */
  reset(
    kind: FogMaskKind,
    grid: { readonly width: number; readonly height: number; readonly cellPx: number },
    read: (key: ChunkKey) => FogBitmap | null,
    keys: () => readonly ChunkKey[],
  ): void {
    this.clear();
    this.kind = kind;
    this.width = grid.width;
    this.height = grid.height;
    this.cellPx = grid.cellPx;
    this.read = read;
    this.keys = keys;
    const all = kind === 'unexplored' ? mapChunkKeys(this.width, this.height) : this.keys();
    for (const key of all) this.update(key);
  }

  /** Rebuilds one chunk from the scene. */
  update(key: ChunkKey): void {
    const p = parseChunkKey(key);
    if (p === null) return;
    const frame = fogFrame(p.cx, p.cy, this.width, this.height);
    if (frame.w <= 0 || frame.h <= 0 || p.cx < 0 || p.cy < 0) return;
    const bits = this.read(key);
    let chunk = this.chunks.get(key);
    if (bits === null && this.kind === 'explored') {
      if (chunk !== undefined) this.drop(key, chunk);
      return;
    }
    if (chunk === undefined) {
      const pixels = new Uint8Array(FOG_SIDE * FOG_SIDE * 4);
      fogPixels(bits, this.kind, pixels);
      const source = new BufferImageSource({
        resource: pixels,
        width: FOG_SIDE,
        height: FOG_SIDE,
        alphaMode: 'premultiplied-alpha',
        scaleMode: 'linear',
      });
      const texture = new Texture({ source, frame: new Rectangle(0, 0, frame.w, frame.h) });
      const sprite = new Sprite(texture);
      sprite.position.set(p.cx * CHUNK_SIZE * this.cellPx, p.cy * CHUNK_SIZE * this.cellPx);
      sprite.scale.set(this.cellPx / FOG_SUBCELLS);
      sprite.tint = this.tint;
      chunk = { source, texture, sprite, pixels };
      this.chunks.set(key, chunk);
      this.root.addChild(sprite);
      return;
    }
    fogPixels(bits, this.kind, chunk.pixels);
    chunk.source.update();
  }

  /** Tint of every chunk sprite (veil colour / explored grey). */
  setTint(tint: number): void {
    this.tint = tint;
    for (const c of this.chunks.values()) c.sprite.tint = tint;
  }

  clear(): void {
    for (const [key, chunk] of [...this.chunks]) this.drop(key, chunk);
  }

  destroy(): void {
    this.clear();
    this.root.destroy({ children: true });
  }

  private drop(key: ChunkKey, chunk: FogChunk): void {
    chunk.sprite.destroy();
    chunk.texture.destroy(false);
    // Free the GPU memory without destroying the source (WebGPU bind-group warnings, see
    // rt-pool.ts); it is garbage collected with the texture.
    chunk.source.unload();
    this.chunks.delete(key);
  }
}
