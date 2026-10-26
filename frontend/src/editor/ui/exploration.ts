/**
 * Fog exploration in the editor (etapes/P05 LANCEMENT, projet.md 14.2): the current visibility
 * of the viewers is rasterised (4×4 sub-cells per cell) and the newly explored bits leave as
 * fog.reveal ops grouped every 500 ms, outside the undo history.
 */
import type { ChunkKey, FogBitmap, MapOp, VisibleScene } from '../contracts';
import { fogRasterizers } from '../../vision/index';
import { effectiveFog, fogOps, mergeFog } from '../model/fog-wire';

export const EXPLORE_FLUSH_MS = 500;

export interface ExplorerTarget {
  readonly floor: string;
  readonly grid: { readonly width: number; readonly height: number };
  fogChunk(key: ChunkKey): FogBitmap | null;
}

export interface ExplorerClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: ExplorerClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class FogExplorer {
  private pending = new Map<ChunkKey, FogBitmap>();
  private timer: unknown = null;
  private disposed = false;

  constructor(
    private readonly doc: ExplorerTarget,
    /** Applies the ops (history.applyUntracked: document + save queue). */
    private readonly apply: (ops: readonly MapOp[]) => void,
    private readonly clock: ExplorerClock = realClock,
    private readonly intervalMs = EXPLORE_FLUSH_MS,
  ) {}

  /** A visibility computed by the engine. */
  push(scene: VisibleScene): void {
    if (this.disposed || scene.floor !== this.doc.floor || scene.viewers.length === 0) return;
    const { width, height } = this.doc.grid;
    const visible = fogRasterizers.visible(scene, width, height);
    // Only what is not explored yet (nor already waiting).
    const fresh = effectiveFog(
      'fog.reveal',
      visible,
      (k) => this.pending.get(k) ?? this.doc.fogChunk(k),
    );
    if (fresh.size === 0) return;
    mergeFog(this.pending, fresh);
    this.timer ??= this.clock.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.intervalMs);
  }

  /** Sends what is waiting now. */
  flush(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const changes = effectiveFog('fog.reveal', this.pending, (k) => this.doc.fogChunk(k));
    this.pending = new Map();
    const ops = fogOps('fog.reveal', this.doc.floor, changes);
    if (ops.length > 0) this.apply(ops);
  }

  /** Stops (what is waiting is sent first unless `drop`). */
  dispose(drop = false): void {
    if (this.disposed) return;
    if (drop) this.pending.clear();
    else this.flush();
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.disposed = true;
  }
}
