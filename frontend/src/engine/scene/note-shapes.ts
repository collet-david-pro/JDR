/**
 * Drawing of the P9b2a objects (pin, zone, trap, secret) with plain vector shapes (no external
 * asset): Graphics painters used by the objects renderer. World space: pixels at zoom 1
 * (`cellPx` per cell); `bucket` keeps the lines readable at every zoom.
 */
import type { PinObject, SecretObject, TrapObject, ZoneObject } from '../../editor/contracts-notes';
import { SECRET_DOOR_OUTLINE, WALL_OUTLINE } from '../../scene/style';
import { dashSegments } from '../overlay-geometry';
import type { Graphics } from '../pixi';
import { parseColor } from './object-geometry';

/** Fill color of zones. */
export const ZONE_COLOR = 0x3f9bd8;
/** Fill color of traps. */
export const TRAP_COLOR = 0xe0762c;
/** Color of secrets. */
export const SECRET_COLOR = SECRET_DOOR_OUTLINE;
/** Radius of a pin disc / point trap marker (cells). */
export const PIN_RADIUS = 0.3;
/** Radius of the trap mark, in cells. */
export const TRAP_MARK_RADIUS = 0.28;

type Poly = readonly (readonly [number, number])[];

function ring(g: Graphics, pts: Poly, k: number): void {
  pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x * k, y * k) : g.lineTo(x * k, y * k)));
  g.closePath();
}

/** Dashed outline of a closed polygon. */
function dashedRing(
  g: Graphics,
  pts: Poly,
  k: number,
  bucket: number,
  color: number,
  alpha: number,
): void {
  const dash = Math.max(0.25 * k, 6 / bucket);
  const gap = dash * 0.7;
  let any = false;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    for (const d of dashSegments(a[0] * k, a[1] * k, b[0] * k, b[1] * k, dash, gap)) {
      g.moveTo(d[0], d[1]).lineTo(d[2], d[3]);
      any = true;
    }
  }
  if (any) g.stroke({ width: Math.max(1.5 / bucket, 0.04 * k), color, alpha, cap: 'butt' });
}

const toPoly = (g: { readonly polygon: readonly { x: number; y: number }[] }): Poly =>
  g.polygon.map((q) => [q.x, q.y] as const);

/** Draws a pin. */
export function drawPin(g: Graphics, o: PinObject, cellPx: number, bucket: number): void {
  const k = cellPx;
  const cx = o.geometry.x * k;
  const cy = o.geometry.y * k;
  const r = PIN_RADIUS * k;
  const color = parseColor(o.props.color) ?? 0xd9534f;
  g.circle(cx, cy, r).fill({ color, alpha: 0.92 });
  g.circle(cx, cy, r).stroke({
    width: Math.max(1.5 / bucket, 0.05 * k),
    color: WALL_OUTLINE,
    alpha: 0.95,
  });
  const s = r * 0.55;
  const line = (ax: number, ay: number, bx: number, by: number): void => {
    g.moveTo(cx + ax * s, cy + ay * s).lineTo(cx + bx * s, cy + by * s);
  };
  switch (o.props.icon) {
    case 'place':
      g.circle(cx, cy, s * 0.45);
      break;
    case 'danger':
      line(0, -1, 0, 0.2);
      line(0, 0.7, 0, 0.75);
      break;
    case 'treasure':
      g.rect(cx - s, cy - s * 0.6, s * 2, s * 1.2);
      line(-1, -0.1, 1, -0.1);
      break;
    case 'npc':
      g.circle(cx, cy - s * 0.5, s * 0.4);
      line(-0.8, 0.9, 0, 0.1);
      line(0, 0.1, 0.8, 0.9);
      break;
    case 'info':
      line(0, -0.1, 0, 0.9);
      line(0, -0.8, 0, -0.75);
      break;
  }
  g.stroke({
    width: Math.max(1.5 / bucket, 0.06 * k),
    color: 0xffffff,
    alpha: 0.98,
    cap: 'round',
    join: 'round',
  });
}

