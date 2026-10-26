/**
 * Pointer handling of the GM console (plain TypeScript, tested without engine): select / drag
 * tokens, toggle doors and lights, paint fog, place tokens. Everything the GM does goes out as
 * session actions (`host.send`, `host.moveToken`) or map ops (`host.placeToken`); the scene
 * only shows a local preview of a dragged token and of the tool footprint.
 */
import { FOG_BRUSH_MAX, FOG_BRUSH_MIN } from '../../../editor/tools/types';
import { brushCellsAround, rectBetweenPoints } from '../../../editor/tools/fog-cells';
import { snapToGrid } from '../../../editor/tools/geometry';
import { hitTest } from '../../../editor/tools/hit';
import type {
  ChunkKey,
  FogBitmap,
  MapPointerEvent,
  Overlay,
  Point,
} from '../../../editor/contracts';
import { FOG_RAW_BYTES } from '../../../formats/fog-codec';
import { mergeFog } from '../../../editor/model/fog-wire';
import type { SessionScene } from '../scene/session-scene';
import type { SessionAction } from '../types';
import { brushRaster, fogActionsFor, rectRaster, type FogGrid } from './fog-actions';

export type ConsoleTool =
  | { readonly kind: 'select' }
  | {
      readonly kind: 'fog';
      readonly op: 'reveal' | 'hide';
      readonly shape: 'brush' | 'rect';
      readonly radius: number;
    }
  | { readonly kind: 'token'; readonly tokenId: string; readonly hidden: boolean };

export interface Selection {
  readonly kind: 'token' | 'object';
  readonly uid: string;
}

export interface ConsoleInputHost {
  scene(): SessionScene | null;
  /** Cells per screen pixel (1 / (cellPx × zoom)). */
  cellsPerPixel(): number;
  moveToken(uid: string, x: number, y: number): void;
  send(actions: SessionAction[]): void;
  placeToken(tokenId: string, cx: number, cy: number, hidden: boolean): void;
  setOverlay(overlay: Overlay | null): void;
  onSelect(selection: Selection | null): void;
  /** Footprint (cells) of a token definition, for the placement preview. */
  tokenSize(tokenId: string): { w: number; h: number };
}

export interface ConsoleInputOptions {
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

const DRAG_PX = 4;
const TOLERANCE_PX = 6;
/** Fog strokes are sent in groups (30 requests a second at most, D12). */
export const FOG_FLUSH_MS = 100;

interface Drag {
  readonly uid: string;
  readonly start: Point;
  readonly offset: Point;
  moved: boolean;
  last: Point;
}

export class ConsoleInput {
  private tool: ConsoleTool = { kind: 'select' };
  private drag: Drag | null = null;
  private click: (Selection & { start: Point }) | null = null;
  private strokeLast: Point | null = null;
  private rectFrom: Point | null = null;
  private pending = new Map<ChunkKey, FogBitmap>();
  private sent = new Map<ChunkKey, FogBitmap>();
  private timer: unknown = null;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (handle: unknown) => void;

