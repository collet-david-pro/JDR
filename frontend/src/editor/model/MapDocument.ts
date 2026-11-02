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
  type FloorInfo,
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
import { FloorSlot, floorRecreateOps, type ChunkRecord, type FloorMeta } from './FloorSlot';
import { DEFAULT_LAYERS, EMPTY_CELL, MapOpError, chunkKey, parseChunkKey } from './ops';
import { FloorView } from './FloorView';
import { NotesState, isNoteOp } from './NotesState';
import { SceneState, isSceneOp, type SceneOp } from './SceneState';
import { DEFAULT_AMBIENT, ambientOf } from './scene-values';
import { validateLayers } from './validate';

export const MAX_MAP_CELLS_PER_SIDE = 400;

export interface AssetInfo {
  readonly url: string | null;
  readonly name: string;
}

export interface MapDocumentInit {
  readonly grid: GridSpec;
  /** Floor shown first (uid or id); single floor 'f1' when `floors` is absent. */
  readonly floor?: string;
  /** P9a2: every floor of the map (server MapDetail.floors). Absent = one floor, `floor`. */
  readonly floors?: readonly FloorInfo[];
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

type Listener<T> = (value: T) => void;

/** Ops as actually applied (object / token revs stamped, see SceneState) and their inverse. */
export interface AppliedOps {
  readonly ops: MapOp[];
  readonly inverse: MapOp[];
}

type MetaOp = Extract<MapOp, { type: 'map.meta' }>;
type AmbientPatch = NonNullable<MetaOp['ambient']>;

export const MAX_FLOORS = 10;
const FLOOR_UID = /^[A-Za-z0-9_-]{1,21}$/;

export interface FloorsEvent {
  /** The list of floors (or one of their names / levels) changed. */
  readonly list: boolean;
  /** The shown floor changed. */
  readonly current: boolean;
}

export class MapDocument implements MapView, SceneView {
  readonly grid: GridSpec;
  /** Notes of the map (P9b2a), outside the floors. */
  readonly notes = new NotesState();
  private readonly slots: FloorSlot[] = [];
  private cur!: FloorSlot;
  private sceneEpoch = 0;
  private readonly sceneListeners = new Set<Listener<SceneChangedEvent>>();
  private readonly floorListeners = new Set<Listener<FloorsEvent>>();
  private readonly floorChunkListeners = new Set<
    (floor: string, event: ChunksChangedEvent) => void
  >();
  private pendingFloors: { list: boolean; current: boolean } | null = null;
  private pendingSwitch: SceneChangedEvent | null = null;
  private pendingSwitchChunks: { floor: FloorSlot; layer: TileLayerId; keys: ChunkKey[] }[] = [];
  private _layers: readonly LayerDef[];
  private _palette: readonly (PaletteEntry | null)[];
  private _theme: GridTheme;
  private readonly resolveAsset: (assetId: string) => AssetInfo | null;
  private readonly chunkListeners = new Set<Listener<ChunksChangedEvent>>();
  private readonly metaListeners = new Set<() => void>();
  private pendingChunks = new Map<FloorSlot, Map<TileLayerId, Set<ChunkKey>>>();
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
    this._layers = validateLayers(init.layers ?? DEFAULT_LAYERS);
    const palette = init.palette ?? [null];
    if (palette.length === 0 || palette[0] !== null) {
      throw new MapOpError('bad_palette_index', 'Palette index 0 must be null');
    }
    this._palette = [...palette];
    this._theme = init.theme ?? 'parchment';
    this.resolveAsset = init.resolveAsset ?? (() => null);
    const ambient =
      init.ambient === undefined || init.ambient === null
        ? DEFAULT_AMBIENT
        : ambientOf(init.ambient);
    const infos: readonly FloorInfo[] =
      init.floors !== undefined && init.floors.length > 0
        ? init.floors
        : [{ id: init.floor ?? 'f1', uid: init.floor ?? 'f1', level: 0, name: '', sort_order: 0 }];
    const first =
      infos.find(
        (i) => init.floor !== undefined && (i.uid === init.floor || i.id === init.floor),
      ) ?? infos[0]!;
    for (const info of infos) {
      // Only the shown floor is in memory at first (the others are fetched when needed).
      const slot = this.newSlot(info.uid, info.id, info.name, info.level, ambient, info === first);
      this.slots.push(slot);
    }
    this.sortSlots();
    this.cur = this.slots.find((s) => s.uid === first.uid)!;
  }

