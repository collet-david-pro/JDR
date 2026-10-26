/**
 * In-memory map document (pure TypeScript, never put in a Svelte $state — projet.md 13.2).
 *
 * Tiles are stored sparsely per 32×32 chunk (Uint16Array of 32×32×4: index, variant, flags, 0),
 * only for non-empty chunks. Change notifications are batched per microtask.
 */
import {
  CHUNK_SIZE,
  type Ambient,
  type CellValue,
  type ChunkKey,
  type ChunksChangedEvent,
  type FogBitmap,
  type GridSpec,
  type GridTheme,
  type LayerDef,
  type MapObject,
  type MapOp,
  type MapView,
  type PaletteEntry,
  type PlacedToken,
  type SceneChangedEvent,
  type SceneView,
  type TileCell,
  type TileLayerId,
  type TokenDefView,
} from '../contracts';
import {
  CELL_STRIDE,
  TILE_LAYERS,
  createChunkCells,
  decodeChunk,
  decodeChunkRaw,
  encodeChunk,
} from '../../formats/chunk-codec';
import type { CompressionOptions } from '../../formats/compression';
import { DEFAULT_LAYERS, EMPTY_CELL, MapOpError, chunkKey, parseChunkKey } from './ops';
import { SceneState, isSceneOp } from './SceneState';
import { DEFAULT_AMBIENT, ambientOf } from './scene-values';
import { validateLayers } from './validate';

export const MAX_MAP_CELLS_PER_SIDE = 400;

export interface AssetInfo {
  readonly url: string | null;
  readonly name: string;
}

export interface MapDocumentInit {
  readonly grid: GridSpec;
  /** Floor uid of the edited floor (single floor in P4a). */
  readonly floor?: string;
  readonly layers?: readonly LayerDef[];
  /** Index 0 must be null. */
  readonly palette?: readonly (PaletteEntry | null)[];
  readonly theme?: GridTheme;
  /** P5: maps.ambient (defaults: no darkness, no tint). */
  readonly ambient?: unknown;
  /** Resolves url/name of an asset added by a palette.add op. */
  readonly resolveAsset?: (assetId: string) => AssetInfo | null;
}

export interface SerializedChunk {
  readonly layer: TileLayerId;
  readonly key: ChunkKey;
  /** Raw-deflate compressed block (12.2). */
  readonly data: Uint8Array;
}

interface ChunkRecord {
  readonly key: ChunkKey;
  readonly cells: Uint16Array;
  filled: number;
}

type Listener<T> = (value: T) => void;

/** Ops as actually applied (object / token revs stamped, see SceneState) and their inverse. */
export interface AppliedOps {
  readonly ops: MapOp[];
  readonly inverse: MapOp[];
}

type MetaOp = Extract<MapOp, { type: 'map.meta' }>;
type AmbientPatch = NonNullable<MetaOp['ambient']>;

export class MapDocument implements MapView, SceneView {
  readonly grid: GridSpec;
  readonly floor: string;
  /** Objects, placed tokens, fog, ambient of the floor (P5). */
  private readonly scene: SceneState;
  private readonly sceneListeners = new Set<Listener<SceneChangedEvent>>();
  private _layers: readonly LayerDef[];
  private _palette: readonly (PaletteEntry | null)[];
  private _theme: GridTheme;
  private readonly resolveAsset: (assetId: string) => AssetInfo | null;
  private readonly chunks = new Map<TileLayerId, Map<number, ChunkRecord>>();
  private readonly chunkListeners = new Set<Listener<ChunksChangedEvent>>();
  private readonly metaListeners = new Set<() => void>();
  private pendingChunks = new Map<TileLayerId, Set<ChunkKey>>();
  private pendingMeta = false;
  private flushScheduled = false;
  private _revision = 0;

