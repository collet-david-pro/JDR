/**
 * Local database `jdr` v1 (projet.md 13.5): a tiny promise layer over the native IndexedDB API
 * (no dependency). Object stores:
 * - pendingOps: map op batches not yet confirmed by the server, key [mapId, seq];
 * - chunkCache: compressed tile blocks of a map at a server revision, key mapId;
 * - prefs: local preferences, key `key`;
 * - drafts: unsent drafts, key `id`.
 * IndexedDB may be missing or refuse to open (private browsing, blocked storage): callers then
 * fall back to memory stores (lib/persistence/stores.ts).
 */

export const DB_NAME = 'jdr';
export const DB_VERSION = 1;
export const STORES = {
  pendingOps: 'pendingOps',
  chunkCache: 'chunkCache',
  prefs: 'prefs',
  drafts: 'drafts',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/** Opening may hang when another tab blocks an upgrade: give up after this delay. */
const OPEN_TIMEOUT_MS = 4000;

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORES.pendingOps)) {
    db.createObjectStore(STORES.pendingOps, { keyPath: ['mapId', 'seq'] });
  }
  if (!db.objectStoreNames.contains(STORES.chunkCache)) {
    db.createObjectStore(STORES.chunkCache, { keyPath: 'mapId' });
  }
  if (!db.objectStoreNames.contains(STORES.prefs)) {
    db.createObjectStore(STORES.prefs, { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains(STORES.drafts)) {
    db.createObjectStore(STORES.drafts, { keyPath: 'id' });
  }
}

let shared: Promise<IDBDatabase | null> | null = null;

/** Opens (once) the `jdr` database; null when IndexedDB is unavailable. */
export function openJdrDb(factory?: IDBFactory | null): Promise<IDBDatabase | null> {
  if (factory === undefined && shared !== null) return shared;
  const idb = factory === undefined ? (globalThis.indexedDB ?? null) : factory;
  const opening = new Promise<IDBDatabase | null>((resolve) => {
    if (idb === null) {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (db: IDBDatabase | null): void => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => done(null), OPEN_TIMEOUT_MS);
    try {
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => upgrade(request.result);
      request.onsuccess = () => {
        const db = request.result;
        // Another tab upgrades the database: let it, we reopen next time.
        db.onversionchange = () => {
          db.close();
          shared = null;
        };
        done(db);
      };
      request.onerror = () => done(null);
      request.onblocked = () => undefined;
    } catch {
      done(null);
    }
  });
  if (factory === undefined) shared = opening;
  return opening;
}

/** Promise of an IDBRequest. */
export function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Runs `body` in a transaction and resolves once the transaction has committed. */
export function transact<T>(
  db: IDBDatabase,
  store: StoreName,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(store, mode);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let result: T | undefined;
    const request = body(tx.objectStore(store));
    if (request) request.onsuccess = () => (result = request.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Asks the browser not to evict the local data (projet.md 13.5). Never throws. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = (globalThis.navigator as Navigator | undefined)?.storage;
    if (storage?.persist === undefined) return false;
    if ((await storage.persisted?.()) === true) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
