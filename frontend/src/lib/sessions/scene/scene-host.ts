/**
 * Keeps the right `SessionScene` for the successive states of a session: a new scene when the
 * map, the floor or the map revision changes (the engine then shows it with `setMap` /
 * `setScene`, see `onScene`), otherwise the same scene brought up to date.
 *
 * Wiring (see SessionSync): pass `host.wrapApi(api)` as the `api` of SessionSync (it records
 * the fog of every snapshot), `host.update` in `onState`, `host.effect` in `onEffect`.
 */
import type { ChunkKey } from '../../../editor/contracts';
import type { SessionEffect } from '../effects';
import type { SessionApi } from '../session-sync';
import type { SessionState } from '../state';
import type { SessionSnapshot } from '../types';
import { SessionScene, floorOf, type TileSource } from './session-scene';

export interface SceneHostOptions {
  readonly source: TileSource;
  /** The scene to show changed (null: nothing to show). Called before its tiles are loaded. */
  readonly onScene: (scene: SessionScene | null) => void;
  /** Blocks to load first (visible area of the engine camera), when known. */
  readonly visible?: () => readonly ChunkKey[] | undefined;
  /** Tile loading finished (`errors` > 0: some blocks are missing) or failed. */
  readonly onTiles?: (scene: SessionScene, errors: number) => void;
  readonly onError?: (error: unknown) => void;
}

export class SceneHost {
  private current: SessionScene | null = null;
  private fog: SessionSnapshot['fog'] | null = null;
  private disposed = false;

  constructor(private readonly o: SceneHostOptions) {}

  get scene(): SessionScene | null {
    return this.current;
  }

  /** Records the fog of a snapshot (applied by the next `update`). */
  noteSnapshot(snapshot: SessionSnapshot): void {
    this.fog = snapshot.fog;
  }

  /** `api` for SessionSync: same calls, the snapshots are noted. */
  wrapApi(api: SessionApi): SessionApi {
    return {
      get: (id, signal) => api.get(id, signal),
      presence: (id) => api.presence(id),
      actions: (id, actions, options) => api.actions(id, actions, options),
      snapshot: async (id, signal) => {
        const snapshot = await api.snapshot(id, signal);
        this.noteSnapshot(snapshot);
        return snapshot;
      },
    };
  }

  update(state: SessionState): void {
    if (this.disposed) return;
    const floor = floorOf(state);
    const fog = this.fog;
    this.fog = null;
    if (state.map === null || floor === null) {
      if (this.current !== null) this.replace(null);
      return;
    }
    const scene = this.current;
    if (scene !== null && scene.matches(state, floor)) {
      scene.sync(state);
      if (fog !== null) scene.importFog(fog);
      return;
    }
    const created = new SessionScene(state, floor);
    if (fog !== null) created.importFog(fog);
    this.replace(created);
    created
      .loadTiles(this.o.source, this.o.visible?.())
      .then((result) => {
        if (this.current === created) this.o.onTiles?.(created, result.errors);
      })
      .catch((error: unknown) => {
        if (this.current === created) this.o.onError?.(error);
      });
  }

  /** `fog` and `reload.chunks` effects. */
  effect(effect: SessionEffect): void {
    const pending = this.current?.applyEffect(effect, this.o.source) ?? null;
    pending?.catch((error: unknown) => this.o.onError?.(error));
  }

  dispose(): void {
    this.disposed = true;
    this.current?.dispose();
    this.current = null;
  }

  private replace(next: SessionScene | null): void {
    this.current?.dispose();
    this.current = next;
    this.o.onScene(next);
  }
}
