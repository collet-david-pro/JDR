/** Helpers shared by the P5 object tools (walls, doors, lights, tokens, fog, selection). */
import type {
  Command,
  DoorObject,
  LightObject,
  LightProps,
  MapOp,
  ObjectLayerId,
  Point,
  WallObject,
  WindowObject,
} from '../contracts';
import { round3 } from '../model/scene-values';
import { newObjectUid } from '../util/uid';
import {
  DOUBLE_CLICK_MS,
  DOUBLE_CLICK_PX,
  HIT_TOLERANCE_PX,
  type LightPresetId,
  type ToolContext,
  type ToolNotice,
} from './types';

/** Cells per screen pixel. */
export function pixelSize(ctx: ToolContext): number {
  return ctx.pixelSize?.() ?? 1 / ctx.doc.grid.cellPx;
}

/** Pointer tolerance in cells. */
export function tolerance(ctx: ToolContext): number {
  return HIT_TOLERANCE_PX * pixelSize(ctx);
}

export function uid(ctx: ToolContext): string {
  return ctx.newUid?.() ?? newObjectUid();
}

/** Notice when an object layer is locked (or missing), else null. */
export function lockedLayer(ctx: ToolContext, layer: ObjectLayerId): ToolNotice | null {
  const def = ctx.doc.layers.find((l) => l.id === layer);
  return def !== undefined && def.locked ? { code: 'layer_locked' } : null;
}

export function command(label: string, ops: readonly MapOp[], mergeKey?: string): Command {
  // The history recomputes the inverse against the document (inverseOps is not trusted).
  return { label, ops, inverseOps: [], ...(mergeKey !== undefined ? { mergeKey } : {}) };
}

/** Detects double clicks from successive presses (time and screen distance). */
export class DoubleClick {
  private last: { t: number; p: Point } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  /** Records a press; true when it completes a double click (then reset). */
  press(p: Point): boolean {
    const t = this.ctx.now?.() ?? Date.now();
    const last = this.last;
    const near =
      last !== null &&
      t - last.t <= DOUBLE_CLICK_MS &&
      Math.hypot(p[0] - last.p[0], p[1] - last.p[1]) <= DOUBLE_CLICK_PX * pixelSize(this.ctx);
    this.last = near ? null : { t, p };
    return near;
  }

  reset(): void {
    this.last = null;
  }
}

export function newWall(ctx: ToolContext, points: readonly Point[], closed: boolean): WallObject {
  const s = ctx.settings;
  return {
    uid: uid(ctx),
    floor: ctx.doc.floor,
    type: 'wall',
    layer: 'walls',
    geometry: { points: points.map((p) => [round3(p[0]), round3(p[1])] as Point), closed },
    props: {
      kind: s.wallKind,
      thickness: round3(Math.min(2, Math.max(0.05, s.wallThickness))),
      blocks_vision: true,
      blocks_light: true,
      blocks_move: true,
      texture_asset: null,
      height: null,
    },
    visibility: 'all',
    locked: false,
    sort_order: 0,
    rev: 1,
  };
}

export function newOpening(ctx: ToolContext, a: Point, b: Point): DoorObject | WindowObject {
  const base = {
    uid: uid(ctx),
    floor: ctx.doc.floor,
    layer: 'walls' as const,
    geometry: {
      a: [round3(a[0]), round3(a[1])] as Point,
      b: [round3(b[0]), round3(b[1])] as Point,
    },
    visibility: 'all' as const,
    locked: false,
    sort_order: 0,
    rev: 1,
  };
  if (ctx.settings.openingKind === 'window') {
    return { ...base, type: 'window', props: { kind: ctx.settings.windowKind } };
  }
  return {
    ...base,
    type: 'door',
    props: {
      state: 'closed',
      locked: false,
      secret: false,
      asset_open: null,
      asset_closed: null,
      swing: 'a',
    },
  };
}

type LightPreset = Pick<LightProps, 'radius' | 'dim_radius' | 'color' | 'intensity' | 'flicker'>;

/** Light presets (projet.md 15.2): radius = bright light, dim_radius = outer radius (cells). */
export const LIGHT_PRESETS: Readonly<Record<LightPresetId, LightPreset>> = Object.freeze({
  torch: {
    radius: 4,
    dim_radius: 8,
    color: '#ffb35c',
    intensity: 0.9,
    flicker: { type: 'torch', amp: 0.25, speed: 2 },
  },
  lantern: {
    radius: 6,
    dim_radius: 12,
    color: '#ffd38a',
    intensity: 0.85,
    flicker: { type: 'torch', amp: 0.1, speed: 1.5 },
  },
  candle: {
    radius: 1,
    dim_radius: 2,
    color: '#ffc46b',
    intensity: 0.7,
    flicker: { type: 'torch', amp: 0.3, speed: 3 },
  },
  campfire: {
    radius: 6,
    dim_radius: 10,
    color: '#ff8c3a',
    intensity: 1,
    flicker: { type: 'torch', amp: 0.35, speed: 2.5 },
  },
  magic: {
    radius: 4,
    dim_radius: 8,
    color: '#9ad0ff',
    intensity: 0.8,
    flicker: { type: 'pulse', amp: 0.3, speed: 0.5 },
  },
});

export const LIGHT_PRESET_IDS = Object.keys(LIGHT_PRESETS) as LightPresetId[];

/** Light of a preset; `dimRadius` (drag) scales both radii, keeping the preset ratio. */
export function newLight(
  ctx: ToolContext,
  x: number,
  y: number,
  preset: LightPresetId,
  dimRadius?: number,
): LightObject {
  const p = LIGHT_PRESETS[preset];
  const dim = round3(Math.min(100, Math.max(0.1, dimRadius ?? p.dim_radius)));
  const radius = round3(Math.min(dim, (p.radius / p.dim_radius) * dim));
  return {
    uid: uid(ctx),
    floor: ctx.doc.floor,
    type: 'light',
    layer: 'lighting',
    geometry: { x: round3(x), y: round3(y) },
    props: {
      radius,
      dim_radius: dim,
      color: p.color,
      intensity: p.intensity,
      flicker: { ...p.flicker },
      cone: null,
      enabled: true,
      follows_token: null,
    },
    visibility: 'all',
    locked: false,
    sort_order: 0,
    rev: 1,
  };
}
