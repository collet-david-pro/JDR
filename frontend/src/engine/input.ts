/**
 * DOM input on the canvas (no Pixi): pan (middle button, or primary button in pan mode, or
 * two fingers), zoom (wheel / Ctrl|Cmd + wheel / pinch, centred on the pointer) and tool
 * pointer events. Coordinates are CSS px relative to the element.
 */

import type { PointerModifiers } from '../editor/contracts';
import { releaseVelocity, type PanSample, type Velocity } from './camera';
import {
  heldButton,
  modifiersOf,
  pinchDelta,
  pinchState,
  wheelPixels,
  wheelZoomFactor,
  type PinchState,
} from './input-math';

export type ToolPointerType = 'down' | 'move' | 'up' | 'leave';

export interface InputCallbacks {
  /** A pan gesture starts (stops any inertia). */
  panStart(): void;
  /** Drag by (dx, dy) CSS px: the map follows the pointer. */
  pan(dx: number, dy: number): void;
  /** Pan released with this velocity (CSS px/ms), for inertia. */
  panEnd(velocity: Velocity): void;
  zoom(factor: number, sx: number, sy: number): void;
  pointer(
    type: ToolPointerType,
    sx: number,
    sy: number,
    button: number,
    mods: PointerModifiers,
  ): void;
}

type Gesture = 'none' | 'tool' | 'pan' | 'pinch';

interface TrackedPointer {
  x: number;
  y: number;
  readonly touch: boolean;
}

const MAX_PAN_SAMPLES = 12;

export class InputController {
  panMode = false;

  private readonly pointers = new Map<number, TrackedPointer>();
  private gesture: Gesture = 'none';
  private activeId = -1;
  private toolButton = 0;
  private panSamples: PanSample[] = [];
  private pinch: PinchState | null = null;
  private readonly abort = new AbortController();

