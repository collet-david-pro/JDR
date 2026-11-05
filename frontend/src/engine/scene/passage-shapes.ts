/**
 * Drawing of the P9a passages (stairs, portal) with plain vector shapes (no external asset):
 * pure geometry helpers (cells) and the Graphics painters used by the objects renderer.
 */
import type { PortalIcon, PortalObject, StairsObject } from '../../editor/contracts';
import { WALL_OUTLINE } from '../../scene/style';
import type { Graphics } from '../pixi';
import { parseColor } from './object-geometry';

/** Fill color of stairs. */
export const STAIRS_COLOR = 0xb8a98a;
/** Color of stairs steps. */
export const STAIRS_STEP_COLOR = 0x5b4f3a;

type Seg = readonly [number, number, number, number];

/**
 * Step lines of a stairs rectangle: perpendicular to the longest side, evenly spaced (one per
 * cell, 2 to 12). `direction` does not change the lines (it is the arrow).
 */
export function stairsStepLines(g: StairsObject['geometry']): Seg[] {
  const horizontal = g.w >= g.h;
  const len = horizontal ? g.w : g.h;
  const n = Math.min(12, Math.max(2, Math.round(len)));
  const out: Seg[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    out.push(
      horizontal
        ? [g.x + g.w * t, g.y, g.x + g.w * t, g.y + g.h]
        : [g.x, g.y + g.h * t, g.x + g.w, g.y + g.h * t],
    );
  }
  return out;
}

/** Arrow of a stairs (shaft + two barbs), pointing to the high end for 'up' and low end for 'down'. */
export function stairsArrow(g: StairsObject['geometry'], direction: 'up' | 'down'): Seg[] {
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const horizontal = g.w >= g.h;
  // Convention: 'up' points to the east / north end, 'down' to the opposite one.
  const s = direction === 'up' ? 1 : -1;
  const half = (horizontal ? g.w : g.h) * 0.3;
  const barb = Math.min(0.3, (horizontal ? g.h : g.w) * 0.3);
  if (horizontal) {
    const tip = cx + s * half;
    const tail = cx - s * half;
    return [
      [tail, cy, tip, cy],
      [tip, cy, tip - s * barb, cy - barb],
      [tip, cy, tip - s * barb, cy + barb],
    ];
  }
  const tip = cy - s * half;
  const tail = cy + s * half;
  return [
    [cx, tail, cx, tip],
    [cx, tip, cx - barb, tip + s * barb],
    [cx, tip, cx + barb, tip + s * barb],
  ];
}

/** Radius of the portal disc (cells). */
export const PORTAL_RADIUS = 0.4;

/** Draws stairs. */
export function drawStairs(g: Graphics, o: StairsObject, cellPx: number, bucket: number): void {
  const { x, y, w, h } = o.geometry;
  const k = cellPx;
  g.rect(x * k, y * k, w * k, h * k).fill({ color: STAIRS_COLOR, alpha: 0.55 });
  for (const s of stairsStepLines(o.geometry)) {
    g.moveTo(s[0] * k, s[1] * k).lineTo(s[2] * k, s[3] * k);
  }
  g.stroke({ width: Math.max(1 / bucket, 0.03 * k), color: STAIRS_STEP_COLOR, alpha: 0.8 });
  g.rect(x * k, y * k, w * k, h * k).stroke({
    width: Math.max(1.5 / bucket, 0.05 * k),
    color: WALL_OUTLINE,
    alpha: 0.9,
  });
  for (const s of stairsArrow(o.geometry, o.props.direction)) {
    g.moveTo(s[0] * k, s[1] * k).lineTo(s[2] * k, s[3] * k);
  }
  g.stroke({ width: Math.max(2 / bucket, 0.07 * k), color: 0xffffff, alpha: 0.95, cap: 'round' });
}

/** Draws a portal. */
export function drawPortal(g: Graphics, o: PortalObject, cellPx: number, bucket: number): void {
  const k = cellPx;
  const cx = o.geometry.x * k;
  const cy = o.geometry.y * k;
  const r = PORTAL_RADIUS * k;
  const color = parseColor(o.props.color) ?? 0x7c4dff;
  g.circle(cx, cy, r).fill({ color, alpha: 0.85 });
  g.circle(cx, cy, r).stroke({
    width: Math.max(1.5 / bucket, 0.05 * k),
    color: WALL_OUTLINE,
    alpha: 0.95,
  });
  drawPortalGlyph(g, o.props.icon, cx, cy, r * 0.6, Math.max(1.5 / bucket, 0.06 * k));
}

function drawPortalGlyph(
  g: Graphics,
  icon: PortalIcon,
  cx: number,
  cy: number,
  s: number,
  width: number,
): void {
  const line = (ax: number, ay: number, bx: number, by: number): void => {
    g.moveTo(cx + ax * s, cy + ay * s).lineTo(cx + bx * s, cy + by * s);
  };
  switch (icon) {
    case 'portal':
      g.circle(cx, cy, s * 0.9);
      g.circle(cx, cy, s * 0.4);
      break;
    case 'door':
      g.rect(cx - s * 0.6, cy - s, s * 1.2, s * 2);
      line(0.25, 0.1, 0.25, 0.15);
      break;
    case 'stairs':
      line(-1, 0.8, -0.4, 0.8);
      line(-0.4, 0.8, -0.4, 0.2);
      line(-0.4, 0.2, 0.2, 0.2);
      line(0.2, 0.2, 0.2, -0.4);
      line(0.2, -0.4, 0.8, -0.4);
      break;
    case 'ladder':
      line(-0.5, -1, -0.5, 1);
      line(0.5, -1, 0.5, 1);
      line(-0.5, -0.5, 0.5, -0.5);
      line(-0.5, 0, 0.5, 0);
      line(-0.5, 0.5, 0.5, 0.5);
      break;
    case 'trapdoor':
      g.rect(cx - s * 0.9, cy - s * 0.9, s * 1.8, s * 1.8);
      line(-0.9, -0.9, 0.9, 0.9);
      line(0.9, -0.9, -0.9, 0.9);
      break;
  }
  g.stroke({ width, color: 0xffffff, alpha: 0.98, cap: 'round', join: 'round' });
}
