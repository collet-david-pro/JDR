/**
 * P5 content of the edited floor (objects, placed tokens, fog, ambient, token definitions),
 * owned by MapDocument (never in a Svelte $state, projet.md 13.2). Values are frozen and
 * replaced on change, so `===` detects changes (SceneView contract).
 *
 * Rev rule (contracts.ts SceneView): every local object.update / maptoken.update increments
 * `rev`; the op actually applied (returned by `apply`) carries the rev the edit was based on,
 * which is what the server compares with its own.
 */
import {
  CHUNK_SIZE,
  type Ambient,
  type ChunkKey,
  type FogBitmap,
  type FogChunkWire,
  type MapObject,
  type MapOp,
  type PlacedToken,
  type SceneChangedEvent,
  type TokenDefView,
} from '../contracts';
import { FOG_RAW_BYTES, createFogBitmap, isFogEmpty } from '../../formats/fog-codec';
import { decodeFogData, fogOps } from './fog-wire';
import { MapOpError, chunkKey, parseChunkKey } from './ops';
import {
  MAX_OBJECTS,
  MAX_PLACED_TOKENS,
  changedObjectPatch,
  changedTokenPatch,
  normalizeObject,
  normalizeToken,
  objectInversePatch,
  patchObject,
  patchToken,
  sameValue,
  tokenInversePatch,
  type Bounds,
} from './scene-values';

export type SceneOp = Extract<
  MapOp,
  {
    type:
      | 'object.add'
      | 'object.update'
      | 'object.remove'
      | 'maptoken.add'
      | 'maptoken.update'
      | 'maptoken.remove'
      | 'fog.reveal'
      | 'fog.hide';
  }
>;

const SCENE_OP_TYPES: ReadonlySet<string> = new Set([
  'object.add',
  'object.update',
  'object.remove',
  'maptoken.add',
  'maptoken.update',
  'maptoken.remove',
  'fog.reveal',
  'fog.hide',
]);

export function isSceneOp(op: MapOp): op is SceneOp {
  return SCENE_OP_TYPES.has(op.type);
}

/** Result of one op: the op as applied (rev stamped) and its inverse (null = no change). */
export interface SceneApplied {
  readonly op: MapOp;
  readonly inverse: MapOp | null;
}

function compareObjects(a: MapObject, b: MapObject): number {
  return a.sort_order - b.sort_order || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
}

export class SceneState {
  private readonly objectMap = new Map<string, MapObject>();
  private readonly tokenMap = new Map<string, PlacedToken>();
  private readonly defs = new Map<string, TokenDefView>();
  private readonly fog = new Map<ChunkKey, FogBitmap>();
  /** Changes not made by this editor's history (conflicts, reloads): see History. */
  private readonly foreign = new Map<string, number>();
  private sortedCache: readonly MapObject[] | null = null;
  private tokensCache: readonly PlacedToken[] | null = null;
  private _ambient: Ambient;
  private _sceneRevision = 0;
  private pendingObjects = new Set<string>();
  private pendingTokens = new Set<string>();
  private pendingFog = new Set<ChunkKey>();
  private pendingAmbient = false;
  private pendingDefs = false;

  constructor(
    readonly floor: string,
    private readonly bounds: Bounds,
    ambient: Ambient,
    /** Called after every change (the document bumps its revision and schedules a flush). */
    private readonly changed: () => void,
  ) {
    this._ambient = ambient;
  }

  // ---- Read side (SceneView) -------------------------------------------------------------

  get sceneRevision(): number {
    return this._sceneRevision;
  }
  get ambient(): Ambient {
    return this._ambient;
  }
  objects(): readonly MapObject[] {
    this.sortedCache ??= Object.freeze([...this.objectMap.values()].sort(compareObjects));
    return this.sortedCache;
  }
  object(uid: string): MapObject | undefined {
    return this.objectMap.get(uid);
  }
  tokens(): readonly PlacedToken[] {
    this.tokensCache ??= Object.freeze([...this.tokenMap.values()]);
    return this.tokensCache;
  }
  token(uid: string): PlacedToken | undefined {
    return this.tokenMap.get(uid);
  }
  tokenDef(tokenId: string): TokenDefView | null {
    return this.defs.get(tokenId) ?? null;
  }
  tokenDefs(): readonly TokenDefView[] {
    return [...this.defs.values()];
  }
  fogKeys(): readonly ChunkKey[] {
    return [...this.fog.keys()];
  }
  fogChunk(key: ChunkKey): FogBitmap | null {
    return this.fog.get(key) ?? null;
  }
  /** Counter of foreign changes of an object / token (`object:<uid>` or `token:<uid>`). */
  foreignStamp(key: string): number {
    return this.foreign.get(key) ?? 0;
  }

