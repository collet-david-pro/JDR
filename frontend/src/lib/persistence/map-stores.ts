/**
 * Local stores of the map editor (projet.md 13.5, 15.1): pending op batches and the chunk cache,
 * in IndexedDB (`jdr` v1) or in memory when IndexedDB is unavailable.
 *
 * tiles.set cells are stored packed in a Uint16Array (x, y, index, variant, flags per cell:
 * maps are ≤ 400 cells per side, indexes are u16, variants and flags u8), which IndexedDB
 * clones much faster than arrays of tuples.
 */
import type { ChunkKey, MapOp, TileCell, TileLayerId } from '../../editor/contracts';
import { STORES, openJdrDb, requestPromise, transact } from './idb';

/** A batch of ops waiting for the server's confirmation. */
export interface PendingBatch {
  readonly mapId: string;
  /** Sending order (increasing). */
  readonly seq: number;
  readonly clientOpId: string;
  readonly ops: readonly MapOp[];
  /** Revision the batch was built against; null until it is sent for the first time. */
  readonly baseRevision: number | null;
  /** Sent at least once: its content and client_op_id never change any more. */
  readonly sealed: boolean;
}

export interface PendingOpsStore {
  /** Batches of a map, by seq. */
  list(mapId: string): Promise<PendingBatch[]>;
  put(batch: PendingBatch): Promise<void>;
  delete(mapId: string, seq: number): Promise<void>;
  /** False for the memory fallback (lost when the page closes). */
  readonly durable: boolean;
}

export interface CachedChunk {
  readonly layer: TileLayerId;
  readonly key: ChunkKey;
  readonly data: Uint8Array;
}

/** Server tile blocks of a map at a revision. */
export interface ChunkCacheEntry {
  readonly mapId: string;
  readonly revision: number;
  readonly floor: string;
  readonly chunks: readonly CachedChunk[];
}

export interface ChunkCacheStore {
  get(mapId: string): Promise<ChunkCacheEntry | null>;
  put(entry: ChunkCacheEntry): Promise<void>;
  delete(mapId: string): Promise<void>;
}

/* ---- Packing ------------------------------------------------------------------------- */

type StoredOp =
  | Exclude<MapOp, { type: 'tiles.set' }>
  | {
      readonly type: 'tiles.set';
      readonly floor: string;
      readonly layer: TileLayerId;
      readonly packed: Uint16Array;
    };

interface StoredBatch extends Omit<PendingBatch, 'ops'> {
  readonly ops: readonly StoredOp[];
}

export function packCells(cells: readonly TileCell[]): Uint16Array {
  const out = new Uint16Array(cells.length * 5);
  for (let i = 0, o = 0; i < cells.length; i++, o += 5) {
    const c = cells[i]!;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = c[3];
    out[o + 4] = c[4];
  }
  return out;
}

export function unpackCells(packed: Uint16Array): TileCell[] {
  const out: TileCell[] = [];
  for (let o = 0; o + 4 < packed.length; o += 5) {
    out.push([packed[o]!, packed[o + 1]!, packed[o + 2]!, packed[o + 3]!, packed[o + 4]!]);
  }
  return out;
}

export function packBatch(batch: PendingBatch): StoredBatch {
  return {
    ...batch,
    ops: batch.ops.map((op) =>
      op.type === 'tiles.set'
        ? { type: 'tiles.set', floor: op.floor, layer: op.layer, packed: packCells(op.cells) }
        : op,
    ),
  };
}

export function unpackBatch(stored: StoredBatch): PendingBatch {
  return {
    ...stored,
    ops: stored.ops.map((op) =>
      op.type === 'tiles.set'
        ? { type: 'tiles.set', floor: op.floor, layer: op.layer, cells: unpackCells(op.packed) }
        : op,
    ),
  };
}

/* ---- Memory fallback ----------------------------------------------------------------- */

