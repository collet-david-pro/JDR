/**
 * Camera maths (pure, no Pixi).
 *
 * Camera state (contracts.ts CameraState):
 * - `x`, `y`: map position, in cells, shown at the centre of the viewport (stable on resize);
 * - `zoom`: scale factor; one cell is `cellPx * zoom` CSS pixels on screen.
 * Screen coordinates are CSS pixels relative to the top-left corner of the canvas.
 */

import type { CameraState, GridSpec } from '../editor/contracts';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
/** Padding kept around the map by fit(), in CSS pixels. */
export const FIT_PADDING_PX = 24;

export interface Viewport {
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Size of one cell on screen, in CSS pixels. */
export function cellScreenSize(cellPx: number, zoom: number): number {
  return cellPx * zoom;
}

/** Keeps the centre over the map (at worst the map edge sits in the middle of the view). */
export function clampCenter(camera: CameraState, grid: GridSpec): CameraState {
  const x = Number.isFinite(camera.x) ? camera.x : grid.width / 2;
  const y = Number.isFinite(camera.y) ? camera.y : grid.height / 2;
  return {
    x: Math.min(grid.width, Math.max(0, x)),
    y: Math.min(grid.height, Math.max(0, y)),
    zoom: camera.zoom,
  };
}

/** Clamps zoom and centre. */
export function normalizeCamera(camera: CameraState, grid: GridSpec): CameraState {
  return clampCenter({ ...camera, zoom: clampZoom(camera.zoom) }, grid);
}

/** Screen (CSS px) ⇒ world (cells, float). */
export function screenToWorld(
  camera: CameraState,
  viewport: Viewport,
  cellPx: number,
  sx: number,
  sy: number,
): Point {
  const scale = cellPx * camera.zoom;
  return {
    x: camera.x + (sx - viewport.width / 2) / scale,
    y: camera.y + (sy - viewport.height / 2) / scale,
  };
}

/** World (cells) ⇒ screen (CSS px). */
export function worldToScreen(
  camera: CameraState,
  viewport: Viewport,
  cellPx: number,
  wx: number,
  wy: number,
): Point {
  const scale = cellPx * camera.zoom;
  return {
    x: (wx - camera.x) * scale + viewport.width / 2,
    y: (wy - camera.y) * scale + viewport.height / 2,
  };
}

/** Integer cell containing a world position. */
export function cellAt(world: Point): Point {
  return { x: Math.floor(world.x), y: Math.floor(world.y) };
}

/**
 * Transform of the world container (whose unit is the pixel at zoom 1, i.e. cell * cellPx):
 * screen = world * scale + (tx, ty).
 */
export function worldTransform(
  camera: CameraState,
  viewport: Viewport,
  cellPx: number,
): { scale: number; tx: number; ty: number } {
  const scale = camera.zoom;
  return {
    scale,
    tx: viewport.width / 2 - camera.x * cellPx * scale,
    ty: viewport.height / 2 - camera.y * cellPx * scale,
  };
}

/** Zoom by `factor`, keeping the world point under the screen point (sx, sy) in place. */
export function zoomAround(
  camera: CameraState,
  viewport: Viewport,
  cellPx: number,
  factor: number,
  sx: number,
  sy: number,
): CameraState {
  const zoom = clampZoom(camera.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1));
  const anchor = screenToWorld(camera, viewport, cellPx, sx, sy);
  const scale = cellPx * zoom;
  return {
    x: anchor.x - (sx - viewport.width / 2) / scale,
    y: anchor.y - (sy - viewport.height / 2) / scale,
    zoom,
  };
}

/** Drag by (dx, dy) CSS pixels: the map follows the pointer. */
export function panByScreen(
  camera: CameraState,
  cellPx: number,
  dx: number,
  dy: number,
): CameraState {
  const scale = cellPx * camera.zoom;
  return { x: camera.x - dx / scale, y: camera.y - dy / scale, zoom: camera.zoom };
}

/** Whole map visible and centred. */
export function fitCamera(
  grid: GridSpec,
  viewport: Viewport,
  padding = FIT_PADDING_PX,
): CameraState {
  const availW = Math.max(1, viewport.width - 2 * padding);
  const availH = Math.max(1, viewport.height - 2 * padding);
  const mapW = Math.max(1, grid.width * grid.cellPx);
  const mapH = Math.max(1, grid.height * grid.cellPx);
  return {
    x: grid.width / 2,
    y: grid.height / 2,
    zoom: clampZoom(Math.min(availW / mapW, availH / mapH)),
  };
}

export function camerasEqual(a: CameraState, b: CameraState): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

// ---------------------------------------------------------------------------------------------
// Inertia ("light": short exponential decay after a pan gesture).

export interface PanSample {
  /** ms */
  readonly t: number;
  /** Screen position, CSS px. */
  readonly x: number;
  readonly y: number;
}

export interface Velocity {
  /** CSS px per ms. */
  readonly vx: number;
  readonly vy: number;
}

/** Time constant of the decay, in ms. */
export const INERTIA_TIME_CONSTANT_MS = 110;
/** Below this speed (CSS px/ms) inertia stops. */
export const INERTIA_MIN_SPEED = 0.02;
/** Release velocity is measured over the last samples of this window. */
export const INERTIA_SAMPLE_WINDOW_MS = 80;
/** A pause longer than this before release cancels inertia. */
export const INERTIA_MAX_IDLE_MS = 60;
/** Speed cap (CSS px/ms) to avoid flinging the map away. */
export const INERTIA_MAX_SPEED = 2.5;

/** Release velocity from the last pointer samples (oldest first). */
export function releaseVelocity(samples: readonly PanSample[], releaseTime: number): Velocity {
  const last = samples[samples.length - 1];
  if (last === undefined || releaseTime - last.t > INERTIA_MAX_IDLE_MS) return { vx: 0, vy: 0 };
  let first = last;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s === undefined || last.t - s.t > INERTIA_SAMPLE_WINDOW_MS) break;
    first = s;
  }
  const dt = last.t - first.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  let vx = (last.x - first.x) / dt;
  let vy = (last.y - first.y) / dt;
  const speed = Math.hypot(vx, vy);
  if (speed > INERTIA_MAX_SPEED) {
    vx = (vx / speed) * INERTIA_MAX_SPEED;
    vy = (vy / speed) * INERTIA_MAX_SPEED;
  }
  return { vx, vy };
}

export function isMoving(v: Velocity): boolean {
  return Math.hypot(v.vx, v.vy) >= INERTIA_MIN_SPEED;
}

/**
 * Advances the inertia by `dtMs`: returns the screen displacement for this step and the
 * decayed velocity (exact integration of v(t) = v0 * exp(-t / tau)).
 */
export function inertiaStep(
  v: Velocity,
  dtMs: number,
  tau = INERTIA_TIME_CONSTANT_MS,
): { dx: number; dy: number; velocity: Velocity } {
  const dt = Math.max(0, Math.min(dtMs, 100));
  const decay = Math.exp(-dt / tau);
  const travel = tau * (1 - decay);
  const velocity = { vx: v.vx * decay, vy: v.vy * decay };
  return {
    dx: v.vx * travel,
    dy: v.vy * travel,
    velocity: isMoving(velocity) ? velocity : { vx: 0, vy: 0 },
  };
}
