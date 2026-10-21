/**
 * Tilemap by chunks (projet.md 12.2, 14.1).
 *
 * - One container per 32 × 32 chunk; inside it one container per tile layer (ground,
 *   terrain, decor, in MapView.layers order, with their visibility and opacity), holding
 *   static ParticleContainers (one per texture source) built from MapView.chunkCells().
 * - Cache: at low/medium zoom each chunk is rendered once into its own RenderTexture whose
 *   resolution follows the zoom (cache-lod.ts) and displayed as a single sprite; it is only
 *   re-rendered when the chunk, the layers or its textures change, or when the zoom level
 *   changes. The particle content is kept for fast re-renders up to MAX_RETAINED_PARTICLES,
 *   then dropped to bound memory on huge maps. At high zoom chunks are
 *   drawn directly from their (static, GPU-resident) particle buffers.
 * - Culling per chunk (+ one chunk margin, prepared ahead but not drawn); chunks outside the
 *   margin for 30 s release their GPU resources.
 * - Work (builds and cache renders) is time-budgeted per frame, nearest chunks first.
 */

import {
  CHUNK_SIZE,
  type ChunksChangedEvent,
  type CameraState,
  type ChunkKey,
  type LayerDef,
  type MapView,
  type TileLayerId,
} from '../editor/contracts';
import type { Viewport } from './camera';
import { cacheTextureBytes, nextRenderMode, type ChunkRenderMode } from './cache-lod';
import { cellSprite } from './cell-transform';
import { chunkDisplay, hasWork, planChunkWork, type ChunkState } from './chunk-plan';
import {
  CHUNK_MARGIN,
  ChunkResidency,
  EMPTY_RANGE,
  keysInRange,
  parseChunkKey,
  rangeContains,
  visibleChunkRange,
  type ChunkRange,
} from './chunk-math';
import {
  Container,
  Matrix,
  Particle,
  ParticleContainer,
  Rectangle,
  Sprite,
  type Renderer,
  type RenderTexture,
} from './pixi';
import { RenderTexturePool } from './rt-pool';
import type { PaletteTextures } from './textures';

/**
 * Particles kept alive in cached mode (about 0.2 KB each with their GPU buffers, so ~40 MB):
 * a fully filled 200 × 200 map with 3 layers is 120 000.
 */
export const MAX_RETAINED_PARTICLES = 200_000;

export const TILE_LAYER_IDS: readonly TileLayerId[] = ['ground', 'terrain', 'decor'];

const STATIC_PROPERTIES = {
  vertex: false,
  position: false,
  rotation: false,
  uvs: false,
  color: false,
} as const;

interface ChunkCache {
  readonly rt: RenderTexture;
  readonly level: number;
  readonly sprite: Sprite;
}

class ChunkView {
  readonly root = new Container();
  content: Container | null = null;
  contentDirty = true;
  cache: ChunkCache | null = null;
  cacheValid = false;
  /** Palette indices used by the last build (to invalidate on texture changes). */
  indices = new Set<number>();
  particles = 0;

  constructor(
    readonly key: ChunkKey,
    readonly cx: number,
    readonly cy: number,
    cellPx: number,
  ) {
    this.root.position.set(cx * CHUNK_SIZE * cellPx, cy * CHUNK_SIZE * cellPx);
    this.root.visible = false;
  }

  get state(): ChunkState {
    return {
      hasContent: this.content !== null,
      contentDirty: this.contentDirty,
      cacheLevel: this.cache?.level ?? null,
      cacheValid: this.cacheValid,
    };
  }

  invalidate(): void {
    this.contentDirty = true;
    this.cacheValid = false;
  }

  dropContent(): void {
    if (this.content === null) return;
    this.content.destroy({ children: true });
    this.content = null;
    this.particles = 0;
  }

  dropCache(pool: RenderTexturePool): void {
    if (this.cache === null) return;
    this.cache.sprite.destroy();
    pool.release(this.cache.rt, this.cache.level);
    this.cache = null;
    this.cacheValid = false;
  }

