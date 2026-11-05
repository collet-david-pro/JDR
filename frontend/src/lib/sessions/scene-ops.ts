/**
 * Applies the ops of a `map.ops` event (GM, channel map:{id}) to the replica: objects and placed
 * tokens are patched; what the replica does not hold (tile blocks, palette, grid, layers, fog
 * bitmaps) comes back as effects. Revision rule of the editor (SceneView): after an update the
 * object / token carries `rev + 1`.
 */
import { CHUNK_SIZE, type MapObject, type PlacedToken } from '../../editor/contracts';
import type { WireMapOp } from '../types';
import { NO_EFFECTS, type SessionEffect } from './effects';
import type { SessionState } from './state';

export interface OpsResult {
  readonly objects: SessionState['objects'];
  readonly tokens: SessionState['tokens'];
  readonly notes: SessionState['notes'];
  readonly revealed: SessionState['revealed'];
  readonly ambient: SessionState['ambient'];
  readonly effects: readonly SessionEffect[];
}

/** Applies map operations to the session scene. */
export function applyMapOps(
  state: SessionState,
  mapId: string,
  ops: readonly WireMapOp[],
): OpsResult {
  let objects = state.objects;
  let tokens = state.tokens;
  let ambient = state.ambient;
  let notes = state.notes;
  let revealed = state.revealed;
  const effects: SessionEffect[] = [];
  const blocks = new Map<string, { floor: string; cx: number; cy: number }>();
  // Ops designate a floor by its id or its uid (the editor sends uids); the replica keeps ids.
  const floors = state.map?.floors ?? [];
  const floorId = (ref: string): string =>
    floors.find((f) => f.id === ref || f.uid === ref)?.id ?? ref;
  let reload = false;
  let editedObjects = false;
  let editedTokens = false;
  const objs = (): Record<string, MapObject> => {
    if (!editedObjects) {
      objects = { ...objects };
      editedObjects = true;
    }
    return objects as Record<string, MapObject>;
  };
  const toks = (): Record<string, PlacedToken> => {
    if (!editedTokens) {
      tokens = { ...tokens };
      editedTokens = true;
    }
    return tokens as Record<string, PlacedToken>;
  };

  for (const op of ops) {
    switch (op.type) {
      case 'object.add':
        objs()[op.object.uid] = { ...op.object, floor: floorId(op.object.floor), rev: 1 };
        break;
      case 'object.update': {
        const current = objects[op.uid];
        if (current !== undefined) {
          objs()[op.uid] = { ...current, ...op.patch, rev: op.rev + 1 } as MapObject;
        }
        break;
      }
      case 'object.remove':
        if (op.uid in objects) delete objs()[op.uid];
        break;
      case 'maptoken.add':
        toks()[op.token.uid] = { ...op.token, floor: floorId(op.token.floor), rev: 1 };
        break;
      case 'maptoken.update': {
        const current = tokens[op.uid];
        if (current !== undefined) {
          toks()[op.uid] = { ...current, ...op.patch, rev: op.rev + 1 } as PlacedToken;
        }
        break;
      }
      case 'maptoken.remove':
        if (op.uid in tokens) delete toks()[op.uid];
        break;
      case 'note.add': {
        const n = op.note;
        notes = {
          ...notes,
          [n.uid]: {
            uid: n.uid,
            title: n.title,
            body: n.body,
            asset_id: n.asset_id ?? null,
            audience: n.audience ?? 'gm',
            audience_users: n.audience === 'players' ? (n.audience_users ?? []) : [],
            read_aloud: n.read_aloud ?? false,
          },
        };
        break;
      }
      case 'note.update': {
        const current = notes[op.uid];
        if (current === undefined) break;
        const next = { ...current, ...op.patch } as typeof current;
        if ('audience' in next && op.patch.audience !== undefined) {
          const users =
            op.patch.audience === 'players' ? (op.patch.audience_users ?? next.audience_users) : [];
          (next as { audience_users: readonly string[] }).audience_users = users;
        }
        notes = { ...notes, [op.uid]: next };
        break;
      }
      case 'note.remove':
        if (op.uid in notes) {
          notes = { ...notes };
          delete (notes as Record<string, unknown>)[op.uid];
        }
        break;
      case 'secrets.reset': {
        const kept = revealed.filter((uid) => {
          const type = objects[uid]?.type;
          return type !== 'trap' && type !== 'secret';
        });
        if (kept.length !== revealed.length) revealed = kept;
        break;
      }
      case 'tiles.set':
        for (const [x, y] of op.cells) {
          const cx = Math.floor((x ?? 0) / CHUNK_SIZE);
          const cy = Math.floor((y ?? 0) / CHUNK_SIZE);
          const floor = floorId(op.floor);
          blocks.set(`${floor}:${cx}:${cy}`, { floor, cx, cy });
        }
        break;
      case 'fog.reveal':
      case 'fog.hide':
        effects.push({
          kind: 'fog',
          mapId,
          floorId: floorId(op.floor),
          op: op.type === 'fog.reveal' ? 'reveal' : 'hide',
          chunks: op.chunks,
        });
        break;
      case 'map.meta': {
        if (op.ambient !== undefined && ambient !== null) {
          const patch = op.ambient;
          ambient = {
            ...ambient,
            ...patch,
            weather:
              patch.weather === undefined
                ? ambient.weather
                : { ...ambient.weather, ...patch.weather },
          } as SessionState['ambient'];
        }
        if (
          op.name !== undefined ||
          op.grid !== undefined ||
          op.layers !== undefined ||
          op.theme !== undefined
        ) {
          reload = true;
        }
        break;
      }
      case 'palette.add':
        reload = true;
        break;
      // Floors changed (added, renamed, re-levelled, deleted with its content): read the map again.
      case 'floor.add':
      case 'floor.update':
      case 'floor.remove':
        reload = true;
        break;
    }
  }
  if (blocks.size > 0) effects.push({ kind: 'reload.chunks', mapId, chunks: [...blocks.values()] });
  if (reload) effects.push({ kind: 'reload.snapshot', reason: 'map_reload' });
  return {
    objects,
    tokens,
    notes,
    revealed,
    ambient,
    effects: effects.length === 0 ? NO_EFFECTS : effects,
  };
}
