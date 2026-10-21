/**
 * One editing session of the editor page: document, history, tools, palette and the link with
 * the scene engine. Plain TypeScript (the Svelte components only read `ui` and call methods),
 * testable with a fake engine.
 */
import type { GridSpec, GridTheme, LayerId, SceneEngineApi, TileLayerId } from '../contracts';
import { EditorController } from '../EditorController';
import { History } from '../history/History';
import {
  layerOrderCommand,
  layerPatchCommand,
  themeCommand,
  type LayerPatch,
} from '../model/commands';
import { MapDocument } from '../model/MapDocument';
import {
  isTypingTarget,
  resolveShortcut,
  type KeyBinding,
  type KeyLike,
  type Platform,
  type ShortcutAction,
} from '../shortcuts';
import { EditorUiState } from '../state.svelte';
import type { ToolContext, ToolId, ToolNotice } from '../tools/types';
import { createRng, type Rng } from '../util/rng';
import { PaletteCatalog, type TileAsset } from './palette';
import { SoloView } from './solo-view';

/** The engine as used by the page: the contract plus the optional performance-mode flag. */
export type EngineLike = SceneEngineApi & { readonly performanceMode?: boolean };

export interface EditorKeyEvent extends KeyLike {
  readonly repeat: boolean;
  readonly target: unknown;
}

export interface EditorSessionOptions {
  readonly grid: GridSpec;
  readonly floor?: string;
  readonly ui?: EditorUiState;
  readonly platform?: Platform;
  readonly bindings?: readonly KeyBinding[];
  readonly rng?: Rng;
  readonly now?: () => number;
  readonly formatDistance?: ToolContext['formatDistance'];
  /** Text of a tool notice (i18n); default: its code. */
  readonly describeNotice?: (notice: ToolNotice) => string;
  /** Keys that need the map to have the focus (Space, Tab) are accepted for these targets. */
  readonly isViewportTarget?: (target: unknown) => boolean;
}

/** Actions repeated while the key is held. */
const REPEATABLE: ReadonlySet<ShortcutAction> = new Set([
  'undo',
  'redo',
  'brush.smaller',
  'brush.larger',
]);

/** Target inside a dialog (the dialog handles its own keys, e.g. Escape). */
function inDialog(target: unknown): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === 'function' && el.closest('dialog, [role="dialog"]') !== null;
}

export class EditorSession {
  readonly ui: EditorUiState;
  readonly doc: MapDocument;
  readonly view: SoloView;
  readonly history: History;
  readonly controller: EditorController;
  readonly catalog = new PaletteCatalog();

  private engine: EngineLike | null = null;
  private engineOffs: (() => void)[] = [];
  private readonly offs: (() => void)[] = [];
  private noticeSeq = 0;
  private readonly platform: Platform;
  private readonly bindings: readonly KeyBinding[] | undefined;
  private readonly describeNotice: (notice: ToolNotice) => string;
  private readonly isViewportTarget: (target: unknown) => boolean;

  constructor(options: EditorSessionOptions) {
    this.ui = options.ui ?? new EditorUiState();
    this.platform = options.platform ?? 'other';
    this.bindings = options.bindings;
    this.describeNotice = options.describeNotice ?? ((n) => n.code);
    this.isViewportTarget = options.isViewportTarget ?? (() => true);
    this.doc = new MapDocument({
      grid: options.grid,
      ...(options.floor !== undefined ? { floor: options.floor } : {}),
      resolveAsset: (id) => this.catalog.resolve(id),
    });
    this.view = new SoloView(this.doc);
    this.history = new History(this.doc, options.now !== undefined ? { now: options.now } : {});
    this.controller = new EditorController(
      this.doc,
      this.history,
      this.ui,
      {
        setOverlay: (overlay) => this.engine?.setOverlay(overlay),
        setPanMode: (enabled) => {
          this.ui.panMode = enabled;
          this.engine?.setPanMode(enabled);
        },
        notify: (notice) => this.notify(this.describeNotice(notice)),
        onAction: (action) => this.onAction(action),
      },
      {
        rng: options.rng ?? createRng(Date.now()),
        ...(options.formatDistance !== undefined ? { formatDistance: options.formatDistance } : {}),
      },
    );
    this.offs.push(
      this.history.onChange((state) => (this.ui.history = state)),
      this.view.onMetaChanged(() => this.syncMeta()),
    );
    this.syncMeta();
  }

  // ---- Engine ----------------------------------------------------------------------------

  /** Connects the engine (shows the map and fits it). */
  attach(engine: EngineLike): void {
    this.detach();
    this.engine = engine;
    engine.setMap(this.view);
    engine.setGridVisible(this.ui.gridVisible);
    engine.setPanMode(this.ui.panMode);
    this.ui.renderer = engine.renderer;
    this.ui.performanceMode = engine.performanceMode ?? false;
    this.ui.zoom = engine.camera.get().zoom;
    const { width, height } = this.doc.grid;
    this.engineOffs = [
      engine.onPointer((e) => {
        const inside = e.cell.x >= 0 && e.cell.y >= 0 && e.cell.x < width && e.cell.y < height;
        this.ui.cursor = e.type !== 'leave' && inside ? { x: e.cell.x, y: e.cell.y } : null;
        this.controller.handlePointer(e);
      }),
      engine.onCamera((camera) => (this.ui.zoom = camera.zoom)),
      engine.onFps((fps) => {
        this.ui.fps = fps;
        this.ui.performanceMode = engine.performanceMode ?? false;
      }),
    ];
  }

