/**
 * Loading of the tile blocks of a map (projet.md 11.4 "Chargement", 13.5): from the local cache
 * when it holds the server revision, otherwise from GET /maps/{id}/chunks — the visible blocks
 * first, then the others in the background, nearest first.
 */
import { CHUNK_SIZE, type CameraState, type ChunkKey, type GridSpec } from '../contracts';
import type { MapDocument } from '../model/MapDocument';
import type { ChunkCacheStore, CachedChunk } from '../../lib/persistence/map-stores';
import type { ChunkRecord } from '../../formats/chunk-stream';

/** Blocks per request after the visible ones (keeps URLs short: "cx:cy," ≤ 8 characters). */
export const CHUNK_GROUP_SIZE = 96;

export interface ChunkFetchResult {
  readonly records: readonly ChunkRecord[];
  readonly revision: number | null;
}

export interface ChunkLoadOptions {
  readonly doc: MapDocument;
  readonly mapId: string;
  readonly floor: string;
  /** Server revision of the metadata (GET /maps/{id}). */
  readonly revision: number;
  /** null = every block of the floor. */
  readonly fetch: (cells: readonly ChunkKey[] | null) => Promise<ChunkFetchResult>;
  readonly cache?: ChunkCacheStore | null;
  /** Blocks to load first (visible area). */
  readonly visible?: readonly ChunkKey[];
  readonly onProgress?: (done: number, total: number) => void;
  readonly groupSize?: number;
}

export interface ChunkLoadResult {
  readonly source: 'cache' | 'network';
  /** Blocks that could not be decoded (skipped). */
  readonly errors: number;
  /** The blocks answered with another revision (someone wrote meanwhile). */
  readonly revisionMismatch: boolean;
}

/** Every block address of a map. */
export function allChunkKeys(grid: Pick<GridSpec, 'width' | 'height'>): ChunkKey[] {
  const out: ChunkKey[] = [];
  const cw = Math.ceil(grid.width / CHUNK_SIZE);
  const ch = Math.ceil(grid.height / CHUNK_SIZE);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) out.push(`${cx}:${cy}`);
  return out;
}

/** Blocks shown by the camera in a viewport of `width × height` CSS pixels. */
export function visibleChunkKeys(
  grid: GridSpec,
  camera: CameraState,
  viewport: { readonly width: number; readonly height: number },
): ChunkKey[] {
  const cellScreen = grid.cellPx * camera.zoom;
  if (!(cellScreen > 0) || viewport.width <= 0 || viewport.height <= 0) return allChunkKeys(grid);
  const halfW = viewport.width / cellScreen / 2;
  const halfH = viewport.height / cellScreen / 2;
  const maxCx = Math.ceil(grid.width / CHUNK_SIZE) - 1;
  const maxCy = Math.ceil(grid.height / CHUNK_SIZE) - 1;
  const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, v));
  const x0 = clamp(Math.floor((camera.x - halfW) / CHUNK_SIZE), maxCx);
  const x1 = clamp(Math.floor((camera.x + halfW) / CHUNK_SIZE), maxCx);
  const y0 = clamp(Math.floor((camera.y - halfH) / CHUNK_SIZE), maxCy);
  const y1 = clamp(Math.floor((camera.y + halfH) / CHUNK_SIZE), maxCy);
  const out: ChunkKey[] = [];
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) out.push(`${cx}:${cy}`);
  return out;
}

function parseKey(key: ChunkKey): [number, number] {
  const [x, y] = key.split(':');
  return [Number(x), Number(y)];
}

/** `rest` sorted by distance to the centre of `around`. */
function nearestFirst(rest: ChunkKey[], around: readonly ChunkKey[]): ChunkKey[] {
  if (around.length === 0) return rest;
  let sx = 0;
  let sy = 0;
  for (const k of around) {
    const [x, y] = parseKey(k);
    sx += x;
    sy += y;
  }
  const cx = sx / around.length;
  const cy = sy / around.length;
  const d = (k: ChunkKey): number => {
    const [x, y] = parseKey(k);
    return (x - cx) ** 2 + (y - cy) ** 2;
  };
  return [...rest].sort((a, b) => d(a) - d(b));
}

export async function loadMapChunks(options: ChunkLoadOptions): Promise<ChunkLoadResult> {
  const { doc, mapId, floor, revision } = options;
  let errors = 0;
  const importAll = async (records: readonly CachedChunk[]): Promise<void> => {
    for (const r of records) {
      try {
        await doc.importChunk(r.layer, r.key, r.data);
      } catch (error) {
        errors++;
        console.error(error);
      }
    }
  };

  const cached = await options.cache?.get(mapId).catch(() => null);
  if (cached != null && cached.revision === revision && cached.floor === floor) {
    await importAll(cached.chunks);
    options.onProgress?.(1, 1);
    return { source: 'cache', errors, revisionMismatch: false };
  }

  const all = allChunkKeys(doc.grid);
  const allSet = new Set(all);
  const visible = (options.visible ?? all).filter((k) => allSet.has(k));
  const visibleSet = new Set(visible);
  const rest = nearestFirst(
    all.filter((k) => !visibleSet.has(k)),
    visible,
  );
  const size = Math.max(1, options.groupSize ?? CHUNK_GROUP_SIZE);
  const groups: (readonly ChunkKey[] | null)[] = [];
  if (rest.length === 0) groups.push(null);
  else {
    if (visible.length > 0) groups.push(visible);
    for (let i = 0; i < rest.length; i += size) groups.push(rest.slice(i, i + size));
  }

  const received: CachedChunk[] = [];
  let mismatch = false;
  let done = 0;
  options.onProgress?.(0, groups.length);
  for (const cells of groups) {
    const answer = await options.fetch(cells);
    if (answer.revision !== null && answer.revision !== revision) mismatch = true;
    const chunks = answer.records.map((r) => ({
      layer: r.layer,
      key: r.key,
      data: r.data.slice(),
    }));
    await importAll(chunks);
    received.push(...chunks);
    options.onProgress?.(++done, groups.length);
  }
  if (!mismatch && errors === 0 && options.cache) {
    await options.cache
      .put({ mapId, revision, floor, chunks: received })
      .catch((e: unknown) => console.error(e));
  }
  return { source: 'network', errors, revisionMismatch: mismatch };
}