  private newSlot(
    uid: string,
    id: string | null,
    name: string,
    level: number,
    ambient: Ambient,
    loaded: boolean,
  ): FloorSlot {
    const scene = new SceneState(
      uid,
      { width: this.grid.width, height: this.grid.height },
      ambient,
      () => this.schedule(),
    );
    if (id !== null) scene.addRef(id);
    return new FloorSlot(uid, id, name, level, scene, loaded);
  }

  private sortSlots(): void {
    this.slots.sort((a, b) => a.level - b.level);
  }

  /** The shown floor (uid): tools put it in the ops they build. */
  get floor(): string {
    return this.cur.uid;
  }

  // ---- Floors (P9a2) --------------------------------------------------------------------

  /** Floors by level. */
  floors(): readonly FloorMeta[] {
    return this.slots.map((s) => s.meta);
  }

  floorMeta(ref: string): FloorMeta | undefined {
    return this.slotOrUndefined(ref)?.meta;
  }

  /** Switches the shown floor (the engine is notified like for any change). */
  setCurrentFloor(ref: string): void {
    const slot = this.slotOf(ref);
    if (slot === this.cur) return;
    this.switchTo(slot);
  }

  /** Marks a floor as fully in memory (tiles imported, fog imported). */
  markFloorLoaded(ref: string): void {
    const slot = this.slotOf(ref);
    if (slot.loaded) return;
    slot.loaded = true;
    this.noteFloors(true, false);
  }

  /** Server ids for floors created locally (after a reload of the floor list). */
  setFloorId(uid: string, id: string): void {
    const slot = this.slotOf(uid);
    slot.id = id;
    slot.scene.addRef(id);
  }

  onFloorsChanged(listener: Listener<FloorsEvent>): () => void {
    this.floorListeners.add(listener);
    return () => this.floorListeners.delete(listener);
  }

  /** Chunk changes of any floor (ghost floor view). */
  onFloorChunksChanged(listener: (floor: string, event: ChunksChangedEvent) => void): () => void {
    this.floorChunkListeners.add(listener);
    return () => this.floorChunkListeners.delete(listener);
  }

  /** Floor whose level is the closest below the shown one, or undefined. */
  floorBelow(): FloorMeta | undefined {
    const i = this.slots.indexOf(this.cur);
    return i > 0 ? this.slots[i - 1]!.meta : undefined;
  }

  /** A read-only MapView of another floor (ghost). */
  floorView(ref: string): MapView {
    return new FloorView(this, this.slotOf(ref).uid);
  }

  /** Chunk keys / cells of any floor (views, export of the cache). */
  chunkKeysOf(floor: string, layer: TileLayerId): readonly ChunkKey[] {
    return this.slotOf(floor).chunkKeys(layer);
  }
  chunkCellsOf(floor: string, layer: TileLayerId, key: ChunkKey): Uint16Array | null {
    const p = parseChunkKey(key);
    if (p === null) return null;
    return this.slotOf(floor).chunks.get(layer)?.get(this.numKey(p.cx, p.cy))?.cells ?? null;
  }
  objectsOf(floor: string): readonly MapObject[] {
    return this.slotOf(floor).scene.objects();
  }
  tokensOf(floor: string): readonly PlacedToken[] {
    return this.slotOf(floor).scene.tokens();
  }
  fogKeysOf(floor: string): readonly ChunkKey[] {
    return this.slotOf(floor).scene.fogKeys();
  }

  private slotOrUndefined(ref: string): FloorSlot | undefined {
    return this.slots.find((s) => s.owns(ref));
  }

  private slotOf(ref: string): FloorSlot {
    const slot = this.slotOrUndefined(ref);
    if (slot === undefined) throw new MapOpError('unknown_floor', `Unknown floor ${ref}`);
    return slot;
  }

