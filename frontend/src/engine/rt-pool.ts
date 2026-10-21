/**
 * Pool of chunk cache render textures, by cache level.
 *
 * Why: under WebGPU, Pixi keeps the texture bind groups of its batcher in a global cache;
 * destroying a texture that was drawn warns ("destroyed while still bound to a shader") and
 * creating new ones grows that cache. Each chunk keeps its texture and resizes it when the
 * cache level changes; released chunks return it here; textures beyond the pool budget are
 * destroyed (GPU memory released).
 */

import { cacheTextureBytes, cacheTextureSize } from './cache-lod';
import { RenderTexture } from './pixi';

/** Free render textures kept for reuse, in bytes of GPU memory. */
export const RT_POOL_MAX_BYTES = 48 * 1024 * 1024;

export class RenderTexturePool {
  private readonly free: { rt: RenderTexture; level: number }[] = [];
  private freeBytes = 0;
  /** Set during teardown: keep everything for destroy(). */
  closing = false;

  constructor(private readonly maxBytes = RT_POOL_MAX_BYTES) {}

  /** A render texture sized for `level` (reused and resized when possible). */
  acquire(level: number): RenderTexture {
    const size = cacheTextureSize(level);
    const item = this.free.pop();
    if (item !== undefined) {
      this.freeBytes -= cacheTextureBytes(item.level);
      if (item.level !== level) item.rt.resize(size, size);
      return item.rt;
    }
    return RenderTexture.create({
      width: size,
      height: size,
      resolution: 1,
      antialias: false,
      scaleMode: 'linear',
      // The frame follows resize() (cache level changes reuse the same texture).
      dynamic: true,
    });
  }

  /** Resizes a texture in use to another level. */
  resize(rt: RenderTexture, level: number): void {
    const size = cacheTextureSize(level);
    rt.resize(size, size);
  }

  release(rt: RenderTexture, level: number): void {
    this.free.push({ rt, level });
    this.freeBytes += cacheTextureBytes(level);
    while (!this.closing && this.freeBytes > this.maxBytes) {
      const oldest = this.free.shift();
      if (oldest === undefined) break;
      this.freeBytes -= cacheTextureBytes(oldest.level);
      oldest.rt.destroy(true);
    }
  }

  get bytes(): number {
    return this.freeBytes;
  }

  /**
   * Engine teardown: frees the GPU memory without destroying the sources (destroying them
   * would only trigger Pixi's bind-group warnings; the renderer is destroyed right after).
   */
  destroy(): void {
    for (const item of this.free) {
      item.rt.source.unload();
      item.rt.destroy(false);
    }
    this.free.length = 0;
    this.freeBytes = 0;
  }
}