  constructor(
    private readonly el: HTMLElement,
    private readonly cb: InputCallbacks,
    private readonly now: () => number = () => performance.now(),
  ) {
    const opts = { signal: this.abort.signal };
    el.style.touchAction = 'none';
    el.style.userSelect = 'none';
    el.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    el.addEventListener('pointermove', (e) => this.onMove(e), opts);
    el.addEventListener('pointerup', (e) => this.onUp(e, false), opts);
    el.addEventListener('pointercancel', (e) => this.onUp(e, true), opts);
    el.addEventListener('pointerleave', (e) => this.onLeave(e), opts);
    el.addEventListener('wheel', (e) => this.onWheel(e), { ...opts, passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    el.addEventListener('auxclick', (e) => e.preventDefault(), opts);
  }

  destroy(): void {
    this.abort.abort();
    this.pointers.clear();
  }

  /** True while a pan or pinch gesture is in progress. */
  get navigating(): boolean {
    return this.gesture === 'pan' || this.gesture === 'pinch';
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private touchPair(): [TrackedPointer, TrackedPointer] | null {
    const touches = [...this.pointers.values()].filter((p) => p.touch);
    const a = touches[0];
    const b = touches[1];
    return a !== undefined && b !== undefined ? [a, b] : null;
  }

  private onDown(e: PointerEvent): void {
    const p = this.local(e);
    const touch = e.pointerType === 'touch';
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, touch });
    const pair = touch ? this.touchPair() : null;
    if (pair !== null) {
      // Second finger: end any single-finger gesture, start pinch (zoom + two-finger pan).
      this.endGesture();
      this.gesture = 'pinch';
      this.pinch = pinchState(pair[0], pair[1]);
      this.cb.panStart();
      return;
    }
    if (this.gesture !== 'none') return;
    if (e.button === 1 || (e.button === 0 && this.panMode)) {
      e.preventDefault();
      this.gesture = 'pan';
      this.activeId = e.pointerId;
      this.panSamples = [{ t: this.now(), x: p.x, y: p.y }];
      this.capture(e.pointerId);
      this.cb.panStart();
      return;
    }
    if (e.button === 0 || e.button === 2) {
      this.gesture = 'tool';
      this.activeId = e.pointerId;
      this.toolButton = e.button;
      this.capture(e.pointerId);
      this.cb.pointer('down', p.x, p.y, e.button, modifiersOf(e));
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    const tracked = this.pointers.get(e.pointerId);
    let dx = 0;
    let dy = 0;
    if (tracked !== undefined) {
      dx = p.x - tracked.x;
      dy = p.y - tracked.y;
      tracked.x = p.x;
      tracked.y = p.y;
    }
    if (this.gesture === 'pinch') {
      const pair = this.touchPair();
      if (pair !== null && this.pinch !== null) {
        const next = pinchState(pair[0], pair[1]);
        const d = pinchDelta(this.pinch, next);
        this.pinch = next;
        if (d.dx !== 0 || d.dy !== 0) this.cb.pan(d.dx, d.dy);
        if (d.factor !== 1) this.cb.zoom(d.factor, next.cx, next.cy);
      }
      return;
    }
    if (this.gesture === 'pan' && e.pointerId === this.activeId) {
      if (dx !== 0 || dy !== 0) this.cb.pan(dx, dy);
      this.panSamples.push({ t: this.now(), x: p.x, y: p.y });
      if (this.panSamples.length > MAX_PAN_SAMPLES) this.panSamples.shift();
    }
    this.cb.pointer('move', p.x, p.y, heldButton(e.buttons), modifiersOf(e));
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.gesture === 'pinch') {
      if (this.touchPair() === null) {
        this.gesture = 'none';
        this.pinch = null;
        this.cb.panEnd({ vx: 0, vy: 0 });
      }
      return;
    }
    if (e.pointerId !== this.activeId) return;
    if (this.gesture === 'pan') {
      const v = cancelled ? { vx: 0, vy: 0 } : releaseVelocity(this.panSamples, this.now());
      this.gesture = 'none';
      this.activeId = -1;
      this.cb.panEnd(v);
      return;
    }
    if (this.gesture === 'tool') {
      this.gesture = 'none';
      this.activeId = -1;
      this.cb.pointer('up', p.x, p.y, cancelled ? this.toolButton : e.button, modifiersOf(e));
    }
  }

  private onLeave(e: PointerEvent): void {
    if (this.gesture !== 'none') return;
    const p = this.local(e);
    this.cb.pointer('leave', p.x, p.y, -1, modifiersOf(e));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    const ctrl = e.ctrlKey || e.metaKey;
    const page = this.el.clientHeight || 800;
    const dy = wheelPixels(e.deltaY, e.deltaMode, page);
    const dx = wheelPixels(e.deltaX, e.deltaMode, page);
    if (e.shiftKey && !ctrl) {
      // Shift + wheel: pan (vertical wheel scrolls horizontally, as in most editors).
      this.cb.panStart();
      this.cb.pan(-(dx || dy), dx ? -dy : 0);
      this.cb.panEnd({ vx: 0, vy: 0 });
      return;
    }
    if (dy !== 0) this.cb.zoom(wheelZoomFactor(dy, ctrl), p.x, p.y);
  }

  /** Ends the current single-pointer gesture (a second finger arrived). */
  private endGesture(): void {
    if (this.gesture === 'tool') {
      const tracked = this.pointers.get(this.activeId);
      this.cb.pointer('up', tracked?.x ?? 0, tracked?.y ?? 0, this.toolButton, {
        shift: false,
        alt: false,
        ctrlOrMeta: false,
      });
    } else if (this.gesture === 'pan') {
      this.cb.panEnd({ vx: 0, vy: 0 });
    }
    this.gesture = 'none';
    this.activeId = -1;
  }

  private capture(pointerId: number): void {
    try {
      this.el.setPointerCapture(pointerId);
    } catch {
      // The pointer may already be gone (synthetic events, tests).
    }
  }
}