  /** Slot holding an object / placed token (uids are unique in the map). */
  private slotHolding(kind: 'object' | 'token', uid: string): FloorSlot | undefined {
    if (this.cur.scene[kind](uid) !== undefined) return this.cur;
    return this.slots.find((s) => s.scene[kind](uid) !== undefined);
  }

  private switchTo(slot: FloorSlot): void {
    const prev = this.cur;
    // What the engine shows changes: every block / object / token / fog chunk of both floors.
    for (const f of [prev, slot]) {
      for (const [layer, keys] of f.allChunkKeys()) {
        if (keys.length > 0) this.pendingSwitchChunks.push({ floor: f, layer, keys });
      }
    }
    const old = prev.scene.eventForAll();
    const next = slot.scene.eventForAll();
    this.pendingSwitch = {
      objects: [...new Set([...old.objects, ...next.objects])],
      tokens: [...new Set([...old.tokens, ...next.tokens])],
      fog: [...new Set([...old.fog, ...next.fog])],
      ambient: false,
      tokenDefs: false,
    };
    this.cur = slot;
    this.sceneEpoch++;
    slot.scene.takeEvent();
    this.noteFloors(false, true);
    this.schedule();
  }

  private noteFloors(list: boolean, current: boolean): void {
    this.pendingFloors = {
      list: list || (this.pendingFloors?.list ?? false),
      current: current || (this.pendingFloors?.current ?? false),
    };
    this.schedule();
  }

  // ---- SceneView (P5) --------------------------------------------------------------------

  get sceneRevision(): number {
    return this.sceneEpoch * 1_000_000 + this.cur.scene.sceneRevision;
  }
  get ambient(): Ambient {
    return this.cur.scene.ambient;
  }
  objects(): readonly MapObject[] {
    return this.cur.scene.objects();
  }
  /** An object of any floor. */
  object(uid: string): MapObject | undefined {
    return this.slotHolding('object', uid)?.scene.object(uid);
  }
  tokens(): readonly PlacedToken[] {
    return this.cur.scene.tokens();
  }
  token(uid: string): PlacedToken | undefined {
    return this.slotHolding('token', uid)?.scene.token(uid);
  }
  tokenDef(tokenId: string): TokenDefView | null {
    return this.cur.scene.tokenDef(tokenId);
  }
  /** Token definitions of the game (token tool, panels). */
  tokenDefs(): readonly TokenDefView[] {
    return this.cur.scene.tokenDefs();
  }
  fogKeys(): readonly ChunkKey[] {
    return this.cur.scene.fogKeys();
  }
  fogChunk(key: ChunkKey): FogBitmap | null {
    return this.cur.scene.fogChunk(key);
  }
  onSceneChanged(listener: Listener<SceneChangedEvent>): () => void {
    this.sceneListeners.add(listener);
    return () => this.sceneListeners.delete(listener);
  }
  /** Foreign change counter of `object:<uid>` / `token:<uid>` (History co-editing check). */
  foreignStamp(key: string): number {
    let n = 0;
    for (const slot of this.slots) n += slot.scene.foreignStamp(key);
    return n;
  }

  // ---- P5 non-undoable updates (load, conflicts, reset): not ops ------------------------

