/** Pure geometry of the text objects (estimated box: the real width depends on the font). */
import type { Point } from './contracts';
import type { TextObject } from './contracts-text';

/** Average glyph width relative to the font size. */
const GLYPH_WIDTH = 0.55;

/** Half width and half height of the text box, cells. */
export function textHalfSize(o: TextObject): { hw: number; hh: number } {
  const chars = Math.max(1, [...o.props.text].length);
  return { hw: (chars * o.props.size * GLYPH_WIDTH) / 2, hh: o.props.size / 2 };
}

/** The four corners of the (rotated) text box. */
export function textCorners(o: TextObject): Point[] {
  const { hw, hh } = textHalfSize(o);
  const a = (o.props.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const
  ).map(([x, y]): Point => [o.geometry.x + x * cos - y * sin, o.geometry.y + x * sin + y * cos]);
}

/** Distance from p to the text box (0 inside). */
export function textDistance(o: TextObject, p: Point): number {
  const { hw, hh } = textHalfSize(o);
  const a = (-o.props.rotation * Math.PI) / 180;
  const dx = p[0] - o.geometry.x;
  const dy = p[1] - o.geometry.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.hypot(Math.max(Math.abs(lx) - hw, 0), Math.max(Math.abs(ly) - hh, 0));
}
