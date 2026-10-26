/**
 * Scene adapter of a session (shared by the GM console, P6e, and the player view, P6f).
 *
 * One `SessionScene` shows one floor of one map for the scene engine. It owns a read-only
 * `MapDocument` (which implements `MapView` and `SceneView`, like in the editor) and keeps it
 * in line with:
 * - the `SessionState` (objects, tokens, token definitions, ambient): `sync(state)` applies
 *   the differences by identity (the reducer keeps the identity of what did not change);
 * - the tile blocks (`loadTiles`, `reloadChunks` for the `reload.chunks` effect);
 * - the fog (`importFog` for `snapshot.fog`, `applyEffect` for the `fog` effect).
 *
 * The document is never mutated by the UI: all changes come from the server.
 */
import type {
  ChunkKey,
  FogChunkWire,
  MapObject,
  MapOp,
  PlacedToken,
  TokenDefView,
} from '../../../editor/contracts';
import { decodeFogData } from '../../../editor/model/fog-wire';
import { MapDocument } from '../../../editor/model/MapDocument';
import { chunkKey } from '../../../editor/model/ops';
import { loadMapChunks, type ChunkLoadResult } from '../../../editor/sync/chunk-loader';
import {
  gridOf,
  layersFromWire,
  paletteFromWire,
  themeOf,
  tokenDefFromWire,
} from '../../../editor/sync/wire';
import { TILE_LAYERS } from '../../../formats/chunk-codec';
import type { MapsClient } from '../../maps/maps-client';
import type { MapDetail } from '../../types';
import type { SessionEffect } from '../effects';
import type { SessionState } from '../state';
import type { SessionSnapshot } from '../types';

/** What the scene needs to fetch tile blocks. */
export type TileSource = Pick<MapsClient, 'chunks'>;

/** Bytes of an uncompressed, empty tile block (clears a block that became empty). */
const EMPTY_RAW_BLOCK = 4104;

/** Floor shown for a state: the session floor, else the first floor of the map. */
export function floorOf(state: SessionState): string | null {
  if (state.map === null) return null;
  return state.session.current_floor_id ?? state.map.floors[0]?.id ?? null;
}

export class SessionScene {
  /** The document the engine shows (`setMap(doc)`, `setScene(doc)`). */
  readonly doc: MapDocument;
  readonly mapId: string;
  readonly floor: string;
  /** Server revision of the map head the tiles were read for. */
  readonly mapRevision: number;

  private objects: Readonly<Record<string, MapObject>> = {};
  private tokens: Readonly<Record<string, PlacedToken>> = {};
  private definitions: SessionState['definitions'] | null = null;
  private ambient: SessionState['ambient'] | undefined;
  private readonly frozen = new Set<string>();
  private readonly role: SessionState['role'];
  private abort = new AbortController();
  private disposed = false;

  constructor(state: SessionState, floor: string) {
    const map = state.map;
    if (map === null) throw new Error('SessionScene needs a map');
    this.mapId = map.id;
    this.role = state.role;
    this.floor = floor;
    this.mapRevision = map.revision;
    this.doc = new MapDocument({
      grid: gridOf(map as Pick<MapDetail, 'grid'>),
      floor,
      layers: layersFromWire(map.layers),
      palette: paletteFromWire(map.palette),
      theme: themeOf(map.theme),
      ...(state.ambient === null ? {} : { ambient: state.ambient }),
    });
    this.ambient = state.ambient;
    this.doc.loadScene(
      Object.values(state.objects).map((o) => this.shown(o)),
      Object.values(state.tokens),
    );
    this.objects = state.objects;
    this.tokens = state.tokens;
    this.sync(state);
  }

  /** Same map, floor and tiles: the scene can be kept for this state. */
  matches(state: SessionState, floor: string | null): boolean {
    return (
      state.map !== null &&
      state.map.id === this.mapId &&
      floor === this.floor &&
      state.map.revision === this.mapRevision
    );
  }

  // ---- State ----------------------------------------------------------------------------

  /** Brings objects, tokens, definitions and ambient to the state (differences only). */
  sync(state: SessionState): void {
    if (this.disposed) return;
    if (state.definitions !== this.definitions) {
      this.definitions = state.definitions;
      const defs: TokenDefView[] = Object.values(state.definitions).map(tokenDefFromWire);
      this.doc.setTokenDefs(defs);
    }
    if (state.objects !== this.objects) {
      const previous = this.objects;
      for (const [uid, value] of Object.entries(state.objects)) {
        if (previous[uid] === value) continue;
        if (value.floor === this.floor || previous[uid]?.floor === this.floor) {
          this.safely(() => this.doc.replaceObject(uid, this.shown(value)));
        }
      }
      for (const uid of Object.keys(previous)) {
        if (state.objects[uid] === undefined) this.safely(() => this.doc.replaceObject(uid, null));
      }
      this.objects = state.objects;
    }
    if (state.tokens !== this.tokens) {
      const previous = this.tokens;
      const next: Record<string, PlacedToken> = { ...state.tokens };
      for (const [uid, value] of Object.entries(state.tokens)) {
        if (previous[uid] === value) continue;
        if (this.frozen.has(uid)) {
          // Being dragged here: the preview wins until release().
          next[uid] = previous[uid] ?? value;
          continue;
        }
        this.safely(() => this.doc.replaceToken(uid, value));
      }
      for (const uid of Object.keys(previous)) {
        if (state.tokens[uid] === undefined) {
          this.frozen.delete(uid);
          this.safely(() => this.doc.replaceToken(uid, null));
        }
      }
      this.tokens = next;
    }
    if (state.ambient !== this.ambient) {
      this.ambient = state.ambient;
      if (state.ambient !== null) {
        const ambient = state.ambient as NonNullable<
          Extract<MapOp, { type: 'map.meta' }>['ambient']
        >;
        this.doc.applyOps([{ type: 'map.meta', ambient }]);
      }
    }
  }