  constructor(
    private readonly host: ConsoleInputHost,
    options: ConsoleInputOptions = {},
  ) {
    this.setT = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = options.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  setTool(tool: ConsoleTool): void {
    this.cancel();
    this.tool = tool;
  }

  get current(): ConsoleTool {
    return this.tool;
  }

  /** Abandons the gesture in progress (tool change, Escape, leaving the console). */
  cancel(): void {
    if (this.drag !== null) this.host.scene()?.release(this.drag.uid);
    this.drag = null;
    this.click = null;
    this.flush();
    this.strokeLast = null;
    this.rectFrom = null;
    this.sent.clear();
    this.host.setOverlay(null);
  }

  handle(e: MapPointerEvent): void {
    const scene = this.host.scene();
    if (scene === null) return;
    const tool = this.tool;
    switch (tool.kind) {
      case 'select':
        this.select(scene, e);
        break;
      case 'fog':
        this.fog(scene, tool, e);
        break;
      case 'token':
        this.place(scene, tool, e);
        break;
    }
  }

  // ---- Select / drag --------------------------------------------------------------------

  private select(scene: SessionScene, e: MapPointerEvent): void {
    const p: Point = [e.world.x, e.world.y];
    const px = this.host.cellsPerPixel();
    switch (e.type) {
      case 'down': {
        if (e.button !== 0) return;
        const hit = hitTest(scene.doc, scene.doc.layers, p, TOLERANCE_PX * px, px);
        if (hit === null) {
          this.host.onSelect(null);
          return;
        }
        if (hit.kind === 'token') {
          const token = scene.token(hit.uid);
          if (token === undefined) return;
          this.drag = {
            uid: hit.uid,
            start: p,
            offset: [token.x - p[0], token.y - p[1]],
            moved: false,
            last: [token.x, token.y],
          };
        }
        this.click = { ...hit, start: p };
        return;
      }
      case 'move': {
        const drag = this.drag;
        if (drag === null) return;
        if (!drag.moved && Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) < DRAG_PX * px) {
          return;
        }
        drag.moved = true;
        const { width, height } = scene.doc.grid;
        const snapped = snapToGrid([p[0] + drag.offset[0], p[1] + drag.offset[1]], 0.5);
        const x = Math.min(width, Math.max(0, snapped[0]));
        const y = Math.min(height, Math.max(0, snapped[1]));
        if (x === drag.last[0] && y === drag.last[1]) return;
        drag.last = [x, y];
        scene.preview(drag.uid, x, y);
        this.host.moveToken(drag.uid, x, y);
        return;
      }
      case 'up': {
        const drag = this.drag;
        const click = this.click;
        this.drag = null;
        this.click = null;
        if (drag?.moved === true) {
          this.host.moveToken(drag.uid, drag.last[0], drag.last[1]);
          scene.release(drag.uid);
          return;
        }
        if (drag !== null) scene.release(drag.uid);
        if (click !== null) this.clicked(scene, click);
        return;
      }
      case 'leave':
        return;
    }
  }

  private clicked(scene: SessionScene, click: Selection): void {
    if (click.kind === 'object') {
      const object = scene.doc.object(click.uid);
      if (object?.type === 'door') {
        this.host.send([{ type: 'door.toggle', uid: click.uid }]);
      } else if (object?.type === 'light') {
        this.host.send([{ type: 'light.toggle', uid: click.uid }]);
      }
    }
    this.host.onSelect({ kind: click.kind, uid: click.uid });
  }

  // ---- Fog ------------------------------------------------------------------------------

  private fogGrid(scene: SessionScene, op: 'reveal' | 'hide'): FogGrid {
    return {
      floor: scene.floor,
      width: scene.doc.grid.width,
      height: scene.doc.grid.height,
      fogChunk: (key) => this.shown(scene, key, op),
    };
  }

  /** Fog of a block as it will be once what this stroke already sent is applied. */
  private shown(scene: SessionScene, key: ChunkKey, op: 'reveal' | 'hide'): FogBitmap | null {
    const base = scene.doc.fogChunk(key);
    const sent = this.sent.get(key);
    if (sent === undefined) return base;
    const out = base === null ? new Uint8Array(FOG_RAW_BYTES) : base.slice();
    for (let i = 0; i < FOG_RAW_BYTES; i++) {
      out[i] = op === 'reveal' ? out[i]! | sent[i]! : out[i]! & ~sent[i]!;
    }
    return out;
  }