  /** Pending change event (null when nothing changed); resets the pending state. */
  takeEvent(): SceneChangedEvent | null {
    if (
      this.pendingObjects.size === 0 &&
      this.pendingTokens.size === 0 &&
      this.pendingFog.size === 0 &&
      !this.pendingAmbient &&
      !this.pendingDefs
    ) {
      return null;
    }
    const event: SceneChangedEvent = {
      objects: [...this.pendingObjects],
      tokens: [...this.pendingTokens],
      fog: [...this.pendingFog],
      ambient: this.pendingAmbient,
      tokenDefs: this.pendingDefs,
    };
    this.pendingObjects = new Set();
    this.pendingTokens = new Set();
    this.pendingFog = new Set();
    this.pendingAmbient = false;
    this.pendingDefs = false;
    return event;
  }

  // ---- Ops -------------------------------------------------------------------------------

  /**
   * `rollback`: the op is the inverse of an op just applied by a failing batch: revs are
   * restored instead of incremented, so the state is exactly what it was.
   */
  apply(op: SceneOp, rollback = false): SceneApplied {
    switch (op.type) {
      case 'object.add': {
        const o = op.object;
        this.checkFloor(o.floor);
        if (this.objectMap.has(o.uid)) {
          throw new MapOpError('object_exists', `Object ${o.uid} already exists`);
        }
        if (this.objectMap.size >= MAX_OBJECTS) throw new MapOpError('bad_object', 'Too many');
        const value = normalizeObject(
          { ...o, rev: rollback ? o.rev : 1 } as MapObject,
          this.bounds,
        );
        this.putObject(value);
        return { op: { type: 'object.add', object: value }, inverse: objectRemove(o.uid) };
      }
      case 'object.update': {
        const cur = this.objectMap.get(op.uid);
        if (cur === undefined) return { op, inverse: null }; // deleted meanwhile: removal wins
        const patch = changedObjectPatch(cur, op.patch);
        if (Object.keys(patch).length === 0) return { op: { ...op, rev: cur.rev }, inverse: null };
        const next = patchObject(cur, patch, this.bounds);
        const rev = rollback ? Math.max(1, op.rev - 1) : cur.rev + 1;
        this.putObject(Object.freeze({ ...next, rev }));
        return {
          op: { type: 'object.update', uid: op.uid, rev: cur.rev, patch },
          inverse: {
            type: 'object.update',
            uid: op.uid,
            rev: cur.rev + 1,
            patch: objectInversePatch(cur, patch),
          },
        };
      }
      case 'object.remove': {
        const cur = this.objectMap.get(op.uid);
        if (cur === undefined) return { op, inverse: null };
        this.deleteObject(op.uid);
        return { op, inverse: { type: 'object.add', object: cur } };
      }
      case 'maptoken.add': {
        const t = op.token;
        this.checkFloor(t.floor);
        if (this.tokenMap.has(t.uid)) {
          throw new MapOpError('object_exists', `Token ${t.uid} already placed`);
        }
        if (this.tokenMap.size >= MAX_PLACED_TOKENS) {
          throw new MapOpError('bad_object', 'Too many tokens');
        }
        const value = normalizeToken({ ...t, rev: rollback ? t.rev : 1 }, this.bounds);
        this.putToken(value);
        return {
          op: { type: 'maptoken.add', token: value },
          inverse: { type: 'maptoken.remove', uid: t.uid },
        };
      }
      case 'maptoken.update': {
        const cur = this.tokenMap.get(op.uid);
        if (cur === undefined) return { op, inverse: null };
        const patch = changedTokenPatch(cur, op.patch);
        if (Object.keys(patch).length === 0) return { op: { ...op, rev: cur.rev }, inverse: null };
        const next = patchToken(cur, patch, this.bounds);
        const rev = rollback ? Math.max(1, op.rev - 1) : cur.rev + 1;
        this.putToken(Object.freeze({ ...next, rev }));
        return {
          op: { type: 'maptoken.update', uid: op.uid, rev: cur.rev, patch },
          inverse: {
            type: 'maptoken.update',
            uid: op.uid,
            rev: cur.rev + 1,
            patch: tokenInversePatch(cur, patch),
          },
        };
      }
      case 'maptoken.remove': {
        const cur = this.tokenMap.get(op.uid);
        if (cur === undefined) return { op, inverse: null };
        this.deleteToken(op.uid);
        return { op, inverse: { type: 'maptoken.add', token: cur } };
      }
      case 'fog.reveal':
      case 'fog.hide':
        return this.applyFog(op.type, op.floor, op.chunks);
    }
  }

