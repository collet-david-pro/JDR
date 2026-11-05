/**
 * Persistence of a server map in the editor (projet.md 15.1, 13.5): loads the tile blocks
 * (cache or network, visible first), applies again the ops left unconfirmed by a previous page,
 * then feeds the persistent queue with every op of the history and follows the page lifecycle
 * (online/offline, hidden page, unload).
 */
import type { ChunkKey, MapOp, TileLayerId } from '../contracts';
import type { EditorSession } from '../ui/session';
import type { MapsClient } from '../../lib/maps/maps-client';
import type { MapStores } from '../../lib/persistence/map-stores';
import type { MapDetail, MapOpConflict } from '../../lib/types';
import { decodeFog, fogFromBase64 } from '../../formats/fog-codec';
import type { FloorMeta } from '../model/FloorSlot';
import { MapOpError, chunkKey } from '../model/ops';
import { loadMapChunks, type ChunkLoadResult } from './chunk-loader';
import { OpsQueue, type QueueEvents, type TransportError } from './OpsQueue';

/** Delay before the chunk cache is refreshed once everything is saved. */
const CACHE_REFRESH_MS = 3000;

export interface LifecycleTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface MapSyncOptions {
  readonly session: EditorSession;
  readonly map: MapDetail;
  /** `fog` (P5) is optional for callers without fog (tests). */
  readonly client: Pick<MapsClient, 'chunks' | 'sendOps'> & Partial<Pick<MapsClient, 'fog'>>;
  readonly stores: MapStores;
  /** window (online, offline, pagehide, beforeunload). */
  readonly win?: LifecycleTarget;
  /** document (visibilitychange). */
  readonly doc?: LifecycleTarget & { readonly visibilityState?: string };
  /** Notice shown when the server refuses a batch. */
  readonly onRejected?: (error: TransportError) => void;
  readonly onReloadRequired?: () => void;
  /** Every op is confirmed by the server (after a confirmed batch): thumbnail refresh (P4c). */
  readonly onSaved?: (revision: number) => void;
  /** P5: some ops were refused because the object changed on the server (already resolved). */
  readonly onConflicts?: (conflicts: readonly MapOpConflict[]) => void;
}

export interface MapSyncStart {
  readonly chunks: ChunkLoadResult;
  /** Ops applied again from the local queue. */
  readonly replayed: number;
  /** Replayed ops that no longer apply (skipped). */
  readonly replayFailed: number;
  /** P5: fog chunks that could not be loaded (-1: the whole request failed). */
  readonly fogErrors: number;
}

/** Orchestrates map saving: loads chunks, queues operations and reports save status. */
export class MapSync {
  readonly queue: OpsQueue;
  private readonly session: EditorSession;
  private readonly map: MapDetail;
  private readonly client: MapSyncOptions['client'];
  private readonly stores: MapStores;
  private readonly win: LifecycleTarget | undefined;
  private readonly doc: MapSyncOptions['doc'];
  private readonly floor: string;
  private readonly offs: (() => void)[] = [];
  private cacheTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly onSaved: ((revision: number) => void) | undefined;

  constructor(options: MapSyncOptions) {
    this.session = options.session;
    this.map = options.map;
    this.client = options.client;
    this.stores = options.stores;
    this.win = options.win;
    this.doc = options.doc;
    this.floor = options.session.doc.floor;
    this.onSaved = options.onSaved;
    const events: QueueEvents = {
      onRejected: (_batch, error) => options.onRejected?.(error),
      onReloadRequired: () => options.onReloadRequired?.(),
      onConflicts: (conflicts) => {
        this.session.resolveConflicts(conflicts);
        options.onConflicts?.(conflicts);
      },
      onConfirmed: (revision, inSync) => this.confirmed(revision, inSync),
    };
    this.queue = new OpsQueue({
      mapId: this.map.id,
      revision: this.map.revision,
      store: this.stores.pending,
      transport: {
        send: (body, { keepalive }) => this.client.sendOps(this.map.id, body, { keepalive }),
      },
      ...events,
    });
  }