  private fog(
    scene: SessionScene,
    tool: Extract<ConsoleTool, { kind: 'fog' }>,
    e: MapPointerEvent,
  ): void {
    const p: Point = [e.world.x, e.world.y];
    const { width, height } = scene.doc.grid;
    const radius = Math.min(FOG_BRUSH_MAX, Math.max(FOG_BRUSH_MIN, tool.radius));
    const erase = (tool.op === 'hide') !== e.mods.alt;
    const op = erase ? 'hide' : 'reveal';
    const brushOverlay = (): Overlay => ({
      kind: 'cells',
      cells: brushCellsAround(p, radius, width, height),
      erase,
    });
    switch (e.type) {
      case 'down': {
        if (e.button !== 0) return;
        if (tool.shape === 'rect') {
          this.rectFrom = p;
          this.host.setOverlay({ kind: 'area', ...rectBetweenPoints(p, p), erase });
          return;
        }
        this.strokeLast = p;
        this.queue(scene, op, brushRaster(scene.doc.grid, p, p, radius));
        this.host.setOverlay(brushOverlay());
        return;
      }
      case 'move': {
        if (this.rectFrom !== null) {
          this.host.setOverlay({ kind: 'area', ...rectBetweenPoints(this.rectFrom, p), erase });
          return;
        }
        if (this.strokeLast === null) {
          this.host.setOverlay(tool.shape === 'brush' ? brushOverlay() : null);
          return;
        }
        const from = this.strokeLast;
        this.strokeLast = p;
        this.queue(scene, op, brushRaster(scene.doc.grid, from, p, radius));
        this.host.setOverlay(brushOverlay());
        return;
      }
      case 'up': {
        if (this.rectFrom !== null) {
          const raster = rectRaster(scene.doc.grid, this.rectFrom, p);
          this.rectFrom = null;
          this.host.setOverlay(null);
          if (raster !== null) this.queue(scene, op, raster);
        }
        this.strokeLast = null;
        this.flush();
        this.sent.clear();
        return;
      }
      case 'leave':
        if (this.strokeLast === null && this.rectFrom === null) this.host.setOverlay(null);
        return;
    }
  }

  private pendingOp: 'reveal' | 'hide' = 'reveal';

  private queue(
    scene: SessionScene,
    op: 'reveal' | 'hide',
    raster: Map<ChunkKey, FogBitmap>,
  ): void {
    if (this.pending.size > 0 && this.pendingOp !== op) this.flush();
    this.pendingOp = op;
    const fresh = fogActionsFor(
      op === 'reveal' ? 'fog.reveal' : 'fog.hide',
      this.fogGrid(scene, op),
      raster,
    );
    if (fresh.length === 0) return;
    // Remember what is queued (for the next steps of the stroke) and what is to be sent.
    mergeFog(this.sent, raster);
    mergeFog(this.pending, raster);
    if (this.timer === null) this.timer = this.setT(() => this.flush(), FOG_FLUSH_MS);
  }

  /** Sends the fog bits gathered since the last flush. */
  flush(): void {
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
    const scene = this.host.scene();
    if (this.pending.size === 0 || scene === null) {
      this.pending = new Map();
      return;
    }
    const raster = this.pending;
    this.pending = new Map();
    // `sent` already holds these bits: compare with the shown fog without them.
    const grid: FogGrid = {
      floor: scene.floor,
      width: scene.doc.grid.width,
      height: scene.doc.grid.height,
      fogChunk: (key) => scene.doc.fogChunk(key),
    };
    const actions = fogActionsFor(
      this.pendingOp === 'reveal' ? 'fog.reveal' : 'fog.hide',
      grid,
      raster,
    );
    if (actions.length > 0) this.host.send(actions);
  }

  // ---- Token placement ------------------------------------------------------------------

  private place(
    scene: SessionScene,
    tool: Extract<ConsoleTool, { kind: 'token' }>,
    e: MapPointerEvent,
  ): void {
    const size = this.host.tokenSize(tool.tokenId);
    const { width, height } = scene.doc.grid;
    const inside = e.cell.x >= 0 && e.cell.y >= 0 && e.cell.x < width && e.cell.y < height;
    switch (e.type) {
      case 'down':
        if (e.button === 0 && inside)
          this.host.placeToken(tool.tokenId, e.cell.x, e.cell.y, tool.hidden);
        return;
      case 'move':
        this.host.setOverlay(
          inside ? { kind: 'area', x: e.cell.x, y: e.cell.y, w: size.w, h: size.h } : null,
        );
        return;
      case 'leave':
        this.host.setOverlay(null);
        return;
      case 'up':
        return;
    }
  }
}