  // ---- Non-undoable updates (load, conflicts, reset) ------------------------------------

  /** Replaces the whole content (load). Objects / tokens of other floors are ignored. */
  load(objects: readonly MapObject[], tokens: readonly PlacedToken[]): { skipped: number } {
    let skipped = 0;
    for (const uid of [...this.objectMap.keys()]) this.deleteObject(uid);
    for (const uid of [...this.tokenMap.keys()]) this.deleteToken(uid);
    for (const o of objects) {
      if (o.floor !== this.floor) continue;
      try {
        this.putObject(normalizeObject(o, this.bounds));
        this.bumpForeign(`object:${o.uid}`);
      } catch {
        skipped++;
      }
    }
    for (const t of tokens) {
      if (t.floor !== this.floor) continue;
      try {
        this.putToken(normalizeToken(t, this.bounds));
        this.bumpForeign(`token:${t.uid}`);
      } catch {
        skipped++;
      }
    }
    return { skipped };
  }

  /** Server state of an object after a conflict (null: it no longer exists). */
  replaceObject(uid: string, value: MapObject | null): void {
    this.bumpForeign(`object:${uid}`);
    if (value === null || value.floor !== this.floor) {
      if (this.objectMap.has(uid)) this.deleteObject(uid);
      return;
    }
    this.putObject(normalizeObject(value, this.bounds));
  }

  replaceToken(uid: string, value: PlacedToken | null): void {
    this.bumpForeign(`token:${uid}`);
    if (value === null || value.floor !== this.floor) {
      if (this.tokenMap.has(uid)) this.deleteToken(uid);
      return;
    }
    this.putToken(normalizeToken(value, this.bounds));
  }

  setTokenDefs(defs: readonly TokenDefView[]): void {
    this.defs.clear();
    for (const d of defs) this.defs.set(d.id, Object.freeze({ ...d }));
    this.pendingDefs = true;
    this.changed();
  }

  setAmbient(ambient: Ambient): void {
    if (sameValue(ambient, this._ambient)) return;
    this._ambient = ambient;
    this.pendingAmbient = true;
    this.changed();
  }

  /** Loaded fog chunk (OR with what is there: replayed ops may already have set bits). */
  importFog(key: ChunkKey, bits: FogBitmap): void {
    this.checkChunk(key);
    if (bits.length !== FOG_RAW_BYTES) throw new MapOpError('bad_fog', 'Invalid fog size');
    const cur = this.fog.get(key);
    if (cur === undefined) {
      if (isFogEmpty(bits)) return;
      this.fog.set(key, bits.slice());
    } else {
      const next = cur.slice();
      for (let i = 0; i < FOG_RAW_BYTES; i++) next[i]! |= bits[i]!;
      this.fog.set(key, next);
    }
    this.pendingFog.add(key);
    this.changed();
  }

  /** Whole fog of the floor cleared (GM reset, already done on the server). */
  clearFog(): void {
    if (this.fog.size === 0) return;
    for (const key of this.fog.keys()) this.pendingFog.add(key);
    this.fog.clear();
    this.changed();
  }