  /**
   * Loads the map content and starts saving. `visible`: blocks shown first.
   * Pointer edits stay blocked until everything is loaded and replayed.
   */
  async start(visible: readonly ChunkKey[] | null = null): Promise<MapSyncStart> {
    const { session } = this;
    session.setEditable(false);
    const pending = await this.queue.restore();
    session.doc.loadScene(this.map.objects ?? [], this.map.tokens_placed ?? []);
    session.doc.notes.load(this.map.notes ?? []);
    const fog = this.loadFog();
    const chunks = await loadMapChunks({
      doc: session.doc,
      mapId: this.map.id,
      floor: this.floor,
      revision: this.map.revision,
      cache: this.stores.chunks,
      ...(visible !== null ? { visible } : {}),
      fetch: (cells) =>
        this.client.chunks(this.map.id, {
          floor: this.floor,
          ...(cells !== null ? { cells } : {}),
        }),
      onProgress: (done, total) => {
        session.ui.loading = done >= total ? null : { done, total };
      },
    });
    const fogErrors = await fog;
    session.ui.loading = null;
    // Pending ops on another floor need its content in memory first (they are applied on top of it).
    let preloadFailed = 0;
    for (const meta of this.floorsOf(pending)) {
      try {
        await this.loadFloor(meta);
        session.doc.markFloorLoaded(meta.uid);
      } catch (error) {
        console.error(error);
        preloadFailed++;
      }
    }
    const { replayed, replayFailed: failed } = this.replay(pending);
    const replayFailed = failed + preloadFailed;
    if (this.disposed) return { chunks, replayed, replayFailed, fogErrors };
    session.refreshPalette();
    this.offs.push(
      session.history.onOps((ops: readonly MapOp[]) => this.queue.push(ops)),
      this.queue.onStatus((status) => (session.ui.save = status)),
    );
    this.listen();
    session.floors.setLoader((meta) => this.loadFloor(meta));
    session.setEditable(true);
    if (this.queue.hasUnconfirmed) void this.queue.flush();
    return { chunks, replayed, replayFailed, fogErrors };
  }

  /**
   * Fetches the tiles and the fog of a floor that is not in memory yet (a floor created in this
   * session is already complete). Rejects when the server cannot be reached.
   */
  async loadFloor(meta: FloorMeta): Promise<void> {
    const { doc } = this.session;
    const ref = meta.uid;
    const target = {
      grid: doc.grid,
      importChunk: (layer: TileLayerId, key: ChunkKey, data: Uint8Array) =>
        doc.importChunk(layer, key, data, {}, ref),
    };
    const result = await loadMapChunks({
      doc: target,
      mapId: this.map.id,
      floor: ref,
      revision: this.map.revision,
      fetch: (cells) =>
        this.client.chunks(this.map.id, { floor: ref, ...(cells !== null ? { cells } : {}) }),
    });
    if (result.errors > 0) throw new Error('Some blocks of the floor could not be decoded');
    const fogErrors = await this.loadFog(ref);
    if (fogErrors !== 0) throw new Error('The fog of the floor could not be loaded');
  }

  /** Floors (other than the shown one) not in memory that the ops of the local queue target. */
  private floorsOf(pending: readonly { ops: readonly MapOp[] }[]): FloorMeta[] {
    const doc = this.session.doc;
    const out = new Map<string, FloorMeta>();
    const note = (ref: string): void => {
      const meta = doc.floorMeta(ref);
      if (meta !== undefined && !meta.loaded) out.set(meta.uid, meta);
    };
    for (const batch of pending) {
      for (const op of batch.ops) {
        if (op.type === 'tiles.set' || op.type === 'fog.reveal' || op.type === 'fog.hide')
          note(op.floor);
        else if (op.type === 'floor.remove') note(op.uid);
      }
    }
    return [...out.values()];
  }

  /** The server revision moved outside the queue (fog reset): later batches build on it. */
  noteRevision(revision: number): void {
    this.queue.noteRevision(revision);
  }

  /**
   * Sends every pending op now and waits for the answers (before a snapshot, a restoration or
   * an export). Resolves true when nothing is left unconfirmed, false otherwise (offline,
   * refused, paused).
   */
  async settle(): Promise<boolean> {
    if (this.disposed) return false;
    await this.queue.flush();
    return !this.queue.hasUnconfirmed;
  }

  /** Leaving the editor inside the application: last send, then stop. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (this.cacheTimer !== null) clearTimeout(this.cacheTimer);
    const queue = this.queue;
    if (queue.hasUnconfirmed) {
      void queue.flush().finally(() => queue.dispose());
    } else {
      queue.dispose();
    }
  }

  // ---- Internals -------------------------------------------------------------------------

  /** Explored fog of the floor (P5). Returns the number of chunks that failed. */
  private async loadFog(floor: string = this.floor): Promise<number> {
    const fetchFog = this.client.fog;
    if (fetchFog === undefined) return 0;
    let chunks;
    try {
      chunks = (await fetchFog.call(this.client, this.map.id, floor)).chunks;
    } catch (error) {
      console.error(error);
      return -1;
    }
    let errors = 0;
    for (const [cx, cy, data] of chunks) {
      try {
        const bits = await decodeFog(fogFromBase64(data));
        if (!this.disposed) this.session.doc.importFog(chunkKey(cx, cy), bits, floor);
      } catch (error) {
        console.error(error);
        errors++;
      }
    }
    return errors;
  }