  /** Disconnects the engine (it is destroyed by its owner). */
  detach(): void {
    for (const off of this.engineOffs) off();
    this.engineOffs = [];
    this.engine = null;
  }

  dispose(): void {
    this.detach();
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  // ---- Commands from the UI --------------------------------------------------------------

  setTool(id: ToolId): void {
    this.controller.setTool(id);
  }

  undo(): void {
    this.history.undo();
  }

  redo(): void {
    this.history.redo();
  }

  setTheme(theme: GridTheme): void {
    const command = themeCommand(this.doc.theme, theme);
    if (command !== null) this.history.execute(command);
  }

  setGridVisible(visible: boolean): void {
    this.ui.gridVisible = visible;
    this.engine?.setGridVisible(visible);
  }

  patchLayer(id: LayerId, patch: LayerPatch): void {
    const command = layerPatchCommand(this.doc, id, patch);
    if (command !== null) this.history.execute(command);
  }

  toggleLayerVisible(id: LayerId): void {
    const layer = this.doc.layer(id);
    if (layer !== undefined) this.patchLayer(id, { visible: !layer.visible });
  }

  toggleLayerLocked(id: LayerId): void {
    const layer = this.doc.layer(id);
    if (layer !== undefined) this.patchLayer(id, { locked: !layer.locked });
  }

  /** Moves a layer up (+1, drawn later) or down (-1) in the stack. */
  moveLayer(id: LayerId, delta: number): void {
    const index = this.doc.layers.findIndex((l) => l.id === id);
    if (index < 0) return;
    const command = layerOrderCommand(this.doc, id, index + delta);
    if (command !== null) this.history.execute(command);
  }

  toggleSolo(id: LayerId): void {
    this.view.setSolo(this.view.solo === id ? null : id);
  }

  /** Active layer for the tile tools (object layers come with P5). */
  setActiveLayer(id: LayerId): void {
    if (this.doc.layer(id)?.kind === 'tiles') this.ui.layer = id as TileLayerId;
  }

  /** Adds a library asset to the palette (palette.add, not undoable) and selects it. */
  addTileAsset(asset: TileAsset): number {
    this.catalog.remember(asset);
    const { index, op } = this.doc.paletteIndexFor(asset.id);
    if (op !== null) this.history.applyUntracked([op]);
    else this.doc.updatePaletteAsset(asset.id, { url: asset.urls.full, name: asset.name });
    this.syncMeta();
    this.selectTile(index);
    return index;
  }

  selectTile(index: number): void {
    if (index <= 0 || this.doc.palette[index] == null) return;
    this.ui.tile = { index, variant: 0, flags: 0 };
    if (this.ui.tool !== 'brush' && this.ui.tool !== 'fill' && this.ui.tool !== 'shape') {
      this.setTool('brush');
    }
  }

  togglePanels(): void {
    this.ui.panelsOpen = !this.ui.panelsOpen;
  }

  zoomReset(): void {
    this.engine?.camera.set({ zoom: 1 });
  }

  zoomFit(): void {
    this.engine?.camera.fit();
  }

  zoomBy(factor: number): void {
    this.engine?.camera.zoomBy(factor);
  }

  // ---- Keyboard --------------------------------------------------------------------------

  /** Window keydown. Returns true when handled (the caller then calls preventDefault). */
  handleKeyDown(e: EditorKeyEvent): boolean {
    if (isTypingTarget(e.target) || inDialog(e.target)) return false;
    const action = resolveShortcut(e, this.platform, this.bindings);
    if (action === null) return false;
    if ((action === 'pan.hold' || action === 'panels.toggle') && !this.isViewportTarget(e.target)) {
      return false; // Space activates buttons, Tab moves the focus: keep native behaviour.
    }
    if (e.repeat && !REPEATABLE.has(action)) return action === 'pan.hold';
    return this.controller.handleAction(action);
  }

  handleKeyUp(e: { readonly key: string }): void {
    if (e.key === ' ') this.controller.setSpaceHeld(false);
  }

  /** Window blur: keys held are released. */
  releaseKeys(): void {
    this.controller.setSpaceHeld(false);
  }

  // ---- Internals -------------------------------------------------------------------------

  notify(text: string): void {
    this.ui.notice = { id: ++this.noticeSeq, text };
  }

  private onAction(action: ShortcutAction): void {
    switch (action) {
      case 'zoom.reset':
        this.zoomReset();
        break;
      case 'zoom.fit':
        this.zoomFit();
        break;
      case 'panels.toggle':
        this.togglePanels();
        break;
      case 'help':
        this.ui.helpOpen = true;
        break;
      default:
        break;
    }
  }

  private syncMeta(): void {
    this.ui.layers = this.doc.layers;
    this.ui.theme = this.doc.theme;
    this.ui.solo = this.view.solo;
    this.ui.palette = this.catalog.items(this.doc.palette);
  }
}