  constructor(init: MapDocumentInit) {
    const { width, height } = init.grid;
    for (const v of [width, height]) {
      if (!Number.isInteger(v) || v < 1 || v > MAX_MAP_CELLS_PER_SIDE) {
        throw new RangeError(`Map size must be 1..${MAX_MAP_CELLS_PER_SIDE} cells`);
      }
    }
    this.grid = { ...init.grid };
    this.floor = init.floor ?? 'f1';
    this._layers = validateLayers(init.layers ?? DEFAULT_LAYERS);
    const palette = init.palette ?? [null];
    if (palette.length === 0 || palette[0] !== null) {
      throw new MapOpError('bad_palette_index', 'Palette index 0 must be null');
    }
    this._palette = [...palette];
    this._theme = init.theme ?? 'parchment';
    this.resolveAsset = init.resolveAsset ?? (() => null);
    for (const l of TILE_LAYERS) this.chunks.set(l, new Map());
    this.scene = new SceneState(
      this.floor,
      { width, height },
      init.ambient === undefined || init.ambient === null
        ? DEFAULT_AMBIENT
        : ambientOf(init.ambient),
      () => this.schedule(),
    );
  }

  // ---- SceneView (P5) --------------------------------------------------------------------

  get sceneRevision(): number {
    return this.scene.sceneRevision;
  }
  get ambient(): Ambient {
    return this.scene.ambient;
  }
  objects(): readonly MapObject[] {
    return this.scene.objects();
  }
  object(uid: string): MapObject | undefined {
    return this.scene.object(uid);
  }
  tokens(): readonly PlacedToken[] {
    return this.scene.tokens();
  }
  token(uid: string): PlacedToken | undefined {
    return this.scene.token(uid);
  }
  tokenDef(tokenId: string): TokenDefView | null {
    return this.scene.tokenDef(tokenId);
  }
  /** Token definitions of the game (token tool, panels). */
  tokenDefs(): readonly TokenDefView[] {
    return this.scene.tokenDefs();
  }
  fogKeys(): readonly ChunkKey[] {
    return this.scene.fogKeys();
  }
  fogChunk(key: ChunkKey): FogBitmap | null {
    return this.scene.fogChunk(key);
  }
  onSceneChanged(listener: Listener<SceneChangedEvent>): () => void {
    this.sceneListeners.add(listener);
    return () => this.sceneListeners.delete(listener);
  }
  /** Foreign change counter of `object:<uid>` / `token:<uid>` (History co-editing check). */
  foreignStamp(key: string): number {
    return this.scene.foreignStamp(key);
  }

  // ---- P5 non-undoable updates (load, conflicts, reset): not ops ------------------------

  /** Objects and placed tokens of the map (GET /maps/{id}); other floors are ignored. */
  loadScene(objects: readonly MapObject[], tokens: readonly PlacedToken[]): { skipped: number } {
    return this.scene.load(objects, tokens);
  }
  setTokenDefs(defs: readonly TokenDefView[]): void {
    this.scene.setTokenDefs(defs);
  }
  importFog(key: ChunkKey, bits: FogBitmap): void {
    this.scene.importFog(key, bits);
  }
  clearFog(): void {
    this.scene.clearFog();
  }
  /** Server state after a conflict (null: deleted). */
  replaceObject(uid: string, value: MapObject | null): void {
    this.scene.replaceObject(uid, value);
  }
  replaceToken(uid: string, value: PlacedToken | null): void {
    this.scene.replaceToken(uid, value);
  }

  // ---- MapView ---------------------------------------------------------------------------

  get layers(): readonly LayerDef[] {
    return this._layers;
  }
  get palette(): readonly (PaletteEntry | null)[] {
    return this._palette;
  }
  /** Local change counter (any mutation increments it). Not the server revision. */
  get revision(): number {
    return this._revision;
  }
  get theme(): GridTheme {
    return this._theme;
  }

  layer(id: string): LayerDef | undefined {
    return this._layers.find((l) => l.id === id);
  }

