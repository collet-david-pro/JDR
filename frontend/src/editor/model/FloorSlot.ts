/**
 * One floor of the edited map (P9a2): its tile blocks and its scene content (objects, placed tokens,
 * fog). The document keeps every floor in memory once loaded, so that ops can target any floor (undo
 * across floors) while the engine only shows the current one.
 */
import {
  CHUNK_SIZE,
  type ChunkKey,
  type FogBitmap,
  type MapOp,
  type TileCell,
  type TileLayerId,
} from '../contracts';
import { CELL_STRIDE, TILE_LAYERS } from '../../formats/chunk-codec';
import { fogOps } from './fog-wire';
import type { SceneState } from './SceneState';

export interface ChunkRecord {
  readonly key: ChunkKey;
  readonly cells: Uint16Array;
  filled: number;
}

/** A floor as the editor lists it. `id` is null for a floor created in this session (not reloaded yet). */
export interface FloorMeta {
  readonly uid: string;
  readonly id: string | null;
  readonly name: string;
  readonly level: number;
  /** Tiles and fog are in memory (false: the floor must be fetched before it is shown or deleted). */
  readonly loaded: boolean;
}

export class FloorSlot {
  readonly chunks = new Map<TileLayerId, Map<number, ChunkRecord>>();
  loaded: boolean;

  constructor(
    readonly uid: string,
    public id: string | null,
    public name: string,
    public level: number,
    readonly scene: SceneState,
    loaded: boolean,
  ) {
    this.loaded = loaded;
    for (const l of TILE_LAYERS) this.chunks.set(l, new Map());
  }

  get meta(): FloorMeta {
    return { uid: this.uid, id: this.id, name: this.name, level: this.level, loaded: this.loaded };
  }

  /** Whether `ref` (uid or server id) designates this floor. */
  owns(ref: string): boolean {
    return this.scene.refs.has(ref);
  }

  /** Keys of the non-empty blocks of a layer. */
  chunkKeys(layer: TileLayerId): ChunkKey[] {
    return [...(this.chunks.get(layer)?.values() ?? [])].map((r) => r.key);
  }

  /** Every keyed block of every layer (changed-keys of a switch). */
  allChunkKeys(): Map<TileLayerId, ChunkKey[]> {
    const out = new Map<TileLayerId, ChunkKey[]>();
    for (const l of TILE_LAYERS) out.set(l, this.chunkKeys(l));
    return out;
  }
}

/**
 * Ops that recreate a floor with all its content (inverse of floor.remove): floor.add, one tiles.set
 * per non-empty block, the objects and placed tokens (designating the floor by its uid, the server gives
 * a new id to a re-created floor) and the fog.
 */
export function floorRecreateOps(slot: FloorSlot): MapOp[] {
  const uid = slot.uid;
  const ops: MapOp[] = [{ type: 'floor.add', floor: { uid, name: slot.name, level: slot.level } }];
  for (const layer of TILE_LAYERS) {
    const records = [...(slot.chunks.get(layer)?.values() ?? [])].sort((a, b) =>
      a.key < b.key ? -1 : 1,
    );
    for (const rec of records) {
      const [cx, cy] = rec.key.split(':').map(Number) as [number, number];
      const cells: TileCell[] = [];
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const o = (ly * CHUNK_SIZE + lx) * CELL_STRIDE;
          const index = rec.cells[o]!;
          if (index === 0) continue;
          cells.push([
            cx * CHUNK_SIZE + lx,
            cy * CHUNK_SIZE + ly,
            index,
            rec.cells[o + 1]!,
            rec.cells[o + 2]!,
          ]);
        }
      }
      if (cells.length > 0) ops.push({ type: 'tiles.set', floor: uid, layer, cells });
    }
  }
  for (const object of slot.scene.objects()) {
    ops.push({ type: 'object.add', object: { ...object, floor: uid } });
  }
  for (const token of slot.scene.tokens()) {
    ops.push({ type: 'maptoken.add', token: { ...token, floor: uid } });
  }
  const fog = new Map<ChunkKey, FogBitmap>();
  for (const key of slot.scene.fogKeys()) {
    const bits = slot.scene.fogChunk(key);
    if (bits !== null) fog.set(key, bits);
  }
  if (fog.size > 0) ops.push(...fogOps('fog.reveal', uid, fog));
  return ops;
}
