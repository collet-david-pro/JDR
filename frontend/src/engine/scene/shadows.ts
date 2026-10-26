/**
 * Cast shadows (pure, projet.md 14.2 option): for the walls and closed doors blocking light,
 * a quad projected away from each shadow-casting light (at most MAX_SHADOW_LIGHTS). The
 * shadow length grows with the wall height (props.height, default 1) and stops at the light's
 * outer radius. Drawn opaque into a render texture, shown with SHADOW_ALPHA (overlaps do not
 * darken twice).
 */

import type { MapObject, ViewMode } from '../../editor/contracts';
import { SHADOW_LENGTH_PER_HEIGHT } from '../../scene/style';
import type { LightSource } from './lights';
import { polylineSegments, type Seg } from './object-geometry';
import { doorDrawnAsWall } from './view-rules';

export const DEFAULT_WALL_HEIGHT = 1;

export interface ShadowSegment {
  readonly seg: Seg;
  readonly height: number;
}

/** Segments casting shadows in this view (invisible walls and open doors do not). */
export function shadowSegments(objects: readonly MapObject[], mode: ViewMode): ShadowSegment[] {
  const out: ShadowSegment[] = [];
  for (const obj of objects) {
    if (obj.type === 'wall') {
      if (!obj.props.blocks_light || obj.props.kind === 'invisible') continue;
      const height = obj.props.height ?? DEFAULT_WALL_HEIGHT;
      if (!(height > 0)) continue;
      for (const seg of polylineSegments(obj.geometry.points, obj.geometry.closed)) {
        out.push({ seg, height });
      }
    } else if (obj.type === 'door') {
      if (obj.props.state === 'open' && !doorDrawnAsWall(obj, mode)) continue;
      const { a, b } = obj.geometry;
      out.push({ seg: [a[0], a[1], b[0], b[1]], height: DEFAULT_WALL_HEIGHT });
    }
  }
  return out;
}

function distanceToSegment(px: number, py: number, s: Seg): number {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - s[0]) * dx + (py - s[1]) * dy) / len2));
  return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
}

/**
 * Shadow quads of one light: [ax, ay, bx, by, b'x, b'y, a'x, a'y] in cells, a' / b' being the
 * segment ends pushed away from the light.
 */
export function shadowQuads(
  light: Pick<LightSource, 'x' | 'y' | 'dim'>,
  segments: readonly ShadowSegment[],
  lengthPerHeight = SHADOW_LENGTH_PER_HEIGHT,
): Float32Array[] {
  const out: Float32Array[] = [];
  const { x, y, dim } = light;
  for (const { seg, height } of segments) {
    if (distanceToSegment(x, y, seg) >= dim) continue;
    // Light on the segment line: no area to shade.
    const cross = (seg[2] - seg[0]) * (y - seg[1]) - (seg[3] - seg[1]) * (x - seg[0]);
    if (Math.abs(cross) < 1e-6) continue;
    const length = height * lengthPerHeight;
    const push = (px: number, py: number): [number, number] => {
      const dx = px - x;
      const dy = py - y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) return [px, py];
      const ext = Math.min(length, Math.max(0, dim - d));
      return [px + (dx / d) * ext, py + (dy / d) * ext];
    };
    const [a2x, a2y] = push(seg[0], seg[1]);
    const [b2x, b2y] = push(seg[2], seg[3]);
    out.push(new Float32Array([seg[0], seg[1], seg[2], seg[3], b2x, b2y, a2x, a2y]));
  }
  return out;
}
