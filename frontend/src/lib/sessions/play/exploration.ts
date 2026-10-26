/**
 * Fog exploration of the player (projet.md 14.2): the visibility of the player's tokens is
 * rasterised and the newly explored bits are applied to the local document (optimistic) and
 * sent as `fog.reveal` session actions, grouped every 500 ms. Nothing happens unless the
 * session is running.
 */
import type { MapOp, VisibleScene } from '../../../editor/contracts';
import { FogExplorer, type ExplorerClock } from '../../../editor/ui/exploration';
import type { SessionScene } from '../scene/session-scene';
import type { SessionAction } from '../types';

export interface PlayerExplorerOptions {
  readonly scene: SessionScene;
  /** The session is running (not lobby, paused or ended). */
  readonly active: () => boolean;
  readonly send: (actions: SessionAction[]) => void;
  readonly clock?: ExplorerClock;
  readonly intervalMs?: number;
}

export class PlayerExplorer {
  private readonly explorer: FogExplorer;

  constructor(private readonly o: PlayerExplorerOptions) {
    this.explorer = new FogExplorer(o.scene.doc, (ops) => this.apply(ops), o.clock, o.intervalMs);
  }

  /** A visibility computed by the engine. */
  push(visible: VisibleScene): void {
    if (!this.o.active()) return;
    this.explorer.push(visible);
  }

  dispose(): void {
    this.explorer.dispose(true);
  }

  private apply(ops: readonly MapOp[]): void {
    if (!this.o.active()) return;
    const actions: SessionAction[] = [];
    for (const op of ops) {
      if (op.type !== 'fog.reveal') continue;
      actions.push({ type: 'fog.reveal', floor: op.floor, chunks: op.chunks });
    }
    if (actions.length === 0) return;
    try {
      this.o.scene.doc.applyOps(ops);
    } catch (error) {
      console.error(error);
    }
    this.o.send(actions);
  }
}