export class MemoryPendingOpsStore implements PendingOpsStore {
  readonly durable: boolean = false;
  private readonly rows = new Map<string, StoredBatch>();

  list(mapId: string): Promise<PendingBatch[]> {
    const out = [...this.rows.values()]
      .filter((b) => b.mapId === mapId)
      .sort((a, b) => a.seq - b.seq)
      .map((b) => unpackBatch(structuredClone(b)));
    return Promise.resolve(out);
  }

  put(batch: PendingBatch): Promise<void> {
    this.rows.set(`${batch.mapId}\u0000${batch.seq}`, structuredClone(packBatch(batch)));
    return Promise.resolve();
  }

  delete(mapId: string, seq: number): Promise<void> {
    this.rows.delete(`${mapId}\u0000${seq}`);
    return Promise.resolve();
  }

  /** Test helper: number of stored batches. */
  get size(): number {
    return this.rows.size;
  }
}

export class MemoryChunkCacheStore implements ChunkCacheStore {
  private readonly rows = new Map<string, ChunkCacheEntry>();

  get(mapId: string): Promise<ChunkCacheEntry | null> {
    return Promise.resolve(this.rows.get(mapId) ?? null);
  }

  put(entry: ChunkCacheEntry): Promise<void> {
    this.rows.set(entry.mapId, entry);
    return Promise.resolve();
  }

  delete(mapId: string): Promise<void> {
    this.rows.delete(mapId);
    return Promise.resolve();
  }
}

/* ---- IndexedDB ----------------------------------------------------------------------- */

class IdbPendingOpsStore implements PendingOpsStore {
  readonly durable = true;
  constructor(private readonly db: IDBDatabase) {}

  async list(mapId: string): Promise<PendingBatch[]> {
    const range = IDBKeyRange.bound([mapId, -Infinity], [mapId, Infinity]);
    const rows = await transact<StoredBatch[]>(this.db, STORES.pendingOps, 'readonly', (s) =>
      s.getAll(range),
    );
    return (rows ?? []).sort((a, b) => a.seq - b.seq).map(unpackBatch);
  }

  async put(batch: PendingBatch): Promise<void> {
    await transact(this.db, STORES.pendingOps, 'readwrite', (s) => s.put(packBatch(batch)));
  }

  async delete(mapId: string, seq: number): Promise<void> {
    await transact(this.db, STORES.pendingOps, 'readwrite', (s) => s.delete([mapId, seq]));
  }
}

class IdbChunkCacheStore implements ChunkCacheStore {
  constructor(private readonly db: IDBDatabase) {}

  async get(mapId: string): Promise<ChunkCacheEntry | null> {
    const tx = this.db.transaction(STORES.chunkCache, 'readonly');
    const row = await requestPromise<ChunkCacheEntry | undefined>(
      tx.objectStore(STORES.chunkCache).get(mapId),
    );
    return row ?? null;
  }

  async put(entry: ChunkCacheEntry): Promise<void> {
    await transact(this.db, STORES.chunkCache, 'readwrite', (s) => s.put(entry));
  }

  async delete(mapId: string): Promise<void> {
    await transact(this.db, STORES.chunkCache, 'readwrite', (s) => s.delete(mapId));
  }
}

export interface MapStores {
  readonly pending: PendingOpsStore;
  readonly chunks: ChunkCacheStore;
}

let memory: MapStores | null = null;

/**
 * IndexedDB stores, or memory stores when IndexedDB cannot be opened (shared by the whole
 * page, so that pending ops survive a navigation inside the application).
 */
export async function openMapStores(factory?: IDBFactory | null): Promise<MapStores> {
  const db = await openJdrDb(factory);
  if (db === null) {
    memory ??= { pending: new MemoryPendingOpsStore(), chunks: new MemoryChunkCacheStore() };
    return memory;
  }
  return { pending: new IdbPendingOpsStore(db), chunks: new IdbChunkCacheStore(db) };
}
