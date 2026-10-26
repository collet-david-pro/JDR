/**
 * P5 edit overlays (contracts.ts revision 3), drawn in screen space by OverlayRenderer:
 * `objects` (selected objects / tokens: outline + handles), `polyline` (wall tool),
 * `segment` (door / window tool, red when invalid), `light` (light tool), `snap`, `area`.
 */

import type { Overlay, Point, SceneView } from '../editor/contracts';
import { normalizeRect } from './overlay-geometry';
import { dashSegments } from './overlay-geometry';
import type { Graphics } from './pixi';
import { lightPosition, objectHandles, tokenBox } from './scene/object-geometry';

export const OVERLAY_ACCENT = 0x2f80ed;
export const OVERLAY_ERASE = 0xe5484d;
export const OVERLAY_DARK = 0x111418;
export const OVERLAY_LIGHT = 0xffffff;
/** Handle size, screen px. */
export const HANDLE_PX = 8;

export type ToScreen = (x: number, y: number) => { x: number; y: number };

export type SceneOverlay = Extract<
  Overlay,
  { kind: 'objects' | 'polyline' | 'segment' | 'light' | 'snap' | 'area' }
>;

export function isSceneOverlay(o: Overlay): o is SceneOverlay {
  return (
    o.kind === 'objects' ||
    o.kind === 'polyline' ||
    o.kind === 'segment' ||
    o.kind === 'light' ||
    o.kind === 'snap' ||
    o.kind === 'area'
  );
}

/** Screen points of a rotated token box (cells → screen), clockwise from top-left. */
export function tokenCorners(
  x: number,
  y: number,
  w: number,
  h: number,
  rotationDeg: number,
): Point[] {
  const a = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const corners: Point[] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  return corners.map(([dx, dy]) => [x + dx * c - dy * s, y + dx * s + dy * c] as const);
}

function handle(g: Graphics, x: number, y: number, round = false): void {
  const r = HANDLE_PX / 2;
  if (round) g.circle(x, y, r);
  else g.rect(x - r, y - r, HANDLE_PX, HANDLE_PX);
  g.fill({ color: OVERLAY_LIGHT }).stroke({ width: 1.5, color: OVERLAY_ACCENT });
}

function path(g: Graphics, pts: readonly { x: number; y: number }[], closed: boolean): void {
  if (pts.length < 2) return;
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
  if (closed && pts.length > 2) g.closePath();
}

/** Outline readable on any background: dark halo then the colour. */
function outline(
  g: Graphics,
  pts: readonly { x: number; y: number }[],
  closed: boolean,
  color = OVERLAY_ACCENT,
): void {
  path(g, pts, closed);
  g.stroke({ width: 4, color: OVERLAY_DARK, alpha: 0.45, join: 'round', cap: 'round' });
  path(g, pts, closed);
  g.stroke({ width: 2, color, alpha: 1, join: 'round', cap: 'round' });
}

function dashedCircle(g: Graphics, cx: number, cy: number, r: number, color: number): void {
  if (!(r > 0)) return;
  const steps = Math.max(16, Math.min(128, Math.round(r / 4)));
  for (let i = 0; i < steps; i += 2) {
    const a0 = (i / steps) * Math.PI * 2;
    const a1 = ((i + 1) / steps) * Math.PI * 2;
    g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    g.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
  }
  g.stroke({ width: 1.5, color, alpha: 0.95 });
}

function lightRings(
  g: Graphics,
  toScreen: ToScreen,
  x: number,
  y: number,
  radius: number,
  dim: number,
): void {
  const c = toScreen(x, y);
  const r = toScreen(x + radius, y).x - c.x;
  const d = toScreen(x + dim, y).x - c.x;
  if (r > 0) {
    g.circle(c.x, c.y, r).stroke({ width: 3, color: OVERLAY_DARK, alpha: 0.35 });
    g.circle(c.x, c.y, r).stroke({ width: 1.5, color: OVERLAY_ACCENT, alpha: 1 });
  }
  dashedCircle(g, c.x, c.y, d, OVERLAY_ACCENT);
}