/** Draws a zone. */
export function drawZone(g: Graphics, o: ZoneObject, cellPx: number, bucket: number): void {
  const pts = toPoly(o.geometry);
  ring(g, pts, cellPx);
  g.fill({ color: ZONE_COLOR, alpha: 0.18 });
  dashedRing(g, pts, cellPx, bucket, ZONE_COLOR, 0.9);
}

/** Red halo of a trap that was just revealed (`props.pulse`, client only). */
function drawPulse(g: Graphics, o: TrapObject, k: number): void {
  const geo = o.geometry;
  const pts = 'polygon' in geo ? geo.polygon : [geo];
  const cx = (pts.reduce((s, q) => s + q.x, 0) / pts.length) * k;
  const cy = (pts.reduce((s, q) => s + q.y, 0) / pts.length) * k;
  g.circle(cx, cy, TRAP_MARK_RADIUS * k * 2.6).fill({ color: 0xff2d2d, alpha: 0.35 });
  g.circle(cx, cy, TRAP_MARK_RADIUS * k * 2.6).stroke({
    width: 0.08 * k,
    color: 0xff2d2d,
    alpha: 0.9,
  });
}

/** Draws a trap. */
export function drawTrap(g: Graphics, o: TrapObject, cellPx: number, bucket: number): void {
  const k = cellPx;
  const geo = o.geometry;
  if (o.props.pulse === true) drawPulse(g, o, k);
  if ('polygon' in geo) {
    const pts = toPoly(geo);
    ring(g, pts, k);
    g.fill({ color: TRAP_COLOR, alpha: 0.2 });
    dashedRing(g, pts, k, bucket, TRAP_COLOR, 0.95);
    return;
  }
  // Point: a warning triangle.
  const cx = geo.x * k;
  const cy = geo.y * k;
  const r = TRAP_MARK_RADIUS * k;
  g.poly([cx, cy - r, cx + r * 0.95, cy + r * 0.75, cx - r * 0.95, cy + r * 0.75]).fill({
    color: TRAP_COLOR,
    alpha: 0.92,
  });
  g.poly([cx, cy - r, cx + r * 0.95, cy + r * 0.75, cx - r * 0.95, cy + r * 0.75]).stroke({
    width: Math.max(1.5 / bucket, 0.05 * k),
    color: WALL_OUTLINE,
    alpha: 0.95,
  });
  g.moveTo(cx, cy - r * 0.35).lineTo(cx, cy + r * 0.2);
  g.stroke({ width: Math.max(1.5 / bucket, 0.06 * k), color: 0xffffff, alpha: 0.98, cap: 'round' });
}

/** GM view of a secret: a dashed segment (passage) or polygon (room, object). */
export function drawSecret(g: Graphics, o: SecretObject, cellPx: number, bucket: number): void {
  const k = cellPx;
  const geo = o.geometry;
  if ('polygon' in geo) {
    const pts = toPoly(geo);
    ring(g, pts, k);
    g.fill({ color: SECRET_COLOR, alpha: 0.14 });
    dashedRing(g, pts, k, bucket, SECRET_COLOR, 0.95);
    return;
  }
  const revealed = o.props.revealed === true;
  const dash = Math.max(0.25 * k, 6 / bucket) * (revealed ? 0.6 : 1);
  let any = false;
  for (const d of dashSegments(
    geo.a[0] * k,
    geo.a[1] * k,
    geo.b[0] * k,
    geo.b[1] * k,
    dash,
    dash * 0.7,
  )) {
    g.moveTo(d[0], d[1]).lineTo(d[2], d[3]);
    any = true;
  }
  if (any) {
    g.stroke({
      width: Math.max(3 / bucket, 0.12 * k),
      color: revealed ? 0xe8e0c8 : SECRET_COLOR,
      alpha: revealed ? 0.8 : 0.95,
      cap: 'butt',
    });
  }
}
