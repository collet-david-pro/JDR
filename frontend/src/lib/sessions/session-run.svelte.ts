/**
 * Reactive model of one session screen (GM console now, player view in P6f): links
 * SessionSync (snapshot, events, actions), the SceneHost (scene adapter for the engine) and
 * the few things the page shows (loading, kicked, text read aloud, reload notice).
 *
 * `state` and `scene` are raw values: never read their content through a $state proxy.
 */
import type { ChunkKey } from '../../editor/contracts';
import type { SyncClient } from '../realtime/types';
import type { BlockedMove } from './action-sender';
import type { SessionEffect } from './effects';
import { SceneHost, type SessionScene, type TileSource } from './scene';
import { SessionSync, type SessionApi } from './session-sync';
import type { SessionState } from './state';

export type RunPhase = 'loading' | 'ready' | 'error' | 'kicked';

export interface ReadAloud {
  readonly eventId: string;
  readonly title: string;
  readonly body: string;
}

export interface SessionRunOptions {
  readonly sessionId: string;
  readonly userId: string;
  readonly api: SessionApi;
  readonly sync: SyncClient;
  readonly tiles: TileSource;
  /** Blocks of the engine camera to load first. */
  readonly visible?: () => readonly ChunkKey[] | undefined;
  /** Error shown to the user (refused action, partial loading...). */
  readonly onProblem?: (error: unknown) => void;
  /** A token.move was refused by a wall (D8): the token was brought back (player view). */
  readonly onBlocked?: (move: BlockedMove) => void;
}

export class SessionRun {
  phase = $state<RunPhase>('loading');
  error = $state.raw<unknown>(null);
  state = $state.raw<SessionState | null>(null);
  scene = $state.raw<SessionScene | null>(null);
  /** Tile blocks being loaded. */
  tilesLoading = $state(false);
  tilesErrors = $state(0);
  /** Last text read aloud (note.read_aloud). */
  readAloud = $state.raw<ReadAloud | null>(null);
  /** The server asked the clients to reload (server.notice reload). */
  reloadAsked = $state(false);
  /** Counts the `reload.preload` effects (player: the map changed, preload again). */
  preloadAsked = $state(0);

  readonly sync: SessionSync;
  private readonly host: SceneHost;
  private stopped = false;

  constructor(private readonly o: SessionRunOptions) {
    this.host = new SceneHost({
      source: o.tiles,
      ...(o.visible === undefined ? {} : { visible: o.visible }),
      onScene: (scene) => {
        this.scene = scene;
        this.tilesLoading = scene !== null;
        this.tilesErrors = 0;
      },
      onTiles: (_scene, errors) => {
        this.tilesLoading = false;
        this.tilesErrors = errors;
      },
      onError: (error) => {
        this.tilesLoading = false;
        o.onProblem?.(error);
      },
    });
    this.sync = new SessionSync({
      sessionId: o.sessionId,
      userId: o.userId,
      api: this.host.wrapApi(o.api),
      sync: o.sync,
      onState: (state) => this.apply(state),
      onEffect: (effect) => this.effect(effect),
      onError: (error) => o.onProblem?.(error),
      ...(o.onBlocked === undefined ? {} : { onBlocked: o.onBlocked }),
    });
  }

  /** Loads the snapshot and subscribes; `phase` tells the result. */
  async start(): Promise<void> {
    try {
      const state = await this.sync.start();
      if (this.stopped) return;
      this.apply(state);
    } catch (error) {
      if (this.stopped) return;
      this.error = error;
      this.phase = 'error';
    }
  }

  stop(): void {
    this.stopped = true;
    this.sync.stop();
    this.host.dispose();
  }

  /** The page was hidden / shown. */
  setHidden(hidden: boolean): void {
    this.sync.setHidden(hidden);
  }

  /** Reads the session again (after a kick, a refused action...). */
  reload(): Promise<void> {
    return this.sync.reload();
  }

  private apply(state: SessionState): void {
    if (this.stopped) return;
    this.state = state;
    this.host.update(state);
    if (state.kicked) this.phase = 'kicked';
    else if (this.phase !== 'error') this.phase = 'ready';
  }

  private effect(effect: SessionEffect): void {
    switch (effect.kind) {
      case 'fog':
      case 'reload.chunks':
        this.host.effect(effect);
        return;
      case 'reload.preload':
        this.preloadAsked += 1;
        return;
      case 'read_aloud':
        this.readAloud = { eventId: effect.eventId, title: effect.title, body: effect.body };
        return;
      case 'kicked':
        this.phase = 'kicked';
        return;
      case 'notice':
        if (effect.notice === 'reload') this.reloadAsked = true;
        return;
      default:
        return;
    }
  }
}