  /**
   * The server sends a secret door to a player only once revealed (an unrevealed one comes as a
   * wall): a door received by a player is a real door, not the wall `props.secret` makes of it
   * in the vision of the editor's "player view".
   */
  private shown(object: MapObject): MapObject {
    if (this.role !== 'player' || object.type !== 'door' || !object.props.secret) return object;
    return { ...object, props: { ...object.props, secret: false } };
  }

  /** An invalid value from the server must not stop the other updates. */
  private safely(change: () => void): void {
    try {
      change();
    } catch (error) {
      console.error(error);
    }
  }

  // ---- Local drag preview ---------------------------------------------------------------

  /** Moves a token locally while it is dragged (state updates for it are held back). */
  preview(uid: string, x: number, y: number): void {
    const token = this.doc.token(uid);
    if (token === undefined || this.disposed) return;
    this.frozen.add(uid);
    this.doc.replaceToken(uid, { ...token, x, y });
  }

  /** The drag ended: the state is applied again for this token at the next sync. */
  release(uid: string): void {
    this.frozen.delete(uid);
  }

  /** A move was refused: shows the token where the server has it. */
  revert(uid: string): void {
    this.frozen.delete(uid);
    const server = this.tokens[uid];
    if (server === undefined || this.disposed) return;
    this.safely(() => this.doc.replaceToken(uid, server));
  }

  /** The placed token at `uid` as the document shows it (preview included). */
  token(uid: string): PlacedToken | undefined {
    return this.doc.token(uid);
  }

  // ---- Tiles ----------------------------------------------------------------------------

  /** Loads every tile block (visible ones first when given). */
  loadTiles(
    source: TileSource,
    visible?: readonly ChunkKey[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<ChunkLoadResult> {
    const signal = this.abort.signal;
    return loadMapChunks({
      doc: this.doc,
      mapId: this.mapId,
      floor: this.floor,
      revision: this.mapRevision,
      cache: null,
      ...(visible === undefined ? {} : { visible }),
      ...(onProgress === undefined ? {} : { onProgress }),
      fetch: (cells) =>
        source.chunks(this.mapId, {
          floor: this.floor,
          signal,
          ...(cells === null ? {} : { cells }),
        }),
    });
  }

  /** `reload.chunks`: fetches these blocks again (a block that became empty is cleared). */
  async reloadChunks(
    source: TileSource,
    chunks: readonly { floor: string; cx: number; cy: number }[],
  ): Promise<void> {
    const keys = [
      ...new Set(chunks.filter((c) => c.floor === this.floor).map((c) => chunkKey(c.cx, c.cy))),
    ];
    if (keys.length === 0 || this.disposed) return;
    const answer = await source.chunks(this.mapId, {
      floor: this.floor,
      cells: keys,
      signal: this.abort.signal,
    });
    if (this.disposed) return;
    const seen = new Set<string>();
    for (const record of answer.records) {
      seen.add(`${record.layer}/${record.key}`);
      await this.doc.importChunk(record.layer, record.key, record.data.slice());
    }
    const empty = new Uint8Array(EMPTY_RAW_BLOCK);
    for (const key of keys) {
      for (const layer of TILE_LAYERS) {
        if (seen.has(`${layer}/${key}`)) continue;
        try {
          this.doc.importRawChunk(layer, key, empty);
        } catch {
          /* nothing to clear */
        }
      }
    }
  }

  // ---- Fog ------------------------------------------------------------------------------

  /** Replaces the fog by the snapshot's (floor of the snapshot must be this floor). */
  importFog(fog: SessionSnapshot['fog']): void {
    if (this.disposed || fog.floor !== this.floor) return;
    this.doc.clearFog();
    for (const [cx, cy, data] of fog.chunks) {
      try {
        this.doc.importFog(chunkKey(cx, cy), decodeFogData(data));
      } catch (error) {
        console.error(error);
      }
    }
  }

  /** Reveals (OR) or hides (AND NOT) fog bits. */
  applyFog(op: 'reveal' | 'hide', chunks: readonly FogChunkWire[]): void {
    if (this.disposed || chunks.length === 0) return;
    try {
      this.doc.applyOps([
        { type: op === 'reveal' ? 'fog.reveal' : 'fog.hide', floor: this.floor, chunks },
      ]);
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Applies the effects that concern the scene (`fog`, `reload.chunks`); other effects are
   * ignored. Returns the pending tile reload, if any.
   */
  applyEffect(effect: SessionEffect, source: TileSource): Promise<void> | null {
    if (effect.kind === 'fog') {
      if (effect.mapId === this.mapId && effect.floorId === this.floor) {
        this.applyFog(effect.op, effect.chunks);
      }
      return null;
    }
    if (effect.kind === 'reload.chunks' && effect.mapId === this.mapId) {
      return this.reloadChunks(source, effect.chunks);
    }
    return null;
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
  }
}