  /** Objects and placed tokens of the map (GET /maps/{id}); other floors are ignored. */
  loadScene(objects: readonly MapObject[], tokens: readonly PlacedToken[]): { skipped: number } {
    let skipped = 0;
    for (const slot of this.slots) skipped += slot.scene.load(objects, tokens).skipped;
    return { skipped };
  }
  setTokenDefs(defs: readonly TokenDefView[]): void {
    for (const slot of this.slots) slot.scene.setTokenDefs(defs);
  }
  /** Fog chunk of a floor (default: the shown one). */
  importFog(key: ChunkKey, bits: FogBitmap, floor?: string): void {
    const slot = floor === undefined ? this.cur : this.slotOf(floor);
    slot.scene.importFog(key, bits);
  }
  clearFog(): void {
    this.cur.scene.clearFog();
  }
  /** Server state after a conflict (null: deleted). */
  replaceObject(uid: string, value: MapObject | null): void {
    const holder = this.slotHolding('object', uid);
    if (holder !== undefined && (value === null || !holder.owns(value.floor))) {
      holder.scene.replaceObject(uid, null);
    }
    const target = value === null ? holder : this.slotOrUndefined(value.floor);
    target?.scene.replaceObject(uid, value);
  }
  replaceToken(uid: string, value: PlacedToken | null): void {
    const holder = this.slotHolding('token', uid);
    if (holder !== undefined && (value === null || !holder.owns(value.floor))) {
      holder.scene.replaceToken(uid, null);
    }
    const target = value === null ? holder : this.slotOrUndefined(value.floor);
    target?.scene.replaceToken(uid, value);
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

  getCell(layer: TileLayerId, x: number, y: number, floor?: string): CellValue {
    if (!this.inBounds(x, y)) return EMPTY_CELL;
    const slot = floor === undefined ? this.cur : this.slotOf(floor);
    const rec = this.record(layer, x, y, slot);
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
  setCells(layer: TileLayerId, cells: readonly TileCell[], slot: FloorSlot = this.cur): TileCell[] {
    const store = this.layerChunks(layer, slot);
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
    const pending = this.pendingSet(slot, layer);
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
    // One group of inverse ops per op (floor.remove has several), in application order.
    const groups: MapOp[][] = [];
    const applied: MapOp[] = [];
    try {
      for (const op of ops) {
        const r = this.applyOne(op);
        applied.push(r.op);
        if (r.inverse !== null) groups.push(Array.isArray(r.inverse) ? r.inverse : [r.inverse]);
      }
    } catch (e) {
      // Roll back what was applied (inverse order), then rethrow.
      for (let i = groups.length - 1; i >= 0; i--) {
        for (const inv of groups[i]!) this.applyOne(inv, true);
      }
      throw e;
    }
    return { ops: applied, inverse: groups.reverse().flat() };
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
    const floors = this.pendingFloors;
    const switched = this.pendingSwitch;
    const switchedChunks = this.pendingSwitchChunks;
    this.pendingChunks = new Map();
    this.pendingMeta = false;
    this.pendingFloors = null;
    this.pendingSwitch = null;
    this.pendingSwitchChunks = [];
    if (meta) for (const l of [...this.metaListeners]) l();
    const emitChunks = (slot: FloorSlot, layer: TileLayerId, keys: readonly ChunkKey[]): void => {
      if (keys.length === 0) return;
      const event: ChunksChangedEvent = { layer, keys: [...keys] };
      if (slot === this.cur) for (const l of [...this.chunkListeners]) l(event);
      for (const l of [...this.floorChunkListeners]) l(slot.uid, event);
    };
    for (const item of switchedChunks) emitChunks(item.floor, item.layer, item.keys);
    for (const [slot, byLayer] of chunks) {
      if (!this.slots.includes(slot)) continue;
      for (const [layer, keys] of byLayer) emitChunks(slot, layer, [...keys]);
    }
    const scene = this.cur.scene.takeEvent();
    const event = mergeSceneEvents(switched, scene);
    if (event !== null) for (const l of [...this.sceneListeners]) l(event);
    if (floors !== null) for (const l of [...this.floorListeners]) l(floors);
  }

  // ---- Chunk (de)serialisation (12.2) ----------------------------------------------------

  /** Compresses every non-empty chunk. */
  async exportChunks(options: CompressionOptions = {}, floor?: string): Promise<SerializedChunk[]> {
    const out: SerializedChunk[] = [];
    const slot = floor === undefined ? this.cur : this.slotOf(floor);
    for (const layer of TILE_LAYERS) {
      for (const rec of this.layerChunks(layer, slot).values()) {
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
    floor?: string,
  ): Promise<void> {
    const decoded = await decodeChunk(data, {
      ...options,
      layer,
      paletteSize: this._palette.length,
    });
    this.putChunk(layer, key, decoded?.cells ?? null, decoded?.filled ?? 0, floor);
  }

  /** Loads an uncompressed raw block (4 104 bytes). */
  importRawChunk(layer: TileLayerId, key: ChunkKey, raw: Uint8Array, floor?: string): void {
    const decoded = decodeChunkRaw(raw, { layer, paletteSize: this._palette.length });
    this.putChunk(layer, key, decoded?.cells ?? null, decoded?.filled ?? 0, floor);
  }

  // ---- Internals -------------------------------------------------------------------------

  private applyOne(op: MapOp, rollback = false): { op: MapOp; inverse: MapOp | MapOp[] | null } {
    if (isSceneOp(op)) return this.sceneOf(op).apply(op, rollback);
    if (isNoteOp(op)) return this.notes.apply(op);
    return { op, inverse: this.applyTile(op) };
  }

  /** The scene of the floor an object / token / fog op targets. */
  private sceneOf(op: SceneOp): SceneState {
    switch (op.type) {
      case 'object.add':
        return this.slotOf(op.object.floor).scene;
      case 'maptoken.add':
        return this.slotOf(op.token.floor).scene;
      case 'fog.reveal':
      case 'fog.hide':
        return this.slotOf(op.floor).scene;
      case 'object.update':
      case 'object.remove':
        return (this.slotHolding('object', op.uid) ?? this.cur).scene;
      case 'maptoken.update':
      case 'maptoken.remove':
        return (this.slotHolding('token', op.uid) ?? this.cur).scene;
    }
  }

  private applyTile(op: MapOp): MapOp | MapOp[] | null {
    switch (op.type) {
      case 'floor.add':
        return this.floorAdd(op.floor);
      case 'floor.update':
        return this.floorUpdate(op.uid, op.patch);
      case 'floor.remove':
        return this.floorRemove(op.uid);
      case 'tiles.set': {
        const slot = this.slotOf(op.floor);
        if (!TILE_LAYERS.includes(op.layer)) {
          throw new MapOpError('unknown_layer', `Unknown tile layer ${String(op.layer)}`);
        }
        const prev = this.setCells(op.layer, op.cells, slot);
        return prev.length === 0
          ? null
          : { type: 'tiles.set', floor: slot.uid, layer: op.layer, cells: prev };
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
          for (const slot of this.slots) slot.scene.setAmbient(ambient.next);
        }
        if (layers === undefined && op.theme === undefined && ambient === null) return null;
        if (layers !== undefined || op.theme !== undefined) this.markMeta();
        return inverse;
      }
      default:
        throw new MapOpError('unknown_op', `Unknown op ${(op as { type: string }).type}`);
    }
  }

  // ---- Floor ops (P9a2) --------------------------------------------------------------

  private floorAdd(f: { uid: string; name: string; level: number }): MapOp {
    if (typeof f.uid !== 'string' || !FLOOR_UID.test(f.uid) || /^[0-9]+$/.test(f.uid)) {
      throw new MapOpError('bad_floor', `Invalid floor uid ${String(f.uid)}`);
    }
    if (this.slotOrUndefined(f.uid) !== undefined) {
      throw new MapOpError('floor_taken', `Floor uid ${f.uid} already used`);
    }
    this.checkFloorName(f.name);
    this.checkFloorLevel(f.level);
    if (this.slots.some((s) => s.level === f.level)) {
      throw new MapOpError('floor_taken', `Floor level ${f.level} already used`);
    }
    if (this.slots.length >= MAX_FLOORS) throw new MapOpError('floor_limit', 'Too many floors');
    const slot = this.newSlot(f.uid, null, f.name, f.level, this.cur.scene.ambient, true);
    slot.scene.setTokenDefs(this.cur.scene.tokenDefs());
    this.slots.push(slot);
    this.sortSlots();
    this.noteFloors(true, false);
    return { type: 'floor.remove', uid: f.uid };
  }

  private floorUpdate(uid: string, patch: { name?: string; level?: number }): MapOp | null {
    const slot = this.slotOf(uid);
    const inverse: { name?: string; level?: number } = {};
    if (patch.name !== undefined && patch.name !== slot.name) {
      this.checkFloorName(patch.name);
      inverse.name = slot.name;
    }
    if (patch.level !== undefined && patch.level !== slot.level) {
      this.checkFloorLevel(patch.level);
      if (this.slots.some((s) => s !== slot && s.level === patch.level)) {
        throw new MapOpError('floor_taken', `Floor level ${patch.level} already used`);
      }
      inverse.level = slot.level;
    }
    if (Object.keys(inverse).length === 0) return null;
    if (inverse.name !== undefined) slot.name = patch.name!;
    if (inverse.level !== undefined) slot.level = patch.level!;
    this.sortSlots();
    this.noteFloors(true, false);
    return { type: 'floor.update', uid: slot.uid, patch: inverse };
  }

  /** The inverse recreates the floor with all its content (the floor must be loaded). */
  private floorRemove(ref: string): MapOp[] {
    const slot = this.slotOf(ref);
    if (this.slots.length <= 1) throw new MapOpError('last_floor', 'Cannot remove the last floor');
    if (!slot.loaded) throw new MapOpError('floor_unloaded', 'The floor content is not loaded');
    const inverse = floorRecreateOps(slot);
    const wasCurrent = slot === this.cur;
    const index = this.slots.indexOf(slot);
    if (wasCurrent) {
      this.switchTo(this.slots[index === 0 ? 1 : 0]!);
    }
    this.slots.splice(this.slots.indexOf(slot), 1);
    this.pendingChunks.delete(slot);
    this.noteFloors(true, false);
    return inverse;
  }

  private checkFloorName(name: string): void {
    if (typeof name !== 'string' || name.trim() === '' || [...name].length > 60) {
      throw new MapOpError('bad_floor', 'Invalid floor name');
    }
  }

  private checkFloorLevel(level: number): void {
    if (!Number.isInteger(level) || level < -9 || level > 9) {
      throw new MapOpError('bad_floor', 'Invalid floor level');
    }
  }

  /** Next ambient and the inverse patch (previous values of the changed keys), or null. */
  private ambientChange(patch: AmbientPatch): { next: Ambient; inverse: AmbientPatch } | null {
    const cur = this.cur.scene.ambient;
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
    floor?: string,
  ): void {
    const slot = floor === undefined ? this.cur : this.slotOf(floor);
    const p = parseChunkKey(key);
    if (
      p === null ||
      p.cx * CHUNK_SIZE >= this.grid.width ||
      p.cy * CHUNK_SIZE >= this.grid.height
    ) {
      throw new MapOpError('bad_cell', `Chunk ${key} outside the map`);
    }
    const store = this.layerChunks(layer, slot);
    const nk = this.numKey(p.cx, p.cy);
    if (cells === null) store.delete(nk);
    else store.set(nk, { key: chunkKey(p.cx, p.cy), cells, filled });
    this.pendingSet(slot, layer).add(chunkKey(p.cx, p.cy));
    this.schedule();
  }

  private pendingSet(slot: FloorSlot, layer: TileLayerId): Set<ChunkKey> {
    let byLayer = this.pendingChunks.get(slot);
    if (byLayer === undefined) {
      byLayer = new Map();
      this.pendingChunks.set(slot, byLayer);
    }
    let set = byLayer.get(layer);
    if (set === undefined) {
      set = new Set();
      byLayer.set(layer, set);
    }
    return set;
  }

  private layerChunks(layer: TileLayerId, slot: FloorSlot = this.cur): Map<number, ChunkRecord> {
    const m = slot.chunks.get(layer);
    if (m === undefined)
      throw new MapOpError('unknown_layer', `Unknown tile layer ${String(layer)}`);
    return m;
  }

  private record(
    layer: TileLayerId,
    x: number,
    y: number,
    slot: FloorSlot = this.cur,
  ): ChunkRecord | undefined {
    return this.layerChunks(layer, slot).get(
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

function mergeSceneEvents(
  a: SceneChangedEvent | null,
  b: SceneChangedEvent | null,
): SceneChangedEvent | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    objects: [...new Set([...a.objects, ...b.objects])],
    tokens: [...new Set([...a.tokens, ...b.tokens])],
    fog: [...new Set([...a.fog, ...b.fog])],
    ambient: a.ambient || b.ambient,
    tokenDefs: a.tokenDefs || b.tokenDefs,
  };
}
