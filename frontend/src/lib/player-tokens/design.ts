/**
 * Design of a player-made token (JSON kept on the server to edit the token again) and the pure
 * geometry of the portrait crop. No DOM here: tested with Vitest.
 */

export const SHAPES = ['disc', 'hex', 'shield', 'square', 'diamond'] as const;
export type Shape = (typeof SHAPES)[number];

export const MODES = ['emblem', 'portrait'] as const;
export type Mode = (typeof MODES)[number];

/** Final PNG side, in pixels. */
export const TOKEN_PX = 512;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const RING_MIN = 0;
export const RING_MAX = 0.25;

/** Portrait placement: zoom >= 1 over the "cover" fit; ox / oy in [-1, 1] (0 = centred). */
export interface PortraitCrop {
  zoom: number;
  ox: number;
  oy: number;
}

export interface TokenDesign {
  v: 1;
  shape: Shape;
  bg: string;
  ring: string;
  /** Ring thickness as a fraction of the token radius. */
  ringWidth: number;
  mode: Mode;
  emblem: string;
  emblemColor: string;
  crop: PortraitCrop;
}

export function defaultDesign(): TokenDesign {
  return {
    v: 1,
    shape: 'disc',
    bg: '#3b4a6b',
    ring: '#d9b24c',
    ringWidth: 0.1,
    mode: 'emblem',
    emblem: 'sword',
    emblemColor: '#f2efe6',
    crop: { zoom: 1, ox: 0, oy: 0 },
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** A design read from the server (or anything): every field is checked, bad ones fall back. */
export function parseDesign(raw: unknown, knownEmblems: readonly string[]): TokenDesign {
  const base = defaultDesign();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const crop = (typeof r['crop'] === 'object' && r['crop'] !== null ? r['crop'] : {}) as Record<
    string,
    unknown
  >;
  return {
    v: 1,
    shape: SHAPES.find((s) => s === r['shape']) ?? base.shape,
    bg: color(r['bg'], base.bg),
    ring: color(r['ring'], base.ring),
    ringWidth: num(r['ringWidth'], RING_MIN, RING_MAX, base.ringWidth),
    mode: MODES.find((m) => m === r['mode']) ?? base.mode,
    emblem:
      typeof r['emblem'] === 'string' && knownEmblems.includes(r['emblem'])
        ? r['emblem']
        : base.emblem,
    emblemColor: color(r['emblemColor'], base.emblemColor),
    crop: {
      zoom: num(crop['zoom'], ZOOM_MIN, ZOOM_MAX, 1),
      ox: num(crop['ox'], -1, 1, 0),
      oy: num(crop['oy'], -1, 1, 0),
    },
  };
}

/** JSON text sent to the server (stable key order, small). */
export function serializeDesign(design: TokenDesign): string {
  const d = parseDesign(design, [design.emblem]);
  return JSON.stringify({
    v: 1,
    shape: d.shape,
    bg: d.bg,
    ring: d.ring,
    ringWidth: round(d.ringWidth),
    mode: d.mode,
    emblem: d.emblem,
    emblemColor: d.emblemColor,
    crop: { zoom: round(d.crop.zoom), ox: round(d.crop.ox), oy: round(d.crop.oy) },
  });
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface Rect {
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

/**
 * Where to draw an image of imgW x imgH in a square box of `box` pixels: "cover" fit times the
 * zoom, moved by (ox, oy). The box is always fully covered.
 */
export function cropRect(imgW: number, imgH: number, crop: PortraitCrop, box: number): Rect {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, crop.zoom));
  const scale = (box / Math.min(imgW, imgH)) * zoom;
  const dw = imgW * scale;
  const dh = imgH * scale;
  const ox = Math.min(1, Math.max(-1, crop.ox));
  const oy = Math.min(1, Math.max(-1, crop.oy));
  return {
    dx: (box - dw) / 2 + (ox * (dw - box)) / 2,
    dy: (box - dh) / 2 + (oy * (dh - box)) / 2,
    dw,
    dh,
  };
}

/** Moves the image by a pointer delta (pixels of the box); stays inside the allowed range. */
export function panCrop(
  imgW: number,
  imgH: number,
  crop: PortraitCrop,
  box: number,
  dxPx: number,
  dyPx: number,
): PortraitCrop {
  const r = cropRect(imgW, imgH, crop, box);
  const rangeX = (r.dw - box) / 2;
  const rangeY = (r.dh - box) / 2;
  return {
    zoom: crop.zoom,
    ox: rangeX > 0 ? clamp1(crop.ox + dxPx / rangeX) : 0,
    oy: rangeY > 0 ? clamp1(crop.oy + dyPx / rangeY) : 0,
  };
}

/** Changes the zoom keeping the image point under the box centre in place (re-clamped). */
export function zoomCrop(
  imgW: number,
  imgH: number,
  crop: PortraitCrop,
  box: number,
  zoom: number,
): PortraitCrop {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  const before = cropRect(imgW, imgH, crop, box);
  const after = cropRect(imgW, imgH, { ...crop, zoom: next }, box);
  // Absolute offset of the image centre from the box centre, kept in pixels when possible.
  const cx = before.dx + before.dw / 2 - box / 2;
  const cy = before.dy + before.dh / 2 - box / 2;
  const rangeX = (after.dw - box) / 2;
  const rangeY = (after.dh - box) / 2;
  return {
    zoom: next,
    ox: rangeX > 0 ? clamp1(cx / rangeX) : 0,
    oy: rangeY > 0 ? clamp1(cy / rangeY) : 0,
  };
}

function clamp1(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

/** Size of the portrait source sent for re-editing: longest side at most `max`. */
export function sourceSize(w: number, h: number, max = 1024): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Image made by the generator in library mode (GM tokens). */
export interface GeneratedToken {
  readonly name: string;
  /** TOKEN_PX square PNG. */
  readonly png: Blob;
}
