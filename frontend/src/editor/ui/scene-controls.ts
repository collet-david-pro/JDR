/**
 * P5 part of an editing session: objects / placed tokens edits from the panels, ambient, view
 * mode ("see as the player"), render switches, fog exploration and conflicts. Plain
 * TypeScript; the panels read `ui` (simple values) and call these methods.
 */
import type {
  Ambient,
  MapObject,
  MapOp,
  ObjectPatch,
  PlacedToken,
  PlacedTokenPatch,
  SceneChangedEvent,
  SceneEngineApi,
  TokenDefView,
  ViewOptions,
} from '../contracts';
import type { History } from '../history/History';
import type { MapDocument } from '../model/MapDocument';
import { changedObjectPatch, changedTokenPatch } from '../model/scene-values';
import type { EditorUiState, SceneItem, ViewState } from '../state.svelte';
import { EMPTY_OBJECT_SELECTION, type ObjectSelection } from '../tools/types';
import type { MapOpConflict } from '../../lib/types';
import { createVisionCore, type VisionCore } from '../../vision/index';
import { FogExplorer, type ExplorerClock } from './exploration';

type Engine = Pick<SceneEngineApi, 'setScene' | 'setView' | 'onVisibility' | 'setPerformanceMode'>;

export interface SceneControlsHost {
  /** Object selection changed outside the select tool (pruned after an undo, list click). */
  selectObjects(selection: ObjectSelection): void;
  refreshSelectionOverlay(): void;
  notify(code: 'conflict'): void;
}

export class SceneControls {
  private engine: Engine | null = null;
  private engineOffs: (() => void)[] = [];
  private readonly offs: (() => void)[] = [];
  private explorer: FogExplorer | null = null;
  private core: VisionCore | null = null;
  private coreRevision = -1;
  private lastViewers = '';

  constructor(
    private readonly doc: MapDocument,
    private readonly history: History,
    private readonly ui: EditorUiState,
    private readonly host: SceneControlsHost,
    private readonly clock?: ExplorerClock,
  ) {
    this.offs.push(this.doc.onSceneChanged((e) => this.sceneChanged(e)));
    this.syncUi();
  }

  // ---- Engine ----------------------------------------------------------------------------

  attach(engine: Engine): void {
    this.detach();
    this.engine = engine;
    engine.setScene(this.doc);
    engine.setView(this.viewOptions());
    this.applyPerformance();
    const off = engine.onVisibility((scene) => {
      if (this.ui.view.explore) this.explorer?.push(scene);
    });
    if (off !== undefined) this.engineOffs.push(off);
    this.updateExplorer();
  }

  detach(): void {
    for (const off of this.engineOffs) off();
    this.engineOffs = [];
    this.explorer?.dispose();
    this.explorer = null;
    this.engine?.setScene(null);
    this.engine = null;
  }

