/**
 * Persistence of a server map in the editor (projet.md 15.1, 13.5): loads the tile blocks
 * (cache or network, visible first), applies again the ops left unconfirmed by a previous page,
 * then feeds the persistent queue with every op of the history and follows the page lifecycle
 * (online/offline, hidden page, unload).
 */
import type { ChunkKey, MapOp } from '../contracts';
import type { EditorSession } from '../ui/session';
import type { MapsClient } from '../../lib/maps/maps-client';
import type { MapStores } from '../../lib/persistence/map-stores';
import type { MapDetail } from '../../lib/types';
import { MapOpError } from '../model/ops';
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
  readonly client: Pick<MapsClient, 'chunks' | 'sendOps'>;
  readonly stores: MapStores;
  /** window (online, offline, pagehide, beforeunload). */
  readonly win?: LifecycleTarget;
  /** document (visibilitychange). */
  readonly doc?: LifecycleTarget & { readonly visibilityState?: string };
  /** Notice shown when the server refuses a batch. */
  readonly onRejected?: (error: TransportError) => void;
  readonly onReloadRequired?: () => void;
}

export interface MapSyncStart {
  readonly chunks: ChunkLoadResult;
  /** Ops applied again from the local queue. */
  readonly replayed: number;
  /** Replayed ops that no longer apply (skipped). */
  readonly replayFailed: number;
}

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

  constructor(options: MapSyncOptions) {
    this.session = options.session;
    this.map = options.map;
    this.client = options.client;
    this.stores = options.stores;
    this.win = options.win;
    this.doc = options.doc;
    this.floor = options.session.doc.floor;
    const events: QueueEvents = {
      onRejected: (_batch, error) => options.onRejected?.(error),
      onReloadRequired: () => options.onReloadRequired?.(),
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
    session.ui.loading = null;
    const { replayed, replayFailed } = this.replay(pending);
    if (this.disposed) return { chunks, replayed, replayFailed };
    session.refreshPalette();
    this.offs.push(
      session.history.onOps((ops: readonly MapOp[]) => this.queue.push(ops)),
      this.queue.onStatus((status) => (session.ui.save = status)),
    );
    this.listen();
    session.setEditable(true);
    if (this.queue.hasUnconfirmed) void this.queue.flush();
    return { chunks, replayed, replayFailed };
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
    try {
      const chunks = await doc.exportChunks();
      if (doc.revision !== before || this.queue.hasUnconfirmed) return;
      await this.stores.chunks.put({ mapId: this.map.id, revision, floor: this.floor, chunks });
    } catch (error) {
      console.error(error);
    }
  }
}
