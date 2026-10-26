/**
 * Geometry of the P5 scene objects (pure, cells unless stated otherwise): wall widths, door
 * leaves (closed / open / sliding), token boxes and initials, edit handles.
 */

import type {
  DoorObject,
  MapObject,
  PlacedToken,
  Point,
  TokenDefView,
} from '../../editor/contracts';
import {
  SLIDE_OFFSET,
  SLIDE_OPEN_FRACTION,
  TOKEN_RING_COLORS,
  WALL_MIN_SCREEN_PX,
} from '../../scene/style';

/** Zoom quantised to half octaves: zoom-dependent widths are redrawn when it changes. */
export function zoomBucket(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) return 1;
  return 2 ** (Math.round(Math.log2(zoom) * 2) / 2);
}

/** Stroke width in world pixels (cell × cellPx) with a minimal width on screen. */
export function strokeWidthPx(
  thicknessCells: number,
  cellPx: number,
  zoom: number,
  minScreenPx = WALL_MIN_SCREEN_PX,
): number {
  const z = zoom > 0 ? zoom : 1;
  return Math.max(Math.max(0, thicknessCells) * cellPx, minScreenPx / z);
}

export type Seg = readonly [ax: number, ay: number, bx: number, by: number];

/** Segments of a polyline (closed: last point joined to the first; degenerate ones dropped). */
export function polylineSegments(points: readonly Point[], closed: boolean): Seg[] {
  const out: Seg[] = [];
  const n = points.length;
  if (n < 2) return out;
  const last = closed && n > 2 ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    if (a[0] === b[0] && a[1] === b[1]) continue;
    out.push([a[0], a[1], b[0], b[1]]);
  }
  return out;
}

export interface DoorShape {
  /** The door leaf. */
  readonly leaf: Seg;
  /** The doorway a–b, drawn faintly when the door is open (null when closed). */
  readonly gap: Seg | null;
}

/**
 * Door leaf: closed = a–b; open with swing 'a' (hinge at a) or 'b' (hinge at b) = the leaf
 * turned by 90° (both open towards the same side: +90° clockwise on screen from a→b);
 * 'slide' = the leaf moved along the wall by SLIDE_OPEN_FRACTION and offset sideways.
 */
export function doorShape(door: DoorObject): DoorShape {
  const [ax, ay] = door.geometry.a;
  const [bx, by] = door.geometry.b;
  if (door.props.state !== 'open') return { leaf: [ax, ay, bx, by], gap: null };
  const dx = bx - ax;
  const dy = by - ay;
  const gap: Seg = [ax, ay, bx, by];
  // Clockwise on screen (Y down): (x, y) → (−y, x).
  const px = -dy;
  const py = dx;
  switch (door.props.swing) {
    case 'a':
      return { leaf: [ax, ay, ax + px, ay + py], gap };
    case 'b':
      return { leaf: [bx, by, bx + px, by + py], gap };
    default: {
      const len = Math.hypot(dx, dy) || 1;
      const ox = (px / len) * SLIDE_OFFSET + dx * SLIDE_OPEN_FRACTION;
      const oy = (py / len) * SLIDE_OFFSET + dy * SLIDE_OPEN_FRACTION;
      return { leaf: [ax + ox, ay + oy, bx + ox, by + oy], gap };
    }
  }
}

export function segmentMiddle(s: Seg): Point {
  return [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2];
}

/** Token size in cells (definition size × scale; 1 × 1 when the definition is unknown). */
export function tokenBox(
  token: PlacedToken,
  def: TokenDefView | null,
): { readonly w: number; readonly h: number } {
  const scale = token.scale > 0 ? token.scale : 1;
  const w = def !== null && def.sizeW > 0 ? def.sizeW : 1;
  const h = def !== null && def.sizeH > 0 ? def.sizeH : 1;
  return { w: w * scale, h: h * scale };
}

export function parseColor(color: string | null | undefined): number | null {
  if (typeof color !== 'string') return null;
  const m = /^#([0-9a-fA-F]{6})$/.exec(color);
  return m === null ? null : parseInt(m[1]!, 16);
}

export function tokenRingColor(def: TokenDefView | null): number {
  return parseColor(def?.ringColor) ?? TOKEN_RING_COLORS[def?.kind ?? 'object'];
}

/** Up to two initials of a name ("Gobelin archer" → "GA", "Zed" → "Z"). */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_'’.]+/u)
    .filter((w) => w !== '');
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? '');
  return letters.join('').toLocaleUpperCase('fr');
}

/** Edit handles of an object (overlay 'objects'), in cells. */
export function objectHandles(
  obj: MapObject,
  position?: Point,
): { readonly kind: 'vertex' | 'end' | 'centre' | 'radius'; readonly at: Point }[] {
  switch (obj.type) {
    case 'wall':
      return obj.geometry.points.map((p) => ({ kind: 'vertex' as const, at: p }));
    case 'door':
    case 'window':
      return [
        { kind: 'end', at: obj.geometry.a },
        { kind: 'end', at: obj.geometry.b },
      ];
    case 'light': {
      const [x, y] = position ?? [obj.geometry.x, obj.geometry.y];
      return [
        { kind: 'centre', at: [x, y] },
        // Radius handle on the outer (dim) circle, east of the light (lot 4 hit-tests it).
        { kind: 'radius', at: [x + obj.props.dim_radius, y] },
      ];
    }
  }
}

/** Light position: the followed token when it exists, else its own geometry. */
export function lightPosition(
  light: Extract<MapObject, { type: 'light' }>,
  token: (uid: string) => PlacedToken | undefined,
): Point {
  const follows = light.props.follows_token;
  if (follows !== null) {
    const t = token(follows);
    if (t !== undefined) return [t.x, t.y];
  }
  return [light.geometry.x, light.geometry.y];
}