  destroy(pool: RenderTexturePool): void {
    this.dropContent();
    this.dropCache(pool);
    this.root.destroy({ children: true });
  }
}

export interface TileMapStats {
  readonly mode: string;
  /** Chunks with GPU resources (content or cache). */
  readonly resident: number;
  readonly visible: number;
  readonly withContent: number;
  readonly cached: number;
  readonly particles: number;
  readonly cacheBytes: number;
}

export class TileMapRenderer {
  /** Child of the world container (unit: pixel at zoom 1). */
  readonly root = new Container();

  private view: MapView | null = null;
  private cellPx = 1;
  private readonly views = new Map<ChunkKey, ChunkView>();
  private readonly existing = new Set<ChunkKey>();
  private readonly residency = new ChunkResidency();
  private layers: LayerDef[] = [];
  private mode: ChunkRenderMode | null = null;
  private range: ChunkRange = EMPTY_RANGE;
  private visibleCount = 0;
  private readonly matrix = new Matrix();
  private readonly pool = new RenderTexturePool();
  private retainedParticles = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly textures: PaletteTextures,
  ) {}

  setMap(view: MapView | null): void {
    this.clear();
    this.view = view;
    if (view === null) return;
    this.cellPx = view.grid.cellPx;
    for (const layer of TILE_LAYER_IDS) {
      for (const key of view.chunkKeys(layer)) this.existing.add(key);
    }
    this.layers = tileLayers(view.layers);
  }

  /** Layer order/visibility/opacity changed: rebuild everything (progressively). */
  setLayers(layers: readonly LayerDef[]): void {
    const next = tileLayers(layers);
    if (sameLayers(next, this.layers)) return;
    this.layers = next;
    for (const v of this.views.values()) v.invalidate();
  }

  chunksChanged(event: ChunksChangedEvent): void {
    const view = this.view;
    if (view === null) return;
    for (const key of event.keys) {
      if (view.chunkCells(event.layer, key) !== null) {
        this.existing.add(key);
      } else if (!TILE_LAYER_IDS.some((l) => view.chunkCells(l, key) !== null)) {
        this.existing.delete(key);
      }
      this.views.get(key)?.invalidate();
    }
  }

  /** Textures of these palette indices changed (loaded, failed, url changed). */
  texturesChanged(indices: readonly number[]): void {
    for (const v of this.views.values()) {
      if (indices.some((i) => v.indices.has(i))) v.invalidate();
    }
  }

  /**
   * Culling, builds and cache renders for this frame. Returns true when work remains
   * (another frame is needed).
   */
  update(
    now: number,
    camera: CameraState,
    viewport: Viewport,
    dpr: number,
    settled: boolean,
    budgetMs: number,
  ): boolean {
    const view = this.view;
    if (view === null) return false;
    const grid = view.grid;
    this.mode = nextRenderMode(this.mode, grid.cellPx * camera.zoom * dpr, settled);
    const strict = visibleChunkRange(camera, viewport, grid, 0);
    this.range = visibleChunkRange(camera, viewport, grid, CHUNK_MARGIN);

    for (const v of this.views.values()) v.root.visible = false;
    const keys = keysInRange(this.range, this.existing);
    // Visible chunks first, then the margin.
    const inStrict = (key: ChunkKey): boolean => {
      const p = parseChunkKey(key);
      return p !== null && rangeContains(strict, p.cx, p.cy);
    };
    const ordered = [...keys.filter(inStrict), ...keys.filter((k) => !inStrict(k))];

    let retained = 0;
    for (const v of this.views.values()) retained += v.particles;
    this.retainedParticles = retained;
    const deadline = performance.now() + budgetMs;
    let pending = false;
    let worked = 0;
    let visible = 0;
    for (const key of ordered) {
      const chunk = this.ensure(key);
      if (chunk === null) continue;
      this.residency.touch(key, now);
      const strictly = inStrict(key);
      // At least one unit of work per frame, then as much as the budget allows.
      const allowed = worked === 0 || performance.now() < deadline;
      const result = this.prepare(chunk, allowed);
      if (result === 'deferred') pending = true;
      else if (result === 'worked') worked++;
      if (strictly && this.show(chunk)) {
        chunk.root.visible = true;
        visible++;
      }
    }
    this.visibleCount = visible;
    return pending;
  }

  /** Releases chunks outside the margin for longer than the TTL. Returns how many. */
  releaseExpired(now: number): number {
    const expired = this.residency.expire(now, (key) => {
      const p = parseChunkKey(key);
      return p !== null && rangeContains(this.range, p.cx, p.cy);
    });
    for (const key of expired) {
      this.views.get(key)?.destroy(this.pool);
      this.views.delete(key);
    }
    return expired.length;
  }

  get stats(): TileMapStats {
    let withContent = 0;
    let cached = 0;
    let particles = 0;
    let cacheBytes = 0;
    for (const v of this.views.values()) {
      if (v.content !== null) withContent++;
      if (v.cache !== null) {
        cached++;
        cacheBytes += cacheTextureBytes(v.cache.level);
      }
      particles += v.particles;
    }
    const mode = this.mode;
    return {
      mode: mode === null ? 'none' : mode.kind === 'direct' ? 'direct' : `cached@${mode.level}`,
      resident: this.views.size,
      visible: this.visibleCount,
      withContent,
      cached,
      particles,
      cacheBytes,
    };
  }

  clear(): void {
    for (const v of this.views.values()) v.destroy(this.pool);
    this.views.clear();
    this.existing.clear();
    this.residency.clear();
    this.mode = null;
    this.range = EMPTY_RANGE;
    this.visibleCount = 0;
  }

  destroy(): void {
    this.pool.closing = true;
    this.clear();
    this.view = null;
    this.pool.destroy();
    this.root.destroy({ children: true });
  }

  private ensure(key: ChunkKey): ChunkView | null {
    let chunk = this.views.get(key);
    if (chunk !== undefined) return chunk;
    const p = parseChunkKey(key);
    if (p === null) return null;
    chunk = new ChunkView(key, p.cx, p.cy, this.cellPx);
    this.views.set(key, chunk);
    this.root.addChild(chunk.root);
    return chunk;
  }

  /** Brings a chunk up to date for the current mode. */
  private prepare(chunk: ChunkView, allowed: boolean): 'ready' | 'worked' | 'deferred' {
    const mode = this.mode;
    if (mode === null) return 'ready';
    const work = planChunkWork(chunk.state, mode);
    if (!hasWork(work)) {
      if (mode.kind === 'cached') this.trimContent(chunk);
      return 'ready';
    }
    if (!allowed) return 'deferred';
    if (work.build) {
      this.retainedParticles -= chunk.particles;
      this.build(chunk);
      this.retainedParticles += chunk.particles;
    }
    if (work.cacheLevel !== null) {
      this.renderCache(chunk, work.cacheLevel);
      this.trimContent(chunk);
    }
    return 'worked';
  }

  /**
   * In cached mode the particle content is only needed to re-render the cache (zoom level
   * change, edits). It is kept while the retained total stays under the budget (fast level
   * changes on normal maps) and dropped beyond (memory bounded on huge maps).
   */
  private trimContent(chunk: ChunkView): void {
    if (chunk.content === null) return;
    if (this.retainedParticles <= MAX_RETAINED_PARTICLES) return;
    this.retainedParticles -= chunk.particles;
    chunk.dropContent();
  }

  /** Shows the content or the cache sprite (see chunkDisplay). */
  private show(chunk: ChunkView): boolean {
    const display = this.mode === null ? 'none' : chunkDisplay(chunk.state, this.mode);
    if (chunk.content !== null) chunk.content.visible = display === 'content';
    if (chunk.cache !== null) chunk.cache.sprite.visible = display === 'cache';
    return display !== 'none';
  }

  private build(chunk: ChunkView): void {
    const view = this.view;
    if (view === null) return;
    chunk.dropContent();
    const content = new Container();
    const indices = new Set<number>();
    const cellPx = this.cellPx;
    const chunkPx = CHUNK_SIZE * cellPx;
    const bounds = new Rectangle(0, 0, chunkPx, chunkPx);
    const maxX = view.grid.width - chunk.cx * CHUNK_SIZE;
    const maxY = view.grid.height - chunk.cy * CHUNK_SIZE;
    let particles = 0;
    for (const def of this.layers) {
      if (!def.visible || def.opacity <= 0) continue;
      const cells = view.chunkCells(def.id as TileLayerId, chunk.key);
      if (cells === null) continue;
      const groups = new Map<number, ParticleContainer>();
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const index = cells[i * 4] ?? 0;
        if (index === 0) continue;
        const lx = i % CHUNK_SIZE;
        const ly = (i / CHUNK_SIZE) | 0;
        if (lx >= maxX || ly >= maxY) continue;
        const variant = cells[i * 4 + 1] ?? 0;
        const flags = cells[i * 4 + 2] ?? 0;
        indices.add(index);
        const tile = this.textures.resolve(index, variant);
        const frame = tile.texture.frame;
        const s = cellSprite(lx, ly, cellPx, frame.width, frame.height, flags);
        const uid = tile.texture.source.uid;
        let group = groups.get(uid);
        if (group === undefined) {
          group = new ParticleContainer({
            texture: tile.texture,
            dynamicProperties: STATIC_PROPERTIES,
            boundsArea: bounds,
          });
          groups.set(uid, group);
        }
        group.particleChildren.push(
          new Particle({
            texture: tile.texture,
            x: s.x,
            y: s.y,
            scaleX: s.scaleX,
            scaleY: s.scaleY,
            rotation: s.rotation,
            anchorX: 0.5,
            anchorY: 0.5,
            tint: tile.tint,
          }),
        );
        particles++;
      }
      if (groups.size === 0) continue;
      const layer = new Container({ alpha: Math.min(1, Math.max(0, def.opacity)) });
      layer.label = def.id;
      for (const group of groups.values()) {
        group.update();
        layer.addChild(group);
      }
      content.addChild(layer);
    }
    chunk.content = content;
    chunk.contentDirty = false;
    chunk.indices = indices;
    chunk.particles = particles;
    content.visible = false;
    chunk.root.addChild(content);
  }

  private renderCache(chunk: ChunkView, level: number): void {
    const content = chunk.content;
    if (content === null) return;
    if (chunk.cache !== null && chunk.cache.level !== level) {
      this.pool.resize(chunk.cache.rt, level);
      chunk.cache.sprite.scale.set(this.cellPx / level);
      chunk.cache = { ...chunk.cache, level };
    }
    if (chunk.cache === null) {
      const rt = this.pool.acquire(level);
      const sprite = new Sprite(rt);
      sprite.scale.set(this.cellPx / level);
      chunk.root.addChildAt(sprite, 0);
      chunk.cache = { rt, level, sprite };
    }
    const scale = level / this.cellPx;
    this.matrix.set(scale, 0, 0, scale, 0, 0);
    const wasVisible = content.visible;
    content.visible = true;
    this.renderer.render({
      container: content,
      target: chunk.cache.rt,
      clear: true,
      clearColor: [0, 0, 0, 0],
      transform: this.matrix,
    });
    content.visible = wasVisible;
    chunk.cacheValid = true;
  }
}

function tileLayers(layers: readonly LayerDef[]): LayerDef[] {
  return layers.filter(
    (l) => l.kind === 'tiles' && (TILE_LAYER_IDS as readonly string[]).includes(l.id),
  );
}

function sameLayers(a: readonly LayerDef[], b: readonly LayerDef[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((l, i) => {
    const o = b[i];
    return o !== undefined && o.id === l.id && o.visible === l.visible && o.opacity === l.opacity;
  });
}