export function drawSceneOverlay(
  g: Graphics,
  o: SceneOverlay,
  toScreen: ToScreen,
  scene: SceneView | null,
): void {
  switch (o.kind) {
    case 'polyline': {
      const pts = o.points.map(([x, y]) => toScreen(x, y));
      outline(g, pts, o.closed);
      const last = pts[pts.length - 1];
      if (o.cursor !== undefined && last !== undefined) {
        const c = toScreen(o.cursor[0], o.cursor[1]);
        for (const d of dashSegments(last.x, last.y, c.x, c.y, 6, 4)) {
          g.moveTo(d[0], d[1]).lineTo(d[2], d[3]);
        }
        g.stroke({ width: 2, color: OVERLAY_ACCENT, alpha: 0.9 });
      }
      for (const p of pts) handle(g, p.x, p.y);
      break;
    }
    case 'segment': {
      const a = toScreen(o.a[0], o.a[1]);
      const b = toScreen(o.b[0], o.b[1]);
      const color = o.valid ? OVERLAY_ACCENT : OVERLAY_ERASE;
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 8, color: OVERLAY_DARK, alpha: 0.35 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 5, color, alpha: 0.9, cap: 'round' });
      for (const p of [a, b]) {
        g.circle(p.x, p.y, 4).fill({ color }).stroke({ width: 1.5, color: OVERLAY_LIGHT });
      }
      break;
    }
    case 'light': {
      lightRings(g, toScreen, o.x, o.y, o.radius, o.dimRadius);
      const c = toScreen(o.x, o.y);
      handle(g, c.x, c.y, true);
      break;
    }
    case 'snap': {
      const p = toScreen(o.x, o.y);
      const r = 6;
      g.poly([p.x, p.y - r, p.x + r, p.y, p.x, p.y + r, p.x - r, p.y], true)
        .fill({ color: OVERLAY_LIGHT, alpha: 0.9 })
        .stroke({ width: 2, color: OVERLAY_ACCENT });
      break;
    }
    case 'area': {
      const r = normalizeRect(o.x, o.y, o.w, o.h);
      const a = toScreen(r.x, r.y);
      const b = toScreen(r.x + r.w, r.y + r.h);
      const color = o.erase === true ? OVERLAY_ERASE : OVERLAY_ACCENT;
      g.rect(a.x, a.y, b.x - a.x, b.y - a.y)
        .fill({ color, alpha: 0.14 })
        .stroke({ width: 1.5, color, alpha: 0.95, alignment: 0.5 });
      break;
    }
    case 'objects':
      if (scene !== null) drawSelection(g, o, toScreen, scene);
      break;
  }
}

function drawSelection(
  g: Graphics,
  o: Extract<Overlay, { kind: 'objects' }>,
  toScreen: ToScreen,
  scene: SceneView,
): void {
  for (const uid of o.objects) {
    const obj = scene.object(uid);
    if (obj === undefined) continue;
    switch (obj.type) {
      case 'wall':
        outline(
          g,
          obj.geometry.points.map(([x, y]) => toScreen(x, y)),
          obj.geometry.closed,
        );
        break;
      case 'door':
      case 'window':
        outline(
          g,
          [obj.geometry.a, obj.geometry.b].map(([x, y]) => toScreen(x, y)),
          false,
        );
        break;
      case 'light': {
        const [x, y] = lightPosition(obj, (t) => scene.token(t));
        lightRings(g, toScreen, x, y, obj.props.radius, obj.props.dim_radius);
        break;
      }
    }
    const position = obj.type === 'light' ? lightPosition(obj, (t) => scene.token(t)) : undefined;
    for (const h of objectHandles(obj, position)) {
      const p = toScreen(h.at[0], h.at[1]);
      handle(g, p.x, p.y, h.kind === 'radius' || h.kind === 'centre');
    }
  }
  for (const uid of o.tokens) {
    const t = scene.token(uid);
    if (t === undefined) continue;
    const box = tokenBox(t, scene.tokenDef(t.token_id));
    const corners = tokenCorners(t.x, t.y, box.w, box.h, t.rotation).map(([x, y]) =>
      toScreen(x, y),
    );
    outline(g, corners, true);
    const c = toScreen(t.x, t.y);
    handle(g, c.x, c.y, true);
  }
}
