/**
 * Long press in a corner of the screen (P7d): opens the discreet menu of a projection screen
 * without any visible control. Pure: the timer is injected.
 */
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export const CORNER_ZONE_PX = 80;
export const CORNER_HOLD_MS = 2000;
export const CORNER_MOVE_TOLERANCE_PX = 10;

export interface Area {
  readonly width: number;
  readonly height: number;
}

/** The corner (zone of `zone` px) a point belongs to, null elsewhere. */
export function cornerAt(
  x: number,
  y: number,
  area: Area,
  zone: number = CORNER_ZONE_PX,
): Corner | null {
  const left = x >= 0 && x <= zone;
  const right = x <= area.width && x >= area.width - zone;
  const top = y >= 0 && y <= zone;
  const bottom = y <= area.height && y >= area.height - zone;
  if (top && left) return 'tl';
  if (top && right) return 'tr';
  if (bottom && left) return 'bl';
  if (bottom && right) return 'br';
  return null;
}

export interface CornerPressOptions {
  readonly onTrigger: (corner: Corner) => void;
  readonly holdMs?: number;
  readonly tolerance?: number;
  readonly zone?: number;
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

/** One pointer at a time; a second pointer or any move beyond the tolerance cancels. */
export class CornerPress {
  private pointer: number | null = null;
  private origin = { x: 0, y: 0 };
  private timer: unknown = null;
  private readonly hold: number;
  private readonly tolerance: number;
  private readonly zone: number;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (handle: unknown) => void;

  constructor(private readonly o: CornerPressOptions) {
    this.hold = o.holdMs ?? CORNER_HOLD_MS;
    this.tolerance = o.tolerance ?? CORNER_MOVE_TOLERANCE_PX;
    this.zone = o.zone ?? CORNER_ZONE_PX;
    this.setT = o.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = o.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get pressing(): boolean {
    return this.timer !== null;
  }

  down(pointerId: number, x: number, y: number, area: Area): void {
    if (this.pointer !== null && pointerId !== this.pointer) {
      this.cancel();
      return;
    }
    this.cancel();
    const corner = cornerAt(x, y, area, this.zone);
    if (corner === null) return;
    this.pointer = pointerId;
    this.origin = { x, y };
    this.timer = this.setT(() => {
      this.timer = null;
      this.pointer = null;
      this.o.onTrigger(corner);
    }, this.hold);
  }

  move(pointerId: number, x: number, y: number): void {
    if (this.pointer !== pointerId) return;
    if (Math.hypot(x - this.origin.x, y - this.origin.y) > this.tolerance) this.cancel();
  }

  up(pointerId: number): void {
    if (this.pointer === pointerId) this.cancel();
  }

  cancel(): void {
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
    this.pointer = null;
  }
}