  dispose(): void {
    this.detach();
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  /** Synchronous vision core on the current objects (fog "room" fill). */
  visionCore(): VisionCore {
    this.core ??= createVisionCore();
    if (this.coreRevision !== this.doc.sceneRevision) {
      this.core.setScene({
        floor: this.doc.floor,
        width: this.doc.grid.width,
        height: this.doc.grid.height,
        objects: this.doc.objects(),
        viewer: 'gm',
        revision: this.doc.sceneRevision,
      });
      this.coreRevision = this.doc.sceneRevision;
    }
    return this.core;
  }

  // ---- View ------------------------------------------------------------------------------

  setView(patch: Partial<ViewState>): void {
    this.ui.view = { ...this.ui.view, ...patch };
    this.engine?.setView(this.viewOptions());
    if (patch.performance !== undefined) this.applyPerformance();
    this.updateExplorer();
  }

  /** ViewOptions of the engine from the UI switches. */
  viewOptions(): ViewOptions {
    const v = this.ui.view;
    const viewers = v.mode === 'gm' && !v.explore ? [] : this.viewerUids();
    this.lastViewers = viewers.join(',');
    return {
      mode: v.mode,
      viewers,
      lighting: v.lighting,
      fog: v.fog,
      shadows: v.shadows,
    };
  }

  /** Placed tokens used as viewers: the chosen one, or every PC (kind pc). */
  viewerUids(): string[] {
    const v = this.ui.view.viewer;
    const tokens = this.doc.tokens();
    if (v !== 'all_pcs') return tokens.some((t) => t.uid === v) ? [v] : [];
    return tokens.filter((t) => this.doc.tokenDef(t.token_id)?.kind === 'pc').map((t) => t.uid);
  }

  // ---- Object / token edits (properties panel) -------------------------------------------

  /** Applies `patch(o)` to every selected object (unchanged ones skipped), one command. */
  patchObjects(uids: readonly string[], patch: (o: MapObject) => ObjectPatch | null): void {
    const ops: MapOp[] = [];
    for (const uid of uids) {
      const o = this.doc.object(uid);
      if (o === undefined) continue;
      const p = patch(o);
      if (p === null) continue;
      const changed = changedObjectPatch(o, p);
      if (Object.keys(changed).length > 0) {
        ops.push({ type: 'object.update', uid, rev: o.rev, patch: changed });
      }
    }
    this.run('editor.command.edit_object', ops);
  }

  patchTokens(uids: readonly string[], patch: (t: PlacedToken) => PlacedTokenPatch | null): void {
    const ops: MapOp[] = [];
    for (const uid of uids) {
      const t = this.doc.token(uid);
      if (t === undefined) continue;
      const p = patch(t);
      if (p === null) continue;
      const changed = changedTokenPatch(t, p);
      if (Object.keys(changed).length > 0) {
        ops.push({ type: 'maptoken.update', uid, rev: t.rev, patch: changed });
      }
    }
    this.run('editor.command.edit_token', ops);
  }

  /** map.meta ambient (partial), undoable; sliders merge into one step. */
  setAmbient(patch: Partial<Ambient>, mergeKey?: string): void {
    this.run('editor.command.ambient', [{ type: 'map.meta', ambient: patch }], mergeKey);
  }

  setTokenDefs(defs: readonly TokenDefView[]): void {
    this.doc.setTokenDefs(defs);
  }

  /** Server states of the conflicting objects / tokens replace the local ones (no history). */
  resolveConflicts(conflicts: readonly MapOpConflict[]): void {
    for (const c of conflicts) {
      try {
        if (c.kind === 'object') this.doc.replaceObject(c.uid, c.current);
        else this.doc.replaceToken(c.uid, c.current);
      } catch (error) {
        console.error(error);
      }
    }
    if (conflicts.length > 0) this.host.notify('conflict');
  }

  /** Every explored bit sent now (before a reload, a reset or leaving). */
  flushExploration(): void {
    this.explorer?.flush();
  }

  /** Fog reset done on the server: local fog cleared, pending exploration dropped. */
  fogReset(): void {
    this.explorer?.dispose(true);
    this.explorer = null;
    this.doc.clearFog();
    this.updateExplorer();
  }

  // ---- Internals -------------------------------------------------------------------------

  private run(label: string, ops: readonly MapOp[], mergeKey?: string): void {
    if (ops.length === 0) return;
    try {
      this.history.execute({ label, ops, inverseOps: [], ...(mergeKey ? { mergeKey } : {}) });
    } catch (error) {
      console.error(error);
    }
  }

  private updateExplorer(): void {
    const want = this.engine !== null && this.ui.view.explore;
    if (want && this.explorer === null) {
      this.explorer = new FogExplorer(
        this.doc,
        (ops) => this.history.applyUntracked(ops),
        this.clock,
      );
    } else if (!want && this.explorer !== null) {
      this.explorer.dispose();
      this.explorer = null;
    }
  }

  private applyPerformance(): void {
    const p = this.ui.view.performance;
    this.engine?.setPerformanceMode(p === 'auto' ? 'auto' : p === 'on');
  }

  private sceneChanged(e: SceneChangedEvent): void {
    const content = e.objects.length > 0 || e.tokens.length > 0;
    if (!content && !e.ambient && !e.tokenDefs) return; // fog only: nothing shown in the panels
    this.syncUi();
    const meta = e.tokenDefs;
    // Selection: uids that no longer exist are dropped.
    const sel = this.ui.objectSelection;
    const objects = sel.objects.filter((u) => this.doc.object(u) !== undefined);
    const tokens = sel.tokens.filter((u) => this.doc.token(u) !== undefined);
    if (objects.length !== sel.objects.length || tokens.length !== sel.tokens.length) {
      this.host.selectObjects(
        objects.length + tokens.length === 0 ? EMPTY_OBJECT_SELECTION : { objects, tokens },
      );
    } else {
      this.host.refreshSelectionOverlay();
    }
    // Viewers follow the placed tokens (all PCs, removed token).
    const previous = this.lastViewers;
    const options = this.viewOptions();
    if (options.viewers.join(',') !== previous || meta) this.engine?.setView(options);
  }

  private syncUi(): void {
    const ui = this.ui;
    ui.sceneVersion++;
    ui.ambient = this.doc.ambient;
    ui.tokenDefs = this.doc.tokenDefs().map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      imageUrl: d.imageUrl,
      sizeW: d.sizeW,
      sizeH: d.sizeH,
    }));
    const items: SceneItem[] = this.doc.tokens().map((t) => ({
      uid: t.uid,
      kind: 'token',
      name: this.doc.tokenDef(t.token_id)?.name ?? null,
      x: t.x,
      y: t.y,
    }));
    for (const o of this.doc.objects()) {
      const [x, y] =
        o.type === 'wall'
          ? (o.geometry.points[0] ?? [0, 0])
          : o.type === 'light'
            ? [o.geometry.x, o.geometry.y]
            : o.geometry.a;
      items.push({ uid: o.uid, kind: o.type, name: null, x, y });
    }
    ui.sceneItems = items;
    if (ui.tokenId !== null && this.doc.tokenDef(ui.tokenId) === null) ui.tokenId = null;
  }
}