  inBounds(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.grid.width &&
      y < this.grid.height
    );
  }

  getCell(layer: TileLayerId, x: number, y: number): CellValue {
    if (!this.inBounds(x, y)) return EMPTY_CELL;
    const rec = this.record(layer, x, y);
    if (rec === undefined) return EMPTY_CELL;
    const s = this.offset(x, y);
    const index = rec.cells[s]!;
    return index === 0
      ? EMPTY_CELL
      : { index, variant: rec.cells[s + 1]!, flags: rec.cells[s + 2]! };
  }

  /** Fast path: palette index of a cell (0 when empty or outside the map). */
  getIndex(layer: TileLayerId, x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.grid.width || y >= this.grid.height) return 0;
    const rec = this.record(layer, x, y);
    return rec === undefined ? 0 : rec.cells[this.offset(x, y)]!;
  }

  chunkKeys(layer: TileLayerId): readonly ChunkKey[] {
    return [...this.layerChunks(layer).values()].map((r) => r.key);
  }

  chunkCells(layer: TileLayerId, key: ChunkKey): Uint16Array | null {
    const p = parseChunkKey(key);
    if (p === null) return null;
    return this.layerChunks(layer).get(this.numKey(p.cx, p.cy))?.cells ?? null;
  }

  onChunksChanged(listener: Listener<ChunksChangedEvent>): () => void {
    this.chunkListeners.add(listener);
    return () => this.chunkListeners.delete(listener);
  }

  onMetaChanged(listener: () => void): () => void {
    this.metaListeners.add(listener);
    return () => this.metaListeners.delete(listener);
  }

  // ---- Mutations -------------------------------------------------------------------------

  /**
   * Writes cells and returns the previous values of the cells that actually changed (one entry per
   * cell, original value) — i.e. the cells of the inverse tiles.set. Cells outside the map are
   * ignored; an invalid value throws before anything is written.
   */
  setCells(layer: TileLayerId, cells: readonly TileCell[]): TileCell[] {
    const store = this.layerChunks(layer);
    const paletteSize = this._palette.length;
    for (const c of cells) {
      const index = c[2];
      const variant = c[3];
      const flags = c[4];
      if (!isByte(variant) || !isByte(flags) || !Number.isInteger(index) || index < 0) {
        throw new MapOpError('bad_cell', `Invalid cell value ${JSON.stringify(c)}`);
      }
      if (index >= paletteSize) {
        throw new MapOpError('bad_palette_index', `Palette index ${index} out of range`);
      }
    }
    const previous: TileCell[] = [];
    // Cells already reported in `previous` (duplicates keep their original value).
    const big = cells.length > 512;
    const seenSet = !big && cells.length > 1 ? new Set<number>() : null;
    const seenBits = big ? new Uint8Array(this.grid.width * this.grid.height) : null;
    const w = this.grid.width;
    let pending = this.pendingChunks.get(layer);
    for (const c of cells) {
      const x = c[0];
      const y = c[1];
      if (!this.inBounds(x, y)) continue;
      const index = c[2];
      const variant = index === 0 ? 0 : c[3];
      const flags = index === 0 ? 0 : c[4];
      const nk = this.numKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
      let rec = store.get(nk);
      const s = this.offset(x, y);
      const oldIndex = rec === undefined ? 0 : rec.cells[s]!;
      const oldVariant = rec === undefined ? 0 : rec.cells[s + 1]!;
      const oldFlags = rec === undefined ? 0 : rec.cells[s + 2]!;
      if (oldIndex === index && oldVariant === variant && oldFlags === flags) continue;
      if (rec === undefined) {
        const cx = Math.floor(x / CHUNK_SIZE);
        const cy = Math.floor(y / CHUNK_SIZE);
        rec = { key: chunkKey(cx, cy), cells: createChunkCells(), filled: 0 };
        store.set(nk, rec);
      }
      const lin = y * w + x;
      if (seenBits !== null) {
        if (seenBits[lin] === 0) {
          seenBits[lin] = 1;
          previous.push([x, y, oldIndex, oldVariant, oldFlags]);
        }
      } else if (seenSet === null || !seenSet.has(lin)) {
        seenSet?.add(lin);
        previous.push([x, y, oldIndex, oldVariant, oldFlags]);
      }
      rec.cells[s] = index;
      rec.cells[s + 1] = variant;
      rec.cells[s + 2] = flags;
      if (oldIndex === 0) rec.filled++;
      if (index === 0) rec.filled--;
      if (rec.filled === 0) store.delete(nk);
      if (pending === undefined) {
        pending = new Set();
        this.pendingChunks.set(layer, pending);
      }
      pending.add(rec.key);
    }
    if (previous.length > 0) this.schedule();
    return previous;
  }

  /**
   * Applies ops atomically (all or nothing) and returns the inverse ops, computed against the
   * state just before application, in the order they must be applied to undo.
   * palette.add has no inverse (palette entries are append-only).
   */
  applyOps(ops: readonly MapOp[]): MapOp[] {
    return this.apply(ops).inverse;
  }

  /**
   * Like applyOps, and also returns the ops as applied: object / token updates carry the rev
   * they were based on (the value to send), adds carry the normalised value.
   */
  apply(ops: readonly MapOp[]): AppliedOps {
    const inverse: MapOp[] = [];
    const applied: MapOp[] = [];
    try {
      for (const op of ops) {
        const r = this.applyOne(op);
        applied.push(r.op);
        if (r.inverse !== null) inverse.push(r.inverse);
      }
    } catch (e) {
      // Roll back what was applied (inverse order), then rethrow.
      for (let i = inverse.length - 1; i >= 0; i--) this.applyOne(inverse[i]!, true);
      throw e;
    }
    return { ops: applied, inverse: inverse.reverse() };
  }

  /** Index of an asset in the palette, and the palette.add op to emit when it is missing. */
  paletteIndexFor(assetId: string): { index: number; op: MapOp | null } {
    const found = this._palette.findIndex((p) => p !== null && p.assetId === assetId);
    if (found > 0) return { index: found, op: null };
    const index = this._palette.length;
    return { index, op: { type: 'palette.add', index, asset_id: assetId } };
  }

  /** Updates url/name of palette entries (e.g. once signed URLs are known). Not an op. */
  updatePaletteAsset(assetId: string, info: AssetInfo): void {
    let changed = false;
    this._palette = this._palette.map((p) => {
      if (p === null || p.assetId !== assetId) return p;
      changed = true;
      return { ...p, url: info.url, name: info.name };
    });
    if (changed) this.markMeta();
  }

  /** Synchronously emits pending change events (normally sent on the next microtask). */
  flush(): void {
    this.flushScheduled = false;
    const chunks = this.pendingChunks;
    const meta = this.pendingMeta;
    this.pendingChunks = new Map();
    this.pendingMeta = false;
    if (meta) for (const l of [...this.metaListeners]) l();
    for (const [layer, keys] of chunks) {
      if (keys.size === 0) continue;
      const event: ChunksChangedEvent = { layer, keys: [...keys] };
      for (const l of [...this.chunkListeners]) l(event);
    }
    const scene = this.scene.takeEvent();
    if (scene !== null) for (const l of [...this.sceneListeners]) l(scene);
  }

  // ---- Chunk (de)serialisation (12.2) ----------------------------------------------------

  /** Compresses every non-empty chunk. */
  async exportChunks(options: CompressionOptions = {}): Promise<SerializedChunk[]> {
    const out: SerializedChunk[] = [];
    for (const layer of TILE_LAYERS) {
      for (const rec of this.layerChunks(layer).values()) {
        const data = await encodeChunk(layer, rec.cells, options);
        if (data !== null) out.push({ layer, key: rec.key, data });
      }
    }
    return out;
  }

  /** Loads a compressed chunk (server or cache). Not undoable; emits a change event. */
  async importChunk(
    layer: TileLayerId,
    key: ChunkKey,
    data: Uint8Array,
    options: CompressionOptions = {},
  ): Promise<void> {
    const decoded = await decodeChunk(data, {
      ...options,
      layer,
      paletteSize: this._palette.length,
    });
    this.putChunk(layer, key, decoded?.cells ?? null, decoded?.filled ?? 0);
  }

  /** Loads an uncompressed raw block (4 104 bytes). */
  importRawChunk(layer: TileLayerId, key: ChunkKey, raw: Uint8Array): void {
    const decoded = decodeChunkRaw(raw, { layer, paletteSize: this._palette.length });
    this.putChunk(layer, key, decoded?.cells ?? null, decoded?.filled ?? 0);
  }

  // ---- Internals -------------------------------------------------------------------------

  private applyOne(op: MapOp, rollback = false): { op: MapOp; inverse: MapOp | null } {
    if (isSceneOp(op)) return this.scene.apply(op, rollback);
    return { op, inverse: this.applyTile(op) };
  }

  private applyTile(op: MapOp): MapOp | null {
    switch (op.type) {
      case 'tiles.set': {
        if (op.floor !== this.floor)
          throw new MapOpError('unknown_floor', `Unknown floor ${op.floor}`);
        if (!TILE_LAYERS.includes(op.layer)) {
          throw new MapOpError('unknown_layer', `Unknown tile layer ${String(op.layer)}`);
        }
        const prev = this.setCells(op.layer, op.cells);
        return prev.length === 0
          ? null
          : { type: 'tiles.set', floor: op.floor, layer: op.layer, cells: prev };
      }
      case 'palette.add':
        this.addPalette(op.index, op.asset_id, op.autotile ?? null);
        return null;
      case 'map.meta': {
        const layers = op.layers === undefined ? undefined : validateLayers(op.layers);
        const inverse: {
          type: 'map.meta';
          layers?: readonly LayerDef[];
          theme?: GridTheme;
          ambient?: AmbientPatch;
        } = { type: 'map.meta' };
        const ambient = op.ambient === undefined ? null : this.ambientChange(op.ambient);
        if (layers !== undefined) {
          inverse.layers = this._layers;
          this._layers = layers;
        }
        if (op.theme !== undefined) {
          inverse.theme = this._theme;
          this._theme = op.theme;
        }
        if (ambient !== null) {
          inverse.ambient = ambient.inverse;
          this.scene.setAmbient(ambient.next);
        }
        if (layers === undefined && op.theme === undefined && ambient === null) return null;
        if (layers !== undefined || op.theme !== undefined) this.markMeta();
        return inverse;
      }
      default:
        throw new MapOpError('unknown_op', `Unknown op ${(op as { type: string }).type}`);
    }
  }

  /** Next ambient and the inverse patch (previous values of the changed keys), or null. */
  private ambientChange(patch: AmbientPatch): { next: Ambient; inverse: AmbientPatch } | null {
    const cur = this.scene.ambient;
    const next = ambientOf({ ...cur, ...patch });
    const inverse: Record<string, unknown> = {};
    for (const k of Object.keys(patch) as (keyof Ambient)[]) {
      if (JSON.stringify(cur[k]) !== JSON.stringify(next[k])) inverse[k] = cur[k];
    }
    return Object.keys(inverse).length === 0 ? null : { next, inverse: inverse as AmbientPatch };
  }

  private addPalette(index: number, assetId: string, autotile: string | null): void {
    if (!Number.isInteger(index) || index < 1 || index > 0xffff || assetId === '') {
      throw new MapOpError('bad_palette_index', `Invalid palette index ${index}`);
    }
    const existing = this._palette[index];
    if (existing !== undefined && existing !== null) {
      if (existing.assetId === assetId) return;
      throw new MapOpError('palette_conflict', `Palette index ${index} already used`);
    }
    const info = this.resolveAsset(assetId);
    const next = [...this._palette];
    while (next.length < index) next.push(null);
    next[index] = {
      assetId,
      url: info?.url ?? null,
      name: info?.name ?? assetId,
      ...(autotile !== null ? { autotile } : {}),
    };
    this._palette = next;
    this.markMeta();
  }

  private putChunk(
    layer: TileLayerId,
    key: ChunkKey,
    cells: Uint16Array | null,
    filled: number,
  ): void {
    const p = parseChunkKey(key);
    if (
      p === null ||
      p.cx * CHUNK_SIZE >= this.grid.width ||
      p.cy * CHUNK_SIZE >= this.grid.height
    ) {
      throw new MapOpError('bad_cell', `Chunk ${key} outside the map`);
    }
    const store = this.layerChunks(layer);
    const nk = this.numKey(p.cx, p.cy);
    if (cells === null) store.delete(nk);
    else store.set(nk, { key: chunkKey(p.cx, p.cy), cells, filled });
    let pending = this.pendingChunks.get(layer);
    if (pending === undefined) {
      pending = new Set();
      this.pendingChunks.set(layer, pending);
    }
    pending.add(chunkKey(p.cx, p.cy));
    this.schedule();
  }

  private layerChunks(layer: TileLayerId): Map<number, ChunkRecord> {
    const m = this.chunks.get(layer);
    if (m === undefined)
      throw new MapOpError('unknown_layer', `Unknown tile layer ${String(layer)}`);
    return m;
  }

  private record(layer: TileLayerId, x: number, y: number): ChunkRecord | undefined {
    return this.layerChunks(layer).get(
      this.numKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)),
    );
  }

  private numKey(cx: number, cy: number): number {
    return cy * 65536 + cx;
  }

  private offset(x: number, y: number): number {
    return ((y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)) * CELL_STRIDE;
  }

  private markMeta(): void {
    this.pendingMeta = true;
    this.schedule();
  }

  private schedule(): void {
    this._revision++;
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      if (this.flushScheduled) this.flush();
    });
  }
}

function isByte(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 0xff;
}
