/**
 * Glue between pointer/keyboard input, the tools, the history and the engine overlay.
 * Pure TypeScript: the page (lot C) forwards SceneEngineApi.onPointer events and key events here.
 */
import type { CellValue, MapPointerEvent, Overlay, TileLayerId } from './contracts';
import type { VisionCore } from '../vision/index';
import type { History } from './history/History';
import type { MapDocument } from './model/MapDocument';
import type { ShortcutAction } from './shortcuts';
import { clampBrushSize } from './tools/common';
import { createTools, type ToolSet } from './tools/index';
import type {
  CellRect,
  ObjectSelection,
  ToolContext,
  ToolId,
  ToolNotice,
  ToolResult,
  ToolSettings,
} from './tools/types';
import { createRng, type Rng } from './util/rng';

/** Mutable settings (EditorUiState implements it). */
export interface EditorSettings extends ToolSettings {
  tool: ToolId;
  layer: TileLayerId;
  tile: CellValue | null;
  brushSize: number;
  selection: readonly CellRect[];
  objectSelection: ObjectSelection;
}

export interface EditorHost {
  setOverlay(overlay: Overlay | null): void;
  setPanMode(enabled: boolean): void;
  notify?(notice: ToolNotice): void;
  /** Actions not handled here (zoom.reset, zoom.fit, panels.toggle, help). */
  onAction?(action: ShortcutAction): void;
}

const TOOL_ACTIONS: Partial<Record<ShortcutAction, ToolId>> = {
  'tool.select': 'select',
  'tool.hand': 'hand',
  'tool.brush': 'brush',
  'tool.eraser': 'eraser',
  'tool.fill': 'fill',
  'tool.shape': 'shape',
  'tool.pipette': 'pipette',
  'tool.ruler': 'ruler',
  'tool.wall': 'wall',
  'tool.door': 'door',
  'tool.light': 'light',
  'tool.token': 'token',
  'tool.fog': 'fog',
};

export interface EditorControllerOptions {
  rng?: Rng;
  formatDistance?: ToolContext['formatDistance'];
  /** Cells per screen pixel (object tool tolerances). */
  pixelSize?: () => number;
  now?: () => number;
  newUid?: () => string;
  visionCore?: () => VisionCore;
}

export class EditorController {
  readonly tools: ToolSet;
  private spaceHeld = false;

  constructor(
    readonly doc: MapDocument,
    readonly history: History,
    readonly settings: EditorSettings,
    private readonly host: EditorHost,
    options: EditorControllerOptions = {},
  ) {
    const ctx: ToolContext = {
      doc,
      settings,
      rng: options.rng ?? createRng(Date.now()),
      ...(options.formatDistance !== undefined ? { formatDistance: options.formatDistance } : {}),
      ...(options.pixelSize !== undefined ? { pixelSize: options.pixelSize } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.newUid !== undefined ? { newUid: options.newUid } : {}),
      ...(options.visionCore !== undefined ? { visionCore: options.visionCore } : {}),
    };
    this.tools = createTools(ctx);
    this.host.setPanMode(settings.tool === 'hand');
  }

  setTool(id: ToolId): void {
    if (id === this.settings.tool) return;
    this.handleResult(this.tools[this.settings.tool].deactivate());
    this.settings.tool = id;
    this.host.setOverlay(id === 'select' ? this.selectionOverlay() : null);
    this.host.setPanMode(id === 'hand' || this.spaceHeld);
  }

  handlePointer(event: MapPointerEvent): void {
    if (this.spaceHeld) return;
    this.handleResult(this.tools[this.settings.tool].onPointer(event));
  }

  /** Space pressed/released: temporary hand tool. */
  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
    this.host.setPanMode(held || this.settings.tool === 'hand');
  }

  /** Runs a shortcut action. Returns false when it is not an editor action. */
  handleAction(action: ShortcutAction): boolean {
    const tool = TOOL_ACTIONS[action];
    if (tool !== undefined) {
      this.setTool(tool);
      return true;
    }
    switch (action) {
      case 'undo':
        this.history.undo();
        return true;
      case 'redo':
        this.history.redo();
        return true;
      case 'brush.smaller':
      case 'brush.larger':
        this.settings.brushSize = clampBrushSize(
          this.settings.brushSize + (action === 'brush.larger' ? 1 : -1),
        );
        return true;
      case 'pan.hold':
        this.setSpaceHeld(true);
        return true;
      case 'cancel':
        this.handleResult(this.tools[this.settings.tool].cancel());
        return true;
      case 'confirm':
      case 'delete': {
        const tool = this.tools[this.settings.tool];
        if (tool.onAction === undefined) return false;
        this.handleResult(tool.onAction(action));
        return true;
      }
      default:
        if (action.startsWith('layer.')) {
          const def = this.doc.layers[Number(action.slice(6)) - 1];
          if (def?.kind === 'tiles') this.settings.layer = def.id as TileLayerId;
          return true;
        }
        this.host.onAction?.(action);
        return this.host.onAction !== undefined;
    }
  }

  /** Replaces the object selection (panels, keyboard list); shown with the select tool. */
  selectObjects(selection: ObjectSelection): void {
    this.settings.objectSelection = selection;
    const r = this.tools.select.setObjectSelection(selection);
    if (this.settings.tool === 'select') this.host.setOverlay(r.overlay ?? null);
  }

  /** Refreshes the select overlay (objects changed, e.g. undo). */
  refreshSelectionOverlay(): void {
    if (this.settings.tool === 'select') this.host.setOverlay(this.selectionOverlay());
  }

  private selectionOverlay(): Overlay | null {
    this.tools.select.setObjectSelection(this.settings.objectSelection);
    return this.tools.select.setSelection(this.settings.selection).overlay ?? null;
  }

  private handleResult(r: ToolResult): void {
    if (r.command !== undefined) {
      try {
        this.history.execute(r.command);
      } catch (error) {
        // An invalid edit (e.g. out-of-range value) is refused locally, never sent.
        console.error(error);
        this.host.notify?.({ code: 'invalid' });
      }
    }
    if (r.overlay !== undefined) this.host.setOverlay(r.overlay);
    if (r.picked !== undefined) this.settings.tile = r.picked;
    if (r.selection !== undefined) this.settings.selection = r.selection;
    if (r.objectSelection !== undefined) this.settings.objectSelection = r.objectSelection;
    if (r.notice !== undefined) this.host.notify?.(r.notice);
  }
}