  /**
   * Applies again the ops of the local queue. A palette.add whose index was taken meanwhile by
   * another asset gets a free index (the following cells follow it); ops that no longer apply
   * are dropped. A changed batch is rewritten in the queue (new client_op_id).
   */
  private replay(pending: readonly { seq: number; ops: readonly MapOp[] }[]): {
    replayed: number;
    replayFailed: number;
  } {
    const doc = this.session.doc;
    const remap = new Map<number, number>();
    let replayed = 0;
    let replayFailed = 0;
    for (const batch of pending) {
      let changed = false;
      const out: MapOp[] = [];
      for (const original of batch.ops) {
        let op = original;
        if (op.type === 'tiles.set' && remap.size > 0 && op.cells.some((c) => remap.has(c[2]))) {
          op = {
            ...op,
            cells: op.cells.map((c) => {
              const to = remap.get(c[2]);
              return to === undefined ? c : ([c[0], c[1], to, c[3], c[4]] as const);
            }),
          };
          changed = true;
        }
        try {
          doc.applyOps([op]);
          out.push(op);
          replayed++;
        } catch (error) {
          changed = true;
          if (
            op.type === 'palette.add' &&
            error instanceof MapOpError &&
            error.code === 'palette_conflict'
          ) {
            const { index, op: add } = doc.paletteIndexFor(op.asset_id);
            remap.set(op.index, index);
            if (add !== null) {
              doc.applyOps([add]);
              out.push(add);
            }
            replayed++;
          } else {
            replayFailed++;
          }
        }
      }
      if (changed) this.queue.rewrite(batch.seq, out);
    }
    return { replayed, replayFailed };
  }

  private listen(): void {
    const on = (target: LifecycleTarget | undefined, type: string, fn: (e: Event) => void) => {
      if (target === undefined) return;
      target.addEventListener(type, fn);
      this.offs.push(() => target.removeEventListener(type, fn));
    };
    on(this.win, 'online', () => this.queue.online());
    on(this.win, 'offline', () => this.queue.goneOffline());
    on(this.win, 'pagehide', () => this.queue.flushOnHide());
    on(this.win, 'beforeunload', (event) => {
      if (!this.queue.hasUnconfirmed) return;
      this.queue.flushOnHide();
      event.preventDefault();
      try {
        // Older browsers need returnValue set.
        (event as BeforeUnloadEvent).returnValue = '';
      } catch {
        // Read-only outside a real BeforeUnloadEvent.
      }
    });
    on(this.doc, 'visibilitychange', () => {
      if (this.doc?.visibilityState === 'hidden') this.queue.flushOnHide();
    });
  }

  /** Everything is saved and nobody else wrote: refresh the local copy of the blocks. */
  private confirmed(revision: number, inSync: boolean): void {
    if (!this.queue.hasUnconfirmed) this.onSaved?.(revision);
    if (this.cacheTimer !== null) clearTimeout(this.cacheTimer);
    this.cacheTimer = null;
    if (!inSync) {
      void this.stores.chunks.delete(this.map.id).catch(() => undefined);
      return;
    }
    this.cacheTimer = setTimeout(() => {
      this.cacheTimer = null;
      void this.refreshCache(revision);
    }, CACHE_REFRESH_MS);
  }

  private async refreshCache(revision: number): Promise<void> {
    const doc = this.session.doc;
    const before = doc.revision;
    if (this.queue.hasUnconfirmed || this.queue.serverRevision !== revision) return;
    // The cache holds the floor loaded first; gone (deleted floor) = nothing to refresh.
    const first = doc.floorMeta(this.floor);
    if (first === undefined || !first.loaded) return;
    try {
      const chunks = await doc.exportChunks({}, this.floor);
      if (doc.revision !== before || this.queue.hasUnconfirmed) return;
      await this.stores.chunks.put({ mapId: this.map.id, revision, floor: this.floor, chunks });
    } catch (error) {
      console.error(error);
    }
  }
}
