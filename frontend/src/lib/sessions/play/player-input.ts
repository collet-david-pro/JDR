/**
 * Pointer input of the player view (reduced version of the GM console input): dragging the
 * player's own tokens, mouse or finger. A drag moves the token locally (`scene.preview`) and
 * sends the positions (`moveToken`, throttled by the ActionSender); the final position is always
 * sent on release. Nothing else is selectable.
 */
import type { MapPointerEvent, Point } from '../../../editor/contracts';
import { snapToGrid } from '../../../editor/tools/geometry';
import { hitTest } from '../../../editor/tools/hit';
import type { SessionScene } from '../scene/session-scene';

/** Pointer travel (screen pixels) before a press becomes a drag. */
export const PLAYER_DRAG_PX = 4;
const TOLERANCE_PX = 6;

export interface PlayerInputHost {
  scene(): SessionScene | null;
  /** Cells per screen pixel at the current zoom. */
  cellsPerPixel(): number;
  /** The session lets the players move their own tokens (and runs). */
  canMove(): boolean;
  /** The placed token belongs to the player. */
  isOwn(uid: string): boolean;
  moveToken(uid: string, x: number, y: number): void;
}

interface Drag {
  readonly uid: string;
  readonly start: Point;
  readonly offset: Point;
  moved: boolean;
  last: Point;
}

export class PlayerInput {
  private drag: Drag | null = null;

  constructor(private readonly host: PlayerInputHost) {}

  /** A token is being dragged. */
  get dragging(): boolean {
    return this.drag !== null;
  }

  cancel(): void {
    if (this.drag !== null) this.host.scene()?.release(this.drag.uid);
    this.drag = null;
  }

  handle(e: MapPointerEvent): void {
    const scene = this.host.scene();
    if (scene === null) return;
    const p: Point = [e.world.x, e.world.y];
    const px = this.host.cellsPerPixel();
    switch (e.type) {
      case 'down': {
        if (e.button !== 0 || !this.host.canMove()) return;
        const hit = hitTest(scene.doc, scene.doc.layers, p, TOLERANCE_PX * px, px);
        if (hit === null || hit.kind !== 'token' || !this.host.isOwn(hit.uid)) return;
        const token = scene.token(hit.uid);
        if (token === undefined) return;
        this.drag = {
          uid: hit.uid,
          start: p,
          offset: [token.x - p[0], token.y - p[1]],
          moved: false,
          last: [token.x, token.y],
        };
        return;
      }
      case 'move': {
        const drag = this.drag;
        if (drag === null) return;
        if (
          !drag.moved &&
          Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) < PLAYER_DRAG_PX * px
        ) {
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
        this.drag = null;
        if (drag === null) return;
        if (drag.moved) this.host.moveToken(drag.uid, drag.last[0], drag.last[1]);
        scene.release(drag.uid);
        return;
      }
      case 'leave':
        return;
    }
  }
}