  // ---- Internals -------------------------------------------------------------------------

  private applyFog(
    type: 'fog.reveal' | 'fog.hide',
    floor: string,
    chunks: readonly FogChunkWire[],
  ): SceneApplied {
    this.checkFloor(floor);
    // Decode everything first: an invalid chunk must leave the fog untouched.
    const decoded = chunks.map(([cx, cy, data]) => {
      const key = chunkKey(cx, cy);
      this.checkChunk(key);
      return { key, bits: decodeFogData(data) };
    });
    const changes = new Map<ChunkKey, FogBitmap>();
    for (const { key, bits } of decoded) {
      const cur = this.fog.get(key) ?? null;
      let next: FogBitmap | null = null;
      let diff = changes.get(key) ?? null;
      for (let i = 0; i < FOG_RAW_BYTES; i++) {
        const c = next !== null ? next[i]! : cur === null ? 0 : cur[i]!;
        const d = type === 'fog.reveal' ? bits[i]! & ~c : bits[i]! & c;
        if (d === 0) continue;
        next ??= cur === null ? createFogBitmap() : cur.slice();
        diff ??= createFogBitmap();
        diff[i]! |= d;
        next[i] = type === 'fog.reveal' ? c | d : c & ~d;
      }
      if (next === null) continue;
      if (diff !== null) changes.set(key, diff);
      if (isFogEmpty(next)) this.fog.delete(key);
      else this.fog.set(key, next);
      this.pendingFog.add(key);
    }
    if (changes.size === 0) return { op: { type, floor, chunks }, inverse: null };
    this.changed();
    const inverseType = type === 'fog.reveal' ? 'fog.hide' : 'fog.reveal';
    const inverse = fogOps(inverseType, floor, changes);
    // fogOps splits at 200 chunks; the history accepts several inverse ops through a group.
    return {
      op: { type, floor, chunks },
      inverse: inverse.length === 1 ? inverse[0]! : mergeFogOps(inverseType, floor, inverse),
    };
  }

  private checkFloor(floor: string): void {
    if (floor !== this.floor) throw new MapOpError('unknown_floor', `Unknown floor ${floor}`);
  }

  private checkChunk(key: ChunkKey): void {
    const p = parseChunkKey(key);
    if (
      p === null ||
      p.cx * CHUNK_SIZE >= this.bounds.width ||
      p.cy * CHUNK_SIZE >= this.bounds.height
    ) {
      throw new MapOpError('bad_fog', `Fog chunk ${key} outside the map`);
    }
  }

  private putObject(o: MapObject): void {
    this.objectMap.set(o.uid, o);
    this.sortedCache = null;
    this.objectChanged(o.uid);
  }

  private deleteObject(uid: string): void {
    this.objectMap.delete(uid);
    this.sortedCache = null;
    this.objectChanged(uid);
  }

  private putToken(t: PlacedToken): void {
    this.tokenMap.set(t.uid, t);
    this.tokensCache = null;
    this.tokenChanged(t.uid);
  }

  private deleteToken(uid: string): void {
    this.tokenMap.delete(uid);
    this.tokensCache = null;
    this.tokenChanged(uid);
  }

  private objectChanged(uid: string): void {
    this._sceneRevision++;
    this.pendingObjects.add(uid);
    this.changed();
  }

  private tokenChanged(uid: string): void {
    this._sceneRevision++;
    this.pendingTokens.add(uid);
    this.changed();
  }

  private bumpForeign(key: string): void {
    this.foreign.set(key, (this.foreign.get(key) ?? 0) + 1);
  }
}

function objectRemove(uid: string): MapOp {
  return { type: 'object.remove', uid };
}

/** One fog op with every chunk (the inverse of one op stays one op; ≤ 200 chunks anyway). */
function mergeFogOps(type: 'fog.reveal' | 'fog.hide', floor: string, ops: readonly MapOp[]): MapOp {
  const chunks: FogChunkWire[] = [];
  for (const op of ops) if (op.type === type) chunks.push(...op.chunks);
  return { type, floor, chunks };
}
